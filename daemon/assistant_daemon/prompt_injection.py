from __future__ import annotations

from .schemas import PromptInjectionConfig


def _render_template(template: str, values: dict[str, str]) -> str:
    rendered = template
    for key, value in values.items():
        rendered = rendered.replace("{{ " + key + " }}", value)
        rendered = rendered.replace("{{" + key + "}}", value)
    return rendered.strip()


def render_prompt_injections(profile: PromptInjectionConfig, language: str, context: dict) -> list[str]:
    output_language = profile.language_labels.get(language, language)
    values = {
        "output_language": output_language,
        "language": language,
        "source": str(context.get("source", "unknown")),
        "memory_context": str(context.get("memory_context", "")).strip(),
    }
    rendered = [_render_template(template, values) for template in profile.system_injections]
    if context:
        rendered.extend(_render_template(template, values) for template in profile.context_injections)
    if values["memory_context"]:
        rendered.extend(_render_template(template, values) for template in profile.memory_injections)
    return [item for item in rendered if item]
