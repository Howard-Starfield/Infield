import { invoke as tauriCoreInvoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type {
  AppWindow,
  EbayAuthMutationResult,
  OAuthCallbackListenerStatus,
  OAuthCallbackResult,
  OAuthStartResult,
  PendingOAuthSessionView,
  PreparedTokenExchangeView,
  TauriInvoke,
  VaultData,
  VaultEnvelope,
  VaultSessionResult,
  UiPreferences
} from "./types";

interface NativeVaultResponse {
  vaultJson: string;
  envelopeJson: string;
}

interface NativeEbayAuthMutationResponse extends NativeVaultResponse {
  userMessage: string;
  requiresReauth: boolean;
}

declare global {
  interface Window {
    __TAURI_INTERNALS__?: {
      invoke: TauriInvoke;
    };
    __TAURI__?: {
      core?: {
        invoke?: TauriInvoke;
      };
      window?: {
        getCurrentWindow?: () => AppWindow;
      };
    };
  }
}

function canUseTauriInternalsInvoke(): boolean {
  return typeof window !== "undefined" && typeof window.__TAURI_INTERNALS__?.invoke === "function";
}

function getLegacyGlobalInvoke(): TauriInvoke | null {
  const fn = window.__TAURI__?.core?.invoke;
  return typeof fn === "function" ? fn : null;
}

async function ipcInvoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  if (canUseTauriInternalsInvoke()) {
    return tauriCoreInvoke<T>(command, args);
  }
  const legacy = getLegacyGlobalInvoke();
  if (legacy) {
    return legacy<T>(command, args);
  }
  throw new Error("Native IPC unavailable.");
}

/**
 * True when the page can reach the Tauri command layer (disk vault, OAuth, etc.).
 * Prefer `__TAURI_INTERNALS__.invoke` (matches `@tauri-apps/api`) so Windows dev does not
 * fall through to browser fallback while `window.__TAURI__.core` is still unset.
 */
export function hasNativeVault(): boolean {
  return canUseTauriInternalsInvoke() || Boolean(getLegacyGlobalInvoke());
}

/**
 * Wait until after `load` and briefly poll for late IPC injection (Windows / dev webview).
 * Plain browser sessions resolve quickly when IPC never appears.
 */
export async function waitForNativeIpcReady(): Promise<void> {
  if (hasNativeVault()) {
    return;
  }

  await new Promise<void>((resolve) => {
    if (document.readyState === "complete") {
      queueMicrotask(resolve);
    } else {
      window.addEventListener("load", () => resolve(), { once: true });
    }
  });

  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

  const maxTicks = 120;
  const delayMs = 25;
  for (let i = 0; i < maxTicks && !hasNativeVault(); i++) {
    await new Promise((r) => setTimeout(r, delayMs));
  }
}

export function getTauriWindow(): AppWindow | null {
  if (typeof window === "undefined") {
    return null;
  }

  if (canUseTauriInternalsInvoke()) {
    try {
      return getCurrentWindow() as unknown as AppWindow;
    } catch {
      // fall through to legacy global
    }
  }

  return window.__TAURI__?.window?.getCurrentWindow?.() ?? null;
}

/** IPC may return JSON envelope as a string or already-parsed object; avoid JSON.parse(object) which throws. */
function parseEnvelopeIpcPayload(raw: unknown): VaultEnvelope | null {
  if (raw == null) {
    return null;
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) {
      return null;
    }
    return JSON.parse(trimmed) as VaultEnvelope;
  }
  if (typeof raw === "object") {
    return raw as VaultEnvelope;
  }
  return null;
}

function parseVaultResponse(response: NativeVaultResponse): VaultSessionResult {
  return {
    key: "native-session",
    vault: JSON.parse(response.vaultJson),
    envelope: JSON.parse(response.envelopeJson)
  };
}

function parseEbayAuthMutationResponse(response: NativeEbayAuthMutationResponse): EbayAuthMutationResult {
  return {
    vault: JSON.parse(response.vaultJson),
    envelope: JSON.parse(response.envelopeJson),
    userMessage: response.userMessage,
    requiresReauth: response.requiresReauth
  };
}

export async function createVaultNative(password: string, workspaceLabel: string): Promise<VaultSessionResult | null> {
  if (!hasNativeVault()) {
    return null;
  }

  const response = await ipcInvoke<NativeVaultResponse>("create_vault", {
    password,
    workspaceLabel
  });
  return parseVaultResponse(response);
}

export async function unlockVaultNative(password: string): Promise<VaultSessionResult | null> {
  if (!hasNativeVault()) {
    return null;
  }

  const response = await ipcInvoke<NativeVaultResponse>("unlock_vault", { password });
  return parseVaultResponse(response);
}

