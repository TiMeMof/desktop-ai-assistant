# Live2D Presentation Module

## Current Architecture

Live2D rendering has been split out of the Tauri main window into a dedicated Electron window.

```text
Tauri main window (AI Bubble)
  React UI / status text / suggestions
        |
        | BroadcastChannel("assistant_events")
        v
Electron Live2D window
  transparent frameless always-on-top window
  WebKit / Chromium WebGL2
  pixi.js + pixi-live2d-display
  local Cubism 4 model + Cubism Core
```

The Tauri window keeps the native desktop shell (global shortcut, mouse trigger, settings, chat, action stream). The Electron window only renders the Live2D model and receives motion/emotion events through the browser `BroadcastChannel` API.

## Why Electron

On Ubuntu with NVIDIA proprietary drivers, the Tauri WebKitGTK WebView fails to render Live2D textures to the GPU (WebGL 2 context is present but textures stay gray). The same HTML page renders correctly in Chromium/Electron. Therefore the model layer moved to a separate Electron window while the main app remains a Tauri window.

## Configuration

`frontend/.env` (or `.env.example`) sets the model and Cubism Core paths:

```text
VITE_LIVE2D_MODEL_URL=/live2d/models/haru/haru_greeter_t03.model3.json
VITE_LIVE2D_CORE_URL=/live2d/cubismcore/live2dcubismcore.min.js
```

The core file is loaded as a dynamic script before `pixi-live2d-display` initializes the model.

## Window Files

- `frontend/live2d.html` — Vite entry HTML for the Live2D window.
- `frontend/src/live2d_main.tsx` — mounts `Live2DWindow` in the second entry point.
- `frontend/src/Live2DWindow.tsx` — React component that loads PixiJS, the Cubism Core, and the model, then renders the canvas.
- `frontend/live2d-electron/main.js` — Electron main process: creates a transparent, frameless, always-on-top window loading the local Vite dev URL.
- `frontend/live2d-electron/preload.js` — exposes `window.electronAPI` drag helpers (`startDrag`, `doDrag`, `endDrag`) via `ipcRenderer` so the React layer can drag the window by pointer events.
- `frontend/live2d-electron/package.json` — Electron sub-project dependency and `npm start` script.

## Assistant Event Payload

Action and chat done events may include:

```text
assistant_event:
  state: idle | listening | thinking | presenting | asking_followup | error | chatting
  speak_text: optional short text for speech bubbles or TTS
  emotion: neutral | happy | thinking | confused | apologetic
  motion: idle | nod | wave | present_result | ask | error
  suggestions: optional follow-up commands
  metadata: provider/session/action context
```

Top-level `speak_text`, `emotion`, and `motion` are retained for existing consumers. New presentation code should prefer `assistant_event`.

## Synchronization

`frontend/src/main.tsx` creates `BroadcastChannel("assistant_events")` and posts a message whenever an action or chat stream finishes:

```text
postMessage({ type: "assistant_event", payload: assistantEvent })
```

`frontend/src/Live2DWindow.tsx` listens on the same channel and maps `motion` / `emotion` to the model's motion/expression groups:

```text
ask           -> TapBody
present_result -> Flick
nod           -> TapHead
wave          -> Wave
```

## Current Behavior

- `translate` returns an `asking_followup` event with suggestions for polishing, explaining, or continuing in chat.
- Other actions return a restrained `presenting` event.
- Chat returns a `chatting` event.
- The Tauri main window shows suggestion buttons and can run suggested actions against the prior selected text or result.
- Right-clicking the Tauri bubble panel opens a local menu with quick chat input and settings.
- The Electron window shows the model centered on a transparent background and can be dragged by clicking the model.

## Boundaries

- Daemon owns deterministic event selection for completed action/chat results.
- Tauri main window owns rendering, input affordances, context menus, and settings.
- Electron Live2D window owns model rendering and drag interaction only; it must not build prompts, call providers, or mutate memory directly.
- `BroadcastChannel` is the only cross-window communication path; no direct DOM or Tauri API access is shared.
- Live2D Cubism Core and model asset licenses remain separate from the wrapper package.

## Known Constraints

- Electron is launched with `--disable-gpu --disable-gpu-compositing` to avoid WebKitGTK-style GPU issues on the development host; this produces a `GPU stall due to ReadPixels` performance warning that does not affect functionality.
- The `frontend/public/webgl_check.html` diagnostic page is temporary and can be removed once the Electron path is stable.
