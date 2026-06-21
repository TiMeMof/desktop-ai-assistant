from __future__ import annotations

from .prompt_injection import render_prompt_injections
from .schemas import ActionConfig, ChatMessage, CharacterConfig, PromptInjectionConfig


def build_system_prompt(
    character: CharacterConfig,
    prompt_profile: PromptInjectionConfig,
    language: str = "zh-CN",
    context: dict | None = None,
) -> str:
    parts = [character.system_prompt.strip()]
    if character.style_rules:
        parts.append("Style rules:\n" + "\n".join(f"- {rule}" for rule in character.style_rules))
    if character.output_constraints:
        parts.append("Output constraints:\n" + "\n".join(f"- {rule}" for rule in character.output_constraints))
    parts.extend(render_prompt_injections(prompt_profile, language, context or {}))
    return "\n\n".join(part for part in parts if part)


def render_user_prompt(action: ActionConfig, input_text: str) -> str:
    return action.user_template.replace("{{ input_text }}", input_text.strip())


def build_messages(
    character: CharacterConfig,
    action: ActionConfig,
    prompt_profile: PromptInjectionConfig,
    input_text: str,
    language: str = "zh-CN",
    context: dict | None = None,
) -> list[dict[str, str]]:
    return [
        {"role": "system", "content": build_system_prompt(character, prompt_profile, language, context)},
        {"role": "user", "content": render_user_prompt(action, input_text)},
    ]


def build_chat_messages(
    character: CharacterConfig,
    prompt_profile: PromptInjectionConfig,
    message: str,
    history: list[ChatMessage],
    language: str = "zh-CN",
    context: dict | None = None,
) -> list[dict[str, str]]:
    chat_context = {"source": "chat", **(context or {})}
    messages = [{"role": "system", "content": build_system_prompt(character, prompt_profile, language, chat_context)}]
    for item in history:
        messages.append({"role": item.role, "content": item.content})
    messages.append({"role": "user", "content": message.strip()})
    return messages
