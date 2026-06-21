from __future__ import annotations

from typing import Any

from .schemas import AssistantEvent


def assistant_event_for_action(action_id: str, provider_id: str) -> AssistantEvent:
    if action_id == "translate":
        return AssistantEvent(
            state="asking_followup",
            speak_text="主人，翻译完成了。要不要我继续帮您润色一下？",
            emotion="happy",
            motion="ask",
            suggestions=[
                {
                    "id": "polish_translation",
                    "label": "润色译文",
                    "kind": "action",
                    "action_id": "polish",
                },
                {
                    "id": "explain_source",
                    "label": "解释原文",
                    "kind": "action",
                    "action_id": "explain",
                },
                {
                    "id": "continue_chat",
                    "label": "继续聊天",
                    "kind": "mode",
                    "mode": "chat",
                },
            ],
            metadata={"action_id": action_id, "provider_id": provider_id},
        )
    return AssistantEvent(
        state="presenting",
        speak_text="主人，结果已经为您准备好了。",
        emotion="neutral",
        motion="present_result",
        metadata={"action_id": action_id, "provider_id": provider_id},
    )


def assistant_event_for_chat(display_text: str, session_id: str, provider_id: str) -> AssistantEvent:
    return AssistantEvent(
        state="chatting",
        speak_text=display_text,
        emotion="neutral",
        motion="idle",
        metadata={"provider_id": provider_id, "session_id": session_id},
    )


def done_payload(
    display_text: str,
    metadata: dict[str, Any],
    assistant_event: AssistantEvent,
    session_id: str | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "display_text": display_text,
        "speak_text": assistant_event.speak_text,
        "emotion": assistant_event.emotion,
        "motion": assistant_event.motion,
        "assistant_event": assistant_event.model_dump(exclude_none=True),
        "metadata": metadata,
    }
    if session_id is not None:
        payload["session_id"] = session_id
    return payload
