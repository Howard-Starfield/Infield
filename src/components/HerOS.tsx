import React, { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { WaveBackground } from './WaveBackground';

export const HerOSBackground: React.FC = () => {
  return (
    <>
      {/* ── Layer 0: Three.js Liquid Wave Background ── */}
      <WaveBackground />

      {/* ── Layer 1: Subtle light bloom (Reduced to blend with waves) ── */}
      <div style={{
        position: 'absolute', top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)',
        width: '100%', height: '100%',
        background: 'radial-gradient(circle, rgba(255, 255, 255, 0.05) 0%, transparent 80%)',
        filter: 'blur(100px)', pointerEvents: 'none', zIndex: 1
      }} />

      {/* ── Layer 2: Film grain overlay ── */}
      <svg style={{ position: 'absolute', width: 0, height: 0 }}>
        <filter id="lockNoise">
          <feTurbulence type="fractalNoise" baseFrequency="0.4" numOctaves="4" stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
          <feComponentTransfer><feFuncA type="linear" slope="0.08" /></feComponentTransfer>
        </filter>
      </svg>
      <div style={{
        position: 'absolute', inset: 0,
        filter: 'url(#lockNoise)',
        pointerEvents: 'none', zIndex: 2,
        mixBlendMode: 'overlay',
        opacity: 'var(--heros-grain-opacity, 1)'
      }} />
    </>
  );
};

export const HerOSPanel: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <div className="heros-shell">
      <div className="heros-glass-panel">
        {children}
      </div>
    </div>
  );
};

interface HerOSInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  icon?: React.ReactNode;
}

export const HerOSInput = React.forwardRef<HTMLInputElement, HerOSInputProps>(
  ({ icon, type, style, className, ...props }, ref) => {
    const [showPassword, setShowPassword] = useState(false);
    const isPassword = type === 'password';

    return (
      <div className={`heros-input-wrapper ${className || ''}`}>
        {icon && (
          <div style={{ position: 'absolute', top: 0, bottom: 0, left: '16px', display: 'flex', alignItems: 'center', pointerEvents: 'none' }}>
            {React.isValidElement(icon) ? React.cloneElement(icon, { className: 'heros-icon-animate-focus' } as any) : icon}
          </div>
        )}
        <input 
          ref={ref}
          type={isPassword ? (showPassword ? "text" : "password") : type} 
          style={{ 
            paddingLeft: icon ? '44px' : '16px', 
            paddingRight: isPassword ? '44px' : '16px',
            ...style 
          }}
          {...props} 
        />
        {isPassword && (
          <div style={{ position: 'absolute', top: 0, bottom: 0, right: '12px', display: 'flex', alignItems: 'center' }}>
            <button 
              type="button" 
              onClick={() => setShowPassword(!showPassword)}
              style={{ color: 'var(--heros-text-muted)', padding: '4px', display: 'flex', cursor: 'pointer', background: 'none', border: 'none' }}
            >
              {showPassword ? <EyeOff size={18} strokeWidth={2.5} /> : <Eye size={18} strokeWidth={2.5} />}
            </button>
          </div>
        )}
      </div>
    );
  }
);

interface HerOSButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: React.ReactNode;
  loading?: boolean;
}

export const HerOSButton: React.FC<HerOSButtonProps & { iconPosition?: 'left' | 'right' }> = ({ 
  children, 
  icon, 
  loading, 
  disabled, 
  style, 
  iconPosition = 'left',
  ...props 
}) => {
  const iconElement = icon && !loading && (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      {React.isValidElement(icon) ? React.cloneElement(icon, { className: 'heros-icon-animate-hover' } as any) : icon}
    </div>
  );

  return (
    <button 
      className="heros-btn"
      disabled={loading || disabled}
      style={{ 
        display: 'inline-flex', 
        flexDirection: 'row', 
        alignItems: 'center', 
        justifyContent: 'center', 
        gap: '8px',
        ...style 
      }}
      {...props}
    >
      {iconPosition === 'left' && iconElement}
      <span style={{ display: 'inline-block', lineHeight: 1 }}>{children}</span>
      {iconPosition === 'right' && iconElement}
    </button>
  );
};

export const HerOSViewport: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <div style={{ 
      minHeight: '100vh', 
      width: '100vw', 
      position: 'relative', 
      overflow: 'hidden',
      background: 'var(--heros-bg-foundation)' 
    }}>
      {children}
    </div>
  );
};
