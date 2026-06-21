from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def estimate_tokens(text: str) -> int:
    if not text:
        return 0
    ascii_count = sum(1 for char in text if ord(char) < 128)
    non_ascii_count = len(text) - ascii_count
    return max(1, ascii_count // 4 + non_ascii_count // 2)


def _clip(text: str, limit: int) -> str:
    text = text.strip()
    if len(text) <= limit:
        return text
    return text[: limit - 20].rstrip() + "\n...[truncated]"


SECRET_PATTERNS = [
    re.compile(r"(?i)\b(api[_-]?key|secret|token|password|passwd|pwd)\s*[:=]\s*['\"]?([^\s'\";,]+)"),
    re.compile(r"\b(sk-[A-Za-z0-9_-]{16,})\b"),
    re.compile(r"\b([A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{16,})\b"),
]


def redact_secrets(text: str) -> str:
    redacted = text
    redacted = SECRET_PATTERNS[0].sub(lambda match: f"{match.group(1)}=[redacted]", redacted)
    for pattern in SECRET_PATTERNS[1:]:
        redacted = pattern.sub("[redacted-secret]", redacted)
    return redacted


class MemoryStore:
    def __init__(self, project_root: Path) -> None:
        self.root = project_root / "data" / "memory"
        self.recent_path = self.root / "recent.jsonl"
        self.summary_path = self.root / "summary.md"

    def build_context(self, memory_settings: dict[str, Any]) -> str:
        if not memory_settings.get("enabled", True):
            return ""
        budget = int(memory_settings.get("max_context_tokens", 1000))
        recent_turns = int(memory_settings.get("recent_turns", 10))
        parts: list[str] = []
        summary = self._read_summary()
        if summary:
            parts.append("Memory summary:\n" + _clip(summary, budget * 4))
        recent = self._read_recent()[-recent_turns:]
        recent_lines: list[str] = []
        for item in reversed(recent):
            line = self._format_turn(item)
            candidate = "\n".join(reversed(recent_lines + [line]))
            candidate_context = "\n\n".join(parts + ["Recent interactions:\n" + candidate])
            if estimate_tokens(candidate_context) > budget:
                break
            recent_lines.append(line)
        if recent_lines:
            parts.append("Recent interactions:\n" + "\n".join(reversed(recent_lines)))
        context = "\n\n".join(parts).strip()
        if estimate_tokens(context) <= budget:
            return context
        return _clip(context, budget * 4)

    def append_turn(
        self,
        memory_settings: dict[str, Any],
        action_id: str,
        input_text: str,
        output_text: str,
        provider_id: str,
        metadata: dict[str, Any] | None = None,
        compact_now: bool = True,
    ) -> None:
        if not memory_settings.get("enabled", True):
            return
        self.root.mkdir(parents=True, exist_ok=True)
        item = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "action_id": action_id,
            "provider_id": provider_id,
            "input_text": _clip(redact_secrets(input_text), 4000),
            "output_text": _clip(redact_secrets(output_text), 4000),
            "metadata": metadata or {},
        }
        with self.recent_path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(item, ensure_ascii=False) + "\n")
        if compact_now:
            self.compact(memory_settings)

    def compact(self, memory_settings: dict[str, Any], model_summary: str | None = None) -> None:
        recent = self._read_recent()
        recent_turns = int(memory_settings.get("recent_turns", 10))
        budget = int(memory_settings.get("max_context_tokens", 1000))
        if len(recent) <= recent_turns and estimate_tokens(self.build_context(memory_settings)) <= budget:
            return
        keep = recent[-recent_turns:]
        older = recent[:-recent_turns]
        while keep and estimate_tokens(self._read_summary() + "\n".join(self._format_turn(item) for item in keep)) > budget:
            older.append(keep.pop(0))
        if older:
            if model_summary:
                self._append_model_summary(model_summary, budget)
            else:
                self._append_summary(older, budget)
        self._write_recent(keep)

    def clear(self) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        self.recent_path.write_text("", encoding="utf-8")
        self.summary_path.write_text("", encoding="utf-8")

    def preview(self, limit: int = 20) -> dict[str, Any]:
        recent = self._read_recent()
        selected = recent[-limit:] if limit > 0 else recent
        return {
            "summary": self._read_summary(),
            "recent": [
                {
                    "index": index,
                    "timestamp": item.get("timestamp", ""),
                    "action_id": item.get("action_id", ""),
                    "provider_id": item.get("provider_id", ""),
                    "input_text": item.get("input_text", ""),
                    "output_text": item.get("output_text", ""),
                    "metadata": item.get("metadata", {}),
                }
                for index, item in reversed(list(enumerate(selected)))
            ],
            "total_recent": len(recent),
        }

    def delete_recent(self, timestamp: str) -> bool:
        recent = self._read_recent()
        kept = [item for item in recent if item.get("timestamp") != timestamp]
        if len(kept) == len(recent):
            return False
        self._write_recent(kept)
        return True

    def _read_recent(self) -> list[dict[str, Any]]:
        if not self.recent_path.exists():
            return []
        items = []
        for line in self.recent_path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            try:
                items.append(json.loads(line))
            except json.JSONDecodeError:
                continue
        return items

    def _write_recent(self, items: list[dict[str, Any]]) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        with self.recent_path.open("w", encoding="utf-8") as handle:
            for item in items:
                handle.write(json.dumps(item, ensure_ascii=False) + "\n")

    def _read_summary(self) -> str:
        if not self.summary_path.exists():
            return ""
        return self.summary_path.read_text(encoding="utf-8").strip()

    def _append_summary(self, items: list[dict[str, Any]], budget: int) -> None:
        existing = self._read_summary()
        additions = [
            f"- {item.get('timestamp', '')} [{item.get('action_id', '')}] "
            f"user: {_clip(item.get('input_text', ''), 300)} | assistant: {_clip(item.get('output_text', ''), 300)}"
            for item in items
        ]
        summary = "\n".join(part for part in [existing, "Compressed older interactions:", *additions] if part).strip()
        while estimate_tokens(summary) > budget and "\n" in summary:
            summary = summary.split("\n", 1)[1].strip()
        self.root.mkdir(parents=True, exist_ok=True)
        self.summary_path.write_text(_clip(summary, budget * 4) + "\n", encoding="utf-8")

    def _append_model_summary(self, model_summary: str, budget: int) -> None:
        existing = self._read_summary()
        summary = "\n".join(part for part in [existing, "Model-assisted summary:", model_summary.strip()] if part).strip()
        while estimate_tokens(summary) > budget and "\n" in summary:
            summary = summary.split("\n", 1)[1].strip()
        self.root.mkdir(parents=True, exist_ok=True)
        self.summary_path.write_text(_clip(redact_secrets(summary), budget * 4) + "\n", encoding="utf-8")

    def _format_turn(self, item: dict[str, Any]) -> str:
        return (
            f"- {item.get('timestamp', '')} [{item.get('action_id', '')}] "
            f"input: {_clip(item.get('input_text', ''), 240)}; "
            f"output: {_clip(item.get('output_text', ''), 240)}"
        )
