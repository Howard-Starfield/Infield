import { describe, expect, it } from "vitest";
import type { VaultData } from "./types";
import { migrateVaultData, VAULT_DATA_VERSION_LATEST } from "./vault-migration";

function minimalVault(version: number): VaultData {
  return {
    version,
    workspaceLabel: "t",
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2020-01-01T00:00:00.000Z",
    mfa: { enabled: false, secret: null, enabledAt: null },
    listings: [],
    orders: [],
    evidence: [],
    audits: []
  };
}

describe("migrateVaultData", () => {
  it("migrates v1 to latest with eBay arrays", () => {
    const out = migrateVaultData(minimalVault(1));
    expect(out.version).toBe(VAULT_DATA_VERSION_LATEST);
    expect(out.ebayAccounts).toEqual([]);
    expect(out.ebayConversations).toEqual([]);
    expect(out.ebayMessages).toEqual([]);
    expect(out.ebaySyncStates).toEqual([]);
  });

  it("leaves already-latest vault unchanged in shape", () => {
    const v2 = {
      ...minimalVault(2),
      ebayAccounts: [],
      ebayConversations: [],
      ebayMessages: [],
      ebaySyncStates: []
    };
    const out = migrateVaultData(v2);
    expect(out.version).toBe(2);
  });

  it("rejects vault newer than app", () => {
    expect(() => migrateVaultData(minimalVault(VAULT_DATA_VERSION_LATEST + 1))).toThrow(/newer than this app supports/);
  });
});
