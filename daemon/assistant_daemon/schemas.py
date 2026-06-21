from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator


ProviderType = Literal["openai_compatible", "ollama", "anthropic", "baidu_qianfan"]


class ProviderConfig(BaseModel):
    id: str
    name: str | None = None
    type: ProviderType
    base_url: str
    model: str
    api_key_env: str | None = None
    api_secret_env: str | None = None
    temperature: float = 0.3
    max_tokens: int = 1200
    context_size: int | None = None
    supports_streaming: bool = True
    supports_system_prompt: bool = True
    custom_headers: dict[str, str] = Field(default_factory=dict)
    env_headers: dict[str, str] = Field(default_factory=dict)

    @field_validator("model")
    @classmethod
    def model_must_not_be_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("model must not be blank")
        return value

    @field_validator("base_url")
    @classmethod
    def base_url_must_look_valid(cls, value: str) -> str:
        value = value.strip().rstrip("/")
        if not value.startswith(("http://", "https://")):
            raise ValueError("base_url must start with http:// or https://")
        return value


class UserSettings(BaseModel):
    provider_id: str | None = None
    character_id: str | None = None
    prompt_profile_id: str | None = None
    shortcut: str | None = None
    language: str = "zh-CN"
    model_overrides: dict[str, str] = Field(default_factory=dict)
    mouse_trigger: dict[str, Any] = Field(
        default_factory=lambda: {"enabled": False, "button": 8, "consume": True}
    )
    memory: dict[str, Any] = Field(
        default_factory=lambda: {
            "enabled": True,
            "max_context_tokens": 1000,
            "recent_turns": 10,
            "summary_mode": "deterministic",
        }
    )

    @field_validator("shortcut")
    @classmethod
    def shortcut_must_look_valid(cls, value: str | None) -> str | None:
        if value is None:
            return value
        value = value.strip()
        if not value:
            return None
        parts = [part for part in value.split("+") if part]
        modifiers = {"Ctrl", "Command", "Super", "Alt", "Shift", "Option"}
        if len(parts) < 2 or not any(part in modifiers for part in parts):
            raise ValueError("shortcut must include at least one modifier and one key")
        return "+".join(parts)

    @field_validator("model_overrides")
    @classmethod
    def model_overrides_must_be_strings(cls, value: dict[str, str]) -> dict[str, str]:
        cleaned: dict[str, str] = {}
        for provider_id, model in value.items():
            provider_id = provider_id.strip()
            model = model.strip()
            if provider_id and model:
                cleaned[provider_id] = model
        return cleaned

    @field_validator("mouse_trigger")
    @classmethod
    def mouse_trigger_must_be_valid(cls, value: dict[str, Any]) -> dict[str, Any]:
        merged = {"enabled": False, "button": 8, "consume": True}
        merged.update(value or {})
        button = int(merged["button"])
        if button < 8 or button > 12:
            raise ValueError("mouse trigger button must be between 8 and 12")
        return {
            "enabled": bool(merged["enabled"]),
            "button": button,
            "consume": bool(merged["consume"]),
        }

    @field_validator("memory")
    @classmethod
    def memory_must_be_valid(cls, value: dict[str, Any]) -> dict[str, Any]:
        merged = {
            "enabled": True,
            "max_context_tokens": 1000,
            "recent_turns": 10,
            "summary_mode": "deterministic",
        }
        merged.update(value or {})
        budget = int(merged["max_context_tokens"])
        recent_turns = int(merged["recent_turns"])
        summary_mode = str(merged.get("summary_mode") or "deterministic")
        if budget < 200 or budget > 8000:
            raise ValueError("memory max_context_tokens must be between 200 and 8000")
        if recent_turns < 0 or recent_turns > 100:
            raise ValueError("memory recent_turns must be between 0 and 100")
        if summary_mode not in {"deterministic", "model"}:
            raise ValueError("memory summary_mode must be deterministic or model")
        return {
            "enabled": bool(merged["enabled"]),
            "max_context_tokens": budget,
            "recent_turns": recent_turns,
            "summary_mode": summary_mode,
        }


