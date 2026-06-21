# Providers Module

## Provider Types

The daemon supports these provider types:

- `openai_compatible`
  - calls `{base_url}/chat/completions`;
  - parses OpenAI-style SSE `data:` chunks.

- `ollama`
  - calls `{base_url}/api/chat`;
  - parses Ollama JSON-lines streaming.

- `anthropic`
  - calls `{base_url}/messages`;
  - sends `x-api-key` and `anthropic-version` headers;
  - maps system prompts to Anthropic's top-level `system` field;
  - parses SSE `content_block_delta` / `text_delta` events.

- `baidu_qianfan`
  - exchanges `api_key_env` + `api_secret_env` for a Baidu access token;
  - calls `{base_url}/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/{model}`;
  - folds system prompts into the first user message;
  - parses streamed `result` chunks.

## Main File

- `daemon/assistant_daemon/providers.py`

Responsibilities:

- construct provider payloads;
- set auth headers;
- set optional configured provider headers;
- handle streaming;
- normalize provider errors.

## Capability Metadata

Provider config can include:

- `supports_streaming`;
- `supports_system_prompt`;
- `context_size`;
- `max_tokens` as the max output token hint.

The daemon exposes these through `GET /v1/config`, and Settings uses them for provider details.

If `supports_system_prompt=false`, system messages are folded into the first user message before calling the provider.

If `supports_streaming=false`, streaming requests fail fast for that provider.

## Provider Test

Settings calls:

```text
POST /v1/providers/{provider_id}/test
```

The daemon sends a short non-streaming prompt and returns status, latency, and an output preview. Test calls do not write memory.

## Built-In Providers

Configured in `config/providers.yaml`:

- OpenAI
- Google Gemini OpenAI compatibility
- Anthropic Claude
- OpenRouter
- Alibaba DashScope Qwen
- Baidu Qianfan
- Kimi
- DeepSeek
- SiliconFlow
- Zhipu BigModel
- Local vLLM
- LM Studio
- Ollama

## Extension Rule

Only providers with OpenAI-compatible Chat Completions or Ollama-compatible APIs should be added directly to `providers.yaml`.

Non-compatible APIs need a native adapter in `providers.py` before being exposed as a provider.
