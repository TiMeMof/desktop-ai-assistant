# Desktop AI Assistant v1

Local desktop AI assistant prototype with a Tauri 2 desktop shell and a Python FastAPI daemon.

## What It Does

- Select text in another app and trigger AI actions from a global shortcut or Ubuntu X11 mouse side button.
- Supports actions: translate, explain, polish.
- Streams results into a small always-on-top bubble window.
- Uses Settings for model provider, API key, character, prompt profile, shortcut, mouse trigger, language, and memory.

## Install Daemon

```bash
cd desktop-ai-assistant
python3 -m venv .venv
. .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env
```

Start daemon:

```bash
uvicorn assistant_daemon.main:app --reload --host 127.0.0.1 --port 8732
```

## Install Desktop Shell

Ubuntu prerequisites:

```bash
sudo apt update
sudo apt install -y libwebkit2gtk-4.1-dev librsvg2-dev build-essential curl wget file libxdo-dev xdotool
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
. "$HOME/.cargo/env"
```

If Rust download fails:

```bash
export RUSTUP_DIST_SERVER=https://rsproxy.cn
export RUSTUP_UPDATE_ROOT=https://rsproxy.cn/rustup
rustup default stable
```

Run app:

```bash
cd desktop-ai-assistant/frontend
npm install
npm run tauri dev
```

If the window is blank with EGL warnings:

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
2. Start the desktop shell.
3. Select text in another app.
4. Press the configured shortcut, default `Ctrl+Shift+Space`.
5. Or enable Ubuntu X11 mouse side button trigger in Settings.

The footer button `Run clipboard` runs the current action on clipboard text.

## Settings

Open Settings by right-clicking the bubble window or clicking the titlebar settings button.

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

