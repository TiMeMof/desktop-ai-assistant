from __future__ import annotations

import json
import time
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from .assistant_events import assistant_event_for_action, assistant_event_for_chat, done_payload
from .config import ConfigError, Settings
from .memory import MemoryStore
from .prompts import build_chat_messages, build_messages
from .providers import ModelClient, ProviderError
from .schemas import (
    ActionRequest,
    ActionResponse,
    ChatMessage,
    ChatRequest,
    ConfigSummary,
    MemoryPreview,
    ProviderTestRequest,
    ProviderTestResponse,
    SettingsUpdate,
)


settings = Settings()
app = FastAPI(title="Desktop AI Assistant Daemon", version="0.1.0")


@dataclass
class ChatSession:
    session_id: str
    messages: list[ChatMessage] = field(default_factory=list)
    updated_at: float = field(default_factory=time.time)


CHAT_SESSIONS: dict[str, ChatSession] = {}
MAX_CHAT_MESSAGES = 24
MAX_CHAT_SESSIONS = 50

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:1420",
        "http://127.0.0.1:1420",
        "http://tauri.localhost",
        "https://tauri.localhost",
        "tauri://localhost",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)


def reload_settings() -> Settings:
    global settings
    settings = Settings()
    return settings


def _memory_settings_for_action(memory_settings: dict[str, Any], action_id: str) -> dict[str, Any]:
    adjusted = dict(memory_settings)
    if action_id == "translate":
        adjusted["max_context_tokens"] = min(int(adjusted.get("max_context_tokens", 1000)), 500)
        adjusted["recent_turns"] = min(int(adjusted.get("recent_turns", 10)), 4)
        adjusted["policy"] = "low_context"
    elif action_id in {"explain", "polish"}:
        adjusted["policy"] = "full_context"
    else:
        adjusted["policy"] = "default"
    return adjusted


def _memory_settings_for_chat(memory_settings: dict[str, Any]) -> dict[str, Any]:
    adjusted = dict(memory_settings)
    adjusted["policy"] = "chat_context"
    return adjusted


def _memory_disabled(context: dict[str, Any]) -> bool:
    return bool(context.get("memory_paused") or context.get("memory_disabled"))


def _exclude_memory_input(context: dict[str, Any]) -> bool:
    return bool(context.get("memory_exclude_input"))


def _prepare(request: ActionRequest) -> tuple[Settings, ModelClient, list[dict[str, str]], str, dict[str, Any]]:
    current_settings = reload_settings()
    input_text = request.input_text.strip()
    if not input_text:
        raise HTTPException(status_code=400, detail="input_text is empty")
    if len(input_text) > current_settings.max_input_chars:
        raise HTTPException(status_code=413, detail=f"input_text exceeds {current_settings.max_input_chars} characters")
    try:
        provider = current_settings.require_provider(request.provider_id)
        character = current_settings.require_character(request.character_id)
        action = current_settings.require_action(request.action_id)
        prompt_profile = current_settings.require_prompt_profile()
    except ConfigError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    client = ModelClient(provider, current_settings.provider_api_key(provider))
    request_context = dict(request.context)
    memory_settings = _memory_settings_for_action(current_settings.user_settings.memory, request.action_id)
    if not _memory_disabled(request_context):
        memory_context = MemoryStore(current_settings.project_root).build_context(memory_settings)
    else:
        memory_context = ""
    if memory_context:
        request_context["memory_context"] = memory_context
    return (
        current_settings,
        client,
        build_messages(character, action, prompt_profile, input_text, current_settings.user_settings.language, request_context),
        provider.id,
        memory_settings,
    )


def _prune_chat_sessions() -> None:
    if len(CHAT_SESSIONS) <= MAX_CHAT_SESSIONS:
        return
    stale = sorted(CHAT_SESSIONS.values(), key=lambda session: session.updated_at)
    for session in stale[: len(CHAT_SESSIONS) - MAX_CHAT_SESSIONS]:
        CHAT_SESSIONS.pop(session.session_id, None)


