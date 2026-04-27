import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { BuddyProvider } from '../../contexts/BuddyContext';
import { BuddyView } from '../BuddyView';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
import { invoke } from '@tauri-apps/api/core';

describe('BuddyView', () => {
  beforeEach(() => {
    (invoke as any).mockResolvedValue({
      points_balance: 500, points_overflow: 100, cap_total: 1000,
      active_buddy_id: 'scout-wings',
      roster: [{ buddy_id: 'scout-wings', level: 4, xp_total: 350, shiny: false,
        unlocked_at_ms: 0,
        equipped_hat_id: null, equipped_aura_id: null, equipped_charm_id: null }],
      inventory: [], milestones: [],
      overlay: { x: 0.96, y: 0.92, anchor: 'br', hidden: false },
      team_power: 60,
    });
  });

  it('renders live state from context', async () => {
    render(<BuddyProvider><BuddyView /></BuddyProvider>);
    await waitFor(() => {
      // The "Team Power" stat card label renders as uppercase text in a stat card
      const matches = screen.getAllByText(/Team Power/i);
      expect(matches.length).toBeGreaterThan(0);
    });
  });
});
