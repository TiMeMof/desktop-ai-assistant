# Desktop AI Assistant TODO

## P2: Desktop Shell and Live2D Readiness

- Extract assistant runtime state from `main.tsx` into a UI-independent controller/hook.
- Keep the Tauri bubble UI and the Electron Live2D UI as loosely coupled replaceable presentation layers while sharing daemon APIs and assistant event semantics.
- Harden the `BroadcastChannel` event contract between the Tauri bubble and the Electron Live2D window:
  - typed `assistant_event` payload;
  - graceful handling when the Live2D window is closed;
  - optional Electron window lifecycle management from the Tauri window.
- Add smoke coverage for Live2D Electron interactions:
  - single-click opens the chat primer without model call;
  - double-click runs selected quick action;
  - right-click opens settings;
  - Linux selected-text capture falls back cleanly when `xclip`/`xsel`/`wl-paste` are missing.
- Decide whether chat sessions should persist across daemon restarts.

## P2: Agent / Computer-Control Integration

- Add a daemon-side agent adapter boundary before integrating OpenInterpreter, OpenClaw, or similar computer-control tools.
- Keep provider/tool execution behind daemon endpoints rather than embedding it in Tauri or Electron renderers.
- MVP shape:
  - `POST /v1/agent/stream` or an `agent_execute` action;
  - subprocess/SDK adapter for the selected tool;
  - streamed logs/results/errors over SSE;
  - timeout and cancellation;
  - explicit confirmation for filesystem, shell, browser, mouse, or keyboard actions.
- Safety defaults:
  - workspace allowlist;
  - no secrets in prompts/logs;
  - deny destructive commands unless explicitly confirmed;
  - separate "explain plan" mode from "execute" mode.
- OpenInterpreter is the likely first integration target because it can be wrapped as a CLI/SDK process. OpenClaw feasibility depends on the specific repository/API surface.

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

- Verify normal GPU-enabled Electron startup across the target Linux/NVIDIA setup; keep `live2d:electron:software` as a fallback only.
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
