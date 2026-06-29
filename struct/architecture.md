# Architecture Overview

## Purpose

`desktop-ai-assistant` is a local desktop AI assistant. It captures selected text from the OS or accepts chat input in the bubble, sends it to a local daemon, calls a model provider, and displays streamed output in a small desktop bubble.

## Runtime Shape

```text
Desktop UI / Native input
  Tauri 2 + React + TypeScript + Rust
  transparent bubble window
        |
        | HTTP/SSE on 127.0.0.1:8732
        v
Local daemon
  Python + FastAPI + YAML config + local memory
        |
        | OpenAI-compatible / Ollama / native provider API
        v
Model provider

Avatar Presentation (Electron)
  Electron + Chromium + Three.js FBX or pixi-live2d-display
  transparent frameless always-on-top window
  compact click/chat/action/settings surface
        ^
        | BroadcastChannel("assistant_events") from Tauri window
        |
        + HTTP/SSE on 127.0.0.1:8732 for its own direct interactions
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
  -> React broadcasts assistant_event to Electron avatar window
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
  -> React broadcasts assistant_event to Electron avatar window
  -> daemon stores successful chat turn in local memory
```

Electron avatar direct interaction flow:

```text
single left-click avatar
  -> Electron reads clipboard text
  -> React inserts a local assistant primer using clipboard + recent local messages
  -> no model call until user replies

double left-click avatar
  -> Electron captures selected text through PRIMARY selection reader or clipboard fallback
  -> React calls daemon /v1/actions/stream with selected quick action
  -> daemon follows the normal action prompt/provider/memory lifecycle
  -> avatar bubble renders stream and plays assistant_event

right-click avatar
  -> React mounts SettingsPanel in the Electron window
  -> SettingsPanel saves through daemon /v1/settings
```

## Core Boundaries

- **Frontend UI** owns presentation, settings form, action selector, chat panel, and stream rendering in the Tauri bubble window and compact Electron avatar bubble.
- **Tauri/Rust** owns native OS integration: copy simulation, window behavior, keyboard/mouse trigger bridge for the main bubble window.
- **FastAPI daemon** owns model calls, prompt construction, config loading, API keys, memory, and provider abstraction.
- **YAML config** owns editable actions, characters, providers, and prompt injection profiles.
- **Assistant event protocol** carries presentation-ready state, speech, motion, and follow-up suggestions from daemon results to frontend presentation.
- **Electron avatar window** owns FBX/Live2D rendering and compact click/chat/action/settings interactions. It receives presentation events from the Tauri window via `BroadcastChannel` and may call daemon HTTP/SSE APIs, but must not build model prompts, call providers directly, or mutate memory files.
- **`.env`** owns secrets and optional Live2D asset URLs.

## Module Index

Read only the modules needed for the current task:

- `struct/modules/frontend.md`: React UI, settings, shortcuts, streaming display, and `BroadcastChannel` event broadcast.
- `struct/modules/tauri-rust.md`: Tauri shell, Rust commands, X11 side-button hook.
- `struct/modules/daemon.md`: FastAPI API, config reload, request lifecycle.
- `struct/modules/config.md`: YAML/user settings/env files.
- `struct/modules/providers.md`: provider protocol and built-in model platforms.
- `struct/modules/prompt-memory.md`: prompt construction, prompt injection YAML, memory.
- `struct/modules/live2d.md`: Electron avatar window, dual renderer setup, assistant event protocol, and presentation boundaries.
- `struct/todo.md`: prioritized future work.

## Current Platform Support

- Ubuntu X11: keyboard shortcut, native side-button hook, `xdotool` copy simulation for Tauri, and Electron avatar selected-text capture through PRIMARY selection readers (`xclip`, `xsel`, or `wl-clipboard`) with clipboard fallback.
- Ubuntu Wayland: no native side-button guarantee; system mapping may be required.
- Windows/macOS: keyboard shortcut and copy simulation scaffolded; native side-button hook not implemented.

## Decision Rules

- Do not put model/provider/prompt/memory logic in the frontend.
- Do not put OS input hooks in the daemon.
- Keep the Tauri bubble window and the Electron avatar window as loosely coupled presentation layers. Use `BroadcastChannel` for cross-window assistant presentation events and daemon HTTP/SSE for action/chat/settings work.
- Keep avatar rendering out of the Tauri WebView on Linux/NVIDIA stacks; Electron hosts both FBX 3D and Live2D presentation renderers.
- Keep secrets out of YAML and frontend state.