def _chat_session(session_id: str | None) -> ChatSession:
    selected = session_id or str(uuid.uuid4())
    session = CHAT_SESSIONS.get(selected)
    if session is None:
        session = ChatSession(session_id=selected)
        CHAT_SESSIONS[selected] = session
        _prune_chat_sessions()
    session.updated_at = time.time()
    return session


def _prepare_chat(request: ChatRequest) -> tuple[Settings, ModelClient, list[dict[str, str]], str, dict[str, Any], ChatSession]:
    current_settings = reload_settings()
    input_text = request.message.strip()
    if not input_text:
        raise HTTPException(status_code=400, detail="message is empty")
    if len(input_text) > current_settings.max_input_chars:
        raise HTTPException(status_code=413, detail=f"message exceeds {current_settings.max_input_chars} characters")
    try:
        provider = current_settings.require_provider(request.provider_id)
        character = current_settings.require_character(request.character_id)
        prompt_profile = current_settings.require_prompt_profile()
    except ConfigError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    client = ModelClient(provider, current_settings.provider_api_key(provider))
    session = _chat_session(request.session_id)
    request_context = {"source": "chat", **dict(request.context)}
    memory_settings = _memory_settings_for_chat(current_settings.user_settings.memory)
    if not _memory_disabled(request_context):
        memory_context = MemoryStore(current_settings.project_root).build_context(memory_settings)
    else:
        memory_context = ""
    if memory_context:
        request_context["memory_context"] = memory_context
    history = session.messages[-MAX_CHAT_MESSAGES:]
    return (
        current_settings,
        client,
        build_chat_messages(character, prompt_profile, input_text, history, current_settings.user_settings.language, request_context),
        provider.id,
        memory_settings,
        session,
    )


async def _model_summary(client: ModelClient, store: MemoryStore, memory_settings: dict[str, Any]) -> str | None:
    prompt_context = store.build_context({**memory_settings, "enabled": True, "recent_turns": 100})
    if not prompt_context:
        return None
    messages = [
        {
            "role": "system",
            "content": "Summarize local assistant memory. Keep durable user preferences and useful context. Remove secrets and transient details.",
        },
        {
            "role": "user",
            "content": f"Update the memory summary from these records. Return only the summary.\n\n{prompt_context}",
        },
    ]
    try:
        return await client.complete(messages)
    except ProviderError:
        return None


async def _append_memory(
    current_settings: Settings,
    client: ModelClient,
    memory_settings: dict[str, Any],
    action_id: str,
    input_text: str,
    context: dict[str, Any],
    output_text: str,
    provider_id: str,
    metadata: dict[str, Any],
) -> None:
    if _memory_disabled(context):
        return
    store = MemoryStore(current_settings.project_root)
    stored_input = "[input excluded by privacy setting]" if _exclude_memory_input(context) else input_text
    use_model_summary = memory_settings.get("summary_mode") == "model"
    store.append_turn(
        memory_settings,
        action_id,
        stored_input,
        output_text,
        provider_id,
        {**metadata, "memory_policy": memory_settings.get("policy", "default")},
        compact_now=not use_model_summary,
    )
    if not use_model_summary:
        return
    if store.preview()["total_recent"] <= int(memory_settings.get("recent_turns", 10)):
        return
    summary = await _model_summary(client, store, memory_settings)
    store.compact(memory_settings, model_summary=summary)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/v1/config", response_model=ConfigSummary)
async def config() -> dict:
    return reload_settings().summary()


@app.get("/v1/settings")
async def get_settings() -> dict:
    return reload_settings().safe_user_settings()


@app.put("/v1/settings")
async def update_settings(update: SettingsUpdate) -> dict:
    current_settings = reload_settings()
    try:
        current_settings.save_user_settings(update)
    except ConfigError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return current_settings.safe_user_settings()


@app.delete("/v1/memory")
async def clear_memory() -> dict[str, str]:
    current_settings = reload_settings()
    MemoryStore(current_settings.project_root).clear()
    return {"status": "cleared"}


@app.get("/v1/memory", response_model=MemoryPreview)
async def memory_preview(limit: int = 20) -> dict:
    current_settings = reload_settings()
    return MemoryStore(current_settings.project_root).preview(max(1, min(limit, 100)))


