#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::Command;
use std::sync::atomic::{AtomicI32, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};

#[derive(Clone, Debug, Deserialize, Serialize)]
struct MouseTriggerConfig {
    enabled: bool,
    button: u32,
    consume: bool,
}

impl Default for MouseTriggerConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            button: 8,
            consume: true,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
struct MouseTriggerStatus {
    available: bool,
    backend: String,
    message: String,
    active: bool,
    recording: bool,
    grabbed_button: Option<u32>,
    last_error: Option<String>,
}

impl MouseTriggerStatus {
    fn new(available: bool, backend: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            available,
            backend: backend.into(),
            message: message.into(),
            active: false,
            recording: false,
            grabbed_button: None,
            last_error: None,
        }
    }

    fn with_runtime(&self, runtime: MouseTriggerRuntimeStatus) -> Self {
        Self {
            active: runtime.active,
            recording: runtime.recording,
            grabbed_button: runtime.grabbed_button,
            last_error: runtime.last_error,
            ..self.clone()
        }
    }
}

#[derive(Clone, Debug, Serialize)]
struct MouseTriggerRecorded {
    button: u32,
}

enum MouseTriggerCommand {
    Configure(MouseTriggerConfig),
    StartRecording { timeout_ms: u64 },
    StopRecording,
}

struct MouseTriggerState {
    tx: Option<Sender<MouseTriggerCommand>>,
    status: MouseTriggerStatus,
    runtime: Arc<Mutex<MouseTriggerRuntimeStatus>>,
}

#[derive(Clone, Debug, Default)]
struct MouseTriggerRuntimeStatus {
    active: bool,
    recording: bool,
    grabbed_button: Option<u32>,
    last_error: Option<String>,
}

fn mouse_trigger_status_value() -> MouseTriggerStatus {
    #[cfg(target_os = "linux")]
    {
        let session = std::env::var("XDG_SESSION_TYPE").unwrap_or_default();
        let display = std::env::var("DISPLAY").unwrap_or_default();
        if session == "x11" && !display.is_empty() {
            return MouseTriggerStatus::new(
                true,
                "x11",
                "Ubuntu X11 mouse side button binding is available.",
            );
        }
        return MouseTriggerStatus::new(
            false,
            if session.is_empty() {
                "unknown".into()
            } else {
                session
            },
            "Mouse side button binding is only available on Ubuntu X11 for now.",
        );
    }

    #[cfg(not(target_os = "linux"))]
    {
        MouseTriggerStatus::new(
            false,
            std::env::consts::OS,
            "Mouse side button binding is only implemented for Ubuntu X11 for now.",
        )
    }
}

#[cfg(target_os = "linux")]
fn spawn_x11_mouse_trigger(
    app: tauri::AppHandle,
    runtime: Arc<Mutex<MouseTriggerRuntimeStatus>>,
) -> Option<Sender<MouseTriggerCommand>> {
    if !mouse_trigger_status_value().available {
        return None;
    }
    let (tx, rx) = mpsc::channel::<MouseTriggerCommand>();
    thread::spawn(move || run_x11_mouse_trigger(app, rx, runtime));
    Some(tx)
}

#[cfg(not(target_os = "linux"))]
fn spawn_x11_mouse_trigger(
    _app: tauri::AppHandle,
    _runtime: Arc<Mutex<MouseTriggerRuntimeStatus>>,
) -> Option<Sender<MouseTriggerCommand>> {
    None
}

