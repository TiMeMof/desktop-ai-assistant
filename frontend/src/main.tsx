import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import { register, unregisterAll } from "@tauri-apps/plugin-global-shortcut";
import { Clipboard, Loader2, MessageSquare, RefreshCw, Send, Settings, X } from "lucide-react";
import { fetchConfig, health, streamAction, streamChat } from "./api";
import { captureSelectedText } from "./clipboard";
import { Live2DAssistant } from "./Live2DAssistant";
import { SettingsPanel } from "./SettingsPanel";
import { configureMouseTrigger } from "./mouseTrigger";
import type {
  AssistantEvent,
  AssistantStreamResult,
  AssistantSuggestion,
  ChatMessage,
  ConfigSummary,
  UserSettings
} from "./types";
import "./styles.css";

type Status = "checking" | "ready" | "capturing" | "streaming" | "error";
type Mode = "action" | "chat";

const appWindow = getCurrentWindow();

function shortcutForPlatform(): string {
  return navigator.platform.toLowerCase().includes("mac") ? "Command+Shift+Space" : "Ctrl+Shift+Space";
}

function localId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function labelsFor(language?: string) {
  if (language === "zh-CN") {
    return {
      action: "动作",
      assistant: "助手",
      chat: "聊天",
      chatEmpty: "和当前角色开始对话。",
      clipboardEmpty: "剪贴板为空。先复制文本，再运行。",
      emotion: "情绪",
      excludeInput: "排除输入",
      excludeInputTitle: "本次请求使用输入内容，但保存记忆时不保存原文。",
      hide: "隐藏",
      motion: "动作",
      newChat: "新对话",
      noSelectedText: "没有捕获到选中文本。请先选择文本，或手动复制。",
      placeholder: "输入消息...",
      privateRun: "隐私运行",
      privateRunTitle: "开启后，本次请求不读取也不保存本地记忆。",
      ready: "就绪",
      reload: "重新加载 daemon 配置",
      runClipboard: "运行剪贴板",
      selectHint: "在任意位置选择文本，然后按全局快捷键。",
      selectedText: "选中文本",
      send: "发送",
      settings: "设置",
      thinking: "思考中...",
      you: "你"
    };
  }
  return {
    action: "Action",
    assistant: "Assistant",
    chat: "Chat",
    chatEmpty: "Start a conversation with the current character.",
    clipboardEmpty: "Clipboard is empty. Copy text first, then run.",
    emotion: "Emotion",
    excludeInput: "Exclude input",
    excludeInputTitle: "Use the selected text for this run, but save only the assistant result.",
    hide: "Hide",
    motion: "Motion",
    newChat: "New chat",
    noSelectedText: "No selected text captured. Select text first or copy it manually.",
    placeholder: "Type a message...",
    privateRun: "Private run",
    privateRunTitle: "Do not read or save local memory for the next runs while enabled.",
    ready: "Ready",
    reload: "Reload daemon config",
    runClipboard: "Run clipboard",
    selectHint: "Select text anywhere, then press the global shortcut.",
    selectedText: "Selected text",
    send: "Send",
    settings: "Settings",
    thinking: "Thinking...",
    you: "You"
  };
}

