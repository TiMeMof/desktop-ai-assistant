from __future__ import annotations

import json
import os
import time
from collections.abc import AsyncIterator

import httpx

from .schemas import ProviderConfig


class ProviderError(RuntimeError):
    pass


def _provider_label(provider: ProviderConfig) -> str:
    return f"{provider.id} ({provider.type}) at {provider.base_url}"


def _connection_error(provider: ProviderConfig, exc: Exception) -> ProviderError:
    if provider.type == "ollama":
        return ProviderError(
            f"Cannot connect to Ollama provider {provider.id} at {provider.base_url}. "
            "Start Ollama with `ollama serve` and make sure the configured model is installed. "
            f"Original error: {exc}"
        )
    return ProviderError(f"Cannot connect to provider {_provider_label(provider)}. Original error: {exc}")


def openai_payload(provider: ProviderConfig, messages: list[dict[str, str]], stream: bool) -> dict:
    return {
        "model": provider.model,
        "messages": messages,
        "temperature": provider.temperature,
        "max_tokens": provider.max_tokens,
        "stream": stream,
    }


def ollama_payload(provider: ProviderConfig, messages: list[dict[str, str]], stream: bool) -> dict:
    return {
        "model": provider.model,
        "messages": messages,
        "options": {"temperature": provider.temperature},
        "stream": stream,
    }


def split_system_messages(messages: list[dict[str, str]]) -> tuple[str | None, list[dict[str, str]]]:
    system_parts = [message["content"] for message in messages if message.get("role") == "system"]
    non_system = [message for message in messages if message.get("role") != "system"]
    return ("\n\n".join(system_parts) if system_parts else None, non_system)


_QIANFAN_TOKEN_CACHE: dict[tuple[str, str], tuple[str, float]] = {}


