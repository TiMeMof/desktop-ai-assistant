# Desktop AI Assistant TODO

## P2: Desktop Shell and Live2D Readiness

- Extract assistant runtime state from `main.tsx` into a UI-independent controller/hook.
- Keep bubble UI and future Live2D UI as replaceable presentation layers.
- Add a minimal event bus contract:
  - trigger action;
  - show result;
  - route chat/action done events to Live2D.
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
  - memory clear action.
- Add a script for full local verification:
  - Python unit tests;
  - TypeScript build;
  - Cargo build/check.

## P3: Packaging and Operations

- Add developer scripts:
  - start daemon;
  - start frontend;
  - run all checks.
- Decide packaging strategy:
  - dev-only mode;
  - Tauri sidecar Python daemon;
  - standalone backend binary.
- Add log files and debug panel:
  - daemon request errors;
  - provider errors;
  - shortcut/mouse trigger events.
- Add config migration for future `user_settings.json` schema changes.
