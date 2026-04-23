import React, { useEffect, useState, useRef } from 'react';
import { motion } from 'motion/react';

/**
 * CartoonBuddy Component
 * Animates a 6x6 sprite sheet.
 * Frozen by default, plays loop on hover, smooth return to frame 0.
 */
export function CartoonBuddy() {
  const [frame, setFrame] = useState(0);
  const [isHovered, setIsHovered] = useState(false);
  const timerRef = useRef<any>(null);
  const returnTimerRef = useRef<any>(null);

  // Interaction Logic: Play on hover, cycle back to 0 on leave
  useEffect(() => {
    if (isHovered) {
      // Clear return timer if active
      if (returnTimerRef.current) clearInterval(returnTimerRef.current);
      
      // Start playing the loop
      timerRef.current = setInterval(() => {
        setFrame(prev => (prev + 1) % 36);
      }, 80); // 80ms per frame for a smooth cinematic loop
    } else {
      // Clear play timer
      if (timerRef.current) clearInterval(timerRef.current);
      
      // Smoothly cycle back to frame 0 (rest state)
      returnTimerRef.current = setInterval(() => {
        setFrame(prev => {
          if (prev === 0) {
            if (returnTimerRef.current) clearInterval(returnTimerRef.current);
            return 0;
          }
          // Continue cycling forward until we wrap back to 0
          return (prev + 1) % 36;
        });
      }, 60); // Slightly faster return speed
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (returnTimerRef.current) clearInterval(returnTimerRef.current);
    };
  }, [isHovered]);

  // Calculate background position for the 6x6 sprite grid
  const col = frame % 6;
  const row = Math.floor(frame / 6);
  const posX = (col * 100) / 5; 
  const posY = (row * 100) / 5;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ 
        opacity: 1, 
        y: [0, -6, 0], // Subtle 'breathing' bob
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      transition={{
        y: { duration: 4, repeat: Infinity, ease: "easeInOut" },
        opacity: { duration: 0.6 }
      }}
      style={{
        position: 'fixed',
        bottom: '15px',
        right: '40px',
        width: '130px',
        height: '90px',
        zIndex: 9999,
        cursor: 'pointer',
        pointerEvents: 'auto', // Enable interaction
        backgroundImage: 'url("/buddy-sprite.png")',
        backgroundSize: '600% 600%', 
        backgroundPosition: `${posX}% ${posY}%`,
        imageRendering: 'pixelated', // Keeps pixel art sharp
        filter: 'drop-shadow(0 15px 25px rgba(0,0,0,0.25))',
        scaleX: -1, // Flipped to face the workspace
      }}
    />
  );
}