#[cfg(target_os = "linux")]
fn run_x11_mouse_trigger(
    app: tauri::AppHandle,
    rx: Receiver<MouseTriggerCommand>,
    runtime: Arc<Mutex<MouseTriggerRuntimeStatus>>,
) {
    use std::ptr;
    use std::time::{Duration as StdDuration, Instant};
    use x11::xlib;

    unsafe {
        xlib::XSetErrorHandler(Some(x11_error_handler));
        let display = xlib::XOpenDisplay(ptr::null());
        if display.is_null() {
            set_mouse_runtime_error(&runtime, "Cannot open X11 display.".into());
            let _ = app.emit("mouse-trigger-error", "Cannot open X11 display.");
            return;
        }
        let root = xlib::XDefaultRootWindow(display);
        let mut config = MouseTriggerConfig::default();
        let mut grabbed_button: Option<u32> = None;
        let mut recording_until: Option<Instant> = None;

        loop {
            while let Ok(command) = rx.try_recv() {
                match command {
                    MouseTriggerCommand::Configure(next) => {
                        if let Some(button) = grabbed_button.take() {
                            xlib::XUngrabButton(display, button, xlib::AnyModifier, root);
                        }
                        config = next;
                        if config.enabled {
                            grabbed_button =
                                try_grab_configured(display, root, &config, &runtime, &app);
                        } else {
                            set_mouse_runtime(&runtime, false, false, None, None);
                        }
                        xlib::XFlush(display);
                    }
                    MouseTriggerCommand::StartRecording { timeout_ms } => {
                        if let Some(button) = grabbed_button.take() {
                            xlib::XUngrabButton(display, button, xlib::AnyModifier, root);
                        }
                        let mut failed: Vec<String> = Vec::new();
                        for button in 8..=12 {
                            if let Err(message) = grab_button(display, root, button, true) {
                                failed.push(format!("Button{button}: {message}"));
                            }
                        }
                        if failed.len() == 5 {
                            let message = format!(
                                "Mouse recording could not grab side buttons. Another app may own them: {}",
                                failed.join("; ")
                            );
                            set_mouse_runtime(&runtime, false, false, None, Some(message.clone()));
                            let _ = app.emit("mouse-trigger-error", message);
                            continue;
                        }
                        if !failed.is_empty() {
                            let message = format!(
                                "Some side buttons could not be recorded: {}",
                                failed.join("; ")
                            );
                            set_mouse_runtime(&runtime, false, true, None, Some(message.clone()));
                            let _ = app.emit("mouse-trigger-error", message);
                        } else {
                            set_mouse_runtime(&runtime, false, true, None, None);
                        }
                        recording_until =
                            Some(Instant::now() + StdDuration::from_millis(timeout_ms));
                        xlib::XFlush(display);
                    }
                    MouseTriggerCommand::StopRecording => {
                        for button in 8..=12 {
                            xlib::XUngrabButton(display, button, xlib::AnyModifier, root);
                        }
                        recording_until = None;
                        if config.enabled {
                            grabbed_button =
                                try_grab_configured(display, root, &config, &runtime, &app);
                        } else {
                            set_mouse_runtime(&runtime, false, false, None, None);
                        }
                        xlib::XFlush(display);
                    }
                }
            }

            if recording_until.is_some_and(|deadline| Instant::now() > deadline) {
                for button in 8..=12 {
                    xlib::XUngrabButton(display, button, xlib::AnyModifier, root);
                }
                recording_until = None;
                if config.enabled {
                    grabbed_button = try_grab_configured(display, root, &config, &runtime, &app);
                } else {
                    set_mouse_runtime(&runtime, false, false, None, None);
                }
                xlib::XFlush(display);
            }

            while xlib::XPending(display) > 0 {
                let mut event: xlib::XEvent = std::mem::zeroed();
                xlib::XNextEvent(display, &mut event);
                if event.get_type() != xlib::ButtonPress {
                    continue;
                }
                let button = event.button.button;
                if recording_until.is_some() && (8..=12).contains(&button) {
                    let _ = app.emit("mouse-trigger-recorded", MouseTriggerRecorded { button });
                    for item in 8..=12 {
                        xlib::XUngrabButton(display, item, xlib::AnyModifier, root);
                    }
                    config.button = button;
                    recording_until = None;
                    if config.enabled {
                        grabbed_button =
                            try_grab_configured(display, root, &config, &runtime, &app);
                    } else {
                        set_mouse_runtime(&runtime, false, false, None, None);
                    }
                    xlib::XFlush(display);
                    continue;
                }
                if config.enabled && button == config.button {
                    let _ = app.emit("mouse-trigger", MouseTriggerRecorded { button });
                }
            }

            thread::sleep(StdDuration::from_millis(12));
        }
    }
}

#[cfg(target_os = "linux")]
static LAST_X_ERROR: AtomicI32 = AtomicI32::new(0);

#[cfg(target_os = "linux")]
unsafe extern "C" fn x11_error_handler(
    _display: *mut x11::xlib::Display,
    error: *mut x11::xlib::XErrorEvent,
) -> i32 {
    if !error.is_null() {
        LAST_X_ERROR.store((*error).error_code as i32, Ordering::SeqCst);
    }
    0
}

#[cfg(target_os = "linux")]
unsafe fn grab_button(
    display: *mut x11::xlib::Display,
    root: x11::xlib::Window,
    button: u32,
    consume: bool,
) -> Result<(), String> {
    use x11::xlib;
    LAST_X_ERROR.store(0, Ordering::SeqCst);
    xlib::XGrabButton(
        display,
        button,
        xlib::AnyModifier,
        root,
        if consume { xlib::False } else { xlib::True },
        xlib::ButtonPressMask as u32,
        xlib::GrabModeAsync,
        xlib::GrabModeAsync,
        0,
        0,
    );
    xlib::XSync(display, xlib::False);
    let error_code = LAST_X_ERROR.load(Ordering::SeqCst);
    if error_code != 0 {
        return Err(format!(
            "XGrabButton failed with X11 error code {error_code}"
        ));
    }
    Ok(())
}

