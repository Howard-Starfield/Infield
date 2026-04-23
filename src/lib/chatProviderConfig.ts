import type { ChatProviderConfig, ProviderStatus } from "@/bindings";

/**
 * Build the payload for `setChatProvider` from a row returned by `getChatProviders`.
 * Uses persisted `model` / `base_url` from the server (no draft overrides).
 */
export function chatProviderConfigFromStatus(p: ProviderStatus): ChatProviderConfig {
  const isAnthropic = p.provider_id === "anthropic";
  let base_url: string | null = null;
  if (!isAnthropic) {
    const bu = (p.base_url ?? "").trim() || (p.default_base_url ?? "").trim();
    base_url = bu || "http://localhost:11434/v1";
  }
  const model = (p.model ?? "").trim() || p.default_model;
  const vision_model =
    p.provider_id === "ollama"
      ? (p.vision_model ?? "").trim() || null
      : null;
  return {
    provider_id: p.provider_id,
    provider_type: isAnthropic ? "anthropic" : "openai_compatible",
    base_url,
    model,
    vision_model,
  };
}
