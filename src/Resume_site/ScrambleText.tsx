import React, { useState, useEffect } from 'react';

interface ScrambleTextProps {
  text: string;
  speed?: number;
  revealDelay?: number;
  className?: string;
  onHover?: boolean;
}

const CHARS = 'HOWARDENG';

/**
 * ScrambleText Component
 * Replicates the Unseen.co character shuffling effect with constant vibration.
 */
export const ScrambleText: React.FC<ScrambleTextProps> = ({ 
  text, 
  speed = 30, 
  revealDelay = 50,
  className = "",
  onHover = false
}) => {
  const [displayText, setDisplayText] = useState('');
  const [isAnimating, setIsAnimating] = useState(!onHover);
  const [flicker, setFlicker] = useState(0);

  // Constant "vibration" loop to keep the text 'alive'
  useEffect(() => {
    const interval = setInterval(() => {
      setFlicker(prev => prev + 1);
    }, 50);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!isAnimating) {
      // Subtle flicker even when static
      const result = text.split('').map((char) => {
        if (Math.random() > 0.985) return CHARS[Math.floor(Math.random() * CHARS.length)];
        return char;
      }).join('');
      setDisplayText(result);
      return;
    }

    let frame = 0;
    const maxFrames = text.length + 5;
    
    const interval = setInterval(() => {
      const result = text
        .split('')
        .map((char, index) => {
          if (index < frame / 1.5) return char;
          return CHARS[Math.floor(Math.random() * CHARS.length)];
        })
        .join('');

      setDisplayText(result);
      frame++;

      if (frame >= maxFrames * 2) {
        setDisplayText(text);
        clearInterval(interval);
        if (!onHover) setIsAnimating(false);
      }
    }, speed);

    return () => clearInterval(interval);
  }, [text, isAnimating, speed, onHover, flicker]);

  return (
    <span 
      className={className}
      onMouseEnter={() => onHover && setIsAnimating(true)}
      onMouseLeave={() => onHover && setIsAnimating(false)}
      style={{ 
        display: 'inline-block', 
        minWidth: `${text.length}ch`, 
        fontFamily: "'JetBrains Mono', monospace",
        color: '#f0c040' 
      }}
    >
      {displayText}
    </span>
  );
};