function App() {
  const [status, setStatus] = useState<Status>("checking");
  const [error, setError] = useState("");
  const [config, setConfig] = useState<ConfigSummary | null>(null);
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("action");
  const [actionId, setActionId] = useState("translate");
  const [inputText, setInputText] = useState("");
  const [outputText, setOutputText] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [chatSessionId, setChatSessionId] = useState<string | undefined>();
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [assistantEvent, setAssistantEvent] = useState<AssistantStreamResult | null>(null);
  const broadcastChannelRef = useRef<BroadcastChannel | null>(null);
  if (typeof window !== "undefined" && broadcastChannelRef.current === null) {
    try {
      broadcastChannelRef.current = new BroadcastChannel("assistant_events");
    } catch {
      broadcastChannelRef.current = null;
    }
  }
  function broadcastAssistantEvent(event?: AssistantEvent | null) {
    const channel = broadcastChannelRef.current;
    if (!channel || !event) return;
    channel.postMessage({ type: "assistant_event", payload: event });
  }
  const [memoryPaused, setMemoryPaused] = useState(false);
  const [memoryExcludeInput, setMemoryExcludeInput] = useState(false);
  const busyRef = useRef(false);
  const lastTriggerAtRef = useRef(0);

  const restoreClipboard = true;
  const shortcut = useMemo(() => settings?.shortcut || shortcutForPlatform(), [settings?.shortcut]);
  const labels = useMemo(() => labelsFor(settings?.language), [settings?.language]);

  const loadConfig = useCallback(async () => {
    setStatus("checking");
    setError("");
    const daemonOk = await health();
    if (!daemonOk) {
      setStatus("error");
      setError("Daemon is not reachable at 127.0.0.1:8732.");
      return;
    }
    const nextConfig = await fetchConfig();
    setConfig(nextConfig);
    setSettings(nextConfig.user_settings);
    configureMouseTrigger(nextConfig.user_settings.mouse_trigger).catch((err) => {
      setError(err instanceof Error ? err.message : String(err));
    });
    setActionId(nextConfig.defaults.action_id);
    setStatus("ready");
  }, []);

  const runText = useCallback(async (text: string, source: string, actionOverride?: string) => {
    const selected = text.trim();
    const selectedAction = actionOverride ?? actionId;
    await appWindow.show();
    await appWindow.setFocus();
    setInputText(selected);
    if (!selected) {
      setStatus("error");
      setError(source === "clipboard" ? labels.clipboardEmpty : labels.noSelectedText);
      return;
    }
    setStatus("streaming");
    setAssistantEvent(null);
    const result = await streamAction(
      {
        action_id: selectedAction,
        character_id: settings?.character_id,
        provider_id: settings?.provider_id,
        input_text: selected,
        context: {
          source,
          memory_paused: memoryPaused,
          memory_exclude_input: memoryExcludeInput
        }
      },
      (delta) => setOutputText((current) => current + delta)
    );
    setOutputText(result.display_text);
    setAssistantEvent(result);
    broadcastAssistantEvent(result.assistant_event);
    setStatus("ready");
  }, [actionId, labels, memoryExcludeInput, memoryPaused, settings?.character_id, settings?.provider_id]);

  const runWithSelection = useCallback(async (source = "global_shortcut") => {
    const now = Date.now();
    if (busyRef.current || now - lastTriggerAtRef.current < 750) {
      return;
    }
    lastTriggerAtRef.current = now;
    try {
      setStatus("capturing");
      setError("");
      setOutputText("");
      const selected = await captureSelectedText(restoreClipboard);
      await runText(selected, source);
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [runText]);

  const runWithClipboard = useCallback(async () => {
    const now = Date.now();
    if (busyRef.current || now - lastTriggerAtRef.current < 750) {
      return;
    }
    lastTriggerAtRef.current = now;
    try {
      setStatus("capturing");
      setError("");
      setOutputText("");
      const text = await readText().catch(() => "");
      await runText(text ?? "", "clipboard");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [runText]);

  const sendChatMessage = useCallback(async (rawMessage: string) => {
    const message = rawMessage.trim();
    if (!message || busyRef.current) {
      return;
    }
    const userMessage: ChatMessage = { id: localId(), role: "user", content: message };
    const assistantId = localId();
    setChatMessages((current) => [
      ...current,
      userMessage,
      { id: assistantId, role: "assistant", content: "", streaming: true }
    ]);
    setChatInput("");
    setStatus("streaming");
    setError("");
    setAssistantEvent(null);
    try {
      const result = await streamChat(
        {
          session_id: chatSessionId,
          character_id: settings?.character_id,
          provider_id: settings?.provider_id,
          message,
          context: {
            source: "chat",
            memory_paused: memoryPaused,
            memory_exclude_input: memoryExcludeInput
          }
        },
        (delta) => {
          setChatMessages((current) =>
            current.map((item) =>
              item.id === assistantId ? { ...item, content: item.content + delta } : item
            )
          );
        }
      );
      setChatSessionId(result.session_id || chatSessionId);
      setAssistantEvent(result);
      broadcastAssistantEvent(result.assistant_event);
    broadcastAssistantEvent(result.assistant_event);
      setChatMessages((current) =>
        current.map((item) =>
          item.id === assistantId ? { ...item, content: result.display_text, streaming: false } : item
        )
      );
      setStatus("ready");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : String(err));
      setChatMessages((current) => current.filter((item) => item.id !== assistantId));
    }
  }, [chatSessionId, memoryExcludeInput, memoryPaused, settings?.character_id, settings?.provider_id]);

  const sendChat = useCallback(async () => {
    const message = chatInput.trim();
    if (!message) {
      return;
    }
    await sendChatMessage(message);
  }, [chatInput, sendChatMessage]);

  const runAssistantSuggestion = useCallback((suggestion: AssistantSuggestion) => {
    if (busyRef.current) {
      return;
    }
    if (suggestion.kind === "mode" && suggestion.mode === "chat") {
      setMode("chat");
      return;
    }
    if (suggestion.kind !== "action" || !suggestion.action_id) {
      return;
    }
    const nextInput = suggestion.id === "explain_source" ? inputText : outputText || inputText;
    setActionId(suggestion.action_id);
    setMode("action");
    setOutputText("");
    runText(nextInput, "assistant_suggestion", suggestion.action_id).catch((err) => {
      setStatus("error");
      setError(err instanceof Error ? err.message : String(err));
    });
  }, [inputText, outputText, runText]);

  const resetChat = useCallback(() => {
    setChatMessages([]);
    setChatSessionId(undefined);
    setAssistantEvent(null);
  }, []);

  const startDrag = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest("button")) {
      return;
    }
    appWindow.startDragging().catch(() => undefined);
  }, []);

  const openContextSettings = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    setSettingsOpen(true);
  }, []);

  const openSettings = useCallback(() => {
    setSettingsOpen(true);
  }, []);

  const applySavedSettings = useCallback((nextSettings: UserSettings) => {
    setSettings(nextSettings);
    loadConfig().catch(() => undefined);
  }, [loadConfig]);

  const busy = status === "checking" || status === "capturing" || status === "streaming";

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  useEffect(() => {
    loadConfig().catch((err) => {
      setStatus("error");
      setError(err instanceof Error ? err.message : String(err));
    });
  }, [loadConfig]);

  useEffect(() => {
    register(shortcut, () => runWithSelection("global_shortcut")).catch((err) => {
      setStatus("error");
      setError(`Failed to register shortcut ${shortcut}: ${err}`);
    });
    return () => {
      unregisterAll().catch(() => undefined);
    };
  }, [runWithSelection, shortcut]);

  useEffect(() => {
    const cleanup = listen("mouse-trigger", () => {
      runWithSelection("mouse_trigger");
    });
    return () => {
      cleanup.then((unlisten) => unlisten()).catch(() => undefined);
    };
  }, [runWithSelection]);

  return (
    <main className="shell" onContextMenu={openContextSettings}>
      <header className="titlebar" onPointerDown={startDrag}>
        <div className="brand">
          <Clipboard size={16} />
          <span>AI Bubble</span>
        </div>
        <div className="window-actions">
          <button title={labels.settings} onClick={() => setSettingsOpen(true)}>
            <Settings size={15} />
          </button>
          <button title={labels.reload} onClick={loadConfig} disabled={busy}>
            <RefreshCw size={15} />
          </button>
          <button title={labels.hide} onClick={() => appWindow.hide()}>
            <X size={15} />
          </button>
        </div>
      </header>

      <section className="toolbar">
        <div className="mode-switch" role="tablist" aria-label="Assistant mode">
          <button className={mode === "action" ? "active" : ""} onClick={() => setMode("action")} type="button">
            <Clipboard size={14} />
            {labels.action}
          </button>
          <button className={mode === "chat" ? "active" : ""} onClick={() => setMode("chat")} type="button">
            <MessageSquare size={14} />
            {labels.chat}
          </button>
        </div>
        {mode === "action" && (
          <select value={actionId} onChange={(event) => setActionId(event.target.value)}>
            {config?.actions.map((action) => (
              <option key={action.id} value={action.id}>
                {action.label ?? action.name}
              </option>
            ))}
          </select>
        )}
        {mode === "chat" && (
          <button type="button" className="secondary-action" onClick={resetChat} disabled={busy || chatMessages.length === 0}>
            {labels.newChat}
          </button>
        )}
      </section>

      <section className="content">
        <Live2DAssistant
          event={assistantEvent?.assistant_event}
          busy={busy}
          language={settings?.language}
          onSubmitChat={(message) => {
            setMode("chat");
            sendChatMessage(message);
          }}
          onRunSuggestion={runAssistantSuggestion}
          onOpenSettings={openSettings}
        />

        <div className="status">
          {busy && <Loader2 className="spin" size={15} />}
          <span>{status === "ready" ? `${labels.ready}: ${shortcut}` : status}</span>
        </div>

        {error && <div className="error">{error}</div>}

        {mode === "action" && (
          <>
            {inputText && (
              <details className="source">
                <summary>{labels.selectedText}</summary>
                <pre>{inputText}</pre>
              </details>
            )}

            <pre className="output">
              {outputText || labels.selectHint}
            </pre>
            {assistantEvent && (
              <div className="assistant-event">
                {assistantEvent.assistant_event?.state ?? "event"} · {labels.emotion}: {assistantEvent.emotion ?? "none"} · {labels.motion}: {assistantEvent.motion ?? "none"}
              </div>
            )}
          </>
        )}

        {mode === "chat" && (
          <section className="chat-panel">
            <div className="chat-messages">
              {chatMessages.length === 0 && (
                <div className="chat-empty">{labels.chatEmpty}</div>
              )}
              {chatMessages.map((message) => (
                <article key={message.id} className={`chat-message ${message.role}`}>
                  <div className="chat-role">{message.role === "user" ? labels.you : labels.assistant}</div>
                  <pre>{message.content || (message.streaming ? labels.thinking : "")}</pre>
                </article>
              ))}
            </div>
            {assistantEvent && (
              <div className="assistant-event">
                {assistantEvent.assistant_event?.state ?? "event"} · {labels.emotion}: {assistantEvent.emotion ?? "none"} · {labels.motion}: {assistantEvent.motion ?? "none"}
              </div>
            )}
            <form
              className="chat-composer"
              onSubmit={(event) => {
                event.preventDefault();
                sendChat();
              }}
            >
              <textarea
                value={chatInput}
                onChange={(event) => setChatInput(event.target.value)}
                placeholder={labels.placeholder}
                rows={3}
                disabled={busy}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    sendChat();
                  }
                }}
              />
              <button type="submit" disabled={busy || !chatInput.trim()} title={labels.send}>
                <Send size={15} />
              </button>
            </form>
          </section>
        )}
      </section>

      <footer>
        <label className="footer-toggle" title={labels.privateRunTitle}>
          <input
            type="checkbox"
            checked={memoryPaused}
            onChange={(event) => setMemoryPaused(event.target.checked)}
            disabled={busy}
          />
          {labels.privateRun}
        </label>
        <label className="footer-toggle" title={labels.excludeInputTitle}>
          <input
            type="checkbox"
            checked={memoryExcludeInput}
            onChange={(event) => setMemoryExcludeInput(event.target.checked)}
            disabled={busy || memoryPaused}
          />
          {labels.excludeInput}
        </label>
        {mode === "action" && (
          <button onClick={runWithClipboard} disabled={busy}>
            {labels.runClipboard}
          </button>
        )}
      </footer>

      {settingsOpen && config && settings && (
        <SettingsPanel
          config={config}
          settings={settings}
          onClose={() => setSettingsOpen(false)}
          onSaved={applySavedSettings}
        />
      )}
    </main>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