export async function getUnlockedVaultNative(): Promise<VaultSessionResult | null> {
  if (!hasNativeVault()) {
    return null;
  }

  const response = await ipcInvoke<NativeVaultResponse>("get_unlocked_vault");
  return parseVaultResponse(response);
}

export async function saveVaultNative(vault: VaultData): Promise<VaultEnvelope | null> {
  if (!hasNativeVault()) {
    return null;
  }

  const envelopeJson = await ipcInvoke<unknown>("save_vault", {
    vaultJson: JSON.stringify(vault)
  });
  const parsed = parseEnvelopeIpcPayload(envelopeJson);
  if (!parsed) {
    throw new Error("save_vault returned an empty envelope payload.");
  }
  return parsed;
}

export async function clearVaultSessionNative(): Promise<void> {
  if (!hasNativeVault()) {
    return;
  }

  await ipcInvoke("clear_vault_session");
}

export async function changeVaultPasswordNative(
  currentPassword: string,
  newPassword: string,
  vault: VaultData
): Promise<VaultSessionResult | null> {
  if (!hasNativeVault()) {
    return null;
  }

  const response = await ipcInvoke<NativeVaultResponse>("change_vault_password", {
    currentPassword,
    newPassword,
    vaultJson: JSON.stringify(vault)
  });
  return parseVaultResponse(response);
}

export async function loadVaultEnvelopeNative(): Promise<VaultEnvelope | null> {
  if (!hasNativeVault()) {
    return null;
  }

  const raw = await ipcInvoke<unknown>("load_vault_envelope");
  return parseEnvelopeIpcPayload(raw);
}

/** Tauri app vault directory (contains `vault-envelope.json`). Null in browser-only mode. */
export async function getVaultLocationNative(): Promise<string | null> {
  if (!hasNativeVault()) {
    return null;
  }

  return ipcInvoke<string>("get_vault_location");
}

export async function saveVaultEnvelopeNative(envelope: VaultEnvelope): Promise<void> {
  if (!hasNativeVault()) {
    return;
  }

  await ipcInvoke("save_vault_envelope", {
    envelopeJson: JSON.stringify(envelope)
  });
}

export async function openExternalUrlNative(url: string): Promise<boolean> {
  if (!hasNativeVault()) {
    return false;
  }

  await ipcInvoke("open_external_url", { url });
  return true;
}

export async function saveEbayOAuthAppSettingsNative(
  clientId: string,
  clientSecret: string,
  ruName: string,
  callbackPort?: number,
  authEndpoint?: string,
  tokenEndpoint?: string,
  oauthCallbackTransport?: string | null,
  httpsBridgePublicUrl?: string | null,
  oauthScope?: string | null
): Promise<VaultSessionResult | null> {
  if (!hasNativeVault()) {
    return null;
  }

  const response = await ipcInvoke<NativeVaultResponse>("save_ebay_oauth_app_settings", {
    clientId,
    clientSecret,
    ruName,
    callbackPort: callbackPort ?? null,
    authEndpoint: authEndpoint ?? null,
    tokenEndpoint: tokenEndpoint ?? null,
    oauthCallbackTransport: oauthCallbackTransport ?? null,
    httpsBridgePublicUrl: httpsBridgePublicUrl ?? null,
    oauthScope: oauthScope ?? null
  });
  return parseVaultResponse(response);
}

export async function beginEbayOAuthNative(accountLabel?: string): Promise<OAuthStartResult | null> {
  if (!hasNativeVault()) {
    return null;
  }

  return ipcInvoke<OAuthStartResult>("begin_ebay_oauth", {
    accountLabel: accountLabel ?? null
  });
}

export async function getPendingEbayOAuthNative(): Promise<PendingOAuthSessionView | null> {
  if (!hasNativeVault()) {
    return null;
  }

  return ipcInvoke<PendingOAuthSessionView | null>("get_pending_ebay_oauth");
}

export async function clearPendingEbayOAuthNative(): Promise<void> {
  if (!hasNativeVault()) {
    return;
  }

  await ipcInvoke("clear_pending_ebay_oauth");
}

export async function cancelEbayOAuthNative(): Promise<void> {
  if (!hasNativeVault()) {
    return;
  }

  await ipcInvoke("cancel_ebay_oauth");
}

export async function getPreparedEbayTokenExchangeNative(): Promise<PreparedTokenExchangeView | null> {
  if (!hasNativeVault()) {
    return null;
  }

  return ipcInvoke<PreparedTokenExchangeView | null>("get_prepared_ebay_token_exchange");
}