@app.delete("/v1/memory/recent/{timestamp}")
async def delete_memory_record(timestamp: str) -> dict[str, str]:
    current_settings = reload_settings()
    if not MemoryStore(current_settings.project_root).delete_recent(timestamp):
        raise HTTPException(status_code=404, detail="memory record not found")
    return {"status": "deleted"}


@app.post("/v1/providers/{provider_id}/test", response_model=ProviderTestResponse)
async def test_provider(provider_id: str, request: ProviderTestRequest) -> ProviderTestResponse:
    current_settings = reload_settings()
    try:
        provider = current_settings.require_provider(provider_id)
        client = ModelClient(provider, current_settings.provider_api_key(provider), timeout=30.0)
    except ConfigError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    start = time.perf_counter()
    try:
        output = await client.complete([{"role": "user", "content": request.prompt.strip()[:1000]}])
    except ProviderError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    latency_ms = int((time.perf_counter() - start) * 1000)
    return ProviderTestResponse(
        status="ok",
        provider_id=provider.id,
        latency_ms=latency_ms,
        output_preview=output[:300],
    )


@app.post("/v1/actions/run", response_model=ActionResponse)
async def run_action(request: ActionRequest) -> ActionResponse:
    current_settings, client, messages, provider_id, memory_settings = _prepare(request)
    try:
        text = await client.complete(messages)
    except ProviderError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    await _append_memory(
        current_settings,
        client,
        memory_settings,
        request.action_id,
        request.input_text,
        request.context,
        text,
        provider_id,
        {"mode": "run"},
    )
    assistant_event = assistant_event_for_action(request.action_id, provider_id)
    return ActionResponse(
        display_text=text,
        speak_text=assistant_event.speak_text,
        emotion=assistant_event.emotion,
        motion=assistant_event.motion,
        assistant_event=assistant_event,
        metadata={"provider_id": provider_id},
    )


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@app.post("/v1/chat/stream")
async def stream_chat(request: ChatRequest) -> StreamingResponse:
    current_settings, client, messages, provider_id, memory_settings, session = _prepare_chat(request)

    async def events() -> AsyncIterator[str]:
        collected: list[str] = []
        try:
            async for chunk in client.stream(messages):
                collected.append(chunk)
                yield _sse("delta", {"display_text": chunk})
            display_text = "".join(collected)
            session.messages.append(ChatMessage(role="user", content=request.message))
            session.messages.append(ChatMessage(role="assistant", content=display_text))
            session.messages = session.messages[-MAX_CHAT_MESSAGES:]
            session.updated_at = time.time()
            await _append_memory(
                current_settings,
                client,
                memory_settings,
                "chat",
                request.message,
                request.context,
                display_text,
                provider_id,
                {"mode": "chat", "session_id": session.session_id},
            )
            assistant_event = assistant_event_for_chat(display_text, session.session_id, provider_id)
            yield _sse(
                "done",
                done_payload(
                    display_text,
                    {"provider_id": provider_id, "session_id": session.session_id},
                    assistant_event,
                    session.session_id,
                ),
            )
        except ProviderError as exc:
            yield _sse("error", {"message": str(exc), "session_id": session.session_id})

    return StreamingResponse(events(), media_type="text/event-stream")


@app.post("/v1/actions/stream")
async def stream_action(request: ActionRequest) -> StreamingResponse:
    current_settings, client, messages, provider_id, memory_settings = _prepare(request)

    async def events() -> AsyncIterator[str]:
        collected: list[str] = []
        try:
            async for chunk in client.stream(messages):
                collected.append(chunk)
                yield _sse("delta", {"display_text": chunk})
            display_text = "".join(collected)
            await _append_memory(
                current_settings,
                client,
                memory_settings,
                request.action_id,
                request.input_text,
                request.context,
                display_text,
                provider_id,
                {"mode": "stream"},
            )
            assistant_event = assistant_event_for_action(request.action_id, provider_id)
            yield _sse(
                "done",
                done_payload(display_text, {"provider_id": provider_id}, assistant_event),
            )
        except ProviderError as exc:
            yield _sse("error", {"message": str(exc)})

    return StreamingResponse(events(), media_type="text/event-stream")
