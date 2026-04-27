import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import type { ClaimResult } from '../buddy/types';

export function ChestRevealModal({ result, onClose }: { result: ClaimResult | null; onClose: () => void }) {
  if (result == null) return null;
  const hasShiny = result.gear_dropped.some(g => g.shiny);

  return (
    <AnimatePresence>
      <motion.div className="buddy-chest-backdrop" onClick={onClose}
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
        <motion.div className={`buddy-chest-modal ${hasShiny ? 'buddy-chest-modal--shiny' : ''}`}
          onClick={e => e.stopPropagation()}
          initial={{ scale: 0.85, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9 }}>
          <h2>Chest opened — {Math.floor(result.points_claimed)} points claimed</h2>
          <div className="buddy-chest-cards">
            {result.gear_dropped.map((g, i) => (
              <motion.div key={g.gear_id} className={`buddy-chest-card buddy-chest-card--${g.rarity}`}
                initial={{ y: -40, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.2 * i }}>
                <strong>{g.species}{g.shiny ? ' ★' : ''}</strong>
                <small>{g.rarity}{g.shiny ? ' (shiny!)' : ''}</small>
                <div>P{g.power_bonus} · S{g.speed_bonus} · C{g.charm_bonus}</div>
              </motion.div>
            ))}
          </div>
          <p>+{result.xp_awarded} XP awarded to active buddy</p>
          <button className="heros-btn-brand" onClick={onClose}>Done</button>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
