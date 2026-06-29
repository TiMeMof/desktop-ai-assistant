export type ProviderSummary = {
  id: string;
  name: string;
  type: string;
  model: string;
  default_model: string;
  base_url: string;
  requires_api_key: boolean;
  requires_api_secret: boolean;
  api_key_configured: boolean;
  api_secret_configured: boolean;
  capabilities: {
    supports_streaming: boolean;
    supports_system_prompt: boolean;
    context_size: number | null;
    max_output_tokens: number;
  };
};

export type NamedItem = {
  id: string;
  name: string;
  label?: string;
  description?: string;
  source?: string;
};

export type ConfigSummary = {
  defaults: {
    provider_id: string;
    character_id: string;
    prompt_profile_id: string;
    action_id: string;
  };
  limits: Record<string, unknown>;
  providers: ProviderSummary[];
  characters: NamedItem[];
  prompt_profiles: NamedItem[];
  actions: NamedItem[];
  user_settings: UserSettings;
};

export type UserSettings = {
  provider_id: string;
  character_id: string;
  prompt_profile_id: string;
  shortcut: string;
  language: string;
  model_overrides: Record<string, string>;
  mouse_trigger: MouseTriggerSettings;
  memory: MemorySettings;
  presentation: PresentationSettings;
  api_key_status: Record<string, boolean>;
  api_secret_status: Record<string, boolean>;
};

export type MouseTriggerSettings = {
  enabled: boolean;
  button: number;
  consume: boolean;
};

export type MemorySettings = {
  enabled: boolean;
  max_context_tokens: number;
  recent_turns: number;
  summary_mode: "deterministic" | "model";
};

export type PresentationSettings = {
  renderer: "fbx" | "live2d";
};

export type SettingsUpdate = {
  provider_id?: string;
  character_id?: string;
  prompt_profile_id?: string;
  shortcut?: string;
  language?: string;
  model_overrides?: Record<string, string>;
  mouse_trigger?: Partial<MouseTriggerSettings>;
  memory?: Partial<MemorySettings>;
  presentation?: Partial<PresentationSettings>;
  api_keys?: Record<string, string>;
  api_secrets?: Record<string, string>;
};

export type MemoryRecord = {
  index: number;
  timestamp: string;
  action_id: string;
  provider_id: string;
  input_text: string;
  output_text: string;
  metadata: Record<string, unknown>;
};

export type MemoryPreview = {
  summary: string;
  recent: MemoryRecord[];
  total_recent: number;
};

export type ProviderTestResponse = {
  status: string;
  provider_id: string;
  latency_ms: number;
  output_preview: string;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  suggestions?: AssistantSuggestion[];
};

export type AssistantSuggestion = {
  id: string;
  label: string;
  kind: "action" | "mode" | "command";
  action_id?: string | null;
  mode?: "action" | "chat" | null;
  command?: string | null;
  context?: Record<string, unknown>;
};

export type AssistantEvent = {
  state: "idle" | "listening" | "thinking" | "presenting" | "asking_followup" | "error" | "chatting";
  speak_text?: string | null;
  emotion: "neutral" | "happy" | "thinking" | "confused" | "apologetic";
  motion: "idle" | "nod" | "wave" | "present_result" | "ask" | "error";
  suggestions: AssistantSuggestion[];
  metadata: Record<string, unknown>;
};

export type AssistantStreamResult = {
  display_text: string;
  speak_text?: string | null;
  emotion?: string | null;
  motion?: string | null;
  assistant_event?: AssistantEvent | null;
  metadata: Record<string, unknown>;
};

export type ActionStreamResult = AssistantStreamResult;

export type ChatStreamResult = AssistantStreamResult & {
  session_id: string;
};
