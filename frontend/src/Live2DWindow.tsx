import { useCallback, useEffect, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { MessageSquare, Send, X } from "lucide-react";
import { fetchConfig, streamAction, streamChat } from "./api";
import { SettingsPanel } from "./SettingsPanel";
import type { AssistantEvent, AssistantSuggestion, ChatMessage, ConfigSummary, UserSettings } from "./types";

type Live2DModelLike = {
  x: number;
  y: number;
  width: number;
  height: number;
  scale: { set: (value: number) => void };
  motion: (group: string, index?: number) => Promise<boolean>;
  expression: (id?: number | string) => Promise<boolean>;
  destroy: () => void;
};

const modelUrl = import.meta.env.VITE_LIVE2D_MODEL_URL as string | undefined;
const coreUrl = import.meta.env.VITE_LIVE2D_CORE_URL as string | undefined;

function loadScript(src: string): Promise<void> {
  const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
  if (existing) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

function motionFor(event?: AssistantEvent | null): string | null {
  if (!event) return null;
  if (event.motion === "ask") return "TapBody";
  if (event.motion === "present_result") return "Flick";
  if (event.motion === "nod") return "TapHead";
  if (event.motion === "wave") return "Wave";
  return null;
}

const electronAPI =
  typeof window !== "undefined"
    ? (window as unknown as { electronAPI?: {
        startDrag: (x: number, y: number) => void;
        doDrag: (x: number, y: number) => void;
        endDrag: () => void;
        platform: string;
        setFocusable: (focusable: boolean) => Promise<void>;
        captureSelectedText: (restoreClipboard?: boolean) => Promise<string>;
        readClipboardText: () => Promise<string>;
      } }).electronAPI
    : undefined;

function localId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function labelsFor(language?: string) {
  if (language === "zh-CN") {
    return {
      assistant: "助手",
      chat: "聊天",
      close: "关闭",
      empty: "单击角色开始对话，双击执行快捷动作。",
      errorConfig: "Daemon 未连接或配置读取失败。",
      noSelectedText: "没有捕获到选中文本。请先在其他窗口选择文本，再点击角色。",
      placeholder: "对她说点什么...",
      quickAction: "双击",
      selectedText: "选中文本",
      send: "发送",
      thinking: "思考中...",
      you: "你"
    };
  }
  return {
    assistant: "Assistant",
    chat: "Chat",
    close: "Close",
    empty: "Single-click to chat, double-click to run the quick action.",
    errorConfig: "Daemon is not connected or config failed.",
    noSelectedText: "No selected text captured. Select text in another window, then click the character.",
    placeholder: "Say something...",
    quickAction: "Double-click",
    selectedText: "Selected text",
    send: "Send",
    thinking: "Thinking...",
    you: "You"
  };
}

export function Live2DWindow() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const modelRef = useRef<Live2DModelLike | null>(null);
  const eventRef = useRef<AssistantEvent | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const dragRef = useRef({
    pointerId: null as number | null,
    button: -1,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    active: false,
    frame: 0
  });
  const clickRef = useRef({
    lastAt: 0,
    timer: 0
  });
  const [bubbleOpen, setBubbleOpen] = useState(false);
  const [config, setConfig] = useState<ConfigSummary | null>(null);
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [quickActionId, setQuickActionId] = useState("translate");
  const [chatSessionId, setChatSessionId] = useState<string | undefined>();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [selectedText, setSelectedText] = useState("");
  const [actionOutput, setActionOutput] = useState("");
  const [suggestions, setSuggestions] = useState<AssistantSuggestion[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const labels = labelsFor(settings?.language);
  const quickActions =
    config?.actions.filter((action) => ["translate", "explain", "polish"].includes(action.id)) ?? [];

  const playAssistantEvent = useCallback((assistantEvent: AssistantEvent) => {
    eventRef.current = assistantEvent;
    const model = modelRef.current;
    if (!model) return;
    const motion = motionFor(assistantEvent);
    if (motion) model.motion(motion).catch(() => undefined);
    if (assistantEvent.emotion !== "neutral") model.expression(assistantEvent.emotion).catch(() => undefined);
  }, []);

  useEffect(() => {
    fetchConfig()
      .then((nextConfig) => {
        setConfig(nextConfig);
        setSettings(nextConfig.user_settings);
        setQuickActionId(nextConfig.defaults.action_id || "translate");
      })
      .catch(() => {
        setError(labels.errorConfig);
      });
  }, [labels.errorConfig]);

  useEffect(() => {
    if (bubbleOpen) return;
    if (electronAPI?.platform === "linux") return;
    electronAPI?.setFocusable(false).catch(() => undefined);
  }, [bubbleOpen]);

  useEffect(() => {
    return () => {
      if (clickRef.current.timer) {
        window.clearTimeout(clickRef.current.timer);
      }
    };
  }, []);

  useEffect(() => {
    if (!modelUrl || !canvasRef.current) {
      return;
    }
    const selectedModelUrl = modelUrl;
    let disposed = false;
    let app: { destroy: (removeView?: boolean, options?: unknown) => void } | null = null;

    async function setup() {
      try {
        if (coreUrl) {
          await loadScript(coreUrl);
        }
        const PIXI = await import("pixi.js");
        const { Live2DModel } = await import("pixi-live2d-display/cubism4");
        (window as unknown as { PIXI?: typeof PIXI }).PIXI = PIXI;
        Live2DModel.registerTicker(PIXI.Ticker);

        const canvasWidth = 320;
        const canvasHeight = 480;
        if (canvasRef.current) {
          canvasRef.current.width = canvasWidth;
          canvasRef.current.height = canvasHeight;
        }
        const pixiApp = new PIXI.Application({
          view: canvasRef.current ?? undefined,
          autoStart: true,
          antialias: false,
          backgroundAlpha: 0,
          autoDensity: false,
          resolution: 1,
          powerPreference: "high-performance",
          width: canvasWidth,
          height: canvasHeight
        });
        app = pixiApp as { destroy: (removeView?: boolean, options?: unknown) => void };

        const model = await Live2DModel.from(selectedModelUrl);
        if (disposed) {
          model.destroy();
          return;
        }
        model.anchor.set(0.5, 0.5);
        const originalWidth = model.width;
        const originalHeight = model.height;
        const scale = Math.min(canvasWidth / originalWidth, canvasHeight / originalHeight) * 0.9;
        model.scale.set(scale);
        model.x = canvasWidth / 2;
        model.y = canvasHeight / 2 + 20;
        pixiApp.stage.addChild(model);
        pixiApp.render();

        modelRef.current = model as Live2DModelLike;

      const currentEvent = eventRef.current;
        if (currentEvent) {
          playAssistantEvent(currentEvent);
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("Live2D setup failed", err);
      }
    }

    setup();

    const channel = new BroadcastChannel("assistant_events");
    channelRef.current = channel;
    channel.onmessage = (event) => {
      const data = event.data;
      if (!data || data.type !== "assistant_event") return;
      const assistantEvent = data.payload as AssistantEvent;
      playAssistantEvent(assistantEvent);
    };

    return () => {
      disposed = true;
      channel.close();
      channelRef.current = null;
      modelRef.current?.destroy();
      modelRef.current = null;
      app?.destroy(false, { children: true });
    };
  }, [playAssistantEvent]);

  async function sendChatMessage() {
    const message = draft.trim();
    if (!message || busy) return;

    const userMessage: ChatMessage = { id: localId(), role: "user", content: message };
    const assistantId = localId();
    setMessages((current) => [
      ...current,
      userMessage,
      { id: assistantId, role: "assistant", content: "", streaming: true }
    ]);
    setDraft("");
    setBusy(true);
    setError("");

    try {
      const result = await streamChat(
        {
          session_id: chatSessionId,
          character_id: settings?.character_id ?? config?.defaults.character_id,
          provider_id: settings?.provider_id ?? config?.defaults.provider_id,
          message,
          context: { source: "live2d_electron_bubble" }
        },
        (delta) => {
          setMessages((current) =>
            current.map((item) =>
              item.id === assistantId ? { ...item, content: item.content + delta } : item
            )
          );
        }
      );
      setChatSessionId(result.session_id || chatSessionId);
      if (result.assistant_event) {
        playAssistantEvent(result.assistant_event);
      }
      setMessages((current) =>
        current.map((item) =>
          item.id === assistantId ? { ...item, content: result.display_text, streaming: false } : item
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setMessages((current) => current.filter((item) => item.id !== assistantId));
    } finally {
      setBusy(false);
    }
  }

  async function runActionOnText(text: string, source: string, actionId?: string) {
    const input = text.trim();
    if (!input || busy) return;

    const selectedAction = actionId ?? config?.defaults.action_id ?? "translate";
    setBubbleOpen(true);
    setSelectedText(input);
    setActionOutput("");
    setSuggestions([]);
    setBusy(true);
    setError("");

    try {
      const result = await streamAction(
        {
          action_id: selectedAction,
          character_id: settings?.character_id ?? config?.defaults.character_id,
          provider_id: settings?.provider_id ?? config?.defaults.provider_id,
          input_text: input,
          context: { source }
        },
        (delta) => setActionOutput((current) => current + delta)
      );
      setActionOutput(result.display_text);
      setSuggestions(result.assistant_event?.suggestions ?? []);
      if (result.assistant_event) {
        playAssistantEvent(result.assistant_event);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function runSelectedTextAction() {
    if (busy) return;
      setBubbleOpen(true);
      setError("");
      setActionOutput("");
      setSuggestions([]);
      setBusy(true);
      try {
      if (electronAPI?.platform !== "linux") {
        await electronAPI?.setFocusable(false);
      }
      const text = await electronAPI?.captureSelectedText(true);
      if (!text?.trim()) {
        setError(labels.noSelectedText);
        return;
      }
      setBusy(false);
      await runActionOnText(text, "live2d_double_click", quickActionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function runSuggestion(suggestion: AssistantSuggestion) {
    if (busy || suggestion.kind !== "action" || !suggestion.action_id) return;
    const input = suggestion.id === "explain_source" ? selectedText : actionOutput || selectedText;
    runActionOnText(input, "live2d_suggestion", suggestion.action_id).catch((err) => {
      setError(err instanceof Error ? err.message : String(err));
    });
  }

  function buildOpeningQuestion(clipboardText: string) {
    const trimmedClipboard = clipboardText.trim();
    const clipboardPreview = trimmedClipboard.length > 80 ? `${trimmedClipboard.slice(0, 80)}...` : trimmedClipboard;
    const recent = messages
      .filter((message) => message.content.trim())
      .slice(-2)
      .map((message) => message.content.trim().slice(0, 48))
      .join(" / ");

    if (settings?.language === "zh-CN") {
      if (clipboardPreview && recent) {
        return `我看到剪贴板里有「${clipboardPreview}」，刚才我们聊到「${recent}」。你想让我翻译、解释、润色，还是继续聊？`;
      }
      if (clipboardPreview) {
        return `我看到剪贴板里有「${clipboardPreview}」。你想让我翻译、解释、润色，还是直接聊这个？`;
      }
      if (recent) {
        return `我们刚才聊到「${recent}」。你想继续聊，还是让我处理一段文本？`;
      }
      return "你想让我做什么？可以让我翻译、解释、润色，也可以直接聊天。";
    }

    if (clipboardPreview && recent) {
      return `I see "${clipboardPreview}" in the clipboard, and we were just discussing "${recent}". Should I translate, explain, polish, or keep chatting?`;
    }
    if (clipboardPreview) {
      return `I see "${clipboardPreview}" in the clipboard. Should I translate, explain, polish, or talk through it?`;
    }
    if (recent) {
      return `We were just discussing "${recent}". Should we continue, or should I work on some text?`;
    }
    return "What would you like me to do? I can translate, explain, polish, or just chat.";
  }

  async function openConversationPrompt() {
    if (busy) return;
    setBubbleOpen(true);
    setError("");
    setSuggestions([]);
    try {
      const clipboardText = await electronAPI?.readClipboardText().catch(() => "");
      const question = buildOpeningQuestion(clipboardText ?? "");
      setMessages((current) => [
        ...current,
        { id: localId(), role: "assistant", content: question }
      ]);
      playAssistantEvent({
        state: "asking_followup",
        speak_text: question,
        emotion: "thinking",
        motion: "ask",
        suggestions: [],
        metadata: { source: "live2d_single_click" }
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function focusBubbleInput() {
    electronAPI?.setFocusable(true).catch(() => undefined);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }

  function openSettings(event?: MouseEvent) {
    event?.preventDefault();
    event?.stopPropagation();
    electronAPI?.setFocusable(true).catch(() => undefined);
    setSettingsOpen(true);
  }

  function applySavedSettings(nextSettings: UserSettings) {
    setSettings(nextSettings);
    fetchConfig()
      .then((nextConfig) => {
        setConfig(nextConfig);
        setSettings(nextConfig.user_settings);
        setQuickActionId(nextConfig.defaults.action_id || "translate");
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }

  if (!modelUrl) {
    return <div className="live2d-window-fallback">No Live2D model configured</div>;
  }

  function onPointerDown(event: PointerEvent<HTMLCanvasElement>) {
    if (event.button !== 0) {
      return;
    }
    dragRef.current = {
      pointerId: event.pointerId,
      button: event.button,
      startX: event.screenX,
      startY: event.screenY,
      lastX: event.screenX,
      lastY: event.screenY,
      active: false,
      frame: 0
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current;
    if (drag.pointerId !== event.pointerId) return;

    drag.lastX = event.screenX;
    drag.lastY = event.screenY;

    if (!drag.active) {
      const movedX = event.screenX - drag.startX;
      const movedY = event.screenY - drag.startY;
      if (Math.hypot(movedX, movedY) < 4) return;
      drag.active = true;
      electronAPI?.startDrag(drag.startX, drag.startY);
    }

    if (drag.frame) return;
    drag.frame = window.requestAnimationFrame(() => {
      drag.frame = 0;
      electronAPI?.doDrag(drag.lastX, drag.lastY);
    });
  }

  function onPointerUp(event: PointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current;
    if (drag.pointerId !== event.pointerId) return;
    if (drag.frame) {
      window.cancelAnimationFrame(drag.frame);
    }
    if (drag.active) {
      electronAPI?.endDrag();
    } else {
      const now = Date.now();
      if (now - clickRef.current.lastAt < 280) {
        if (clickRef.current.timer) {
          window.clearTimeout(clickRef.current.timer);
          clickRef.current.timer = 0;
        }
        clickRef.current.lastAt = 0;
        runSelectedTextAction();
      } else {
        clickRef.current.lastAt = now;
        clickRef.current.timer = window.setTimeout(() => {
          clickRef.current.timer = 0;
          openConversationPrompt();
        }, 260);
      }
    }
    dragRef.current = {
      pointerId: null,
      button: -1,
      startX: 0,
      startY: 0,
      lastX: 0,
      lastY: 0,
      active: false,
      frame: 0
    };
  }

  return (
    <div className="live2d-window">
      <canvas
        ref={canvasRef}
        aria-label="Live2D assistant"
        onContextMenu={openSettings}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      />
      {bubbleOpen && (
        <section
          className="live2d-chat-bubble"
          onPointerDown={(event) => {
            event.stopPropagation();
            electronAPI?.setFocusable(true).catch(() => undefined);
          }}
        >
          <header>
            <div>
              <MessageSquare size={15} />
              <span>{labels.chat}</span>
            </div>
            <label className="live2d-quick-action">
              <span>{labels.quickAction}</span>
              <select
                value={quickActionId}
                disabled={busy}
                onChange={(event) => setQuickActionId(event.target.value)}
              >
                {quickActions.map((action) => (
                  <option key={action.id} value={action.id}>
                    {action.label ?? action.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              title={labels.close}
              onClick={() => {
                setBubbleOpen(false);
                if (electronAPI?.platform !== "linux") {
                  electronAPI?.setFocusable(false).catch(() => undefined);
                }
              }}
            >
              <X size={15} />
            </button>
          </header>
          {(selectedText || actionOutput || suggestions.length > 0) && (
            <div className="live2d-action-result">
              {selectedText && (
                <details>
                  <summary>{labels.selectedText}</summary>
                  <pre>{selectedText}</pre>
                </details>
              )}
              <pre>{actionOutput || (busy ? labels.thinking : "")}</pre>
              {suggestions.length > 0 && (
                <div className="live2d-action-suggestions">
                  {suggestions.map((suggestion) => (
                    <button key={suggestion.id} type="button" disabled={busy} onClick={() => runSuggestion(suggestion)}>
                      {suggestion.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <div className="live2d-chat-messages">
            {messages.length === 0 && <div className="live2d-chat-empty">{labels.empty}</div>}
            {messages.map((message) => (
              <article key={message.id} className={`live2d-chat-message ${message.role}`}>
                <div>{message.role === "user" ? labels.you : labels.assistant}</div>
                <pre>{message.content || (message.streaming ? labels.thinking : "")}</pre>
              </article>
            ))}
          </div>
          {error && <div className="live2d-chat-error">{error}</div>}
          <form
            className="live2d-chat-composer"
            onSubmit={(event) => {
              event.preventDefault();
              sendChatMessage();
            }}
          >
            <textarea
              ref={inputRef}
              value={draft}
              onPointerDown={(event) => {
                event.stopPropagation();
                focusBubbleInput();
              }}
              onFocus={focusBubbleInput}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={labels.placeholder}
              rows={2}
              disabled={busy}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  sendChatMessage();
                }
              }}
            />
            <button type="submit" title={labels.send} disabled={busy || !draft.trim()}>
              <Send size={15} />
            </button>
          </form>
        </section>
      )}
      {settingsOpen && config && settings && (
        <SettingsPanel
          config={config}
          settings={settings}
          onClose={() => setSettingsOpen(false)}
          onSaved={applySavedSettings}
        />
      )}
    </div>
  );
}