export async function startEbayOAuthCallbackListenerNative(): Promise<OAuthCallbackListenerStatus | null> {
  if (!hasNativeVault()) {
    return null;
  }

  return ipcInvoke<OAuthCallbackListenerStatus>("start_ebay_oauth_callback_listener");
}

export async function getEbayOAuthCallbackListenerStatusNative(): Promise<OAuthCallbackListenerStatus | null> {
  if (!hasNativeVault()) {
    return null;
  }

  return ipcInvoke<OAuthCallbackListenerStatus>("get_ebay_oauth_callback_listener_status");
}

export async function getLatestEbayOAuthCallbackResultNative(): Promise<OAuthCallbackResult | null> {
  if (!hasNativeVault()) {
    return null;
  }

  return ipcInvoke<OAuthCallbackResult | null>("get_latest_ebay_oauth_callback_result");
}

export async function completeEbayOAuthCallbackNative(payload: {
  state: string;
  code?: string | null;
  error?: string | null;
  errorDescription?: string | null;
}): Promise<OAuthCallbackResult | null> {
  if (!hasNativeVault()) {
    return null;
  }

  return ipcInvoke<OAuthCallbackResult>("complete_ebay_oauth_callback", {
    state: payload.state,
    code: payload.code ?? null,
    error: payload.error ?? null,
    errorDescription: payload.errorDescription ?? null
  });
}

export async function exchangeEbayAuthCodeNative(vault: VaultData): Promise<EbayAuthMutationResult | null> {
  if (!hasNativeVault()) {
    return null;
  }

  const response = await ipcInvoke<NativeEbayAuthMutationResponse>("exchange_ebay_auth_code", {
    vaultJson: JSON.stringify(vault)
  });
  return parseEbayAuthMutationResponse(response);
}

export async function refreshEbayAccessTokenNative(
  vault: VaultData,
  accountId: string
): Promise<EbayAuthMutationResult | null> {
  if (!hasNativeVault()) {
    return null;
  }

  const response = await ipcInvoke<NativeEbayAuthMutationResponse>("refresh_ebay_access_token", {
    vaultJson: JSON.stringify(vault),
    accountId
  });
  return parseEbayAuthMutationResponse(response);
}

export async function importEbayConversationIndexNative(
  vault: VaultData,
  accountId: string
): Promise<EbayAuthMutationResult | null> {
  if (!hasNativeVault()) {
    return null;
  }

  const response = await ipcInvoke<NativeEbayAuthMutationResponse>("import_ebay_conversation_index", {
    vaultJson: JSON.stringify(vault),
    accountId
  });
  return parseEbayAuthMutationResponse(response);
}

export async function importEbayConversationThreadNative(
  vault: VaultData,
  accountId: string,
  conversationId: string
): Promise<EbayAuthMutationResult | null> {
  if (!hasNativeVault()) {
    return null;
  }

  const response = await ipcInvoke<NativeEbayAuthMutationResponse>("import_ebay_conversation_thread", {
    vaultJson: JSON.stringify(vault),
    accountId,
    conversationId
  });
  return parseEbayAuthMutationResponse(response);
}

// ── Storage / JSON directory ─────────────────────────────────────

export async function selectStorageDirectoryNative(): Promise<string | null> {
  if (!hasNativeVault()) return null;
  return ipcInvoke<string | null>("select_storage_directory");
}

export async function getStorageConfigNative(): Promise<string | null> {
  if (!hasNativeVault()) return null;
  return ipcInvoke<string | null>("get_storage_config");
}

export async function saveStorageConfigNative(rootPath: string): Promise<void> {
  if (!hasNativeVault()) return;
  await ipcInvoke("save_storage_config", { rootPath });
}

export async function readMdFileNative(path: string): Promise<string> {
  if (!hasNativeVault()) throw new Error("Native unavailable");
  return ipcInvoke<string>("read_md_file", { path });
}

export async function writeMdFileNative(
  dir: string,
  filename: string,
  content: string,
  scope: string,
  accountId?: string
): Promise<void> {
  if (!hasNativeVault()) return;
  await ipcInvoke("write_md_file", { dir, filename, content, scope, accountId: accountId ?? null });
}

export async function listMdFilesNative(dir: string): Promise<string[]> {
  if (!hasNativeVault()) return [];
  return ipcInvoke<string[]>("list_md_files", { dir });
}

// ── LLM ─────────────────────────────────────────────────────────

