# Architecture Overview

## Purpose

`desktop-ai-assistant` is a local desktop AI assistant. It captures selected text from the OS or accepts chat input in the bubble, sends it to a local daemon, calls a model provider, and displays streamed output in a small desktop bubble.

## Runtime Shape

```text
Desktop UI / Native input
  Tauri 2 + React + TypeScript + Rust
        |
        | HTTP/SSE on 127.0.0.1:8732
        v
Local daemon
  Python + FastAPI + YAML config + local memory
        |
        | OpenAI-compatible / Ollama / native provider API
        v
Model provider
```

## Main Flow

```text
keyboard shortcut or Ubuntu X11 side button
  -> native copy simulation
  -> clipboard selected text capture
  -> React calls daemon /v1/actions/stream
  -> daemon reloads config/settings
  -> daemon builds prompt from character + action + injection profile + memory
  -> daemon streams provider output
  -> React renders result in bubble
  -> daemon stores successful turn in local memory
```

Chat flow:

```text
chat input in bubble
  -> React calls daemon /v1/chat/stream
  -> daemon resolves in-memory chat session
  -> daemon builds prompt from character + injection profile + memory + recent chat messages
  -> daemon streams provider output
  -> React renders chat message
  -> daemon stores successful chat turn in local memory
```

## Core Boundaries

- **Frontend UI** owns presentation, settings form, action selector, chat panel, and stream rendering.
- **Tauri/Rust** owns native OS integration: copy simulation, window behavior, keyboard/mouse trigger bridge.
- **FastAPI daemon** owns model calls, prompt construction, config loading, API keys, memory, and provider abstraction.
- **YAML config** owns editable actions, characters, providers, and prompt injection profiles.
- **Assistant event protocol** carries Live2D-ready state, speech, motion, and follow-up suggestions from daemon results to frontend presentation.
- **`.env`** owns secrets.

## Module Index

Read only the modules needed for the current task:

- `struct/modules/frontend.md`: React UI, settings, shortcuts, streaming display.
- `struct/modules/tauri-rust.md`: Tauri shell, Rust commands, X11 side-button hook.
- `struct/modules/daemon.md`: FastAPI API, config reload, request lifecycle.
- `struct/modules/config.md`: YAML/user settings/env files.
- `struct/modules/providers.md`: provider protocol and built-in model platforms.
- `struct/modules/prompt-memory.md`: prompt construction, prompt injection YAML, memory.
- `struct/modules/live2d.md`: Live2D-ready assistant event protocol and presentation boundaries.
- `struct/todo.md`: prioritized future work.

## Current Platform Support

- Ubuntu X11: keyboard shortcut, native side-button hook, `xdotool` copy simulation.
- Ubuntu Wayland: no native side-button guarantee; system mapping may be required.
- Windows/macOS: keyboard shortcut and copy simulation scaffolded; native side-button hook not implemented.

## Decision Rules

- Do not put model/provider/prompt/memory logic in the frontend.
- Do not put OS input hooks in the daemon.
- Keep Live2D replacement feasible by treating the current bubble as a replaceable presentation layer.
- Keep secrets out of YAML and frontend state.
