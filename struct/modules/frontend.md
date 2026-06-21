# Frontend Module

## Technology

- React
- TypeScript
- Vite
- Tauri JavaScript APIs
- Electron (for the separate Live2D presentation window)

## Responsibilities

- Render the bubble window as a transparent, frameless Tauri window.
- Render compact status text and suggestion buttons (the Live2D model is rendered in a separate Electron window).
- Render the single action selector.
- Render Action/Chat mode switching.
- Render a compact chat panel for direct conversation.
- Open Settings through right-click or titlebar button.
- Register global keyboard shortcut through Tauri plugin.
- Listen for `mouse-trigger` events from Rust.
- Capture selected text or clipboard text.
- Call daemon HTTP/SSE APIs.
- Stream result text into the bubble.
- Broadcast the final `assistant_event` to the Electron Live2D window via `BroadcastChannel`.
- Gate global shortcut, mouse trigger, and clipboard runs through one busy/cooldown path.
- Expose one-run privacy controls for memory pause and input exclusion.

## Main Files

- `frontend/src/main.tsx`
  - app state;
  - Action/Chat mode state;
  - Live2D assistant event handoff and suggestion handling;
  - action selector;
  - chat messages and current chat session ID;
  - trigger handling;
  - trigger debounce and memory privacy flags;
  - stream rendering;
  - `BroadcastChannel("assistant_events")` creation and event broadcast;
  - settings modal mount.

- `frontend/src/SettingsPanel.tsx`
  - tabbed settings sections;
  - localized settings labels from selected output language;
  - model provider, API key/secret, provider test, character, prompt profile;
  - shortcut recorder;
  - mouse side-button settings and active status;
  - language and memory settings;
  - memory preview/delete;
  - settings import/export and reset controls.

- `frontend/src/api.ts`
  - daemon HTTP/SSE client.

- `frontend/src/Live2DAssistant.tsx`
  - compact status/suggestion UI for the Tauri bubble window;
  - right-click menu with quick chat input and settings;
  - no longer renders WebGL/canvas; the actual model lives in the Electron window.

- `frontend/src/Live2DWindow.tsx`
  - Live2D model renderer for the Electron window;
  - loads the configured Cubism Core and model via `pixi-live2d-display`;
  - listens for `assistant_event` on `BroadcastChannel` and drives motion/expression.

- `frontend/src/live2d_main.tsx`
  - second Vite entry point that mounts `Live2DWindow` inside `frontend/live2d.html`.

- `frontend/live2d.html`
  - HTML shell for the Electron Live2D window.

- `frontend/live2d-electron/main.js`
  - Electron main process that creates the transparent, frameless, always-on-top Live2D window.

- `frontend/live2d-electron/preload.js`
  - exposes drag helpers (`startDrag`, `doDrag`, `endDrag`) to the renderer via `contextBridge`.

- `frontend/live2d-electron/package.json`
  - Electron sub-project dependencies and `npm start` script.

- `frontend/src/clipboard.ts`
  - selected-text capture through clipboard.

- `frontend/src/mouseTrigger.ts`
  - Tauri command wrappers for mouse side-button support.

- `frontend/src/shortcuts.ts`
  - blocks dangerous shortcuts like `Ctrl+C`.

## Data Flow

```text
trigger
  -> runWithSelection()
  -> captureSelectedText()
  -> streamAction()
  -> append SSE deltas to outputText
  -> setAssistantEvent(result)
  -> broadcastAssistantEvent(result.assistant_event)
```

Chat data flow:

```text
chat submit
  -> streamChat(session_id, message)
  -> append SSE deltas to assistant chat message
  -> store returned session_id
  -> setAssistantEvent(result)
  -> broadcastAssistantEvent(result.assistant_event)
```

Action and chat done events carry a shared Live2D-ready `assistant_event` payload. The Tauri window stores the event for its own status/suggestion UI and broadcasts it to the Electron Live2D window through `BroadcastChannel("assistant_events")`. The model renders independently in the Electron window.

The Live2D model is loaded only when `VITE_LIVE2D_MODEL_URL` is configured. Without a model URL, the Tauri window still shows the compact status fallback and the Electron window shows a `No Live2D model configured` fallback, so action/chat event handling can be verified before model assets are added.

Legacy top-level Live2D-ready done payload fields:

- `speak_text`
- `emotion`
- `motion`
- `metadata.session_id`

Settings save flow:

```text
SettingsPanel
  -> PUT /v1/settings
  -> configure Tauri mouse trigger if needed
  -> reload config
```

Memory privacy flow:

```text
Private run / Exclude input
  -> streamAction(context.memory_paused / context.memory_exclude_input)
  -> daemon decides memory context and memory write policy
```

## Boundaries

- Frontend must not store API key values except transient input before save.
- Frontend must not build model prompts.
- Frontend must not own memory files.
- The Tauri bubble window must not depend on the Electron Live2D window being open; the `BroadcastChannel` is best-effort.
