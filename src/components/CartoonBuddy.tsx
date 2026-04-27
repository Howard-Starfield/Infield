import React, { useEffect, useState, useRef } from 'react';
import { motion } from 'motion/react';
import { useBuddy } from '../contexts/BuddyContext';

/**
 * CartoonBuddy Component
 * Animates a 6x6 sprite sheet, row selected by active_buddy_id from BuddyContext.
 * Frozen by default, plays loop on hover. Hidden when overlay.hidden is true.
 * Drag/right-click/click reactions and anchor-relative positioning deferred to B2.
 */

const SPRITE_ROW: Record<string, number> = {
  'scout-wings': 1, 'hover-wings': 2, 'glide-wings': 3,
  'lookout-wings': 4, 'sleepy-wings': 5, 'patrol-wings': 6,
};

export function CartoonBuddy() {
  const { state } = useBuddy();
  const [frame, setFrame] = useState(0);
  const [isHovered, setIsHovered] = useState(false);
  const timerRef = useRef<any>(null);

  useEffect(() => {
    if (isHovered) {
      timerRef.current = setInterval(() => setFrame(prev => (prev + 1) % 6), 80);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      setFrame(0);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isHovered]);

  if (!state || state.overlay.hidden) return null;
  const row = SPRITE_ROW[state.active_buddy_id] ?? 1;

  return (
    <motion.div
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      animate={{ y: [0, -6, 0] }}
      transition={{ y: { duration: 4, repeat: Infinity, ease: 'easeInOut' } }}
      style={{
        position: 'fixed', bottom: 15, right: 40,
        width: 130, height: 90, zIndex: 9999, cursor: 'pointer',
        backgroundImage: 'url("/buddy-sprite.png")',
        backgroundSize: '600% 600%',
        backgroundPosition: `${(frame * 100) / 5}% ${((row - 1) * 100) / 5}%`,
        imageRendering: 'pixelated',
        filter: 'drop-shadow(0 15px 25px rgba(0,0,0,0.25))',
        transform: 'scaleX(-1)',
      }}
    />
  );
}
