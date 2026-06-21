from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import json
import yaml
from dotenv import load_dotenv
from pydantic import ValidationError

from .schemas import ActionConfig, CharacterConfig, PromptInjectionConfig, ProviderConfig, SettingsUpdate, UserSettings


PROJECT_ROOT = Path(__file__).resolve().parents[2]
CONFIG_ROOT = PROJECT_ROOT / "config"
USER_SETTINGS_PATH = CONFIG_ROOT / "user_settings.json"
ENV_PATH = PROJECT_ROOT / ".env"


class ConfigError(RuntimeError):
    pass


RESERVED_SHORTCUTS = {
    "Ctrl+C",
    "Command+C",
    "Ctrl+V",
    "Command+V",
    "Ctrl+X",
    "Command+X",
    "Ctrl+A",
    "Command+A",
    "Ctrl+Z",
    "Command+Z",
    "Ctrl+Y",
    "Command+Shift+Z",
}

SUPPORTED_LANGUAGES = {"zh-CN", "en", "ja", "ko"}


def load_yaml(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise ConfigError(f"Missing config file: {path}")
    with path.open("r", encoding="utf-8") as handle:
        data = yaml.safe_load(handle) or {}
    if not isinstance(data, dict):
        raise ConfigError(f"Config file must contain a mapping: {path}")
    return data


class Settings:
    def __init__(self, config_root: Path = CONFIG_ROOT) -> None:
        self.config_root = config_root
        self.project_root = config_root.parent
        self.user_settings_path = config_root / "user_settings.json"
        self.env_path = self.project_root / ".env"
        load_dotenv(self.env_path, override=True)
        self.app = load_yaml(config_root / "app.yaml")
        provider_data = load_yaml(config_root / "providers.yaml")
        self.providers = {
            provider.id: provider
            for provider in (ProviderConfig.model_validate(item) for item in provider_data.get("providers", []))
        }
        self.characters = self._load_dir(config_root / "characters", CharacterConfig)
        self.actions = self._load_dir(config_root / "actions", ActionConfig)
        self.prompt_profiles = self._load_dir(config_root / "prompt_injections", PromptInjectionConfig)
        self.user_settings = self._load_user_settings()
        self._validate_defaults()

    def _load_dir(
        self,
        path: Path,
        model: type[ActionConfig] | type[CharacterConfig] | type[PromptInjectionConfig],
    ) -> dict[str, Any]:
        if not path.exists():
            raise ConfigError(f"Missing config directory: {path}")
        items: dict[str, Any] = {}
        for file_path in sorted(path.glob("*.yaml")):
            item = model.model_validate(load_yaml(file_path))
            items[item.id] = item
        if not items:
            raise ConfigError(f"No config files found in {path}")
        return items

    def _validate_defaults(self) -> None:
        defaults = self.app.get("defaults", {})
        if defaults.get("provider_id") not in self.providers:
            raise ConfigError(f"Unknown default provider_id: {defaults.get('provider_id')}")
        if defaults.get("character_id") not in self.characters:
            raise ConfigError(f"Unknown default character_id: {defaults.get('character_id')}")
        if defaults.get("action_id") not in self.actions:
            raise ConfigError(f"Unknown default action_id: {defaults.get('action_id')}")
        default_prompt_profile = defaults.get("prompt_profile_id", "default")
        if default_prompt_profile not in self.prompt_profiles:
            raise ConfigError(f"Unknown default prompt_profile_id: {default_prompt_profile}")
        if self.user_settings.provider_id and self.user_settings.provider_id not in self.providers:
            raise ConfigError(f"Unknown user provider_id: {self.user_settings.provider_id}")
        if self.user_settings.character_id and self.user_settings.character_id not in self.characters:
            raise ConfigError(f"Unknown user character_id: {self.user_settings.character_id}")
        if self.user_settings.prompt_profile_id and self.user_settings.prompt_profile_id not in self.prompt_profiles:
            raise ConfigError(f"Unknown user prompt_profile_id: {self.user_settings.prompt_profile_id}")
        self._validate_settings(self.user_settings)

    def _load_user_settings(self) -> UserSettings:
        if not self.user_settings_path.exists():
            return UserSettings(
                provider_id=self.app.get("defaults", {}).get("provider_id"),
                character_id=self.app.get("defaults", {}).get("character_id"),
                prompt_profile_id=self.app.get("defaults", {}).get("prompt_profile_id", "default"),
                shortcut=self._default_shortcut(),
                language="zh-CN",
            )
        with self.user_settings_path.open("r", encoding="utf-8") as handle:
            return UserSettings.model_validate(json.load(handle))

    def _default_shortcut(self) -> str:
        return self.app.get("desktop", {}).get("shortcut", {}).get("windows_linux", "Ctrl+Shift+Space")

    def save_user_settings(self, update: SettingsUpdate) -> UserSettings:
        current = self.user_settings.model_dump()
        for field in ("provider_id", "character_id", "prompt_profile_id", "shortcut", "language"):
            value = getattr(update, field)
            if value is not None:
                current[field] = value
        if update.mouse_trigger is not None:
            mouse_trigger = dict(current.get("mouse_trigger") or {})
            for key in ("enabled", "button", "consume"):
                if key in update.mouse_trigger:
                    mouse_trigger[key] = update.mouse_trigger[key]
            current["mouse_trigger"] = mouse_trigger
        if update.memory is not None:
            memory = dict(current.get("memory") or {})
            for key in ("enabled", "max_context_tokens", "recent_turns", "summary_mode"):
                if key in update.memory:
                    memory[key] = update.memory[key]
            current["memory"] = memory
        if update.model_overrides is not None:
            merged = dict(current.get("model_overrides") or {})
            for provider_id, model in update.model_overrides.items():
                model = model.strip()
                if model:
                    merged[provider_id] = model
                else:
                    merged.pop(provider_id, None)
            current["model_overrides"] = merged
        try:
            next_settings = UserSettings.model_validate(current)
        except ValidationError as exc:
            raise ConfigError(str(exc)) from exc
        self._validate_settings(next_settings)
        if update.api_keys:
            self._update_env_values(update.api_keys, "api key", "api_key_env")
            load_dotenv(self.env_path, override=True)
        if update.api_secrets:
            self._update_env_values(update.api_secrets, "api secret", "api_secret_env")
            load_dotenv(self.env_path, override=True)
        self.user_settings_path.parent.mkdir(parents=True, exist_ok=True)
        with self.user_settings_path.open("w", encoding="utf-8") as handle:
            json.dump(next_settings.model_dump(), handle, ensure_ascii=False, indent=2)
            handle.write("\n")
        self.user_settings = next_settings
        return self.user_settings

    def _validate_settings(self, next_settings: UserSettings) -> None:
        if next_settings.provider_id and next_settings.provider_id not in self.providers:
            raise ConfigError(f"Unknown provider_id: {next_settings.provider_id}")
        if next_settings.character_id and next_settings.character_id not in self.characters:
            raise ConfigError(f"Unknown character_id: {next_settings.character_id}")
        if next_settings.prompt_profile_id and next_settings.prompt_profile_id not in self.prompt_profiles:
            raise ConfigError(f"Unknown prompt_profile_id: {next_settings.prompt_profile_id}")
        if next_settings.shortcut in RESERVED_SHORTCUTS:
            raise ConfigError(f"{next_settings.shortcut} is reserved by normal editing/copy behavior")
        if next_settings.language not in SUPPORTED_LANGUAGES:
            raise ConfigError(f"Unsupported language: {next_settings.language}")
        for provider_id in next_settings.model_overrides:
            if provider_id not in self.providers:
                raise ConfigError(f"Unknown provider_id for model override: {provider_id}")

    def _update_env_values(self, values: dict[str, str], label: str, env_attr: str) -> None:
        env_updates: dict[str, str] = {}
        for provider_id, value in values.items():
            if provider_id not in self.providers:
                raise ConfigError(f"Unknown provider_id for {label}: {provider_id}")
            env_name = getattr(self.providers[provider_id], env_attr)
            if env_name and value.strip():
                env_updates[env_name] = value.strip()
        if not env_updates:
            return
        existing: dict[str, str] = {}
        if self.env_path.exists():
            for line in self.env_path.read_text(encoding="utf-8").splitlines():
                if not line or line.strip().startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                existing[key.strip()] = value
        existing.update(env_updates)
        lines = [f"{key}={value}" for key, value in sorted(existing.items())]
        self.env_path.write_text("\n".join(lines) + "\n", encoding="utf-8")

    @property
    def max_input_chars(self) -> int:
        return int(self.app.get("limits", {}).get("max_input_chars", 12000))

    def require_provider(self, provider_id: str | None) -> ProviderConfig:
        selected = provider_id or self.user_settings.provider_id or self.app["defaults"]["provider_id"]
        try:
            provider = self.providers[selected]
        except KeyError as exc:
            raise ConfigError(f"Unknown provider_id: {selected}") from exc
        override = self.user_settings.model_overrides.get(selected)
        if override:
            return provider.model_copy(update={"model": override})
        return provider

    def require_character(self, character_id: str | None) -> CharacterConfig:
        selected = character_id or self.user_settings.character_id or self.app["defaults"]["character_id"]
        try:
            return self.characters[selected]
        except KeyError as exc:
            raise ConfigError(f"Unknown character_id: {selected}") from exc

    def require_action(self, action_id: str) -> ActionConfig:
        try:
            return self.actions[action_id]
        except KeyError as exc:
            raise ConfigError(f"Unknown action_id: {action_id}") from exc

    def require_prompt_profile(self, prompt_profile_id: str | None = None) -> PromptInjectionConfig:
        selected = (
            prompt_profile_id
            or self.user_settings.prompt_profile_id
            or self.app.get("defaults", {}).get("prompt_profile_id")
            or "default"
        )
        try:
            return self.prompt_profiles[selected]
        except KeyError as exc:
            raise ConfigError(f"Unknown prompt_profile_id: {selected}") from exc

    def provider_api_key(self, provider: ProviderConfig) -> str | None:
        if not provider.api_key_env:
            return None
        return os.getenv(provider.api_key_env)

    def summary(self) -> dict[str, Any]:
        return {
            "defaults": self.app.get("defaults", {}),
            "limits": self.app.get("limits", {}),
            "providers": [
                {
                    "id": provider.id,
                    "name": provider.name or provider.id,
                    "type": provider.type,
                    "model": self.user_settings.model_overrides.get(provider.id, provider.model),
                    "default_model": provider.model,
                    "base_url": provider.base_url,
                    "requires_api_key": bool(provider.api_key_env),
                    "requires_api_secret": bool(provider.api_secret_env),
                    "api_key_configured": bool(provider.api_key_env and os.getenv(provider.api_key_env)),
                    "api_secret_configured": bool(provider.api_secret_env and os.getenv(provider.api_secret_env)),
                    "capabilities": {
                        "supports_streaming": provider.supports_streaming,
                        "supports_system_prompt": provider.supports_system_prompt,
                        "context_size": provider.context_size,
                        "max_output_tokens": provider.max_tokens,
                    },
                }
                for provider in self.providers.values()
            ],
            "characters": [{"id": item.id, "name": item.name} for item in self.characters.values()],
            "prompt_profiles": [
                {"id": item.id, "name": item.name, "description": item.description}
                for item in self.prompt_profiles.values()
            ],
            "actions": [
                {
                    "id": item.id,
                    "name": item.name,
                    "label": item.labels.get(self.user_settings.language, item.name),
                    "description": item.description,
                }
                for item in self.actions.values()
            ],
            "user_settings": self.safe_user_settings(),
        }

    def safe_user_settings(self) -> dict[str, Any]:
        data = self.user_settings.model_dump()
        data["provider_id"] = data["provider_id"] or self.app["defaults"]["provider_id"]
        data["character_id"] = data["character_id"] or self.app["defaults"]["character_id"]
        data["prompt_profile_id"] = data["prompt_profile_id"] or self.app.get("defaults", {}).get("prompt_profile_id", "default")
        data["shortcut"] = data["shortcut"] or self._default_shortcut()
        data["api_key_status"] = {
            provider.id: bool(provider.api_key_env and os.getenv(provider.api_key_env))
            for provider in self.providers.values()
        }
        data["api_secret_status"] = {
            provider.id: bool(provider.api_secret_env and os.getenv(provider.api_secret_env))
            for provider in self.providers.values()
        }
        return data