#[cfg(target_os = "linux")]
unsafe fn try_grab_configured(
    display: *mut x11::xlib::Display,
    root: x11::xlib::Window,
    config: &MouseTriggerConfig,
    runtime: &Arc<Mutex<MouseTriggerRuntimeStatus>>,
    app: &tauri::AppHandle,
) -> Option<u32> {
    match grab_button(display, root, config.button, config.consume) {
        Ok(()) => {
            let grabbed = Some(config.button);
            set_mouse_runtime(runtime, true, false, grabbed, None);
            grabbed
        }
        Err(message) => {
            set_mouse_runtime(runtime, false, false, None, Some(message.clone()));
            let _ = app.emit("mouse-trigger-error", message);
            None
        }
    }
}

fn set_mouse_runtime(
    runtime: &Arc<Mutex<MouseTriggerRuntimeStatus>>,
    active: bool,
    recording: bool,
    grabbed_button: Option<u32>,
    last_error: Option<String>,
) {
    if let Ok(mut status) = runtime.lock() {
        status.active = active;
        status.recording = recording;
        status.grabbed_button = grabbed_button;
        status.last_error = last_error;
    }
}

fn set_mouse_runtime_error(runtime: &Arc<Mutex<MouseTriggerRuntimeStatus>>, last_error: String) {
    set_mouse_runtime(runtime, false, false, None, Some(last_error));
}

#[tauri::command]
fn mouse_trigger_status(state: tauri::State<MouseTriggerState>) -> MouseTriggerStatus {
    let runtime = state
        .runtime
        .lock()
        .map(|status| status.clone())
        .unwrap_or_default();
    state.status.with_runtime(runtime)
}

#[tauri::command]
fn configure_mouse_trigger(
    config: MouseTriggerConfig,
    state: tauri::State<MouseTriggerState>,
) -> Result<(), String> {
    if !(8..=12).contains(&config.button) {
        return Err("Mouse trigger button must be between 8 and 12.".into());
    }
    if state.tx.is_none() && !config.enabled {
        return Ok(());
    }
    let tx = state
        .tx
        .as_ref()
        .ok_or_else(|| state.status.message.clone())?;
    tx.send(MouseTriggerCommand::Configure(config))
        .map_err(|err| err.to_string())
}

#[tauri::command]
fn start_mouse_trigger_recording(
    timeout_ms: u64,
    state: tauri::State<MouseTriggerState>,
) -> Result<(), String> {
    if timeout_ms < 500 || timeout_ms > 30000 {
        return Err("Mouse recording timeout must be between 500 and 30000 ms.".into());
    }
    let tx = state
        .tx
        .as_ref()
        .ok_or_else(|| state.status.message.clone())?;
    tx.send(MouseTriggerCommand::StartRecording { timeout_ms })
        .map_err(|err| err.to_string())
}

#[tauri::command]
fn stop_mouse_trigger_recording(state: tauri::State<MouseTriggerState>) -> Result<(), String> {
    let tx = state
        .tx
        .as_ref()
        .ok_or_else(|| state.status.message.clone())?;
    tx.send(MouseTriggerCommand::StopRecording)
        .map_err(|err| err.to_string())
}

#[tauri::command]
fn simulate_copy() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let status = Command::new("osascript")
            .args([
                "-e",
                "tell application \"System Events\" to keystroke \"c\" using command down",
            ])
            .status()
            .map_err(|err| err.to_string())?;
        if !status.success() {
            return Err("osascript failed to send Command+C".into());
        }
    }

    #[cfg(target_os = "windows")]
    {
        let status = Command::new("powershell")
            .args([
                "-NoProfile",
                "-Command",
                "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^c')",
            ])
            .status()
            .map_err(|err| err.to_string())?;
        if !status.success() {
            return Err("PowerShell failed to send Ctrl+C".into());
        }
    }

    #[cfg(target_os = "linux")]
    {
        let status = Command::new("xdotool")
            .args(["key", "ctrl+c"])
            .status()
            .map_err(|err| {
                format!("xdotool is required to capture selected text on Linux: {err}")
            })?;
        if !status.success() {
            return Err("xdotool failed to send Ctrl+C".into());
        }
    }

    thread::sleep(Duration::from_millis(80));
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let status = mouse_trigger_status_value();
            let runtime = Arc::new(Mutex::new(MouseTriggerRuntimeStatus::default()));
            let tx = spawn_x11_mouse_trigger(app.handle().clone(), runtime.clone());
            app.manage(MouseTriggerState {
                tx,
                status,
                runtime,
            });
            Ok(())
        })
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            simulate_copy,
            mouse_trigger_status,
            configure_mouse_trigger,
            start_mouse_trigger_recording,
            stop_mouse_trigger_recording,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
