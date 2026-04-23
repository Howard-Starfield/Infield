import React from 'react';

interface SkeletonProps {
  variant?: 'text' | 'avatar' | 'card' | 'row' | 'pill';
  width?: string | number;
  height?: string | number;
  size?: number;
  count?: number;
  style?: React.CSSProperties;
}

export function Skeleton({ variant = 'text', width, height, size = 36, count = 1, style }: SkeletonProps) {
  const items = Array.from({ length: count });

  const baseStyle: React.CSSProperties = {
    background: 'linear-gradient(90deg, var(--surface-container) 25%, var(--surface-container-high) 50%, var(--surface-container) 75%)',
    backgroundSize: '200% 100%',
    animation: 'shimmer 1.5s ease-in-out infinite',
    borderRadius: 'var(--radius-container)',
    ...style,
  };

  if (variant === 'avatar') {
    return (
      <>{items.map((_, i) => (
        <div key={i} style={{ ...baseStyle, width: size, height: size, borderRadius: '50%', flexShrink: 0 }} />
      ))}</>
    );
  }

  if (variant === 'pill') {
    return (
      <>{items.map((_, i) => (
        <div key={i} style={{ ...baseStyle, width: width || 72, height: height || 28, borderRadius: 16 }} />
      ))}</>
    );
  }

  if (variant === 'card') {
    return (
      <>{items.map((_, i) => (
        <div key={i} style={{ ...baseStyle, width: width || '100%', height: height || 100, borderRadius: 'var(--radius-lg)' }} />
      ))}</>
    );
  }

  if (variant === 'row') {
    return (
      <>{items.map((_, i) => (
        <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '12px 0' }}>
          <div style={{ ...baseStyle, width: 36, height: 36, borderRadius: '50%', flexShrink: 0 }} />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ ...baseStyle, width: '60%', height: 14 }} />
            <div style={{ ...baseStyle, width: '90%', height: 12 }} />
          </div>
          <div style={{ ...baseStyle, width: 56, height: 20, borderRadius: 12 }} />
        </div>
      ))}</>
    );
  }

  // Default: text
  return (
    <>{items.map((_, i) => (
      <div key={i} style={{ ...baseStyle, width: width || '100%', height: height || 14, marginBottom: i < count - 1 ? 8 : 0 }} />
    ))}</>
  );
}

/** Full skeleton for the conversation list column */
export function ConversationListSkeleton() {
  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 4 }}>
      <Skeleton variant="text" width="40%" height={16} style={{ marginBottom: 12 }} />
      <Skeleton variant="card" height={36} style={{ marginBottom: 16 }} />
      <Skeleton variant="row" count={8} />
    </div>
  );
}

/** Full skeleton for the thread workspace - Cinematic Neural Loader */
export function ThreadWorkspaceSkeleton() {
  return (
    <div style={{ padding: '0', display: 'flex', flexDirection: 'column', height: '100%', position: 'relative', overflow: 'hidden' }}>
      {/* Neural Pulse Background */}
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at 50% 30%, rgba(204, 76, 43, 0.05) 0%, transparent 70%)', zIndex: 0 }} />
      
      {/* Header Area */}
      <div style={{ padding: '20px', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', gap: 12, position: 'relative', zIndex: 1 }}>
        <Skeleton variant="pill" width={100} height={24} />
        <Skeleton variant="pill" width={80} height={24} />
        <Skeleton variant="pill" width={70} height={24} />
        <div style={{ flex: 1 }} />
        <Skeleton variant="pill" width={120} height={32} style={{ borderRadius: 8 }} />
      </div>

      {/* Messages Area */}
      <div style={{ flex: 1, padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: 24, position: 'relative', zIndex: 1 }}>
        {/* Animated Staggered Bubbles */}
        {[320, 280, 400, 350, 300].map((w, i) => (
          <div 
            key={i} 
            style={{ 
              alignSelf: i % 2 === 0 ? 'flex-start' : 'flex-end', 
              width: w, maxWidth: '80%',
              opacity: 0.6 - (i * 0.1),
              animation: `fadeInUp 0.8s ease-out ${i * 0.15}s both, pulseSoft 3s ease-in-out infinite ${i * 0.5}s`
            }}
          >
            <div style={{ 
              height: 40 + (Math.random() * 40), 
              background: i % 2 === 0 ? 'rgba(255,255,255,0.03)' : 'rgba(204, 76, 43, 0.08)',
              borderRadius: i % 2 === 0 ? '12px 12px 12px 4px' : '12px 12px 4px 12px',
              border: '1px solid rgba(255,255,255,0.05)',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05)'
            }}>
              {/* Internal shimmer line */}
              <div className="shimmer" style={{ width: '40%', height: '8px', margin: '16px', borderRadius: 4, background: 'rgba(255,255,255,0.05)' }} />
            </div>
          </div>
        ))}

        {/* Dynamic Neural Centerpiece */}
        <div style={{ 
          position: 'absolute', top: '40%', left: '50%', transform: 'translate(-50%, -50%)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, pointerEvents: 'none'
        }}>
          <div style={{ 
            width: 48, height: 48, borderRadius: '50%', 
            background: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 0 32px rgba(204, 76, 43, 0.3)',
            animation: 'pulseGlow 2s ease-in-out infinite'
          }}>
            <div style={{ width: 24, height: 24, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.5)', borderTopColor: 'white', animation: 'spin 1.5s linear infinite' }} />
          </div>
          <span style={{ fontSize: '10px', fontWeight: 800, color: 'var(--primary)', letterSpacing: '0.2em', textTransform: 'uppercase', textShadow: '0 0 10px rgba(204, 76, 43, 0.5)' }}>Synchronizing</span>
        </div>
      </div>

      {/* Composer Area */}
      <div style={{ padding: '16px 20px', borderTop: '1px solid rgba(255,255,255,0.05)', position: 'relative', zIndex: 1 }}>
        <div style={{ height: 44, background: 'rgba(255,255,255,0.03)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.05)' }} />
      </div>
    </div>
  );
}

/** Full skeleton for the inspector panel */
export function InspectorPanelSkeleton() {
  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Skeleton variant="text" width="80%" height={16} />
      {/* Order status */}
      <div>
        <Skeleton variant="pill" width={90} height={24} style={{ marginBottom: 12 }} />
        <Skeleton variant="text" width="100%" height={14} />
      </div>
      {/* Tracking */}
      <div>
        <Skeleton variant="text" width="50%" height={14} style={{ marginBottom: 8 }} />
        <Skeleton variant="text" width="70%" height={14} />
      </div>
      {/* Buyer info card */}
      <Skeleton variant="card" height={140} />
      {/* Past orders */}
      <div>
        <Skeleton variant="text" width="40%" height={14} style={{ marginBottom: 12 }} />
        <Skeleton variant="text" width="100%" height={12} count={4} />
      </div>
      {/* Notes */}
      <Skeleton variant="card" height={80} />
    </div>
  );
}