export interface LlmConfig {
  provider: string;
  baseUrl: string;
  apiKey?: string;
  openai_api_key?: string;
  openai_api_url?: string;
  anthropic_api_key?: string;
  anthropic_api_url?: string;
  model: string;
  customerId?: string;
  enabledFeatures: { summarize: boolean; replySuggest: boolean; buyerProfile: boolean };
  localOnly: boolean;
  prompts: { summarize: string; reply: string; buyerProfile: string };
}

export interface LlmTestResult {
  success: boolean;
  model: string;
  latencyMs: number;
  error?: string;
  sampleOutput?: string;
}

export interface LlmResponse {
  content: string;
  model: string;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  latencyMs: number;
}

export interface ChatMessage { role: string; content: string; }

export interface BuyerContext {
  buyerName: string;
  feedbackScore: number;
  orderCount: number;
  itemsPurchased: string[];
  feedbackHistory: string[];
  commonQuestions: string[];
  shippingPreference: string;
  recommendedApproach: string;
}

export async function getLlmConfigNative(): Promise<LlmConfig | null> {
  if (!hasNativeVault()) return null;
  return ipcInvoke<LlmConfig | null>("get_llm_config");
}

export async function saveLlmConfigNative(config: LlmConfig): Promise<void> {
  if (!hasNativeVault()) return;
  await ipcInvoke("save_llm_config", { config });
}

export async function testLlmConnectionNative(config: LlmConfig): Promise<LlmTestResult> {
  if (!hasNativeVault()) throw new Error("Native unavailable");
  return ipcInvoke<LlmTestResult>("test_llm_connection", { config });
}

export async function llmChatNative(
  promptType: string,
  conversationHistory: ChatMessage[],
  buyerContext: BuyerContext | null,
  extraVars: Record<string, string>
): Promise<LlmResponse> {
  if (!hasNativeVault()) throw new Error("Native unavailable");
  return ipcInvoke<LlmResponse>("llm_chat", {
    promptType,
    conversationHistory,
    buyerContext: buyerContext ?? null,
    extraVars
  });
}

export async function llmChatWithProviderNative(
  provider: string,
  baseUrl: string,
  apiKey: string | undefined,
  model: string,
  messages: ChatMessage[]
): Promise<LlmResponse> {
  if (!hasNativeVault()) throw new Error("Native unavailable");
  return ipcInvoke<LlmResponse>("llm_chat_with_provider", {
    provider,
    baseUrl,
    apiKey: apiKey ?? null,
    model,
    messages
  });
}

// ── eBay scope commands ────────────────────────────────────────

export async function fetchEbayOrdersNative(
  vault: VaultData,
  accountId: string,
  page?: number,
  since?: string
): Promise<string> {
  if (!hasNativeVault()) throw new Error("Native unavailable");
  return ipcInvoke<string>("fetch_ebay_orders", {
    vaultJson: JSON.stringify(vault),
    accountId,
    page: page ?? null,
    since: since ?? null
  });
}

export async function getEbayOrderNative(
  vault: VaultData,
  accountId: string,
  orderId: string
): Promise<string> {
  if (!hasNativeVault()) throw new Error("Native unavailable");
  return ipcInvoke<string>("get_ebay_order", {
    vaultJson: JSON.stringify(vault),
    accountId,
    orderId
  });
}

export async function fetchEbayListingsNative(
  vault: VaultData,
  accountId: string
): Promise<string> {
  if (!hasNativeVault()) throw new Error("Native unavailable");
  return ipcInvoke<string>("fetch_ebay_listings", {
    vaultJson: JSON.stringify(vault),
    accountId
  });
}

export async function getEbayAnalyticsNative(
  vault: VaultData,
  accountId: string,
  from?: string,
  to?: string
): Promise<string> {
  if (!hasNativeVault()) throw new Error("Native unavailable");
  return ipcInvoke<string>("get_ebay_analytics", {
    vaultJson: JSON.stringify(vault),
    accountId,
    from: from ?? null,
    to: to ?? null
  });
}

export async function getEbayPaymentsNative(
  vault: VaultData,
  accountId: string
): Promise<string> {
  if (!hasNativeVault()) throw new Error("Native unavailable");
  return ipcInvoke<string>("get_ebay_payments", {
    vaultJson: JSON.stringify(vault),
    accountId
  });
}

export async function getEbayDisputesNative(
  vault: VaultData,
  accountId: string
): Promise<string> {
  if (!hasNativeVault()) throw new Error("Native unavailable");
  return ipcInvoke<string>("get_ebay_disputes", {
    vaultJson: JSON.stringify(vault),
    accountId
  });
}

export async function getEbayFeedbackNative(
  vault: VaultData,
  accountId: string
): Promise<string> {
  if (!hasNativeVault()) throw new Error("Native unavailable");
  return ipcInvoke<string>("get_ebay_feedback", {
    vaultJson: JSON.stringify(vault),
    accountId
  });
}

