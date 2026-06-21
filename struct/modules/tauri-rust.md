# Tauri and Rust Module

## Technology

- Tauri 2
- Rust
- Tauri plugins:
  - clipboard manager
  - global shortcut
  - HTTP
  - window state
- Linux Xlib through `x11` crate

## Responsibilities

- Host the desktop WebView.
- Provide native commands to React.
- Simulate copy in the currently focused external app.
- Support drag behavior for the undecorated bubble window.
- Bridge Ubuntu X11 mouse side-button events to frontend events.
- Track mouse trigger runtime state for Settings:
  - active;
  - recording;
  - grabbed button;
  - last X11 grab error.
- Keep mouse trigger status construction centralized so static capability fields
  and runtime fields stay in sync when the Rust/TypeScript status shape changes.

## Main Files

- `frontend/src-tauri/src/main.rs`
  - `simulate_copy`
  - mouse trigger status/config/recording commands
  - X11 event loop
  - `MouseTriggerStatus::new` for static capability status.
  - `MouseTriggerStatus::with_runtime` for merging shared runtime state into
    command responses.
  - Tauri setup and plugin registration

- `frontend/src-tauri/build.rs`
  - links Linux builds against `libX11`.

- `frontend/src-tauri/capabilities/default.json`
  - declares frontend permissions for window, clipboard, shortcut, event listening, HTTP.

## Commands and Events

Commands:

- `simulate_copy`
- `mouse_trigger_status`
- `configure_mouse_trigger`
- `start_mouse_trigger_recording`
- `stop_mouse_trigger_recording`

Events:

- `mouse-trigger`
- `mouse-trigger-recorded`
- `mouse-trigger-error`

## Platform Notes

- Linux copy simulation uses `xdotool`.
- Ubuntu X11 side-button hook uses `XGrabButton`.
- `XGrabButton` is followed by `XSync` and an X error handler check so grab failures can be surfaced.
- Wayland is not guaranteed for native mouse hook.
- Windows/macOS side-button hook is future work.

## Risks

- X11 button grabs can conflict with browsers or other global input tools.
- Recording mode attempts `Button8..Button12`; if another app owns all buttons, recording is refused.
- `Ctrl+C` must not be used as app shortcut because it causes accidental triggering while copying.
