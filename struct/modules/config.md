# Config Module

## Config Files

- `config/app.yaml`
  - daemon defaults;
  - default action/provider/character/prompt profile;
  - limits.

- `config/providers.yaml`
  - model provider definitions;
  - provider capability metadata;
  - optional static/env-driven provider headers;
  - optional provider secret env names for adapters that require two credentials.

- `config/actions/*.yaml`
  - action ID, name, localized labels, description, user prompt template.

- `config/characters/*.yaml`
  - character/persona system prompt, style rules, output constraints.

- `config/prompt_injections/*.yaml`
  - structured prompt injection templates.

- `config/user_settings.json`
  - user-selected provider, model overrides, character, prompt profile, shortcut, mouse trigger, language, memory, presentation renderer.

- `.env`
  - API keys and provider secrets.

## Settings Ownership

Non-secret settings live in `config/user_settings.json`. Secrets live in `.env`.

Settings are updated through:

```text
PUT /v1/settings
```

The daemon returns only safe API key/secret status booleans, never secret values.

## Important Defaults

- Default keyboard shortcut: `Ctrl+Shift+Space`.
- Default memory:
  - enabled;
  - `max_context_tokens=1000`;
  - `recent_turns=10`;
  - `summary_mode=deterministic`.
- Default mouse trigger:
  - disabled;
  - `button=8`;
  - `consume=true`.
- Default presentation:
  - `renderer=fbx`.

## Validation

Current validation includes:

- provider ID exists;
- character ID exists;
- prompt profile ID exists;
- reserved shortcuts such as `Ctrl+C` are rejected.
- shortcut format includes a modifier and key;
- provider model overrides target known providers and are non-empty;
- memory budget is between `200..8000`;
- recent turns are between `0..100`;
- mouse button is between `8..12`;
- language is one of the supported UI/output language IDs.
- presentation renderer is either `fbx` or `live2d`.
