import { useState } from "react";
import type { AssistantEvent, AssistantSuggestion } from "./types";

type Live2DAssistantProps = {
  event?: AssistantEvent | null;
  busy: boolean;
  language?: string;
  onSubmitChat: (message: string) => void;
  onRunSuggestion: (suggestion: AssistantSuggestion) => void;
  onOpenSettings: () => void;
};

function labelsFor(language?: string) {
  if (language === "zh-CN") {
    return {
      input: "输入文字",
      placeholder: "对主人有什么吩咐？",
      send: "发送",
      settings: "设置",
      waiting: "等待指令"
    };
  }
  return {
    input: "Type message",
    placeholder: "What should I help with?",
    send: "Send",
    settings: "Settings",
    waiting: "Waiting"
  };
}

export function Live2DAssistant({
  event,
  busy,
  language,
  onSubmitChat,
  onRunSuggestion,
  onOpenSettings
}: Live2DAssistantProps) {
  const labels = labelsFor(language);
  const [menuOpen, setMenuOpen] = useState(false);
  const [inputOpen, setInputOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const suggestions = event?.suggestions ?? [];

  function submitDraft() {
    const message = draft.trim();
    if (!message || busy) {
      return;
    }
    onSubmitChat(message);
    setDraft("");
    setInputOpen(false);
    setMenuOpen(false);
  }

  return (
    <aside
      className="live2d-panel"
      onContextMenu={(reactEvent) => {
        reactEvent.preventDefault();
        reactEvent.stopPropagation();
        setMenuOpen((current) => !current);
      }}
    >
      <div className={`live2d-stage ${busy ? "thinking" : ""}`}>
        <div className="live2d-fallback">{event?.speak_text ?? labels.waiting}</div>
      </div>
      <div className="live2d-status">
        {event?.emotion ?? "neutral"} · {event?.motion ?? "idle"}
      </div>
      {suggestions.length > 0 && (
        <div className="live2d-suggestions">
          {suggestions.map((suggestion) => (
            <button key={suggestion.id} type="button" onClick={() => onRunSuggestion(suggestion)} disabled={busy}>
              {suggestion.label}
            </button>
          ))}
        </div>
      )}
      {menuOpen && (
        <div className="live2d-menu">
          <button type="button" onClick={() => setInputOpen(true)}>
            {labels.input}
          </button>
          <button type="button" onClick={onOpenSettings}>
            {labels.settings}
          </button>
        </div>
      )}
      {inputOpen && (
        <form
          className="live2d-input"
          onSubmit={(reactEvent) => {
            reactEvent.preventDefault();
            submitDraft();
          }}
        >
          <textarea
            value={draft}
            onChange={(reactEvent) => setDraft(reactEvent.target.value)}
            placeholder={labels.placeholder}
            rows={3}
            autoFocus
            disabled={busy}
          />
          <button type="submit" disabled={busy || !draft.trim()}>
            {labels.send}
          </button>
        </form>
      )}
    </aside>
  );
}
