# Prompt and Memory Module

## Prompt Layers

Prompt construction is daemon-owned:

```text
character system prompt
  + style rules
  + output constraints
  + prompt injection YAML
  + selected output language
  + capture source
  + local memory context
  + action user template
```

Chat prompt construction uses:

```text
character system prompt
  + style rules
  + output constraints
  + prompt injection YAML
  + selected output language
  + capture source=chat
  + local memory context
  + recent chat session messages
  + current user message
```

## Main Files

- `daemon/assistant_daemon/prompts.py`
  - combines character, action/chat input, prompt injection profile, language, context, and selected text or chat history.

- `daemon/assistant_daemon/prompt_injection.py`
  - renders YAML templates.

- `config/prompt_injections/*.yaml`
  - user-editable injection profiles.

- `daemon/assistant_daemon/memory.py`
  - local memory storage, bounded context generation, compaction, preview, delete, clear, redaction.

## Prompt Injection YAML

Supported template values:

- `{{ output_language }}`
- `{{ language }}`
- `{{ source }}`
- `{{ memory_context }}`

Current sections:

- `system_injections`
- `context_injections`
- `memory_injections`

## Memory Storage

Files:

- `data/memory/recent.jsonl`
- `data/memory/summary.md`

Memory settings:

- `enabled`
- `max_context_tokens`
- `recent_turns`
- `summary_mode`

Action-level memory policy:

- `translate` uses a smaller memory context by default.
- `explain` and `polish` use the full configured memory context.
- `chat` uses the full configured memory context and also stores recent in-session messages separately.

One-run privacy flags in request context:

- `memory_paused`: do not read or write memory for this action/chat request.
- `memory_exclude_input`: use selected text or chat input for the request but store a placeholder instead of the input.

## Current Compaction

Memory compaction supports two modes:

- `deterministic`: recent records are kept up to configured count/budget and older records are appended into `summary.md`;
- `model`: when compaction is needed after a successful action, the active provider is asked for a short summary; if that fails, compaction falls back to deterministic behavior.

Obvious API keys, tokens, passwords, and JWT-like strings are redacted before memory is written.

## Boundaries

- Frontend can enable/disable and clear memory.
- Frontend can preview memory and delete individual recent records through daemon APIs.
- Frontend cannot directly edit memory files.
