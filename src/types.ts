export type PageName = "dashboard" | "inbox" | "capture" | "security" | "activity" | "search" | "import" | "audio" | "notes" | "databases";

export type SessionKey = CryptoKey | "native-session";

export interface CipherData {
  data: string;
  nonce?: string;
  iv?: string;
}

export interface VaultKdfConfig {
  algorithm: string;
  salt: string;
  iterations?: number;
  hash?: string;
  memory_kib?: number;
  parallelism?: number;
}

export interface VaultEnvelope {
  version: number;
  kdf: VaultKdfConfig | null;
  cipher: CipherData;
  mfaEnabled?: boolean;
}

export interface MfaState {
  enabled: boolean;
  secret: string | null;
  enabledAt: string | null;
}

export interface VaultRecord {
  id: string;
  channel: string;
  title: string;
  amount: number;
  notes: string;
  createdAt: string;
}

export interface AuditRecord {
  id: string;
  action: string;
  detail: string;
  at: string;
}

export interface EbayAccountRecord {
  accountId: string;
  accountLabel: string | null;
  scope: string;
  authStatus: "connected" | "reauth_required" | "error";
  accessTokenExpiresAt: string | null;
  refreshTokenExpiresAt: string | null;
  lastError: string | null;
  connectedAt: string | null;
  updatedAt: string;
}

export interface EbayMessageMediaRecord {
  mediaName: string | null;
  mediaType: string | null;
  mediaUrl: string | null;
}

export interface EbayConversationRecord {
  accountId: string;
  conversationId: string;
  conversationType: string;
  conversationStatus: string;
  conversationTitle: string | null;
  createdDate: string;
  latestMessageId: string | null;
  latestMessageAt: string | null;
  latestMessagePreview: string | null;
  latestSenderUsername: string | null;
  latestRecipientUsername: string | null;
  unreadCount: number;
  referenceId: string | null;
  referenceType: string | null;
  messageCount: number;
  updatedAt: string;
}

export interface EbayMessageRecord {
  accountId: string;
  conversationId: string;
  messageId: string;
  createdDate: string;
  messageBody: string;
  readStatus: boolean;
  recipientUsername: string | null;
  senderUsername: string | null;
  subject: string | null;
  media: EbayMessageMediaRecord[];
}

export interface EbaySyncStateRecord {
  accountId: string;
  conversationType: string;
  lastConversationOffset: number;
  lastConversationLimit: number;
  lastConversationNextOffset: number;
  lastConversationHasMorePages: boolean;
  lastConversationPageFetchedAt: string | null;
  lastConversationIdImported: string | null;
  lastThreadSyncConversationId: string | null;
  lastThreadOffset: number;
  lastThreadLimit: number;
  lastThreadNextOffset: number;
  lastThreadHasMorePages: boolean;
  lastThreadFetchedAt: string | null;
  lastImportedConversationCount: number;
  lastImportedMessageCount: number;
  lastError: string | null;
}

export type EbayActionPayload = 
  | { type: "send_message"; conversationId: string; messageBody: string }
  | { type: "mark_read"; conversationId: string; messageId: string }
  | { type: "archive"; conversationId: string };

export interface EbayActionQueueRecord {
  id: string;
  accountId: string;
  actionType: "send_message" | "mark_read" | "archive";
  payload: EbayActionPayload;
  status: "pending" | "failed" | "processing";
  attempts: number;
  lastError: string | null;
  createdAt: string;
}

export interface EbayAppRateLimitState {
  dailyLimit: number;
  usedCalls: number;
  remainingCalls: number;
  windowStartAt: string;
  windowEndsAt: string;
  updatedAt: string;
}

/** eBay developer app OAuth credentials; stored only inside the encrypted vault (desktop). */
export type EbayOAuthCallbackTransport = "loopback" | "https_bridge";

export interface EbayOAuthAppSettings {
  clientId: string;
  clientSecret: string;
  ruName: string;
  authEndpoint?: string;
  tokenEndpoint?: string;
  callbackHost?: string;
  callbackPort?: number;
  callbackPath?: string;
  /** Default loopback: local TCP listener. `https_bridge`: browser hits public HTTPS, then custom URL scheme. */
  oauthCallbackTransport?: EbayOAuthCallbackTransport;
  /** Required when `oauthCallbackTransport` is `https_bridge` (eBay Auth Accepted URL). */
  httpsBridgePublicUrl?: string;
  /** Optional consent `scope` override (space-separated). Default: Message API scope from V5. */
  oauthScope?: string;
}

export interface VaultData {
  version: number;
  workspaceLabel: string;
  createdAt: string;
  updatedAt: string;
  mfa: MfaState;
  listings: VaultRecord[];
  orders: VaultRecord[];
  evidence: VaultRecord[];
  /** App-level OAuth client; optional — `EBAY_*` env vars are the fallback when absent or incomplete. */
  ebayOAuthApp?: EbayOAuthAppSettings;
  ebayAccounts?: EbayAccountRecord[];
  ebayConversations?: EbayConversationRecord[];
  ebayMessages?: EbayMessageRecord[];
  ebayAppRateLimit?: EbayAppRateLimitState;
  ebayActionQueue?: EbayActionQueueRecord[];
  ebayMedia?: EbayMediaRecord[];
  ebayEvidence?: EbayEvidenceRecord[];
  ebaySyncStates?: EbaySyncStateRecord[];
  uiPreferences?: UiPreferences;
  audits: AuditRecord[];
}

