import type {
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
): Promise<string> {
  const result = await streamSse(`${DAEMON_BASE}/v1/actions/stream`, request, onDelta);
  return String(result.display_text ?? "");
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
  return {
    session_id: String(result.session_id ?? ""),
    display_text: String(result.display_text ?? ""),
    speak_text: typeof result.speak_text === "string" ? result.speak_text : null,
    emotion: typeof result.emotion === "string" ? result.emotion : null,
    motion: typeof result.motion === "string" ? result.motion : null,
    metadata: typeof result.metadata === "object" && result.metadata !== null ? result.metadata as Record<string, unknown> : {}
  };
}
