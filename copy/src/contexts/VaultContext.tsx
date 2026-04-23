import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { 
  unlockVaultNative, 
  clearVaultSessionNative, 
  loadVaultEnvelopeNative,
  getUnlockedVaultNative,
  hasNativeVault
} from '../tauri-bridge';
import { listen } from '@tauri-apps/api/event';
import type { VaultData, VaultEnvelope } from '../types';

interface VaultContextType {
  isLocked: boolean;
  isBooting: boolean;
  vaultData: VaultData | null;
  envelope: VaultEnvelope | null;
  error: string | null;
  unlock: (password: string) => Promise<boolean>;
  lock: () => Promise<void>;
  updateVaultData: (newData: VaultData) => void;
  queueAction: (accountId: string, actionType: string, payload: any) => Promise<void>;
  storeMedia: (accountId: string, conversationId: string, fileName: string, mimeType: string, data: string, thumbnail?: string) => Promise<void>;
  storeEvidence: (accountId: string, orderId: string | null, fileName: string, mimeType: string, data: string, notes?: string) => Promise<void>;
  updateUiPreferences: (preferences: UiPreferences) => Promise<void>;
}

const VaultContext = createContext<VaultContextType | undefined>(undefined);

export function VaultProvider({ children }: { children: ReactNode }) {
  const [vaultData, setVaultData] = useState<VaultData | null>(null);
  const [envelope, setEnvelope] = useState<VaultEnvelope | null>(null);
  const [isLocked, setIsLocked] = useState(true);
  const [isBooting, setIsBooting] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Listen for background vault updates
    let unlisten: (() => void) | null = null;
    
    const setupListener = async () => {
      unlisten = await listen('vault-updated', async () => {
        if (!isLocked) {
          const result = await getUnlockedVaultNative();
          if (result && result.vault) {
            setVaultData(result.vault);
          }
        }
      });
    };

    setupListener();
    return () => { if (unlisten) unlisten(); };
  }, [isLocked]);

  useEffect(() => {
    // Initial check to see if an envelope exists (meaning setup is done)
    const boot = async () => {
      try {
        const env = await loadVaultEnvelopeNative();
        if (env) setEnvelope(env);
        
        // Synchronized delay to match LoadingScreen (2.5s)
        await new Promise(resolve => setTimeout(resolve, 2500));
      } catch (err) {
        console.warn("Could not load vault envelope:", err);
      } finally {
        setIsBooting(false);
      }
    };
    
    boot();
  }, []);

  const unlock = async (password: string) => {
    setError(null);
    try {
      const result = await unlockVaultNative(password);
      if (result && result.vault) {
        setVaultData(result.vault);
        setEnvelope(result.envelope);
        setIsLocked(false);
        return true;
      } else {
        setError("Invalid password or vault could not be decrypted.");
        return false;
      }
    } catch (err: any) {
      setError(err.message || "Failed to unlock vault.");
      return false;
    }
  };

  const lock = async () => {
    try {
      await clearVaultSessionNative();
    } finally {
      setVaultData(null);
      setIsLocked(true);
    }
  };

  const updateVaultData = (newData: VaultData) => {
    setVaultData(newData);
  };

  const queueAction = async (accountId: string, actionType: string, payload: any) => {
    if (!vaultData) return;
    try {
      const { queueEbayActionNative } = await import('../tauri-bridge');
      const result = await queueEbayActionNative(vaultData, accountId, actionType, payload);
      if (result && result.vault) {
        setVaultData(result.vault);
        setEnvelope(result.envelope);
      }
    } catch (err) {
      console.error("Failed to queue action:", err);
    }
  };

  const storeMedia = async (accountId: string, conversationId: string, fileName: string, mimeType: string, data: string, thumbnail?: string) => {
    if (!vaultData) return;
    try {
      const { storeEbayMediaNative } = await import('../tauri-bridge');
      const result = await storeEbayMediaNative(vaultData, accountId, conversationId, fileName, mimeType, data, thumbnail);
      if (result && result.vault) {
        setVaultData(result.vault);
        setEnvelope(result.envelope);
      }
    } catch (err) {
      console.error("Failed to store media:", err);
    }
  };

  const storeEvidence = async (accountId: string, orderId: string | null, fileName: string, mimeType: string, data: string, notes?: string) => {
    if (!vaultData) return;
    try {
      const { storeEbayEvidenceNative } = await import('../tauri-bridge');
      const result = await storeEbayEvidenceNative(vaultData, accountId, orderId, fileName, mimeType, data, notes);
      if (result && result.vault) {
        setVaultData(result.vault);
        setEnvelope(result.envelope);
      }
    } catch (err) {
      console.error("Failed to store evidence:", err);
    }
  };

  const updateUiPreferences = async (preferences: UiPreferences) => {
    if (!vaultData) return;
    try {
      const { updateUiPreferencesNative } = await import('../tauri-bridge');
      const result = await updateUiPreferencesNative(vaultData, preferences);
      if (result && result.vault) {
        setVaultData(result.vault);
        setEnvelope(result.envelope);
      }
    } catch (err) {
      console.error("Failed to update UI preferences:", err);
    }
  };

  return (
    <VaultContext.Provider value={{ isLocked, isBooting, vaultData, envelope, error, unlock, lock, updateVaultData, queueAction, storeMedia, storeEvidence, updateUiPreferences }}>
      {children}
    </VaultContext.Provider>
  );
}

export function useVault() {
  const context = useContext(VaultContext);
  if (context === undefined) {
    throw new Error('useVault must be used within a VaultProvider');
  }
  return context;
}
