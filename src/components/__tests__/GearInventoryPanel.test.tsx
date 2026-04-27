import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { BuddyProvider } from '../../contexts/BuddyContext';
import { GearInventoryPanel } from '../GearInventoryPanel';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
import { invoke } from '@tauri-apps/api/core';

const stateWithGear = {
  points_balance: 0, points_overflow: 0, cap_total: 1000,
  active_buddy_id: 'scout-wings',
  roster: [{ buddy_id: 'scout-wings', unlocked_at_ms: 0, xp_total: 0, level: 1, shiny: false,
    equipped_hat_id: null, equipped_aura_id: null, equipped_charm_id: null }],
  inventory: [{
    gear_id: 'g1', slot: 'hat', species: 'common-hat', rarity: 'common', shiny: false,
    power_bonus: 1, speed_bonus: 1, charm_bonus: 5, acquired_at_ms: 0,
  }],
  milestones: [],
  overlay: { x: 0.96, y: 0.92, anchor: 'br', hidden: false },
  team_power: 30,
};

describe('GearInventoryPanel', () => {
  beforeEach(() => { (invoke as any).mockImplementation((cmd: string) => {
    if (cmd === 'get_buddy_state') return Promise.resolve(stateWithGear);
    return Promise.resolve(null);
  }); });

  it('lists owned gear and emits equip on click', async () => {
    render(<BuddyProvider><GearInventoryPanel /></BuddyProvider>);
    const equipBtn = await waitFor(() => screen.getByRole('button', { name: /equip/i }));
    fireEvent.click(equipBtn);
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('equip_gear',
        { gearId: 'g1', slot: 'hat', buddyId: 'scout-wings' });
    });
  });
});
