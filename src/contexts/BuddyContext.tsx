import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { BuddyState, ActivityEvent, ClaimResult, GearSlot, Anchor } from '../buddy/types';

const ACTIVITY_WEIGHTS: Record<string, number> = {
  'buddy:note-saved': 5,
  'buddy:note-created': 25,
  'buddy:voice-memo-recorded': 50,
  'buddy:system-audio-segment': 10,
  'buddy:url-imported': 40,
  'buddy:database-created': 60,
  'buddy:database-row-created': 8,
  'buddy:search-clicked': 5,
  'buddy:wikilink-followed': 3,
};

const FLUSH_INTERVAL_MS = 5000;

type BuddyActions = {
  refresh(): Promise<void>;
  claim(): Promise<ClaimResult>;
  switchActiveBuddy(id: string): Promise<void>;
  equipGear(gearId: string, slot: GearSlot, buddyId: string): Promise<void>;
  unequipGear(slot: GearSlot, buddyId: string): Promise<void>;
  setOverlayPosition(x: number, y: number, anchor: Anchor): Promise<void>;
  setOverlayHidden(hidden: boolean): Promise<void>;
};

const BuddyCtx = createContext<{ state: BuddyState | null; actions: BuddyActions } | null>(null);

export function BuddyProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<BuddyState | null>(null);
  const queueRef = useRef<ActivityEvent[]>([]);
  const timerRef = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await invoke<BuddyState>('get_buddy_state');
      setState(next);
    } catch (e) {
      console.error('[buddy] refresh failed', e);
    }
  }, []);

  // Initial fetch
  useEffect(() => { refresh(); }, [refresh]);

  // Activity event listener with 5s debounced flush
  useEffect(() => {
    const flush = async () => {
      const batch = queueRef.current.splice(0, queueRef.current.length);
      if (batch.length === 0) return;
      try {
        await invoke('record_activity_batch', { events: batch });
        await refresh();
      } catch (e) {
        console.error('[buddy] flush failed', e);
      }
    };

    const enqueue = (kind: string) => {
      const weight = ACTIVITY_WEIGHTS[kind];
      if (weight == null) return;
      queueRef.current.push({ kind, weight });
      if (timerRef.current == null) {
        timerRef.current = window.setTimeout(() => {
          timerRef.current = null;
          flush();
        }, FLUSH_INTERVAL_MS);
      }
    };

    const handler = (e: Event) => enqueue((e as CustomEvent).type);
    Object.keys(ACTIVITY_WEIGHTS).forEach(k => window.addEventListener(k, handler));

    // Flush remaining on unmount/page hide
    const onHide = () => { flush(); };
    window.addEventListener('pagehide', onHide);
    window.addEventListener('beforeunload', onHide);

    return () => {
      Object.keys(ACTIVITY_WEIGHTS).forEach(k => window.removeEventListener(k, handler));
      window.removeEventListener('pagehide', onHide);
      window.removeEventListener('beforeunload', onHide);
      if (timerRef.current != null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [refresh]);

  const actions: BuddyActions = {
    refresh,
    async claim()                  { const r = await invoke<ClaimResult>('claim_chest'); await refresh(); return r; },
    async switchActiveBuddy(id)    { await invoke('switch_active_buddy', { buddyId: id }); await refresh(); },
    async equipGear(gearId, slot, buddyId) { await invoke('equip_gear', { gearId, slot, buddyId }); await refresh(); },
    async unequipGear(slot, buddyId)       { await invoke('unequip_gear', { slot, buddyId }); await refresh(); },
    async setOverlayPosition(x, y, anchor) { await invoke('set_overlay_position', { x, y, anchor }); await refresh(); },
    async setOverlayHidden(hidden)         { await invoke('set_overlay_hidden', { hidden }); await refresh(); },
  };

  return <BuddyCtx.Provider value={{ state, actions }}>{children}</BuddyCtx.Provider>;
}

export function useBuddy() {
  const v = useContext(BuddyCtx);
  if (v == null) throw new Error('useBuddy must be inside <BuddyProvider>');
  return v;
}
