# Frontend Module

## Technology

- React
- TypeScript
- Vite
- Tauri JavaScript APIs

## Responsibilities

- Render the bubble window.
- Render the single action selector.
- Render Action/Chat mode switching.
- Render a compact chat panel for direct conversation.
- Open Settings through right-click or titlebar button.
- Register global keyboard shortcut through Tauri plugin.
- Listen for `mouse-trigger` events from Rust.
- Capture selected text or clipboard text.
- Call daemon HTTP/SSE APIs.
- Stream result text into the bubble.
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
  - Live2D presentation adapter;
  - right-click Live2D menu;
  - quick chat input popup;
  - suggestion button rendering.

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
```

Chat data flow:

```text
chat submit
  -> streamChat(session_id, message)
  -> append SSE deltas to assistant chat message
  -> store returned session_id
  -> keep done payload for future Live2D consumers
```

Action and chat done events can carry a shared Live2D-ready `assistant_event` payload. The frontend stores the event for presentation consumers while still rendering the streamed result text normally.

The current Live2D adapter loads a real model only when `VITE_LIVE2D_MODEL_URL` is configured. Without a model URL it renders a compact status fallback, so action/chat event handling can be verified before model assets are added.

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
