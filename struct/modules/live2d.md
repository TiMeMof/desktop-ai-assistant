# Live2D Presentation Module

## Current Scope

Live2D is treated as a replaceable presentation layer. The frontend has a small `Live2DAssistant` adapter that consumes daemon `assistant_event` payloads, renders suggestions, and opens a right-click quick chat input.

## Runtime Candidate

Use `pixi-live2d-display` for the first prototype because it gives a compact PixiJS-based API for loading models, hit testing, focus interaction, and motion control. Keep it behind a local React adapter so the app can later move to the official Live2D Cubism Web SDK if licensing, Cubism 5 features, or maintenance risk requires it.

Known constraints:

- Pin PixiJS 6-compatible packages for this prototype.
- Live2D Cubism Core and model asset licenses remain separate from the wrapper package.
- Configure model loading with `VITE_LIVE2D_MODEL_URL`; configure Cubism Core loading with `VITE_LIVE2D_CORE_URL` when the runtime is not already bundled.
- On Ubuntu, this path depends on the Tauri WebView's WebGL support and the user's GPU/WebKitGTK stack.
- Do not let the rendering library leak into daemon, prompt, memory, or provider code.

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

## Current Behavior

- `translate` returns an `asking_followup` event with suggestions for polishing, explaining, or continuing in chat.
- Other actions return a restrained `presenting` event.
- Chat returns a `chatting` event.
- The frontend shows suggestion buttons and can run suggested actions against the prior selected text or result.
- Right-clicking the Live2D panel opens a local menu with quick chat input and settings.

## Boundaries

- Daemon owns deterministic event selection for completed action/chat results.
- Frontend owns rendering, input affordances, context menus, and any future Live2D runtime.
- Live2D rendering must not build prompts, call providers, or mutate memory directly.