export interface UiPreferences {
  animationIntensity: "none" | "low" | "high";
  confettiEnabled: boolean;
  confettiThreshold: number; // Order value to trigger celebration
  toastPosition: "top-right" | "bottom-right" | "top-center" | "bottom-center";
  soundEnabled: boolean;
  themeMode: "auto" | "light" | "dark";
  autoSyncEnabled: boolean;
  syncInterval: number; // in minutes
  themeColor?: string; // Hex color for brand identity
  spotlightTrigger?: string; // e.g. "Space" or "KeyF"
  bgSpeed?: number; // 0-100 scale for animation speed
  bgColorA?: string;
  bgColorB?: string;
  bgColorC?: string;
  /**
   * Global UI density multiplier. Drives both `#root { zoom: var(--app-zoom) }`
   * (catches inline px literals authored verbatim from copy/) and
   * `--ui-scale` (the existing token-system multiplier). Range 0.5–1.5,
   * default 1.0. Hydrated from localStorage at boot via main.tsx, kept
   * in sync via VaultContext.
   */
  uiScale?: number;
}

export interface EbayMediaRecord {
  id: string;
  accountId: string;
  conversationId: string;
  fileName: string;
  mimeType: string;
  data: string; // Base64 encoded encrypted data
  thumbnail?: string; // Base64 encoded thumbnail
  createdAt: string;
}

export interface EbayEvidenceRecord {
  id: string;
  accountId: string;
  orderId?: string;
  fileName: string;
  mimeType: string;
  data: string; // Base64 encoded encrypted data
  notes?: string;
  createdAt: string;
}

export interface RecordDraft {
  type: "listing" | "order" | "evidence";
  channel: string;
  title: string;
  amount: FormDataEntryValue | null;
  notes: string;
}

export interface VaultSessionResult {
  key: SessionKey;
  vault: VaultData;
  envelope: VaultEnvelope;
}

export interface OAuthStartResult {
  attemptId: string;
  accountId: string;
  accountLabel: string | null;
  consentUrl: string;
  state: string;
  redirectUri: string;
  scope: string;
  expiresAt: string;
}

export interface PendingOAuthSessionView {
  attemptId: string;
  accountId: string;
  accountLabel: string | null;
  redirectUri: string;
  scope: string;
  createdAt: string;
  expiresAt: string;
}

export interface TokenExchangePreview {
  tokenEndpoint: string;
  grantType: string;
  redirectUri: string;
  scope: string;
  clientId: string;
  hasClientSecret: boolean;
}

export interface OAuthCallbackResult {
  status: "ready_for_token_exchange" | "authorization_denied" | "listener_error";
  accountId: string;
  accountLabel: string | null;
  userMessage: string;
  tokenExchangePreview: TokenExchangePreview | null;
}

export interface PreparedTokenExchangeView {
  accountId: string;
  accountLabel: string | null;
  authorizationCodePresent: boolean;
  tokenExchangePreview: TokenExchangePreview;
}

export interface OAuthCallbackListenerStatus {
  active: boolean;
  callbackUrl: string;
}

export interface EbayAuthMutationResult {
  vault: VaultData;
  envelope: VaultEnvelope;
  userMessage: string;
  requiresReauth: boolean;
}

export interface PersistedVaultResult {
  vault: VaultData;
  envelope: VaultEnvelope;
}

export interface AppState {
  envelope: VaultEnvelope | null;
  vault: VaultData | null;
  key: SessionKey | null;
  pendingMfaSecret: string | null;
  autoLockHandle: number | null;
  oauthPollHandle: number | null;
  currentPage: PageName;
  oauthStartResult: OAuthStartResult | null;
  pendingOAuthSession: PendingOAuthSessionView | null;
  preparedTokenExchange: PreparedTokenExchangeView | null;
  oauthCallbackResult: OAuthCallbackResult | null;
  oauthListenerStatus: OAuthCallbackListenerStatus | null;
  selectedInboxAccountId: string | null;
  selectedInboxConversationId: string | null;
  /** Inbox left rail: filter cached conversation list (client-side only). */
  inboxFolderFilter: "all" | "unread";
  /** Inbox center column: substring filter on title, preview, sender, reference (client-side only). */
  inboxSearchQuery: string;
  /** Tauri: cached `get_vault_location` result for Security page (avoid repeat invoke). */
  cachedNativeVaultDirectory: string | null;
  /** Tauri: if true, stop retrying vault path until session reset. */
  nativeVaultDirectoryLookupFailed: boolean;
  /** LLM config loaded from vault for AI features. */
  llmConfig: import("./tauri-bridge").LlmConfig | null;
}

export interface AppWindow {
  startDragging?: () => Promise<void>;
  minimize?: () => Promise<void>;
  toggleMaximize?: () => Promise<void>;
  isMaximized?: () => Promise<boolean>;
  close?: () => Promise<void>;
}

export interface TauriInvoke {
  <T>(command: string, args?: Record<string, unknown>): Promise<T>;
}
