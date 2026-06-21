# Desktop AI Assistant TODO

## P2: Desktop Shell and Live2D Readiness

- Extract assistant runtime state from `main.tsx` into a UI-independent controller/hook.
- Keep the Tauri bubble UI and the Electron Live2D UI as loosely coupled replaceable presentation layers.
- Harden the `BroadcastChannel` event contract between the Tauri bubble and the Electron Live2D window:
  - typed `assistant_event` payload;
  - graceful handling when the Live2D window is closed;
  - optional Electron window lifecycle management from the Tauri window.
- Decide whether chat sessions should persist across daemon restarts.

## P2: Cross-Platform Input

- Windows:
  - implement native XButton1/XButton2 hook;
  - or provide AutoHotkey config generation.
- macOS:
  - investigate accessibility permission and event tap feasibility;
  - or generate BetterTouchTool/Karabiner instructions.
- Wayland:
  - prefer system shortcut mapping or input-remapper;
  - avoid promising global raw mouse hooks across compositors.

## P2: Live2D Cleanup

- Electron Live2D window emits a `GPU stall due to ReadPixels` performance warning at startup; it does not affect functionality.
- `frontend/public/webgl_check.html` is a temporary WebGL diagnostic page and can be removed once the Electron Live2D path is stable.

## P2: Testing

- Add daemon tests for:
  - settings update with memory;
  - memory append/compact/clear;
  - prompt injection with memory context;
  - provider config list includes expected IDs.
- Add frontend tests or smoke checks for:
  - Settings save payload;
  - shortcut reserved-key validation;
  - provider dropdown count from config;
  - memory clear action;
  - `BroadcastChannel` broadcast after stream completion.
- Add a script for full local verification:
  - Python unit tests;
  - TypeScript build;
  - Cargo build/check.

## P3: Packaging and Operations

- Add developer scripts:
  - start daemon;
  - start Tauri frontend;
  - start Electron Live2D window;
  - run all checks.
- Decide packaging strategy:
  - dev-only mode;
  - Tauri sidecar Python daemon;
  - standalone backend binary.
- Add log files and debug panel:
  - daemon request errors;
  - provider errors;
  - shortcut/mouse trigger events;
  - Live2D window state and event delivery.
- Add config migration for future `user_settings.json` schema changes.
