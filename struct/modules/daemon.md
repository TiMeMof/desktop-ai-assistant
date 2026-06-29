# Daemon Module

## Technology

- Python 3.11
- FastAPI
- Pydantic
- httpx
- PyYAML

## Responsibilities

- Serve local HTTP/SSE API on `127.0.0.1:8732`.
- Reload config/settings from disk.
- Validate action requests.
- Validate chat requests.
- Build prompts.
- Call model providers.
- Stream model output.
- Emit deterministic presentation-ready assistant events on completed action/chat responses.
- Persist settings and memory.
- Serve memory preview and provider test APIs.
- Maintain bounded in-memory chat sessions.

## Main Files

- `daemon/assistant_daemon/main.py`
  - FastAPI app;
  - endpoint definitions;
  - action request lifecycle;
  - chat request lifecycle and in-memory session storage;
  - memory write after successful action.

- `daemon/assistant_daemon/assistant_events.py`
  - deterministic assistant event payloads for action/chat completion.

- `daemon/assistant_daemon/schemas.py`
  - provider/action/character/prompt/settings/request/response models;
  - user settings schema including `presentation.renderer`.

- `daemon/assistant_daemon/config.py`
  - config loading;
  - user settings save;
  - presentation renderer merge/validation through `SettingsUpdate`;
  - `.env` API key writing;
  - reserved shortcut validation.

## Endpoints

- `GET /health`
- `GET /v1/config`
- `GET /v1/settings`
- `PUT /v1/settings`
- `GET /v1/memory`
- `DELETE /v1/memory`
- `DELETE /v1/memory/recent/{timestamp}`
- `POST /v1/providers/{provider_id}/test`
- `POST /v1/actions/run`
- `POST /v1/actions/stream`
- `POST /v1/chat/stream`

## Request Lifecycle

```text
request
  -> reload Settings()
  -> validate input size and action/provider IDs
  -> resolve provider, character, action, prompt profile
  -> apply per-action memory policy and one-run privacy flags
  -> build memory context if allowed
  -> build messages
  -> call provider
  -> stream or return output
  -> attach assistant_event with state/speech/motion/follow-up suggestions
  -> write memory if allowed
```

Chat request lifecycle:

```text
chat request
  -> reload Settings()
  -> validate message size and provider/character IDs
  -> resolve or create in-memory session_id
  -> apply chat memory policy and one-run privacy flags
  -> build memory context if allowed
  -> build chat messages from character + injection profile + memory + recent session messages
  -> stream provider output
  -> append user/assistant messages to session
  -> attach assistant_event with chat state/speech/motion
  -> write chat turn to memory if allowed
```

Chat sessions are process-local and bounded by count/message limits. They are not durable across daemon restarts.

## Boundaries

- Daemon owns provider calls, prompt policy, API keys, and memory.
- Daemon does not own platform input hooks.
