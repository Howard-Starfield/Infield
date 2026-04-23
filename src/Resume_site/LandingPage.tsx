import React from 'react';
import { ScrambleText } from './ScrambleText';
import { AsciiEye } from './AsciiEye';
import './Resume_site.css';

interface LandingPageProps {
  onBack?: () => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({ onBack }) => {
  return (
    <div className="resume-site-container">
      {/* P5.asciify Powered Eye */}
      <div style={{ position: 'absolute', inset: 0, zIndex: 1 }}>
        <AsciiEye />
      </div>
      
      {/* Close Button */}
      {onBack && (
        <button 
          onClick={onBack}
          style={{
            position: 'absolute', top: '40px', right: '60px',
            background: 'none', border: 'none', color: '#f0c040',
            fontFamily: 'monospace', fontSize: '12px', fontWeight: 800,
            cursor: 'pointer', zIndex: 100, letterSpacing: '0.2em'
          }}
        >
          [X] CLOSE
        </button>
      )}

      <div className="hero-title-container" style={{ position: 'relative', zIndex: 10 }}>
        <div className="hero-title-accent">Year in Review</div>
        
        <div className="scramble-block">
          <h1 className="hero-title-large">
            <ScrambleText text="TWENTY" onHover />
          </h1>
          <h1 className="hero-title-large" style={{ marginLeft: '120px' }}>
            <ScrambleText text="TWENTY" onHover />
          </h1>
          <h1 className="hero-title-large" style={{ marginLeft: '380px' }}>
            <ScrambleText text="FIVE" onHover />
          </h1>
        </div>
      </div>

      <div className="sub-info" style={{ position: 'relative', zIndex: 10 }}>
        <div>[START A PROJECT WITH US]</div>
        <div className="scroll-indicator">
          <div className="arrow-line" />
          <div>[SCROLL] This way to see the things we made.</div>
        </div>
      </div>
    </div>
  );
};
