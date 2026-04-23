import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { commands, type ChatSystemPromptMode, type ProviderStatus } from "@/bindings";
import { toast } from "sonner";

/** Must match server `WORKSPACE_MEMORIES_PLACEHOLDER` in `commands/chat.rs`. */
const WORKSPACE_MEMORIES_PLACEHOLDER = "{{WORKSPACE_MEMORIES}}";

const PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Claude",
  groq: "Groq",
  gemini: "Gemini",
  mistral: "Mistral",
  ollama: "Ollama",
  llama_cpp: "llama.cpp",
};

const NEEDS_API_KEY = ["openai", "anthropic", "groq", "gemini", "mistral"];

const CONTROL_MIN_HEIGHT = 36;

function isOpenAiCompatible(providerId: string): boolean {
  return providerId !== "anthropic";
}

function inputStyle(): React.CSSProperties {
  return {
    width: "100%",
    minHeight: CONTROL_MIN_HEIGHT,
    background: "var(--workspace-panel-muted)",
    border: "1px solid var(--workspace-border)",
    borderRadius: 8,
    padding: "8px 10px",
    color: "var(--workspace-text)",
    fontSize: 12,
    outline: "none",
    fontFamily: "inherit",
    boxSizing: "border-box",
  };
}

function unifiedSaveButtonStyle(enabled: boolean): React.CSSProperties {
  return {
    flexShrink: 0,
    minHeight: CONTROL_MIN_HEIGHT,
    padding: "0 20px",
    borderRadius: 8,
    fontSize: 12,
    fontWeight: 600,
    cursor: enabled ? "pointer" : "default",
    border: "none",
    background: enabled ? "#b72301" : "var(--workspace-panel-muted)",
    color: enabled ? "#fff" : "var(--workspace-text-muted)",
    whiteSpace: "nowrap",
    boxSizing: "border-box",
  };
}

function helpButtonStyle(): React.CSSProperties {
  return {
    width: 22,
    height: 22,
    borderRadius: "50%",
    border: "1px solid var(--workspace-border)",
    background: "var(--workspace-panel-muted)",
    color: "var(--workspace-text-soft)",
    fontSize: 12,
    fontWeight: 700,
    cursor: "help",
    lineHeight: 1,
    padding: 0,
    flexShrink: 0,
  };
}

