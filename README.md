# Desktop AI Assistant v1

Local desktop AI assistant prototype with a Tauri 2 desktop shell, a Python FastAPI daemon, and an optional Electron Live2D presentation window.

## What It Does

- Select text in another app and trigger AI actions from a global shortcut, Ubuntu X11 mouse side button, or the Live2D Electron window.
- Supports actions: translate, explain, polish.
- Streams results into a small always-on-top bubble window.
- When Live2D is configured, the assistant avatar is rendered in a separate transparent Electron window, reacts to assistant state/motion/emotion, and can act as a compact interaction surface.
- Uses Settings for model provider, API key, character, prompt profile, shortcut, mouse trigger, language, and memory.

## Install Daemon

```bash
cd desktop-ai-assistant
python3 -m venv .venv
. .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env
```

## Install Desktop Shell

Ubuntu prerequisites:

```bash
sudo apt update
sudo apt install -y libwebkit2gtk-4.1-dev librsvg2-dev build-essential curl wget file libxdo-dev xdotool
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
. "$HOME/.cargo/env"
```

For Live2D Electron double-click selected-text capture on Linux, install one safe primary-selection reader:

```bash
sudo apt install -y xclip
```

`wl-clipboard` or `xsel` also work. If none is installed, the Live2D window falls back to the current clipboard text and does not send `Ctrl+C`.

If Rust download fails:

```bash
export RUSTUP_DIST_SERVER=https://rsproxy.cn
export RUSTUP_UPDATE_ROOT=https://rsproxy.cn/rustup
rustup default stable
```

Install the Tauri frontend and the Electron Live2D sub-project:

```bash
cd desktop-ai-assistant/frontend
npm install
cd live2d-electron
npm install
cd ..
```

## Live2D Assets

Live2D uses the bundled Haru model and a local Cubism Core. Configure them in `frontend/.env` (copy from `frontend/.env.example`):

```text
VITE_LIVE2D_MODEL_URL=/live2d/models/haru/haru_greeter_t03.model3.json
VITE_LIVE2D_CORE_URL=/live2d/cubismcore/live2dcubismcore.min.js
```

If you do not configure a model URL, the Tauri bubble still works and the Electron window shows a fallback message.

## Runtime

Three processes run together in dev mode. `npm run live2d:electron` starts the Vite dev server for the Live2D page before launching Electron.

```text
+--------------------------+        +--------------------------+
|  Tauri bubble window     |        |  Electron Live2D window  |
|  React UI / shortcuts    |  BC    |  transparent avatar      |
|  chat / suggestions      | -----> |  motion / emotion        |
+----------+---------------+        +-----------+--------------+
           |                                      |
           | BroadcastChannel("assistant_events") |
           |                                      v
           |                         Live2D click / chat / settings
           |                                      |
           v                                      |
+--------------------------+                      |
|    Python daemon         |                      |
|  FastAPI + LLM calls     |                      |
|  memory / config         |                      |
+--------------------------+                      |
           ^                                      |
           | HTTP/SSE on 127.0.0.1:8732           |
           +--------------------------------------+
```

- The Tauri bubble window talks to the daemon over HTTP/SSE.
- When an action or chat finishes, the Tauri window broadcasts the `assistant_event` to the Electron Live2D window over `BroadcastChannel`.
- The Electron Live2D window can also call the daemon directly for its own click/chat/settings flows. Prompt construction and memory still remain daemon-owned.

## Run the App

Three terminals are needed in dev mode.

**Terminal 1 — daemon:**

```bash
cd desktop-ai-assistant
. .venv/bin/activate
uvicorn assistant_daemon.main:app --reload --host 127.0.0.1 --port 8732
```


**Terminal 2 — Electron Live2D window:**

```bash
cd desktop-ai-assistant/frontend
npm run live2d:electron
```

Use the software-rendering fallback only if the normal Electron window fails to display:

```bash
npm run live2d:electron:software
```

Alternatively, you can run the Live2D window in Chrome app mode for quick testing:

```bash
cd desktop-ai-assistant/frontend
npm run live2d:chrome
```

If the Tauri window is blank with EGL warnings:

```bash
WEBKIT_DISABLE_DMABUF_RENDERER=1 LIBGL_ALWAYS_SOFTWARE=1 npm run tauri dev
```

If file watching hits OS limits:

```bash
sudo tee /etc/sysctl.d/99-desktop-ai-assistant-inotify.conf >/dev/null <<'EOF'
fs.inotify.max_user_watches=524288
fs.inotify.max_user_instances=1024
fs.inotify.max_queued_events=32768
EOF
sudo sysctl --system
```

## Usage

1. Start the daemon.
2. Start the Tauri desktop shell.
3. Start the Electron Live2D window if you want the avatar.
4. Select text in another app.
5. Press the configured shortcut, default `Ctrl+Shift+Space`.
6. Or enable Ubuntu X11 mouse side button trigger in Settings.

The footer button `Run clipboard` runs the current action on clipboard text.

Live2D Electron controls:

- Single left-click the model: open the Live2D chat bubble. The assistant first asks what you want to do, using the current clipboard and recent local conversation as lightweight context.
- Double left-click the model: run the selected quick action on selected text or clipboard fallback. The quick action can be switched in the bubble between translate, explain, and polish.
- Drag the model: move the Electron window.
- Right-click the model: open Settings inside the Electron window.

When an action or chat completes, the Tauri bubble shows status text and suggestion buttons, and the Electron Live2D window plays the corresponding motion/expression if configured.

## Settings

Open Settings by right-clicking the bubble window or clicking the titlebar settings button.

In the Live2D Electron window, right-click the model to open the same settings panel. Tauri-only mouse side-button recording is disabled in Electron, but model, provider, API key, character, language, memory, import/export, and provider test settings are available.

Settings include:

- Model provider and model override.
- Provider API key.
- Character.
- Prompt injection profile.
- Keyboard shortcut.
- Ubuntu X11 mouse side button.
- Output language.
- Local memory.

Non-secret settings are saved in `config/user_settings.json`. API keys are saved in `.env`.

## Providers

Built-in providers are configured in `config/providers.yaml`:

- OpenAI
- Google Gemini OpenAI compatibility
- OpenRouter
- Alibaba DashScope Qwen
- Kimi
- DeepSeek
- SiliconFlow
- Zhipu BigModel
- Local vLLM
- LM Studio
- Ollama

Fill API keys in Settings or `.env`.

## Future Agent Tools

OpenInterpreter, OpenClaw, or similar computer-control tools should be integrated behind the Python daemon, not directly inside Tauri or Electron renderers.

Recommended shape:

- add a daemon action or endpoint such as `agent_execute` / `/v1/agent/stream`;
- wrap the selected tool through a subprocess, SDK, or protocol adapter;
- stream logs, tool events, confirmations, and final output over SSE;
- require explicit confirmation for filesystem, shell, browser, mouse, or keyboard actions;
- keep workspace, timeout, cancellation, and destructive-command policy in the daemon.

This keeps Live2D and AI Bubble as presentation surfaces while the daemon owns execution policy, secrets, logs, and memory.

## Verify

```bash
cd desktop-ai-assistant
. .venv/bin/activate
python -m unittest discover -s daemon/tests
cd frontend
npm run build
cargo build --manifest-path src-tauri/Cargo.toml
```

## Architecture Docs

For architecture and implementation map, start with:

```text
ARCHITECTURE_READING.md
struct/architecture.md
struct/todo.md
```
