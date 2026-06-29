import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { clearMemory, deleteMemoryRecord, fetchMemoryPreview, saveSettings, testProvider } from "./api";
import {
  configureMouseTrigger,
  getMouseTriggerStatus,
  startMouseTriggerRecording,
  stopMouseTriggerRecording,
  type MouseTriggerRecorded,
  type MouseTriggerStatus
} from "./mouseTrigger";
import { validateShortcut } from "./shortcuts";
import type { ConfigSummary, MemoryPreview, UserSettings } from "./types";

type Props = {
  config: ConfigSummary;
  settings: UserSettings;
  onClose: () => void;
  onSaved: (settings: UserSettings) => void;
};

const languages = [
  { id: "zh-CN", name: "中文" },
  { id: "en", name: "English" },
  { id: "ja", name: "日本語" },
  { id: "ko", name: "한국어" }
];

type SettingsTab = "model" | "input" | "memory" | "advanced";

const defaultMouseTrigger = { enabled: false, button: 8, consume: true };
const defaultMemory = {
  enabled: true,
  max_context_tokens: 1000,
  recent_turns: 10,
  summary_mode: "deterministic" as const
};

function settingsLabels(language: string) {
  if (language === "zh-CN") {
    return {
      advanced: "高级",
      active: "已启用",
      apiKey: "API Key",
      apiKeyConfigured: "已配置。留空将保留当前 key。",
      apiKeyPaste: "粘贴 API key",
      apiSecret: "API Secret",
      apiSecretConfigured: "已配置。留空将保留当前 secret。",
      apiSecretPaste: "粘贴 API secret",
      cancelRecording: "取消录制",
      character: "角色",
      checkingMouse: "正在检查鼠标触发支持...",
      clearMemory: "清空记忆",
      close: "关闭",
      consumeMouse: "消费事件以避免浏览器后退",
      context: "上下文",
      delete: "删除",
      deterministic: "确定性",
      enableMemory: "启用本地记忆上下文",
      enableMouse: "启用鼠标侧键触发",
      exportSettings: "导出设置",
      importSettings: "导入设置",
      inactive: "未启用",
      input: "输入",
      maxOutput: "最大输出",
      memory: "记忆",
      memoryBudget: "记忆 token 预算",
      model: "模型",
      modelAssisted: "模型辅助",
      modelName: "模型名称",
      modelProvider: "模型提供方",
      mouseSideButton: "鼠标侧键",
      mouseUnavailable: "鼠标侧键绑定不可用。",
      noMemoryRecords: "暂无最近记忆记录。",
      noSummary: "暂无摘要。",
      outputLanguage: "输出语言",
      pressShortcut: "按下快捷键...",
      pressSideButton: "按下侧键",
      presentationRenderer: "展示方式",
      promptProfile: "提示注入配置",
      rawRecentTurns: "最近原始轮数",
      record: "录制",
      recording: "录制中",
      refreshPreview: "刷新预览",
      reset: "重置",
      resetMemory: "重置记忆",
      resetModel: "重置模型覆盖",
      resetMouse: "重置鼠标",
      save: "保存",
      saving: "保存中...",
      settings: "设置",
      shortcut: "快捷键",
      state: "状态",
      streaming: "流式",
      summary: "摘要",
      summaryMode: "摘要模式",
      testProvider: "测试提供方",
      testing: "测试中...",
      yes: "是",
      no: "否"
    };
  }
  return {
    advanced: "Advanced",
    active: "active",
    apiKey: "API key",
    apiKeyConfigured: "Configured. Leave blank to keep current key.",
    apiKeyPaste: "Paste API key",
    apiSecret: "API secret",
    apiSecretConfigured: "Configured. Leave blank to keep current secret.",
    apiSecretPaste: "Paste API secret",
    cancelRecording: "Cancel recording",
    character: "Character",
    checkingMouse: "Checking mouse trigger support...",
    clearMemory: "Clear memory",
    close: "Close",
    consumeMouse: "Consume event to avoid browser back",
    context: "Context",
    delete: "Delete",
    deterministic: "Deterministic",
    enableMemory: "Enable local memory context",
    enableMouse: "Enable mouse side button trigger",
    exportSettings: "Export settings",
    importSettings: "Import settings",
    inactive: "inactive",
    input: "Input",
    maxOutput: "Max output",
    memory: "Memory",
    memoryBudget: "Memory token budget",
    model: "Model",
    modelAssisted: "Model-assisted",
    modelName: "Model name",
    modelProvider: "Model provider",
    mouseSideButton: "Mouse side button",
    mouseUnavailable: "Mouse side button binding is unavailable.",
    noMemoryRecords: "No recent memory records.",
    noSummary: "No summary yet.",
    outputLanguage: "Output language",
    pressShortcut: "Press shortcut...",
    pressSideButton: "Press side button",
    presentationRenderer: "Presentation",
    promptProfile: "Prompt injection profile",
    rawRecentTurns: "Raw recent turns",
    record: "Record",
    recording: "Recording",
    refreshPreview: "Refresh preview",
    reset: "Reset",
    resetMemory: "Reset memory",
    resetModel: "Reset model override",
    resetMouse: "Reset mouse",
    save: "Save",
    saving: "Saving...",
    settings: "Settings",
    shortcut: "Shortcut",
    state: "State",
    streaming: "Streaming",
    summary: "Summary",
    summaryMode: "Summary mode",
    testProvider: "Test provider",
    testing: "Testing...",
    yes: "yes",
    no: "no"
  };
}