function errText(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

export const ChatProvidersSettings: React.FC = () => {
  const { t } = useTranslation();
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [selected, setSelected] = useState<string>("ollama");
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; latency?: number; error?: string }>>({});
  const [testing, setTesting] = useState<Record<string, boolean>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { baseUrl: string; model: string; visionModel: string }>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [chatInstructions, setChatInstructions] = useState("");
  const [chatPromptMode, setChatPromptMode] = useState<ChatSystemPromptMode>("append");
  const [instructionsBaseline, setInstructionsBaseline] = useState<{ text: string; mode: ChatSystemPromptMode }>({
    text: "",
    mode: "append",
  });
  const [savingInstructions, setSavingInstructions] = useState(false);
  const [promptTemplate, setPromptTemplate] = useState("");
  const [templateBaseline, setTemplateBaseline] = useState("");
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [ollamaVisionList, setOllamaVisionList] = useState<string[]>([]);
  const [ollamaVisionLoading, setOllamaVisionLoading] = useState(false);
  const [maxOutputTokens, setMaxOutputTokens] = useState(8192);
  const [omitMaxTokensOpenAi, setOmitMaxTokensOpenAi] = useState(false);
  const [tokenSettingsBaseline, setTokenSettingsBaseline] = useState({ max: 8192, omit: false });
  const [savingTokenSettings, setSavingTokenSettings] = useState(false);

  useEffect(() => {
    void loadProviders();
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const res = await commands.getAppSettings();
        if (res.status !== "ok") return;
        const tpl = res.data.chat_system_prompt_template ?? "";
        setPromptTemplate(tpl);
        setTemplateBaseline(tpl);
      } catch {
        /* ignore */
      }
    })();
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const res = await commands.getAppSettings();
        if (res.status !== "ok") return;
        const text = res.data.chat_custom_instructions ?? "";
        const mode: ChatSystemPromptMode =
          res.data.chat_system_prompt_mode === "replace" ? "replace" : "append";
        setChatInstructions(text);
        setChatPromptMode(mode);
        setInstructionsBaseline({ text, mode });
      } catch {
        /* ignore */
      }
    })();
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const res = await commands.getAppSettings();
        if (res.status !== "ok") return;
        const max = Math.max(1, Number(res.data.chat_max_output_tokens) || 8192);
        const omit = Boolean(res.data.chat_omit_max_tokens_for_openai_compatible);
        setMaxOutputTokens(max);
        setOmitMaxTokensOpenAi(omit);
        setTokenSettingsBaseline({ max, omit });
      } catch {
        /* ignore */
      }
    })();
  }, []);

  const loadProviders = async (): Promise<ProviderStatus[] | null> => {
    try {
      const result = await commands.getChatProviders();
      if (result.status === "ok") {
        setProviders(result.data);
        const active = result.data.find((p) => p.is_active);
        if (active) setSelected(active.provider_id);
        const next: Record<string, { baseUrl: string; model: string; visionModel: string }> = {};
        for (const p of result.data) {
          next[p.provider_id] = {
            baseUrl: p.base_url ?? "",
            model: p.model,
            visionModel: p.vision_model ?? "",
          };
        }
        setDrafts(next);
        return result.data;
      } else {
        toast.error(String(result.error));
      }
    } catch (e) {
      toast.error(errText(e));
    }
    return null;
  };

  const getDraft = (p: ProviderStatus) =>
    drafts[p.provider_id] ?? {
      baseUrl: p.base_url ?? "",
      model: p.model,
      visionModel: p.vision_model ?? "",
    };

  const resolvedBaseUrl = (p: ProviderStatus) => {
    const d = getDraft(p);
    const t0 = d.baseUrl.trim();
    if (t0) return t0;
    return p.default_base_url ?? "";
  };

  const resolvedModel = (p: ProviderStatus) => {
    const d = getDraft(p);
    const t0 = d.model.trim();
    return t0 || p.default_model;
  };

  const buildChatProviderPayload = (p: ProviderStatus) => {
    const model = resolvedModel(p);
    const isAnthropic = p.provider_id === "anthropic";
    let base_url: string | null = null;
    if (!isAnthropic) {
      const bu = resolvedBaseUrl(p).trim() || (p.default_base_url ?? "").trim();
      base_url = bu || "http://localhost:11434/v1";
    }
    const d = getDraft(p);
    const vision_model =
      p.provider_id === "ollama"
        ? (() => {
            const v = (d.visionModel ?? "").trim();
            return v.length > 0 ? v : null;
          })()
        : null;
    return {
      provider_id: p.provider_id,
      provider_type: isAnthropic ? "anthropic" : "openai_compatible",
      base_url,
      model,
      vision_model,
    };
  };

  const buildHelpTooltip = (p: ProviderStatus) => {
    const parts: string[] = [t("settings.chatProviders.helpIntro")];
    if (isOpenAiCompatible(p.provider_id)) {
      parts.push(t("settings.chatProviders.baseUrlHint"));
    } else {
      parts.push(t("settings.chatProviders.anthropicBaseNote"));
    }
    parts.push(t("settings.chatProviders.modelHint"));
    if (NEEDS_API_KEY.includes(p.provider_id)) {
      parts.push(t("settings.chatProviders.keyFormatHint"));
    }
    if (p.provider_id === "openai") {
      parts.push(t("settings.chatProviders.minimaxViaOpenAi"));
    }
    return parts.join("\n\n");
  };

  const handleSetActive = async (providerId: string) => {
    const p = providers.find((x) => x.provider_id === providerId);
    if (!p) return;
    const cfg = buildChatProviderPayload(p);
    try {
      const result = await commands.setChatProvider({
        provider_id: cfg.provider_id,
        provider_type: cfg.provider_type,
        base_url: cfg.base_url,
        model: cfg.model,
      });
      if (result.status === "ok") {
        setSelected(providerId);
        toast.success(t("settings.chatProviders.providerActivated", { provider: PROVIDER_LABELS[providerId] ?? providerId }));
      } else {
        toast.error(t("settings.chatProviders.activateFailed", { error: String(result.error) }));
      }
    } catch (e) {
      toast.error(t("settings.chatProviders.activateFailed", { error: errText(e) }));
    }
  };

  const handleSaveAll = async (p: ProviderStatus) => {
    const id = p.provider_id;
    setSaving((prev) => ({ ...prev, [id]: true }));
    try {
      const d = getDraft(p);
      const keyTrim = (apiKeys[id] ?? "").trim();

      const resultConn = await commands.saveChatProviderOptions(
        id,
        d.baseUrl,
        d.model,
        id === "ollama" ? d.visionModel ?? "" : null,
      );
      if (resultConn.status !== "ok") {
        toast.error(t("settings.chatProviders.saveConnectionFailed", { error: String(resultConn.error) }));
        return;
      }

      if (keyTrim && NEEDS_API_KEY.includes(id)) {
        const resultKey = await commands.saveProviderApiKey(id, keyTrim);
        if (resultKey.status !== "ok") {
          toast.error(t("settings.chatProviders.saveKeyFailed", { error: String(resultKey.error) }));
          return;
        }
        setApiKeys((prev) => ({ ...prev, [id]: "" }));
      }

      toast.success(t("settings.chatProviders.allSaved"));
      await loadProviders();
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setSaving((prev) => ({ ...prev, [id]: false }));
    }
  };

  const handleTest = async (p: ProviderStatus) => {
    const keyDraft = apiKeys[p.provider_id] ?? "";
    const apiKeyOverride = keyDraft.trim() ? keyDraft.trim() : null;
    setTesting((prev) => ({ ...prev, [p.provider_id]: true }));
    try {
      const result = await commands.testChatProvider(buildChatProviderPayload(p), apiKeyOverride);
      if (result.status === "ok") {
        setTestResults((prev) => ({
          ...prev,
          [p.provider_id]: { ok: result.data.ok, latency: result.data.latency_ms, error: result.data.error ?? undefined },
        }));
      } else {
        toast.error(String(result.error));
      }
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setTesting((prev) => ({ ...prev, [p.provider_id]: false }));
    }
  };

  const instructionsDirty =
    chatInstructions !== instructionsBaseline.text || chatPromptMode !== instructionsBaseline.mode;

  const tokenSettingsDirty =
    maxOutputTokens !== tokenSettingsBaseline.max || omitMaxTokensOpenAi !== tokenSettingsBaseline.omit;

  const templateDirty = promptTemplate !== templateBaseline;

  const handleSavePromptTemplate = async () => {
    setSavingTemplate(true);
    try {
      const trimmed = promptTemplate.trim();
      const payload = trimmed.length === 0 ? null : promptTemplate;
      const result = await commands.saveChatSystemPromptTemplate(payload);
      if (result.status !== "ok") {
        toast.error(String(result.error));
        return;
      }
      setTemplateBaseline(trimmed);
      toast.success(
        t("settings.chatProviders.templateSaved", "System prompt template saved."),
      );
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setSavingTemplate(false);
    }
  };

  const handleRefreshOllamaVision = async (p: ProviderStatus) => {
    const bu = resolvedBaseUrl(p).trim() || (p.default_base_url ?? "").trim();
    if (!bu) {
      toast.error(t("settings.chatProviders.ollamaVisionNoBase", "Set a base URL first."));
      return;
    }
    setOllamaVisionLoading(true);
    setOllamaVisionList([]);
    try {
      const result = await commands.listOllamaVisionModels(bu);
      if (result.status !== "ok") {
        toast.error(String(result.error));
        return;
      }
      setOllamaVisionList(result.data);
      if (result.data.length === 0) {
        toast.message(
          t(
            "settings.chatProviders.ollamaVisionEmpty",
            "No vision models detected. Install one in Ollama (e.g. llama3.2-vision) with: ollama pull <model>",
          ),
        );
      }
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setOllamaVisionLoading(false);
    }
  };

  const handleSaveChatInstructions = async () => {
    setSavingInstructions(true);
    try {
      const result = await commands.saveChatCustomInstructions(chatInstructions, chatPromptMode);
      if (result.status !== "ok") {
        toast.error(String(result.error));
        return;
      }
      setInstructionsBaseline({ text: chatInstructions, mode: chatPromptMode });
      toast.success(t("settings.chatProviders.instructionsSaved", "Chat instructions saved."));
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setSavingInstructions(false);
    }
  };

  const handleSaveTokenSettings = async () => {
    setSavingTokenSettings(true);
    try {
      const capped = Math.min(1_000_000, Math.max(1, Math.floor(maxOutputTokens)));
      const result = await commands.saveChatOutputTokenSettings(capped, omitMaxTokensOpenAi);
      if (result.status !== "ok") {
        toast.error(String(result.error));
        return;
      }
      setMaxOutputTokens(capped);
      setTokenSettingsBaseline({ max: capped, omit: omitMaxTokensOpenAi });
      toast.success(t("settings.chatProviders.maxOutputTokensSaved"));
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setSavingTokenSettings(false);
    }
  };

  const toggleExpand = (p: ProviderStatus) => {
    setExpandedId((id) => (id === p.provider_id ? null : p.provider_id));
    setDrafts((prev) => ({
      ...prev,
      [p.provider_id]: prev[p.provider_id] ?? {
        baseUrl: p.base_url ?? "",
        model: p.model,
        visionModel: p.vision_model ?? "",
      },
    }));
  };

  return (
    <div style={{ maxWidth: 600, width: "100%", padding: "0 4px" }}>
      <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12, color: "var(--workspace-text)" }}>
        {t("settings.chatProviders.title")}
      </h2>
      <p style={{ fontSize: 12, color: "var(--workspace-text-muted)", marginBottom: 20, lineHeight: 1.45 }}>
        {t("settings.chatProviders.description")}
      </p>

      <div
        style={{
          marginBottom: 24,
          padding: "16px",
          borderRadius: 12,
          border: "1px solid var(--workspace-border)",
          background: "var(--workspace-panel)",
        }}
      >
        <h3 style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, color: "var(--workspace-text)" }}>
          {t("settings.chatProviders.maxOutputTokensTitle")}
        </h3>
        <p style={{ fontSize: 11, color: "var(--workspace-text-muted)", marginBottom: 12, lineHeight: 1.45 }}>
          {t("settings.chatProviders.maxOutputTokensHelp")}
        </p>
        <label style={{ display: "block", marginBottom: 12 }}>
          <span style={{ fontSize: 11, color: "var(--workspace-text-muted)", display: "block", marginBottom: 4 }}>
            {t("settings.chatProviders.maxOutputTokensLabel")}
          </span>
          <input
            type="number"
            min={1}
            max={1_000_000}
            value={maxOutputTokens}
            onChange={(e) => setMaxOutputTokens(Number(e.target.value))}
            style={{ ...inputStyle(), maxWidth: 200 }}
          />
        </label>
        <label style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 12, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={omitMaxTokensOpenAi}
            onChange={(e) => setOmitMaxTokensOpenAi(e.target.checked)}
            style={{ marginTop: 2 }}
          />
          <span>
            <span style={{ fontSize: 12, color: "var(--workspace-text)", display: "block" }}>
              {t("settings.chatProviders.omitMaxTokensLabel")}
            </span>
            <span style={{ fontSize: 11, color: "var(--workspace-text-muted)", lineHeight: 1.45 }}>
              {t("settings.chatProviders.omitMaxTokensHelp")}
            </span>
          </span>
        </label>
        <button
          type="button"
          disabled={!tokenSettingsDirty || savingTokenSettings}
          onClick={() => void handleSaveTokenSettings()}
          style={unifiedSaveButtonStyle(tokenSettingsDirty && !savingTokenSettings)}
        >
          {savingTokenSettings ? t("settings.chatProviders.saving") : t("common.save")}
        </button>
      </div>

      <div
        style={{
          marginBottom: 24,
          padding: "16px",
          borderRadius: 12,
          border: "1px solid var(--workspace-border)",
          background: "var(--workspace-panel)",
        }}
      >
        <h3 style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, color: "var(--workspace-text)" }}>
          {t("settings.chatProviders.instructionsTitle", "Chat instructions")}
        </h3>
        <p style={{ fontSize: 11, color: "var(--workspace-text-muted)", marginBottom: 12, lineHeight: 1.45 }}>
          {t(
            "settings.chatProviders.instructionsHelp",
            "Merged into the system message the model sees (not this settings screen). Use “Append” to keep Handy’s default prompt and add yours, or “Replace” to use only your text when it is non-empty.",
          )}
        </p>
        <label style={{ display: "block", marginBottom: 12 }}>
          <span style={{ fontSize: 11, color: "var(--workspace-text-muted)", display: "block", marginBottom: 4 }}>
            {t("settings.chatProviders.instructionsMode", "How to apply")}
          </span>
          <select
            value={chatPromptMode}
            onChange={(e) => setChatPromptMode(e.target.value as ChatSystemPromptMode)}
            style={{ ...inputStyle(), maxWidth: 280 }}
          >
            <option value="append">{t("settings.chatProviders.modeAppend", "Append to default system prompt")}</option>
            <option value="replace">{t("settings.chatProviders.modeReplace", "Replace default (your text only)")}</option>
          </select>
        </label>
        <label style={{ display: "block", marginBottom: 12 }}>
          <span style={{ fontSize: 11, color: "var(--workspace-text-muted)", display: "block", marginBottom: 4 }}>
            {t("settings.chatProviders.instructionsBody", "Instructions")}
          </span>
          <textarea
            value={chatInstructions}
            onChange={(e) => setChatInstructions(e.target.value)}
            rows={5}
            style={{ ...inputStyle(), minHeight: 100, resize: "vertical" }}
            spellCheck
          />
        </label>
        <button
          type="button"
          disabled={!instructionsDirty || savingInstructions}
          onClick={() => void handleSaveChatInstructions()}
          style={unifiedSaveButtonStyle(instructionsDirty && !savingInstructions)}
        >
          {savingInstructions ? t("settings.chatProviders.saving") : t("common.save")}
        </button>
      </div>

      <div
        id="chat-system-prompt-template"
        style={{
          marginBottom: 24,
          padding: "16px",
          borderRadius: 12,
          border: "1px solid var(--workspace-border)",
          background: "var(--workspace-panel)",
        }}
      >
        <h3 style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, color: "var(--workspace-text)" }}>
          {t("settings.chatProviders.templateTitle", "System prompt template (advanced)")}
        </h3>
        <p style={{ fontSize: 11, color: "var(--workspace-text-muted)", marginBottom: 12, lineHeight: 1.45 }}>
          {t(
            "settings.chatProviders.templateHelp",
            `Optional. When set, it must include exactly one ${WORKSPACE_MEMORIES_PLACEHOLDER} token. Workspace memories are inserted there inside a safety envelope. Leave empty to use the default layout.`,
          )}
        </p>
        <textarea
          value={promptTemplate}
          onChange={(e) => setPromptTemplate(e.target.value)}
          rows={6}
          placeholder={`You are Handy AI.\n\n${WORKSPACE_MEMORIES_PLACEHOLDER}\n\nBe concise.`}
          style={{ ...inputStyle(), minHeight: 120, resize: "vertical", fontFamily: "ui-monospace, monospace" }}
          spellCheck={false}
        />
        <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
          <button
            type="button"
            disabled={!templateDirty || savingTemplate}
            onClick={() => void handleSavePromptTemplate()}
            style={unifiedSaveButtonStyle(templateDirty && !savingTemplate)}
          >
            {savingTemplate ? t("settings.chatProviders.saving") : t("common.save")}
          </button>
          <button
            type="button"
            disabled={savingTemplate || !promptTemplate.trim()}
            onClick={() => {
              setPromptTemplate("");
              void (async () => {
                setSavingTemplate(true);
                try {
                  const result = await commands.saveChatSystemPromptTemplate(null);
                  if (result.status !== "ok") {
                    toast.error(String(result.error));
                    return;
                  }
                  setTemplateBaseline("");
                  toast.success(t("settings.chatProviders.templateCleared", "Template cleared."));
                } catch (e) {
                  toast.error(errText(e));
                } finally {
                  setSavingTemplate(false);
                }
              })();
            }}
            style={{
              ...unifiedSaveButtonStyle(Boolean(promptTemplate.trim())),
              background: "var(--workspace-panel-muted)",
              color: "var(--workspace-text)",
            }}
          >
            {t("settings.chatProviders.templateClear", "Clear template")}
          </button>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {providers.map((p) => {
          const isActive = p.provider_id === selected;
          const needsKey = NEEDS_API_KEY.includes(p.provider_id);
          const testResult = testResults[p.provider_id];
          const isTesting = testing[p.provider_id] ?? false;
          const expanded = expandedId === p.provider_id;
          const d = getDraft(p);
          const keyDraft = apiKeys[p.provider_id] ?? "";
          const visionDirty =
            p.provider_id === "ollama" &&
            (d.visionModel ?? "").trim() !== (p.vision_model ?? "").trim();
          const connDirty =
            d.baseUrl.trim() !== (p.base_url ?? "").trim() ||
            d.model.trim() !== p.model.trim() ||
            visionDirty;
          const keyDirty = Boolean(keyDraft.trim());
          const saveEnabled = expanded && !saving[p.provider_id] && (connDirty || keyDirty);
          const keyPlaceholder =
            p.key_status === "saved" && !keyDraft.trim()
              ? t("settings.chatProviders.keyMaskedPlaceholder")
              : t("settings.chatProviders.keyPlaceholder");

          const onEnterSave = (e: React.KeyboardEvent) => {
            if (e.key === "Enter" && saveEnabled) {
              e.preventDefault();
              void handleSaveAll(p);
            }
          };

          return (
            <div
              key={p.provider_id}
              style={{
                background: isActive ? "color-mix(in srgb, var(--workspace-accent) 8%, var(--workspace-panel))" : "var(--workspace-panel)",
                border: `1px solid ${isActive ? "var(--workspace-border-strong)" : "var(--workspace-border)"}`,
                borderRadius: 12,
                padding: "14px 16px",
                boxShadow: isActive ? "var(--workspace-shadow-soft)" : "none",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <div
                  role="button"
                  tabIndex={0}
                  aria-label={`${PROVIDER_LABELS[p.provider_id] ?? p.provider_id} — active provider`}
                  onClick={() => void handleSetActive(p.provider_id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleSetActive(p.provider_id);
                  }}
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: "50%",
                    border: `2px solid ${isActive ? "var(--workspace-accent)" : "var(--workspace-text-soft)"}`,
                    background: isActive ? "var(--workspace-accent)" : "transparent",
                    cursor: "pointer",
                    flexShrink: 0,
                  }}
                />
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--workspace-text)", flex: "1 1 120px" }}>
                  {PROVIDER_LABELS[p.provider_id] ?? p.provider_id}
                </span>
                <span style={{ fontSize: 11, color: "var(--workspace-text-muted)" }}>{resolvedModel(p)}</span>

                <button
                  type="button"
                  onClick={() => toggleExpand(p)}
                  style={{
                    background: "transparent",
                    border: "1px solid var(--workspace-border)",
                    borderRadius: 6,
                    color: "var(--workspace-text-soft)",
                    fontSize: 11,
                    padding: "4px 10px",
                    cursor: "pointer",
                  }}
                >
                  {expanded ? t("settings.chatProviders.collapse") : t("settings.chatProviders.expand")}
                </button>

                <button
                  type="button"
                  disabled={isTesting}
                  onClick={() => void handleTest(p)}
                  style={{
                    background: "var(--workspace-panel-muted)",
                    border: "1px solid var(--workspace-border)",
                    borderRadius: 6,
                    color: "var(--workspace-text-soft)",
                    fontSize: 11,
                    padding: "4px 10px",
                    cursor: isTesting ? "default" : "pointer",
                  }}
                >
                  {isTesting ? "…" : t("settings.chatProviders.test")}
                </button>

                {testResult && (
                  <span style={{ fontSize: 11, color: testResult.ok ? "var(--workspace-accent-secondary)" : "#c45c5c" }}>
                    {testResult.ok ? `✓ ${testResult.latency}ms` : `✗ ${testResult.error ?? "error"}`}
                  </span>
                )}
              </div>

              {expanded && (
                <div
                  style={{
                    marginTop: 14,
                    paddingTop: 14,
                    borderTop: "1px solid var(--workspace-border)",
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "flex-end" }}>
                    <button type="button" title={buildHelpTooltip(p)} aria-label={t("settings.chatProviders.helpAria")} style={helpButtonStyle()}>
                      ?
                    </button>
                  </div>

                  {isOpenAiCompatible(p.provider_id) ? (
                    <label style={{ display: "block", margin: 0 }}>
                      <span style={{ fontSize: 11, color: "var(--workspace-text-muted)", display: "block", marginBottom: 4 }}>
                        {t("settings.chatProviders.baseUrl")}
                      </span>
                      <input
                        type="text"
                        autoComplete="off"
                        spellCheck={false}
                        placeholder={p.default_base_url ?? "https://api.openai.com/v1"}
                        value={d.baseUrl}
                        onChange={(e) =>
                          setDrafts((prev) => ({
                            ...prev,
                            [p.provider_id]: {
                              baseUrl: e.target.value,
                              model: prev[p.provider_id]?.model ?? p.model,
                              visionModel: prev[p.provider_id]?.visionModel ?? p.vision_model ?? "",
                            },
                          }))
                        }
                        onKeyDown={onEnterSave}
                        style={inputStyle()}
                      />
                    </label>
                  ) : null}

                  <label style={{ display: "block", margin: 0 }}>
                    <span style={{ fontSize: 11, color: "var(--workspace-text-muted)", display: "block", marginBottom: 4 }}>
                      {t("settings.chatProviders.model")}
                    </span>
                    <input
                      type="text"
                      autoComplete="off"
                      spellCheck={false}
                      placeholder={p.default_model}
                      value={d.model}
                      onChange={(e) =>
                        setDrafts((prev) => ({
                          ...prev,
                          [p.provider_id]: {
                            baseUrl: prev[p.provider_id]?.baseUrl ?? p.base_url ?? "",
                            model: e.target.value,
                            visionModel: prev[p.provider_id]?.visionModel ?? p.vision_model ?? "",
                          },
                        }))
                      }
                      onKeyDown={onEnterSave}
                      style={inputStyle()}
                    />
                  </label>

                  {p.provider_id === "ollama" ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                        <span style={{ fontSize: 11, color: "var(--workspace-text-muted)" }}>
                          {t("settings.chatProviders.ollamaVisionModel", "Vision model (images in chat)")}
                        </span>
                        <button
                          type="button"
                          disabled={ollamaVisionLoading}
                          onClick={() => void handleRefreshOllamaVision(p)}
                          style={{
                            background: "var(--workspace-panel-muted)",
                            border: "1px solid var(--workspace-border)",
                            borderRadius: 6,
                            color: "var(--workspace-text-soft)",
                            fontSize: 11,
                            padding: "4px 10px",
                            cursor: ollamaVisionLoading ? "default" : "pointer",
                          }}
                        >
                          {ollamaVisionLoading
                            ? t("settings.chatProviders.ollamaVisionLoading", "Loading…")
                            : t("settings.chatProviders.ollamaVisionRefresh", "Refresh from Ollama")}
                        </button>
                      </div>
                      <p style={{ fontSize: 10, color: "var(--workspace-text-muted)", margin: 0, lineHeight: 1.45 }}>
                        {t(
                          "settings.chatProviders.ollamaVisionHint",
                          "Lists models already on your machine (GET /api/tags + vision check). To install a model, run ollama pull <name> in a terminal — chat does not download models automatically.",
                        )}
                      </p>
                      {ollamaVisionList.length > 0 ? (
                        <select
                          value={d.visionModel}
                          onChange={(e) =>
                            setDrafts((prev) => ({
                              ...prev,
                              [p.provider_id]: {
                                baseUrl: prev[p.provider_id]?.baseUrl ?? p.base_url ?? "",
                                model: prev[p.provider_id]?.model ?? p.model,
                                visionModel: e.target.value,
                              },
                            }))
                          }
                          style={{ ...inputStyle(), maxWidth: "100%" }}
                        >
                          <option value="">
                            {t("settings.chatProviders.ollamaVisionNone", "Same as main model (default)")}
                          </option>
                          {d.visionModel.trim() &&
                          !ollamaVisionList.includes(d.visionModel.trim()) ? (
                            <option value={d.visionModel.trim()}>{d.visionModel.trim()}</option>
                          ) : null}
                          {ollamaVisionList.map((name) => (
                            <option key={name} value={name}>
                              {name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          autoComplete="off"
                          spellCheck={false}
                          placeholder={t(
                            "settings.chatProviders.ollamaVisionManual",
                            "Or type a model tag (e.g. llama3.2-vision)",
                          )}
                          value={d.visionModel}
                          onChange={(e) =>
                            setDrafts((prev) => ({
                              ...prev,
                              [p.provider_id]: {
                                baseUrl: prev[p.provider_id]?.baseUrl ?? p.base_url ?? "",
                                model: prev[p.provider_id]?.model ?? p.model,
                                visionModel: e.target.value,
                              },
                            }))
                          }
                          onKeyDown={onEnterSave}
                          style={inputStyle()}
                        />
                      )}
                    </div>
                  ) : null}

                  {needsKey ? (
                    <label style={{ display: "block", margin: 0 }}>
                      <span style={{ fontSize: 11, color: "var(--workspace-text-muted)", display: "block", marginBottom: 4 }}>
                        {t("settings.chatProviders.apiKeyLabel")}
                      </span>
                      <span style={{ fontSize: 10, color: "var(--workspace-text-muted)", display: "block", marginBottom: 6 }}>
                        {p.key_status === "saved"
                          ? t("settings.chatProviders.keySavedLabel")
                          : p.key_status === "unavailable"
                            ? t("settings.chatProviders.keyUnavailable")
                            : t("settings.chatProviders.noKeySet")}
                      </span>
                      <input
                        type="password"
                        autoComplete="off"
                        placeholder={keyPlaceholder}
                        value={keyDraft}
                        onChange={(e) => setApiKeys((prev) => ({ ...prev, [p.provider_id]: e.target.value }))}
                        onKeyDown={onEnterSave}
                        style={{ ...inputStyle(), minWidth: 0 }}
                        aria-label={t("settings.chatProviders.apiKeyLabel")}
                      />
                    </label>
                  ) : null}

                  <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
                    <button
                      type="button"
                      disabled={!saveEnabled}
                      onClick={() => void handleSaveAll(p)}
                      style={unifiedSaveButtonStyle(saveEnabled)}
                    >
                      {saving[p.provider_id] ? t("settings.chatProviders.saving") : t("common.save")}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
