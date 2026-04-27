import React from 'react';
import { useBuddy } from '../contexts/BuddyContext';
import type { GearSlot } from '../buddy/types';

const SLOTS: GearSlot[] = ['hat', 'aura', 'charm'];

export function GearInventoryPanel() {
  const { state, actions } = useBuddy();
  if (!state) return null;
  const active = state.roster.find(b => b.buddy_id === state.active_buddy_id)!;

  return (
    <section className="heros-glass-card buddy-gear-panel">
      <h3>Gear Inventory</h3>
      {SLOTS.map(slot => {
        const equipped = active[`equipped_${slot}_id` as `equipped_${GearSlot}_id`];
        const items = state.inventory.filter(g => g.slot === slot);
        return (
          <div key={slot} className="buddy-gear-row">
            <h4>{slot.toUpperCase()}</h4>
            {items.length === 0 ? <span className="buddy-empty">None yet — claim a chest</span> : (
              <ul>
                {items.map(g => {
                  const isEquipped = equipped === g.gear_id;
                  return (
                    <li key={g.gear_id} className={`buddy-gear-${g.rarity}`}>
                      <span>{g.species}{g.shiny ? ' ★' : ''} ({g.rarity}) — P{g.power_bonus} S{g.speed_bonus} C{g.charm_bonus}</span>
                      {isEquipped ? (
                        <button onClick={() => actions.unequipGear(slot, state.active_buddy_id)}>Unequip</button>
                      ) : (
                        <button onClick={() => actions.equipGear(g.gear_id, slot, state.active_buddy_id)}>Equip</button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </section>
  );
}
