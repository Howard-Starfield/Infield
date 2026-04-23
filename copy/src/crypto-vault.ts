import type {
  PersistedVaultResult,
  RecordDraft,
  VaultData,
  VaultEnvelope
} from "./types";
import { migrateVaultData, VAULT_DATA_VERSION_LATEST } from "./vault-migration";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Envelope metadata version (separate from `VaultData.version` schema). */
const VAULT_VERSION = 1;

const KDF_ITERATIONS = 310000;
const AUDIT_CAP = 1000;
const EBAY_DAILY_LIMIT = 5000;
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function generateId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

function normalizePassphrase(password: string): string {
  return password.normalize("NFC");
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer;
}

function auditTimestamp(entry: { at?: string }): string {
  return entry.at ?? "";
}

function nextUtcMidnightIso(from = new Date()): string {
  const next = new Date(from);
  next.setUTCHours(24, 0, 0, 0);
  return next.toISOString();
}

function createDefaultEbayRateLimit(now = new Date()): VaultData["ebayAppRateLimit"] {
  return {
    dailyLimit: EBAY_DAILY_LIMIT,
    usedCalls: 0,
    remainingCalls: EBAY_DAILY_LIMIT,
    windowStartAt: now.toISOString(),
    windowEndsAt: nextUtcMidnightIso(now),
    updatedAt: now.toISOString()
  };
}

function normalizeVault(vault: VaultData): VaultData {
  const nextVault = structuredClone(vault);
  nextVault.ebayAccounts ??= [];
  nextVault.ebayConversations ??= [];
  nextVault.ebayMessages ??= [];
  nextVault.ebaySyncStates ??= [];
  nextVault.ebayAppRateLimit ??= createDefaultEbayRateLimit();
  nextVault.audits.sort((left, right) =>
    auditTimestamp(right).localeCompare(auditTimestamp(left))
  );

  if (nextVault.audits.length <= AUDIT_CAP) {
    return nextVault;
  }

  const retainedEntries = Math.max(AUDIT_CAP - 1, 0);
  const removedCount = nextVault.audits.length - retainedEntries;
  nextVault.audits = nextVault.audits.slice(0, retainedEntries);
  nextVault.audits.unshift({
    id: generateId("audit"),
    action: "audit_log_pruned",
    detail: `Pruned ${removedCount} older audit records to enforce the ${AUDIT_CAP} record limit.`,
    at: new Date().toISOString()
  });

  return nextVault;
}

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const normalizedPassword = normalizePassphrase(password);
  const baseKey = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(encoder.encode(normalizedPassword)),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: toArrayBuffer(salt),
      iterations: KDF_ITERATIONS,
      hash: "SHA-256"
    },
    baseKey,
    {
      name: "AES-GCM",
      length: 256
    },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptJson(
  key: CryptoKey,
  payload: VaultData
): Promise<VaultEnvelope["cipher"]> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = encoder.encode(JSON.stringify(payload));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(iv)
    },
    key,
    toArrayBuffer(plaintext)
  );

  return {
    iv: toBase64(iv),
    data: toBase64(new Uint8Array(ciphertext))
  };
}

async function decryptJson(
  key: CryptoKey,
  payload: VaultEnvelope["cipher"]
): Promise<VaultData> {
  if (!payload.iv) {
    throw new Error("Browser vault payload is missing an AES-GCM IV.");
  }

  const decrypted = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(fromBase64(payload.iv))
    },
    key,
    toArrayBuffer(fromBase64(payload.data))
  );

  return JSON.parse(decoder.decode(decrypted)) as VaultData;
}

function createEmptyVault(workspaceLabel = ""): VaultData {
  const now = new Date().toISOString();
  return normalizeVault({
    version: VAULT_DATA_VERSION_LATEST,
    workspaceLabel,
    createdAt: now,
    updatedAt: now,
    mfa: {
      enabled: false,
      secret: null,
      enabledAt: null
    },
    listings: [],
    orders: [],
    evidence: [],
    ebayAccounts: [],
    ebayConversations: [],
    ebayMessages: [],
    ebaySyncStates: [],
    ebayAppRateLimit: createDefaultEbayRateLimit(new Date(now)),
    audits: [
      {
        id: generateId("audit"),
        action: "Vault created",
        detail: "Initialized encrypted local vault",
        at: now
      }
    ]
  });
}

export async function createVault(
  password: string,
  workspaceLabel = ""
): Promise<{
  key: CryptoKey;
  vault: VaultData;
  envelope: VaultEnvelope;
}> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(password, salt);
  const vault = createEmptyVault(workspaceLabel);
  const cipher = await encryptJson(key, vault);

  return {
    key,
    vault,
    envelope: {
      version: VAULT_VERSION,
      kdf: {
        algorithm: "PBKDF2",
        hash: "SHA-256",
        iterations: KDF_ITERATIONS,
        salt: toBase64(salt)
      },
      cipher
    }
  };
}