class ModelClient:
    def __init__(self, provider: ProviderConfig, api_key: str | None = None, timeout: float = 120.0) -> None:
        self.provider = provider
        self.api_key = api_key
        self.timeout = timeout

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        headers.update(self.provider.custom_headers)
        for header_name, env_name in self.provider.env_headers.items():
            value = os.getenv(env_name)
            if value:
                headers[header_name] = value
        if self.provider.type == "openai_compatible":
            if not self.api_key and self.provider.api_key_env:
                raise ProviderError(f"Missing API key env var: {self.provider.api_key_env}")
            if self.api_key:
                headers["Authorization"] = f"Bearer {self.api_key}"
        if self.provider.type == "anthropic":
            if not self.api_key and self.provider.api_key_env:
                raise ProviderError(f"Missing API key env var: {self.provider.api_key_env}")
            if self.api_key:
                headers["x-api-key"] = self.api_key
            headers.setdefault("anthropic-version", "2023-06-01")
        return headers

    def _url(self) -> str:
        base = self.provider.base_url.rstrip("/")
        if self.provider.type == "openai_compatible":
            return f"{base}/chat/completions"
        if self.provider.type == "ollama":
            return f"{base}/api/chat"
        if self.provider.type == "anthropic":
            return f"{base}/messages"
        return f"{base}/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/{self.provider.model}"

    def _payload(self, messages: list[dict[str, str]], stream: bool) -> dict:
        if stream and not self.provider.supports_streaming:
            raise ProviderError(f"Provider {self.provider.id} does not support streaming")
        if not self.provider.supports_system_prompt:
            messages = self._fold_system_messages(messages)
        if self.provider.type == "openai_compatible":
            return openai_payload(self.provider, messages, stream)
        if self.provider.type == "ollama":
            return ollama_payload(self.provider, messages, stream)
        if self.provider.type == "anthropic":
            return self._anthropic_payload(messages, stream)
        return self._qianfan_payload(messages, stream)

    def _anthropic_payload(self, messages: list[dict[str, str]], stream: bool) -> dict:
        system, non_system = split_system_messages(messages)
        payload: dict = {
            "model": self.provider.model,
            "messages": non_system,
            "temperature": self.provider.temperature,
            "max_tokens": self.provider.max_tokens,
            "stream": stream,
        }
        if system:
            payload["system"] = system
        return payload

    def _qianfan_payload(self, messages: list[dict[str, str]], stream: bool) -> dict:
        system, non_system = split_system_messages(messages)
        if system:
            if non_system:
                first = dict(non_system[0])
                first["content"] = f"{system}\n\n{first.get('content', '')}"
                non_system = [first, *non_system[1:]]
            else:
                non_system = [{"role": "user", "content": system}]
        return {
            "messages": non_system,
            "temperature": self.provider.temperature,
            "stream": stream,
        }

    def _fold_system_messages(self, messages: list[dict[str, str]]) -> list[dict[str, str]]:
        system_parts = [message["content"] for message in messages if message.get("role") == "system"]
        non_system = [message for message in messages if message.get("role") != "system"]
        if not system_parts:
            return non_system
        system_text = "\n\n".join(system_parts)
        if non_system:
            first = dict(non_system[0])
            first["content"] = f"{system_text}\n\n{first.get('content', '')}"
            return [first, *non_system[1:]]
        return [{"role": "user", "content": system_text}]

    async def complete(self, messages: list[dict[str, str]]) -> str:
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(
                    await self._request_url(client),
                    headers=self._headers(),
                    json=self._payload(messages, stream=False),
                )
                if response.status_code >= 400:
                    raise ProviderError(f"Provider returned HTTP {response.status_code}: {response.text[:300]}")
                data = response.json()
        except httpx.ConnectError as exc:
            raise _connection_error(self.provider, exc) from exc
        except httpx.HTTPError as exc:
            raise ProviderError(f"Provider request failed for {_provider_label(self.provider)}: {exc}") from exc
        if self.provider.type == "openai_compatible":
            return data["choices"][0]["message"]["content"]
        if self.provider.type == "ollama":
            return data["message"]["content"]
        if self.provider.type == "anthropic":
            return "".join(item.get("text", "") for item in data.get("content", []) if item.get("type") == "text")
        return data.get("result", "")

    async def stream(self, messages: list[dict[str, str]]) -> AsyncIterator[str]:
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                async with client.stream(
                    "POST",
                    await self._request_url(client),
                    headers=self._headers(),
                    json=self._payload(messages, stream=True),
                ) as response:
                    if response.status_code >= 400:
                        body = await response.aread()
                        raise ProviderError(f"Provider returned HTTP {response.status_code}: {body[:300]!r}")
                    if self.provider.type == "openai_compatible":
                        async for chunk in self._stream_openai(response):
                            yield chunk
                    elif self.provider.type == "ollama":
                        async for chunk in self._stream_ollama(response):
                            yield chunk
                    elif self.provider.type == "anthropic":
                        async for chunk in self._stream_anthropic(response):
                            yield chunk
                    else:
                        async for chunk in self._stream_qianfan(response):
                            yield chunk
        except httpx.ConnectError as exc:
            raise _connection_error(self.provider, exc) from exc
        except httpx.HTTPError as exc:
            raise ProviderError(f"Provider request failed for {_provider_label(self.provider)}: {exc}") from exc

    async def _request_url(self, client: httpx.AsyncClient) -> str:
        if self.provider.type != "baidu_qianfan":
            return self._url()
        token = await self._qianfan_access_token(client)
        return f"{self._url()}?access_token={token}"

    async def _qianfan_access_token(self, client: httpx.AsyncClient) -> str:
        api_key = self.api_key
        secret_env = self.provider.api_secret_env
        secret = os.getenv(secret_env) if secret_env else None
        if not api_key and self.provider.api_key_env:
            raise ProviderError(f"Missing API key env var: {self.provider.api_key_env}")
        if not secret and secret_env:
            raise ProviderError(f"Missing API secret env var: {secret_env}")
        if not api_key or not secret:
            raise ProviderError("Baidu Qianfan requires API key and API secret")
        cache_key = (api_key, secret)
        cached = _QIANFAN_TOKEN_CACHE.get(cache_key)
        now = time.time()
        if cached and cached[1] > now + 60:
            return cached[0]
        response = await client.post(
            "https://aip.baidubce.com/oauth/2.0/token",
            params={"grant_type": "client_credentials", "client_id": api_key, "client_secret": secret},
        )
        if response.status_code >= 400:
            raise ProviderError(f"Baidu token request returned HTTP {response.status_code}: {response.text[:300]}")
        data = response.json()
        token = data.get("access_token")
        if not token:
            raise ProviderError(f"Baidu token response did not include access_token: {response.text[:300]}")
        expires_in = int(data.get("expires_in", 2592000))
        _QIANFAN_TOKEN_CACHE[cache_key] = (token, now + max(60, expires_in - 300))
        return token

    async def _stream_openai(self, response: httpx.Response) -> AsyncIterator[str]:
        async for line in response.aiter_lines():
            if not line.startswith("data:"):
                continue
            payload = line.removeprefix("data:").strip()
            if payload == "[DONE]":
                break
            if not payload:
                continue
            data = json.loads(payload)
            delta = data.get("choices", [{}])[0].get("delta", {})
            content = delta.get("content")
            if content:
                yield content

    async def _stream_ollama(self, response: httpx.Response) -> AsyncIterator[str]:
        async for line in response.aiter_lines():
            if not line:
                continue
            data = json.loads(line)
            content = data.get("message", {}).get("content")
            if content:
                yield content
            if data.get("done"):
                break

    async def _stream_anthropic(self, response: httpx.Response) -> AsyncIterator[str]:
        async for line in response.aiter_lines():
            if not line.startswith("data:"):
                continue
            payload = line.removeprefix("data:").strip()
            if not payload:
                continue
            data = json.loads(payload)
            if data.get("type") == "content_block_delta":
                delta = data.get("delta", {})
                if delta.get("type") == "text_delta" and delta.get("text"):
                    yield delta["text"]
            if data.get("type") == "message_stop":
                break

    async def _stream_qianfan(self, response: httpx.Response) -> AsyncIterator[str]:
        async for line in response.aiter_lines():
            if not line:
                continue
            payload = line.removeprefix("data:").strip() if line.startswith("data:") else line.strip()
            if payload == "[DONE]":
                break
            data = json.loads(payload)
            content = data.get("result")
            if content:
                yield content
            if data.get("is_end"):
                break
