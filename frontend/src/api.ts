import type {
  ActionStreamResult,
  AssistantEvent,
  AssistantSuggestion,
  ChatStreamResult,
  ConfigSummary,
  MemoryPreview,
  ProviderTestResponse,
  SettingsUpdate,
  UserSettings
} from "./types";

const DAEMON_BASE = "http://127.0.0.1:8732";

export async function fetchConfig(): Promise<ConfigSummary> {
  const response = await fetch(`${DAEMON_BASE}/v1/config`);
  if (!response.ok) {
    throw new Error(`Daemon config failed: HTTP ${response.status}`);
  }
  return response.json();
}

export async function health(): Promise<boolean> {
  try {
    const response = await fetch(`${DAEMON_BASE}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

export async function fetchSettings(): Promise<UserSettings> {
  const response = await fetch(`${DAEMON_BASE}/v1/settings`);
  if (!response.ok) {
    throw new Error(`Daemon settings failed: HTTP ${response.status}`);
  }
  return response.json();
}

export async function saveSettings(update: SettingsUpdate): Promise<UserSettings> {
  const response = await fetch(`${DAEMON_BASE}/v1/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(update)
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Save settings failed: HTTP ${response.status}`);
  }
  return response.json();
}

export async function clearMemory(): Promise<void> {
  const response = await fetch(`${DAEMON_BASE}/v1/memory`, { method: "DELETE" });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Clear memory failed: HTTP ${response.status}`);
  }
}

export async function fetchMemoryPreview(): Promise<MemoryPreview> {
  const response = await fetch(`${DAEMON_BASE}/v1/memory`);
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Memory preview failed: HTTP ${response.status}`);
  }
  return response.json();
}

export async function deleteMemoryRecord(timestamp: string): Promise<void> {
  const response = await fetch(`${DAEMON_BASE}/v1/memory/recent/${encodeURIComponent(timestamp)}`, {
    method: "DELETE"
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Delete memory record failed: HTTP ${response.status}`);
  }
}

export async function testProvider(providerId: string): Promise<ProviderTestResponse> {
  const response = await fetch(`${DAEMON_BASE}/v1/providers/${encodeURIComponent(providerId)}/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({})
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Provider test failed: HTTP ${response.status}`);
  }
  return response.json();
}

export type StreamRequest = {
  action_id: string;
  character_id?: string;
  provider_id?: string;
  input_text: string;
  context?: Record<string, unknown>;
};

type SseResult = Record<string, unknown> & { display_text?: string };

function objectRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function parseSuggestion(value: unknown): AssistantSuggestion | null {
  const item = objectRecord(value);
  if (typeof item.id !== "string" || typeof item.label !== "string" || typeof item.kind !== "string") {
    return null;
  }
  if (!["action", "mode", "command"].includes(item.kind)) {
    return null;
  }
  return {
    id: item.id,
    label: item.label,
    kind: item.kind as AssistantSuggestion["kind"],
    action_id: typeof item.action_id === "string" ? item.action_id : null,
    mode: item.mode === "action" || item.mode === "chat" ? item.mode : null,
    command: typeof item.command === "string" ? item.command : null,
    context: objectRecord(item.context)
  };
}

function parseAssistantEvent(value: unknown): AssistantEvent | null {
  const item = objectRecord(value);
  if (typeof item.state !== "string") {
    return null;
  }
  const suggestions = Array.isArray(item.suggestions)
    ? item.suggestions.map(parseSuggestion).filter((suggestion): suggestion is AssistantSuggestion => suggestion !== null)
    : [];
  return {
    state: item.state as AssistantEvent["state"],
    speak_text: typeof item.speak_text === "string" ? item.speak_text : null,
    emotion: typeof item.emotion === "string" ? item.emotion as AssistantEvent["emotion"] : "neutral",
    motion: typeof item.motion === "string" ? item.motion as AssistantEvent["motion"] : "idle",
    suggestions,
    metadata: objectRecord(item.metadata)
  };
}

function parseStreamResult(result: SseResult): ActionStreamResult {
  return {
    display_text: String(result.display_text ?? ""),
    speak_text: typeof result.speak_text === "string" ? result.speak_text : null,
    emotion: typeof result.emotion === "string" ? result.emotion : null,
    motion: typeof result.motion === "string" ? result.motion : null,
    assistant_event: parseAssistantEvent(result.assistant_event),
    metadata: objectRecord(result.metadata)
  };
}

async function streamSse(
  url: string,
  body: unknown,
  onDelta: (text: string) => void
): Promise<SseResult> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok || !response.body) {
    const detail = await response.text();
    throw new Error(detail || `Daemon stream failed: HTTP ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const event of events) {
      const eventName = event.match(/^event:\s*(.+)$/m)?.[1];
      const dataText = event.match(/^data:\s*(.+)$/m)?.[1];
      if (!dataText) continue;
      const data = JSON.parse(dataText);
      if (eventName === "delta") {
        const delta = data.display_text ?? "";
        fullText += delta;
        onDelta(delta);
      }
      if (eventName === "done") {
        return { ...data, display_text: data.display_text ?? fullText };
      }
      if (eventName === "error") {
        throw new Error(data.message ?? "Unknown provider error");
      }
    }
  }

  return { display_text: fullText };
}

export async function streamAction(
  request: StreamRequest,
  onDelta: (text: string) => void
): Promise<ActionStreamResult> {
  const result = await streamSse(`${DAEMON_BASE}/v1/actions/stream`, request, onDelta);
  return parseStreamResult(result);
}

export type ChatStreamRequest = {
  session_id?: string;
  character_id?: string;
  provider_id?: string;
  message: string;
  context?: Record<string, unknown>;
};

export async function streamChat(
  request: ChatStreamRequest,
  onDelta: (text: string) => void
): Promise<ChatStreamResult> {
  const result = await streamSse(`${DAEMON_BASE}/v1/chat/stream`, request, onDelta);
  const parsed = parseStreamResult(result);
  return {
    ...parsed,
    session_id: String(result.session_id ?? ""),
  };
}