export function SettingsPanel({ config, settings, onClose, onSaved }: Props) {
  const hasTauriRuntime = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  const [activeTab, setActiveTab] = useState<SettingsTab>("model");
  const [providerId, setProviderId] = useState(settings.provider_id);
  const [characterId, setCharacterId] = useState(settings.character_id);
  const [promptProfileId, setPromptProfileId] = useState(settings.prompt_profile_id);
  const [shortcut, setShortcut] = useState(settings.shortcut);
  const [language, setLanguage] = useState(settings.language);
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [recordingShortcut, setRecordingShortcut] = useState(false);
  const [mouseEnabled, setMouseEnabled] = useState(settings.mouse_trigger.enabled);
  const [mouseButton, setMouseButton] = useState(settings.mouse_trigger.button);
  const [mouseConsume, setMouseConsume] = useState(settings.mouse_trigger.consume);
  const [mouseStatus, setMouseStatus] = useState<MouseTriggerStatus | null>(null);
  const [recordingMouse, setRecordingMouse] = useState(false);
  const [memoryEnabled, setMemoryEnabled] = useState(settings.memory.enabled);
  const [memoryBudget, setMemoryBudget] = useState(settings.memory.max_context_tokens);
  const [memoryRecentTurns, setMemoryRecentTurns] = useState(settings.memory.recent_turns);
  const [memorySummaryMode, setMemorySummaryMode] = useState<"deterministic" | "model">(
    settings.memory.summary_mode ?? "deterministic"
  );
  const [presentationRenderer, setPresentationRenderer] = useState<"fbx" | "live2d">(
    settings.presentation?.renderer ?? "fbx"
  );
  const [memoryPreview, setMemoryPreview] = useState<MemoryPreview | null>(null);
  const [providerTest, setProviderTest] = useState("");
  const [testingProvider, setTestingProvider] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const importInputRef = useRef<HTMLInputElement>(null);

  const provider = useMemo(
    () => config.providers.find((item) => item.id === providerId) ?? config.providers[0],
    [config.providers, providerId]
  );
  const labels = useMemo(() => settingsLabels(language), [language]);
  const shortcutInputRef = useRef<HTMLInputElement>(null);

  const defaultShortcut = navigator.platform.toLowerCase().includes("mac") ? "Command+Shift+Space" : "Ctrl+Shift+Space";

  useEffect(() => {
    setModel(settings.model_overrides[providerId] ?? provider?.model ?? "");
    setApiKey("");
    setApiSecret("");
  }, [providerId, provider?.model, settings.model_overrides]);

  useEffect(() => {
    if (!hasTauriRuntime) {
      setMouseStatus({
        available: false,
        backend: "unavailable",
        message: labels.mouseUnavailable,
        active: false,
        recording: false,
        grabbed_button: null,
        last_error: null
      });
      return;
    }
    getMouseTriggerStatus()
      .then(setMouseStatus)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [hasTauriRuntime, labels.mouseUnavailable]);

  useEffect(() => {
    if (activeTab !== "memory") return;
    refreshMemoryPreview().catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [activeTab]);

  useEffect(() => {
    if (!hasTauriRuntime) return;
    const cleanup = listen<MouseTriggerRecorded>("mouse-trigger-recorded", (event) => {
      setMouseButton(event.payload.button);
      setRecordingMouse(false);
      configureMouseTrigger({ enabled: mouseEnabled, button: event.payload.button, consume: mouseConsume }).catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
      });
      getMouseTriggerStatus().then(setMouseStatus).catch(() => undefined);
    });
    return () => {
      cleanup.then((unlisten) => unlisten()).catch(() => undefined);
    };
  }, [hasTauriRuntime, mouseConsume, mouseEnabled]);

  useEffect(() => {
    if (!hasTauriRuntime) return;
    const cleanup = listen<string>("mouse-trigger-error", (event) => {
      setError(event.payload);
      getMouseTriggerStatus().then(setMouseStatus).catch(() => undefined);
    });
    return () => {
      cleanup.then((unlisten) => unlisten()).catch(() => undefined);
    };
  }, [hasTauriRuntime]);

  async function submit() {
    setSaving(true);
    setError("");
    const shortcutError = validateShortcut(shortcut);
    if (shortcutError) {
      setSaving(false);
      setError(shortcutError);
      return;
    }
    try {
      const apiKeys = apiKey.trim() ? { [providerId]: apiKey.trim() } : undefined;
      const apiSecrets = apiSecret.trim() ? { [providerId]: apiSecret.trim() } : undefined;
      const next = await saveSettings({
        provider_id: providerId,
        character_id: characterId,
        prompt_profile_id: promptProfileId,
        shortcut,
        language,
        model_overrides: { [providerId]: model.trim() },
        mouse_trigger: { enabled: mouseEnabled, button: mouseButton, consume: mouseConsume },
        memory: {
          enabled: memoryEnabled,
          max_context_tokens: memoryBudget,
          recent_turns: memoryRecentTurns,
          summary_mode: memorySummaryMode
        },
        presentation: { renderer: presentationRenderer },
        api_keys: apiKeys,
        api_secrets: apiSecrets
      });
      if (hasTauriRuntime) {
        await configureMouseTrigger({ enabled: mouseEnabled, button: mouseButton, consume: mouseConsume });
        await getMouseTriggerStatus().then(setMouseStatus).catch(() => undefined);
      }
      onSaved(next);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function clearLocalMemory() {
    setError("");
    try {
      await clearMemory();
      await refreshMemoryPreview();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function refreshMemoryPreview() {
    setMemoryPreview(await fetchMemoryPreview());
  }

  async function deleteLocalMemoryRecord(timestamp: string) {
    setError("");
    try {
      await deleteMemoryRecord(timestamp);
      await refreshMemoryPreview();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function runProviderTest() {
    setTestingProvider(true);
    setProviderTest("");
    setError("");
    try {
      const result = await testProvider(providerId);
      setProviderTest(`${result.status}: ${result.latency_ms} ms\n${result.output_preview}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTestingProvider(false);
    }
  }

  function exportSettings() {
    const payload = {
      provider_id: providerId,
      character_id: characterId,
      prompt_profile_id: promptProfileId,
      shortcut,
      language,
      model_overrides: { ...settings.model_overrides, [providerId]: model.trim() },
      mouse_trigger: { enabled: mouseEnabled, button: mouseButton, consume: mouseConsume },
      memory: {
        enabled: memoryEnabled,
        max_context_tokens: memoryBudget,
        recent_turns: memoryRecentTurns,
        summary_mode: memorySummaryMode
      },
      presentation: { renderer: presentationRenderer }
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "desktop-ai-assistant-settings.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function importSettings(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const imported = JSON.parse(await file.text());
      if (typeof imported.provider_id === "string") setProviderId(imported.provider_id);
      if (typeof imported.character_id === "string") setCharacterId(imported.character_id);
      if (typeof imported.prompt_profile_id === "string") setPromptProfileId(imported.prompt_profile_id);
      if (typeof imported.shortcut === "string") setShortcut(imported.shortcut);
      if (typeof imported.language === "string") setLanguage(imported.language);
      if (imported.model_overrides?.[providerId]) setModel(imported.model_overrides[providerId]);
      if (imported.mouse_trigger) {
        setMouseEnabled(Boolean(imported.mouse_trigger.enabled));
        setMouseButton(Number(imported.mouse_trigger.button ?? defaultMouseTrigger.button));
        setMouseConsume(Boolean(imported.mouse_trigger.consume ?? defaultMouseTrigger.consume));
      }
      if (imported.memory) {
        setMemoryEnabled(Boolean(imported.memory.enabled));
        setMemoryBudget(Number(imported.memory.max_context_tokens ?? defaultMemory.max_context_tokens));
        setMemoryRecentTurns(Number(imported.memory.recent_turns ?? defaultMemory.recent_turns));
        setMemorySummaryMode(imported.memory.summary_mode === "model" ? "model" : "deterministic");
      }
      if (imported.presentation) {
        setPresentationRenderer(imported.presentation.renderer === "live2d" ? "live2d" : "fbx");
      }
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      event.target.value = "";
    }
  }

  function shortcutFromEvent(event: React.KeyboardEvent<HTMLInputElement>): string {
    const parts: string[] = [];
    if (event.ctrlKey) parts.push("Ctrl");
    if (event.metaKey) parts.push(navigator.platform.toLowerCase().includes("mac") ? "Command" : "Super");
    if (event.altKey) parts.push("Alt");
    if (event.shiftKey) parts.push("Shift");

    const keyMap: Record<string, string> = {
      " ": "Space",
      Spacebar: "Space",
      Esc: "Escape",
      ArrowUp: "Up",
      ArrowDown: "Down",
      ArrowLeft: "Left",
      ArrowRight: "Right"
    };
    const ignored = new Set(["Control", "Shift", "Alt", "Meta"]);
    if (!ignored.has(event.key)) {
      const mapped = keyMap[event.key] ?? (event.key.length === 1 ? event.key.toUpperCase() : event.key);
      parts.push(mapped);
    }
    return parts.join("+");
  }

  function recordShortcut(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!recordingShortcut) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
      setRecordingShortcut(false);
      return;
    }
    const next = shortcutFromEvent(event);
    if (next.includes("+")) {
      const shortcutError = validateShortcut(next);
      if (shortcutError) {
        setError(shortcutError);
        setRecordingShortcut(false);
        return;
      }
      setError("");
      setShortcut(next);
      setRecordingShortcut(false);
    }
  }

  async function recordMouseButton() {
    setError("");
    if (!hasTauriRuntime || !mouseStatus?.available) {
      setError(mouseStatus?.message ?? labels.mouseUnavailable);
      return;
    }
    try {
      setRecordingMouse(true);
      await startMouseTriggerRecording(8000);
      window.setTimeout(() => setRecordingMouse(false), 8200);
    } catch (err) {
      setRecordingMouse(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="settings-backdrop" onClick={onClose}>
      <section className="settings-panel" onClick={(event) => event.stopPropagation()}>
        <header>
          <h2>{labels.settings}</h2>
          <button onClick={onClose}>{labels.close}</button>
        </header>

        {error && <div className="error">{error}</div>}

        <nav className="settings-tabs">
          {(["model", "input", "memory", "advanced"] as SettingsTab[]).map((tab) => (
            <button
              key={tab}
              type="button"
              className={activeTab === tab ? "active" : ""}
              onClick={() => setActiveTab(tab)}
            >
              {labels[tab]}
            </button>
          ))}
        </nav>

        {activeTab === "model" && (
          <>
        <label>
          {labels.modelProvider}
          <select value={providerId} onChange={(event) => setProviderId(event.target.value)}>
            {config.providers.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>

        <div className="provider-details">
          <div>{provider?.type}</div>
          <div>{labels.context}: {provider?.capabilities.context_size?.toLocaleString() ?? "unknown"}</div>
          <div>{labels.maxOutput}: {provider?.capabilities.max_output_tokens}</div>
          <div>{labels.streaming}: {provider?.capabilities.supports_streaming ? labels.yes : labels.no}</div>
        </div>

        <button type="button" onClick={runProviderTest} disabled={testingProvider}>
          {testingProvider ? labels.testing : labels.testProvider}
        </button>
        {providerTest && <pre className="settings-pre">{providerTest}</pre>}

        <label>
          {labels.modelName}
          <input value={model} onChange={(event) => setModel(event.target.value)} placeholder={provider?.default_model} />
        </label>

        {provider?.requires_api_key && (
          <label>
            {labels.apiKey}
            <input
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={provider.api_key_configured ? labels.apiKeyConfigured : labels.apiKeyPaste}
              type="password"
            />
          </label>
        )}

        {provider?.requires_api_secret && (
          <label>
            {labels.apiSecret}
            <input
              value={apiSecret}
              onChange={(event) => setApiSecret(event.target.value)}
              placeholder={provider.api_secret_configured ? labels.apiSecretConfigured : labels.apiSecretPaste}
              type="password"
            />
          </label>
        )}

        <label>
          {labels.character}
          <select value={characterId} onChange={(event) => setCharacterId(event.target.value)}>
            {config.characters.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          {labels.promptProfile}
          <select value={promptProfileId} onChange={(event) => setPromptProfileId(event.target.value)}>
            {config.prompt_profiles.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          {labels.outputLanguage}
          <select value={language} onChange={(event) => setLanguage(event.target.value)}>
            {languages.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
          </>
        )}

        {activeTab === "input" && (
          <>
        <label>
          {labels.shortcut}
          <div className="shortcut-recorder">
            <input
              ref={shortcutInputRef}
              value={recordingShortcut ? labels.pressShortcut : shortcut}
              onKeyDown={recordShortcut}
              readOnly
              placeholder="Ctrl+Shift+Space"
            />
            <button
              type="button"
              onClick={() => {
                setRecordingShortcut(true);
                window.setTimeout(() => shortcutInputRef.current?.focus(), 0);
              }}
            >
              {recordingShortcut ? labels.recording : labels.record}
            </button>
            <button type="button" onClick={() => setShortcut(defaultShortcut)}>
              {labels.reset}
            </button>
          </div>
        </label>

        <fieldset className="settings-fieldset">
          <legend>{labels.mouseSideButton}</legend>
          <div className={mouseStatus?.available ? "hint" : "hint warning"}>
            {mouseStatus?.message ?? labels.checkingMouse}
          </div>
          {mouseStatus?.available && (
            <div className="hint">
              {labels.state}: {mouseStatus.recording ? labels.recording : mouseStatus.active ? labels.active : labels.inactive}
              {mouseStatus.grabbed_button ? ` · Button${mouseStatus.grabbed_button}` : ""}
              {mouseStatus.last_error ? ` · ${mouseStatus.last_error}` : ""}
            </div>
          )}
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={mouseEnabled}
              disabled={!mouseStatus?.available}
              onChange={(event) => setMouseEnabled(event.target.checked)}
            />
            {labels.enableMouse}
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={mouseConsume}
              disabled={!mouseStatus?.available}
              onChange={(event) => setMouseConsume(event.target.checked)}
            />
            {labels.consumeMouse}
          </label>
          <div className="shortcut-recorder">
            <input value={`Button${mouseButton}`} readOnly />
            <button type="button" disabled={!mouseStatus?.available || recordingMouse} onClick={recordMouseButton}>
              {recordingMouse ? labels.pressSideButton : labels.record}
            </button>
          </div>
          {recordingMouse && (
            <button
              type="button"
              onClick={() => {
                stopMouseTriggerRecording().catch(() => undefined);
                setRecordingMouse(false);
              }}
            >
              {labels.cancelRecording}
            </button>
          )}
        </fieldset>
          </>
        )}

        {activeTab === "memory" && (
          <>
        <fieldset className="settings-fieldset">
          <legend>{labels.memory}</legend>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={memoryEnabled}
              onChange={(event) => setMemoryEnabled(event.target.checked)}
            />
            {labels.enableMemory}
          </label>
          <label>
            {labels.memoryBudget}
            <input
              type="number"
              min={200}
              max={4000}
              step={100}
              value={memoryBudget}
              onChange={(event) => setMemoryBudget(Number(event.target.value))}
            />
          </label>
          <label>
            {labels.rawRecentTurns}
            <input
              type="number"
              min={0}
              max={50}
              step={1}
              value={memoryRecentTurns}
              onChange={(event) => setMemoryRecentTurns(Number(event.target.value))}
            />
          </label>
          <label>
            {labels.summaryMode}
            <select
              value={memorySummaryMode}
              onChange={(event) => setMemorySummaryMode(event.target.value === "model" ? "model" : "deterministic")}
            >
              <option value="deterministic">{labels.deterministic}</option>
              <option value="model">{labels.modelAssisted}</option>
            </select>
          </label>
          <div className="button-row">
            <button type="button" onClick={() => {
              setMemoryEnabled(defaultMemory.enabled);
              setMemoryBudget(defaultMemory.max_context_tokens);
              setMemoryRecentTurns(defaultMemory.recent_turns);
              setMemorySummaryMode(defaultMemory.summary_mode);
            }}>
              {labels.resetMemory}
            </button>
            <button type="button" onClick={() => refreshMemoryPreview().catch((err) => setError(err instanceof Error ? err.message : String(err)))}>
              {labels.refreshPreview}
            </button>
          </div>
          <button type="button" onClick={clearLocalMemory}>
            {labels.clearMemory}
          </button>
        </fieldset>

        {memoryPreview && (
          <section className="memory-preview">
            <h3>{labels.summary}</h3>
            <pre className="settings-pre">{memoryPreview.summary || labels.noSummary}</pre>
            <h3>{labels.rawRecentTurns}</h3>
            {memoryPreview.recent.length === 0 && <div className="hint">{labels.noMemoryRecords}</div>}
            {memoryPreview.recent.map((item) => (
              <article key={item.timestamp} className="memory-record">
                <div className="memory-record-title">
                  <span>{item.action_id} · {item.provider_id}</span>
                  <button type="button" onClick={() => deleteLocalMemoryRecord(item.timestamp)}>
                    {labels.delete}
                  </button>
                </div>
                <pre>{item.input_text}</pre>
                <pre>{item.output_text}</pre>
              </article>
            ))}
          </section>
        )}
          </>
        )}

        {activeTab === "advanced" && (
          <fieldset className="settings-fieldset">
            <legend>{labels.advanced}</legend>
            <label>
              {labels.presentationRenderer}
              <select
                value={presentationRenderer}
                onChange={(event) => setPresentationRenderer(event.target.value === "live2d" ? "live2d" : "fbx")}
              >
                <option value="fbx">FBX 3D</option>
                <option value="live2d">Live2D</option>
              </select>
            </label>
            <div className="button-row">
              <button type="button" onClick={exportSettings}>
                {labels.exportSettings}
              </button>
              <button type="button" onClick={() => importInputRef.current?.click()}>
                {labels.importSettings}
              </button>
              <input ref={importInputRef} className="hidden-input" type="file" accept="application/json" onChange={importSettings} />
            </div>
            <div className="button-row">
              <button type="button" onClick={() => {
                setMouseEnabled(defaultMouseTrigger.enabled);
                setMouseButton(defaultMouseTrigger.button);
                setMouseConsume(defaultMouseTrigger.consume);
              }}>
                {labels.resetMouse}
              </button>
              <button type="button" onClick={() => setModel("")}>
                {labels.resetModel}
              </button>
            </div>
          </fieldset>
        )}

        <footer>
          <button onClick={submit} disabled={saving}>
            {saving ? labels.saving : labels.save}
          </button>
        </footer>
      </section>
    </div>
  );
}