class SettingsUpdate(BaseModel):
    provider_id: str | None = None
    character_id: str | None = None
    prompt_profile_id: str | None = None
    shortcut: str | None = None
    language: str | None = None
    model_overrides: dict[str, str] | None = None
    mouse_trigger: dict[str, Any] | None = None
    memory: dict[str, Any] | None = None
    api_keys: dict[str, str] | None = None
    api_secrets: dict[str, str] | None = None

    @model_validator(mode="after")
    def strip_blank_scalars(self) -> "SettingsUpdate":
        for field_name in ("provider_id", "character_id", "prompt_profile_id", "shortcut", "language"):
            value = getattr(self, field_name)
            if isinstance(value, str):
                setattr(self, field_name, value.strip() or None)
        return self


class CharacterConfig(BaseModel):
    id: str
    name: str
    system_prompt: str
    style_rules: list[str] = Field(default_factory=list)
    output_constraints: list[str] = Field(default_factory=list)


class ActionConfig(BaseModel):
    id: str
    name: str
    labels: dict[str, str] = Field(default_factory=dict)
    description: str = ""
    user_template: str


class PromptInjectionConfig(BaseModel):
    id: str
    name: str
    description: str = ""
    language_labels: dict[str, str] = Field(default_factory=dict)
    system_injections: list[str] = Field(default_factory=list)
    context_injections: list[str] = Field(default_factory=list)
    memory_injections: list[str] = Field(default_factory=list)


class ActionRequest(BaseModel):
    action_id: str
    character_id: str | None = None
    input_text: str
    provider_id: str | None = None
    context: dict[str, Any] = Field(default_factory=dict)


ChatRole = Literal["user", "assistant"]


class ChatMessage(BaseModel):
    role: ChatRole
    content: str

    @field_validator("content")
    @classmethod
    def content_must_not_be_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("chat message content must not be blank")
        return value


class ChatRequest(BaseModel):
    session_id: str | None = None
    character_id: str | None = None
    provider_id: str | None = None
    message: str
    context: dict[str, Any] = Field(default_factory=dict)

    @field_validator("message")
    @classmethod
    def message_must_not_be_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("message must not be blank")
        return value


class AssistantSuggestion(BaseModel):
    id: str
    label: str
    kind: Literal["action", "mode", "command"]
    action_id: str | None = None
    mode: Literal["action", "chat"] | None = None
    command: str | None = None
    context: dict[str, Any] = Field(default_factory=dict)


class AssistantEvent(BaseModel):
    state: Literal["idle", "listening", "thinking", "presenting", "asking_followup", "error", "chatting"]
    speak_text: str | None = None
    emotion: Literal["neutral", "happy", "thinking", "confused", "apologetic"] = "neutral"
    motion: Literal["idle", "nod", "wave", "present_result", "ask", "error"] = "idle"
    suggestions: list[AssistantSuggestion] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class ChatResponse(BaseModel):
    session_id: str
    display_text: str
    speak_text: str | None = None
    emotion: str | None = None
    motion: str | None = None
    assistant_event: AssistantEvent | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class ProviderTestRequest(BaseModel):
    prompt: str = "Reply with one short sentence saying the provider connection works."


class ProviderTestResponse(BaseModel):
    status: str
    provider_id: str
    latency_ms: int
    output_preview: str


class MemoryRecord(BaseModel):
    index: int
    timestamp: str
    action_id: str
    provider_id: str
    input_text: str
    output_text: str
    metadata: dict[str, Any] = Field(default_factory=dict)


class MemoryPreview(BaseModel):
    summary: str
    recent: list[MemoryRecord]
    total_recent: int


class ActionResponse(BaseModel):
    display_text: str
    speak_text: str | None = None
    emotion: str | None = None
    motion: str | None = None
    assistant_event: AssistantEvent | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class ConfigSummary(BaseModel):
    defaults: dict[str, Any]
    limits: dict[str, Any]
    providers: list[dict[str, Any]]
    characters: list[dict[str, str]]
    prompt_profiles: list[dict[str, str]]
    actions: list[dict[str, str]]
    user_settings: dict[str, Any] = Field(default_factory=dict)