export async function unlockVault(
  password: string,
  envelope: VaultEnvelope
): Promise<{ key: CryptoKey; vault: VaultData }> {
  if (!envelope.kdf?.salt) {
    throw new Error("Vault KDF metadata is missing.");
  }

  const salt = fromBase64(envelope.kdf.salt);
  const key = await deriveKey(password, salt);
  const vault = normalizeVault(migrateVaultData(await decryptJson(key, envelope.cipher)));
  return { key, vault };
}

export async function saveVault(
  key: CryptoKey,
  vault: VaultData
): Promise<PersistedVaultResult> {
  const updatedVault = normalizeVault(
    migrateVaultData({
      ...vault,
      updatedAt: new Date().toISOString()
    })
  );
  const cipher = await encryptJson(key, updatedVault);

  return {
    envelope: {
      version: VAULT_VERSION,
      kdf: null,
      cipher
    },
    vault: updatedVault
  };
}

export function mergeEnvelopeMeta(
  originalEnvelope: VaultEnvelope,
  refreshedEnvelope: PersistedVaultResult["envelope"]
): VaultEnvelope {
  return {
    version: originalEnvelope.version,
    kdf: originalEnvelope.kdf,
    cipher: refreshedEnvelope.cipher
  };
}

export function addAudit(vault: VaultData, action: string, detail: string): VaultData {
  const entry = {
    id: generateId("audit"),
    action,
    detail,
    at: new Date().toISOString()
  };

  return normalizeVault({
    ...vault,
    audits: [entry, ...vault.audits]
  });
}

export function addRecord(vault: VaultData, record: RecordDraft): VaultData {
  const now = new Date().toISOString();
  const entry = {
    id: generateId(record.type),
    channel: record.channel,
    title: record.title,
    amount: Number(record.amount || 0),
    notes: record.notes || "",
    createdAt: now
  };

  const nextVault = structuredClone(vault);
  if (record.type === "listing") {
    nextVault.listings.unshift(entry);
  } else if (record.type === "order") {
    nextVault.orders.unshift(entry);
  } else {
    nextVault.evidence.unshift(entry);
  }
  return nextVault;
}

function bytesToBase32(bytes: Uint8Array): string {
  let bits = "";
  bytes.forEach((byte) => {
    bits += byte.toString(2).padStart(8, "0");
  });

  let output = "";
  for (let index = 0; index < bits.length; index += 5) {
    const chunk = bits.slice(index, index + 5).padEnd(5, "0");
    output += BASE32_ALPHABET[Number.parseInt(chunk, 2)];
  }
  return output;
}

function base32ToBytes(base32: string): Uint8Array {
  const clean = base32.replace(/=+$/g, "").toUpperCase();
  let bits = "";
  clean.split("").forEach((char) => {
    const value = BASE32_ALPHABET.indexOf(char);
    if (value >= 0) {
      bits += value.toString(2).padStart(5, "0");
    }
  });

  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }
  return new Uint8Array(bytes);
}

export function generateTotpSecret(): string {
  const secretBytes = crypto.getRandomValues(new Uint8Array(20));
  return bytesToBase32(secretBytes);
}

async function hmacSha1(secretBytes: Uint8Array, counterBytes: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(secretBytes),
    {
      name: "HMAC",
      hash: "SHA-1"
    },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    toArrayBuffer(counterBytes)
  );
  return new Uint8Array(signature);
}

function getCounterBytes(timestampMs: number): Uint8Array {
  const counter = Math.floor(timestampMs / 1000 / 30);
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  const high = Math.floor(counter / 2 ** 32);
  const low = counter >>> 0;
  view.setUint32(0, high);
  view.setUint32(4, low);
  return new Uint8Array(buffer);
}

export async function computeTotp(secret: string, timestampMs = Date.now()): Promise<string> {
  const secretBytes = base32ToBytes(secret);
  const digest = await hmacSha1(secretBytes, getCounterBytes(timestampMs));
  const offset = digest[digest.length - 1] & 0x0f;
  const code =
    ((digest[offset] & 0x7f) << 24) |
    (digest[offset + 1] << 16) |
    (digest[offset + 2] << 8) |
    digest[offset + 3];
  return String(code % 1000000).padStart(6, "0");
}

export async function verifyTotp(
  secret: string,
  code: string,
  timestampMs = Date.now()
): Promise<boolean> {
  const windows = [-30000, 0, 30000];
  for (const offset of windows) {
    const expected = await computeTotp(secret, timestampMs + offset);
    if (expected === code) {
      return true;
    }
  }
  return false;
}
