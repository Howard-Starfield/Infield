/**
 * Browser-side vault JSON schema migrations.
 * Must stay aligned with `src-tauri/src/migrations.rs` (`VAULT_DATA_VERSION_LATEST` and steps).
 */
import type { VaultData } from "./types";

/** Latest `VaultData.version` after `migrateVaultData` (mirror Rust `VAULT_DATA_VERSION_LATEST`). */
export const VAULT_DATA_VERSION_LATEST = 2;

/** Ordered schema steps on decrypted vault JSON; idempotent. */
export function migrateVaultData(vault: VaultData): VaultData {
  // Optional `ebayOAuthApp` (and future keys) are preserved by `structuredClone` when present.
  let next = structuredClone(vault);
  let v = typeof next.version === "number" && Number.isFinite(next.version) ? next.version : 1;
  if (v > VAULT_DATA_VERSION_LATEST) {
    throw new Error(
      `Vault data version ${v} is newer than this app supports (${VAULT_DATA_VERSION_LATEST}).`
    );
  }
  while (v < VAULT_DATA_VERSION_LATEST) {
    if (v === 1) {
      next.ebayAccounts ??= [];
      next.ebayConversations ??= [];
      next.ebayMessages ??= [];
      next.ebaySyncStates ??= [];
      next.version = 2;
      v = 2;
    } else {
      throw new Error(`Unsupported vault data version ${v}`);
    }
  }
  return next;
}
