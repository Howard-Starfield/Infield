import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';
import { BuddyProvider, useBuddy } from '../BuddyContext';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

import { invoke } from '@tauri-apps/api/core';

const mockState = {
  points_balance: 0, points_overflow: 0, cap_total: 1000,
  active_buddy_id: 'scout-wings',
  roster: [{ buddy_id: 'scout-wings', unlocked_at_ms: 0, xp_total: 0, level: 1, shiny: false,
    equipped_hat_id: null, equipped_aura_id: null, equipped_charm_id: null }],
  inventory: [], milestones: [],
  overlay: { x: 0.96, y: 0.92, anchor: 'br', hidden: false },
  team_power: 30,
};

describe('BuddyContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'get_buddy_state') return Promise.resolve(mockState);
      if (cmd === 'record_activity_batch') return Promise.resolve(null);
      return Promise.resolve(null);
    });
  });

  it('fetches state on mount', async () => {
    let captured: any = null;
    function Probe() { captured = useBuddy(); return null; }
    render(<BuddyProvider><Probe /></BuddyProvider>);
    await waitFor(() => expect(captured.state).not.toBeNull());
    expect(captured.state.active_buddy_id).toBe('scout-wings');
  });

  it('debounces buddy:* events and flushes once', async () => {
    function Probe() { useBuddy(); return null; }
    vi.useFakeTimers();
    render(<BuddyProvider><Probe /></BuddyProvider>);
    await act(async () => { await vi.runAllTimersAsync(); });

    act(() => {
      window.dispatchEvent(new CustomEvent('buddy:note-saved'));
      window.dispatchEvent(new CustomEvent('buddy:note-saved'));
      window.dispatchEvent(new CustomEvent('buddy:voice-memo-recorded'));
    });
    expect(invoke).not.toHaveBeenCalledWith('record_activity_batch', expect.anything());
    await act(async () => { vi.advanceTimersByTime(5_500); });
    expect(invoke).toHaveBeenCalledWith('record_activity_batch',
      expect.objectContaining({ events: expect.arrayContaining([
        expect.objectContaining({ kind: 'buddy:note-saved' }),
        expect.objectContaining({ kind: 'buddy:voice-memo-recorded' }),
      ]) }));
    vi.useRealTimers();
  });
});
