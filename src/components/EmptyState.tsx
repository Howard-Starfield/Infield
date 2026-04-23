import React from 'react';
import { MessageSquare, Inbox, Sparkles, ArrowRight, PlusCircle, Search, HelpCircle } from 'lucide-react';

interface EmptyStateProps {
  variant?: 'no-selection' | 'empty-inbox' | 'loading-error';
  title?: string;
  description?: string;
  compact?: boolean;
}

export function EmptyState({ variant = 'no-selection', title, description, compact = false }: EmptyStateProps) {
  const configs = {
    'no-selection': {
      icon: MessageSquare,
      defaultTitle: 'Sovereign Vault is Ready',
      defaultDesc: 'Select a conversation from the list to start managing your orders and buyer interactions.',
      accentColor: 'var(--primary)',
      bgGlow: 'color-mix(in srgb, var(--heros-brand) 15%, transparent)',
      showActions: true
    },
    'empty-inbox': {
      icon: Sparkles,
      defaultTitle: 'Inbox Zero Achieved',
      defaultDesc: 'You have no pending messages. All customer interactions are currently up to date.',
      accentColor: 'var(--success)',
      bgGlow: 'rgba(16, 185, 129, 0.08)',
      showActions: false
    },
    'loading-error': {
      icon: Inbox,
      defaultTitle: 'Vault Connection Interrupted',
      defaultDesc: 'We were unable to sync your conversations. Please verify your eBay integration in Settings.',
      accentColor: 'var(--error)',
      bgGlow: 'rgba(255, 180, 171, 0.08)',
      showActions: false
    },
  };

  const config = configs[variant];
  const displayTitle = title || config.defaultTitle;
  const displayDesc = description || config.defaultDesc;

  const quickActions = [
    { icon: PlusCircle, label: 'Compose Message', shortcut: 'C' },
    { icon: Search, label: 'Global Search', shortcut: 'Ctrl+F' },
    { icon: HelpCircle, label: 'View Documentation', shortcut: 'F1' },
  ];

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: compact ? 24 : 48,
      textAlign: 'center',
      position: 'relative',
      overflow: 'hidden',
      background: compact ? 'transparent' : 'radial-gradient(circle at center, color-mix(in srgb, var(--heros-brand) 5%, transparent) 0%, transparent 70%)',
    }}>
      {/* Ambient glow */}
      <div style={{
        position: 'absolute',
        width: 400,
        height: 400,
        borderRadius: '50%',
        background: config.bgGlow,
        filter: 'blur(80px)',
        pointerEvents: 'none',
        zIndex: 0
      }} />

      {/* Main Illustration: Dynamic Globe */}
      <div style={{
        position: 'relative',
        zIndex: 1,
        marginBottom: 32,
        width: compact ? 120 : 200,
        height: compact ? 120 : 200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <iframe
          src="globe.html"
          title="Globe Animation"
          allowtransparency="true"
          style={{
            width: '100%',
            height: '100%',
            border: 'none',
            background: 'transparent',
            pointerEvents: 'none', // Prevents iframe from intercepting clicks
            filter: 'drop-shadow(0 0 20px rgba(204, 76, 43, 0.2))'
          }}
          scrolling="no"
        />
      </div>

      {/* Text Content */}
      <div style={{ position: 'relative', zIndex: 1, maxWidth: compact ? 240 : 420 }}>
        <h3 style={{
          fontSize: compact ? 'var(--text-lg)' : 'var(--text-2xl)',
          fontWeight: 700,
          color: 'var(--on-surface)',
          margin: '0 0 8px 0',
          letterSpacing: '-0.01em',
        }}>
          {displayTitle}
        </h3>

        <p style={{
          fontSize: compact ? 'var(--text-xs)' : 'var(--text-base)',
          color: 'var(--on-surface-variant)',
          margin: `0 0 ${compact ? '16px' : '32px'} 0`,
          lineHeight: 1.5,
        }}>
          {displayDesc}
        </p>

        {/* Quick Actions List */}
        {config.showActions && (
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: '1fr', 
            gap: 8, 
            width: '100%',
            background: 'rgba(0,0,0,0.2)',
            padding: 8,
            borderRadius: 12,
            border: '1px solid rgba(255,255,255,0.05)'
          }}>
            {quickActions.map((action, i) => (
              <button 
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 12px',
                  borderRadius: 8,
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--on-surface)',
                  cursor: 'pointer',
                  transition: 'background 0.2s ease',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <action.icon size={18} color="var(--primary)" />
                  <span style={{ fontSize: 'var(--text-sm)', fontWeight: 500 }}>{action.label}</span>
                </div>
                <kbd style={{ 
                  fontSize: '10px', 
                  background: 'var(--surface-container-high)', 
                  padding: '2px 6px', 
                  borderRadius: 4,
                  color: 'var(--on-surface-variant)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  fontFamily: 'monospace'
                }}>
                  {action.shortcut}
                </kbd>
              </button>
            ))}
          </div>
        )}

        {variant === 'loading-error' && (
          <button style={{
            marginTop: 20,
            padding: '10px 24px',
            borderRadius: 8,
            background: 'var(--primary)',
            color: 'white',
            border: 'none',
            fontSize: 'var(--text-base)',
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            margin: '0 auto'
          }}>
            Reconnect Vault <ArrowRight size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