export async function getEbayAdCampaignsNative(
  vault: VaultData,
  accountId: string
): Promise<string> {
  if (!hasNativeVault()) throw new Error("Native unavailable");
  return ipcInvoke<string>("get_ebay_ad_campaigns", {
    vaultJson: JSON.stringify(vault),
    accountId
  });
}

export async function getEbayStoreNative(
  vault: VaultData,
  accountId: string
): Promise<string> {
  if (!hasNativeVault()) throw new Error("Native unavailable");
  return ipcInvoke<string>("get_ebay_store", {
    vaultJson: JSON.stringify(vault),
    accountId
  });
}

export async function getEbayUserInfoNative(
  vault: VaultData,
  accountId: string
): Promise<string> {
  if (!hasNativeVault()) throw new Error("Native unavailable");
  return ipcInvoke<string>("get_ebay_user_info", {
    vaultJson: JSON.stringify(vault),
    accountId
  });
}

export async function markOrderDeliveredNative(
  vault: VaultData,
  accountId: string,
  orderId: string,
  tracking: string
): Promise<string> {
  if (!hasNativeVault()) throw new Error("Native unavailable");
  return ipcInvoke<string>("mark_order_delivered", {
    vaultJson: JSON.stringify(vault),
    accountId,
    orderId,
    tracking
  });
}

export async function initiateEbayRefundNative(
  vault: VaultData,
  accountId: string,
  orderId: string,
  amount: number,
  reason: string
): Promise<string> {
  if (!hasNativeVault()) throw new Error("Native unavailable");
  return ipcInvoke<string>("initiate_ebay_refund", {
    vaultJson: JSON.stringify(vault),
    accountId,
    orderId,
    amount,
    reason
  });
}

export async function sendEbayMessageNative(
  vault: VaultData,
  accountId: string,
  conversationId: string,
  messageBody: string
): Promise<string> {
  if (!hasNativeVault()) throw new Error("Native unavailable");
  return ipcInvoke<string>("send_ebay_message", {
    vaultJson: JSON.stringify(vault),
    accountId,
    conversationId,
    messageBody
  });
}

export async function syncAllEbayDataNative(
  vault: VaultData,
  accountId: string
): Promise<string> {
  if (!hasNativeVault()) throw new Error("Native unavailable");
  return ipcInvoke<string>("sync_all_ebay_data", {
    vaultJson: JSON.stringify(vault),
    accountId
  });
}

export async function queueEbayActionNative(
  vault: VaultData,
  accountId: string,
  actionType: string,
  payload: any
): Promise<EbayAuthMutationResult | null> {
  if (!hasNativeVault()) return null;
  const response = await ipcInvoke<NativeEbayAuthMutationResponse>("queue_ebay_action", {
    vaultJson: JSON.stringify(vault),
    accountId,
    actionType,
    payload
  });
  return parseEbayAuthMutationResponse(response);
}

export async function storeEbayMediaNative(
  vault: VaultData,
  accountId: string,
  conversationId: string,
  fileName: string,
  mimeType: string,
  data: string,
  thumbnail?: string
): Promise<EbayAuthMutationResult | null> {
  if (!hasNativeVault()) return null;
  const response = await ipcInvoke<NativeEbayAuthMutationResponse>("store_ebay_media", {
    vaultJson: JSON.stringify(vault),
    accountId,
    conversationId,
    fileName,
    mimeType,
    data,
    thumbnail
  });
  return parseEbayAuthMutationResponse(response);
}

export async function storeEbayEvidenceNative(
  vault: VaultData,
  accountId: string,
  orderId: string | null,
  fileName: string,
  mimeType: string,
  data: string,
  notes?: string
): Promise<EbayAuthMutationResult | null> {
  if (!hasNativeVault()) return null;
  const response = await ipcInvoke<NativeEbayAuthMutationResponse>("store_ebay_evidence", {
    vaultJson: JSON.stringify(vault),
    accountId,
    orderId,
    fileName,
    mimeType,
    data,
    notes
  });
  return parseEbayAuthMutationResponse(response);
}

export async function updateUiPreferencesNative(
  vault: VaultData,
  preferences: UiPreferences
): Promise<EbayAuthMutationResult | null> {
  if (!hasNativeVault()) return null;
  const response = await ipcInvoke<NativeEbayAuthMutationResponse>("update_ui_preferences", {
    vaultJson: JSON.stringify(vault),
    preferencesJson: JSON.stringify(preferences)
  });
  return parseEbayAuthMutationResponse(response);
}




