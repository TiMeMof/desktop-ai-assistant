# Frontend Module

## Technology

- React
- TypeScript
- Vite
- Tauri JavaScript APIs
- Electron (for the separate avatar presentation window)

## Responsibilities

- Render the bubble window as a transparent, frameless Tauri window.
- Render compact status text and suggestion buttons (the avatar is rendered in a separate Electron window).
- Render the single action selector.
- Render Action/Chat mode switching.
- Render a compact chat panel for direct conversation.
- Open Settings through right-click or titlebar button.
- Register global keyboard shortcut through Tauri plugin.
- Listen for `mouse-trigger` events from Rust.
- Capture selected text or clipboard text.
- Call daemon HTTP/SSE APIs.
- Stream result text into the bubble.
- Broadcast the final `assistant_event` to the Electron avatar window via `BroadcastChannel`.
- Provide compact Electron avatar interactions: single-click chat primer, double-click quick action, right-click settings.
- Gate global shortcut, mouse trigger, and clipboard runs through one busy/cooldown path.
- Expose one-run privacy controls for memory pause and input exclusion.

## Main Files

- `frontend/src/main.tsx`
  - app state;
  - Action/Chat mode state;
  - presentation assistant event handoff and suggestion handling;
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
  - presentation renderer selection;
  - memory preview/delete;
  - settings import/export and reset controls.
  - degrades in Electron by disabling Tauri-only mouse side-button recording/status calls.

- `frontend/src/api.ts`
  - daemon HTTP/SSE client.

- `frontend/src/Live2DAssistant.tsx`
  - compact status/suggestion UI for the Tauri bubble window;
  - right-click menu with quick chat input and settings;
  - no longer renders WebGL/canvas; the actual model lives in the Electron window.

- `frontend/src/AvatarWindow.tsx`
  - renderer-agnostic Electron avatar container;
  - listens for `assistant_event` on `BroadcastChannel` and passes motion state to the selected renderer;
  - handles avatar drag, single-click chat primer, double-click quick action, right-click settings, compact chat, suggestions, and quick action selection.

- `frontend/src/FbxAvatarRenderer.tsx`
  - default Three.js renderer for `frontend/fbx/*.fbx`;
  - loads idle first, preloads other motions, and plays one-shot actions before returning to idle.

- `frontend/src/Live2DRenderer.tsx`
  - optional Live2D renderer;
  - loads the configured Cubism Core and model via `pixi-live2d-display`.

- `frontend/src/Live2DWindow.tsx`
  - compatibility wrapper that mounts `AvatarWindow`.

- `frontend/src/live2d_main.tsx`
  - second Vite entry point that mounts `AvatarWindow` inside `frontend/live2d.html`.

- `frontend/live2d.html`
  - HTML shell for the Electron avatar window.

- `frontend/live2d-electron/main.js`
  - Electron main process that creates the transparent, frameless, always-on-top avatar window;
  - owns Electron clipboard/focus/window IPC and Linux selected-text capture helpers.

- `frontend/live2d-electron/preload.js`
  - exposes drag helpers, focusability, selected-text capture, clipboard read, and platform info to the renderer via `contextBridge`.

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

Action and chat done events carry a shared presentation-ready `assistant_event` payload. The Tauri window stores the event for its own status/suggestion UI and broadcasts it to the Electron avatar window through `BroadcastChannel("assistant_events")`. The avatar renders independently in the Electron window.

FBX 3D is the default presentation renderer. Live2D is loaded only when selected in Settings and `VITE_LIVE2D_MODEL_URL` is configured. Without a model URL, the Tauri window still shows the compact status fallback and the Electron window shows a `No Live2D model configured` fallback for the Live2D renderer.

Electron avatar direct interaction flow:

```text
single left-click avatar
  -> read Electron clipboard text
  -> append local assistant primer using clipboard + recent local messages
  -> play asking_followup motion locally

double left-click avatar
  -> capture selected text through Electron preload
  -> run selected quick action: translate / explain / polish
  -> stream action result into avatar bubble
  -> play returned assistant_event locally

right-click avatar
  -> mount SettingsPanel in Electron
  -> save through daemon PUT /v1/settings
```

Legacy top-level presentation payload fields:

- `speak_text`
- `emotion`
- `motion`
- `metadata.session_id`

Settings save flow:

```text
SettingsPanel
  -> PUT /v1/settings
  -> configure Tauri mouse trigger if running in Tauri
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
- The Tauri bubble window must not depend on the Electron avatar window being open; the `BroadcastChannel` is best-effort.
- The Electron avatar window may call daemon HTTP/SSE APIs for compact interactions, but it must not own prompt construction, provider calls, API secrets, or memory persistence.
