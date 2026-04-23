import React from 'react';
import { useVault } from '../contexts/VaultContext';
import { Shield, Lock, Key, Smartphone, HardDrive, RefreshCw, Eye, EyeOff, ShieldCheck, AlertCircle, ArrowRight, Trash2, Zap } from 'lucide-react';
import { motion } from 'framer-motion';
import { HerOSButton } from './HerOS';

interface SecurityProps {
  onNavigate: (page: string) => void;
}

export function SecurityView({ onNavigate }: SecurityProps) {
  const { vaultData } = useVault();
  const [showKey, setShowKey] = React.useState(false);

  const sections = [
    {
      title: 'Encryption Engine',
      icon: <Lock size={20} color="var(--primary)" />,
      items: [
        { label: 'Algorithm', value: 'AES-256-GCM', detail: 'Authenticated encryption with associated data.' },
        { label: 'Key Derivation', value: 'Argon2id', detail: 'Memory-hard function protecting against GPU/ASIC attacks.' },
        { label: 'KDF Iterations', value: vaultData?.kdf?.iterations || 2, detail: 'Number of passes over memory.' },
        { label: 'KDF Memory', value: `${(vaultData?.kdf?.memory_kib || 19456) / 1024} MB`, detail: 'RAM required for key derivation.' },
      ]
    },
    {
      title: 'Multi-Factor Auth',
      icon: <Smartphone size={20} color="var(--secondary)" />,
      status: vaultData?.mfa?.enabled ? 'Active' : 'Disabled',
      items: [
        { label: 'Status', value: vaultData?.mfa?.enabled ? 'Enabled' : 'Not Configured', detail: 'Two-step verification for volume mounting.' },
        { label: 'Method', value: 'TOTP (Authenticator App)', detail: 'Standards-based time-varying codes.' },
      ]
    },
    {
      title: 'Volume Integrity',
      icon: <HardDrive size={20} color="var(--tertiary)" />,
      items: [
        { label: 'Vault Version', value: `v${vaultData?.version || 1}`, detail: 'Internal schema version.' },
        { label: 'Last Hardened', value: new Date(vaultData?.updatedAt || Date.now()).toLocaleDateString(), detail: 'Last time the cipher was rotated.' },
      ]
    }
  ];

  return (
    <div className="heros-page-container">
      <header>
        <h1 style={{ fontSize: '32px', fontWeight: 700, color: 'var(--on-surface)', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <ShieldCheck size={32} color="var(--success)" />
          Security Center
        </h1>
        <p style={{ color: 'var(--on-surface-variant)', fontSize: '16px' }}>
          Your vault is currently hardened using industry-standard cryptographic primitives.
        </p>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
          {sections.map((section, i) => (
            <motion.div
              key={section.title}
              className="heros-glass-card"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
              style={{ 
                display: 'flex', 
                flexDirection: 'column',
                minHeight: '340px',
                padding: 0
              }}
            >
              <div style={{ 
                padding: '0 16px', 
                height: '48px',
                borderBottom: '1px solid rgba(255,255,255,0.08)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: 'rgba(255,255,255,0.02)'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {React.cloneElement(section.icon as React.ReactElement, { size: 14, color: 'var(--heros-brand)' })}
                  <span style={{ 
                    fontSize: '11px', 
                    fontWeight: 700, 
                    textTransform: 'uppercase', 
                    letterSpacing: '0.12em', 
                    color: '#fff',
                    textShadow: 'var(--heros-text-shadow)'
                  }}>
                    {section.title}
                  </span>
                </div>
                {section.status && (
                  <span style={{ 
                    fontSize: '9px', fontWeight: 800, padding: '2px 8px', borderRadius: '4px',
                    background: section.status === 'Active' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(255, 152, 0, 0.1)',
                    color: section.status === 'Active' ? 'var(--success)' : 'var(--warning)',
                    border: `1px solid ${section.status === 'Active' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255, 152, 0, 0.2)'}`
                  }}>
                    {section.status.toUpperCase()}
                  </span>
                )}
              </div>

              <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                {section.items.map(item => (
                  <div key={item.label}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                      <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--on-surface-variant)', textTransform: 'uppercase', letterSpacing: '0.12em', textShadow: 'var(--heros-text-shadow)' }}>{item.label}</span>
                      <span style={{ fontSize: '14px', fontWeight: 600, color: '#fff', textShadow: 'var(--heros-text-shadow)' }}>{item.value}</span>
                    </div>
                    <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.3)', lineHeight: 1.4 }}>{item.detail}</div>
                  </div>
                ))}
              </div>
            </motion.div>
          ))}
        </div>

      {/* Advanced Actions */}
      <section className="heros-glass-card" style={{ 
        display: 'flex',
        flexDirection: 'column',
        padding: 0,
        background: 'rgba(255,255,255,0.01)',
        marginTop: '16px'
      }}>
        <div style={{ 
          padding: '0 16px', 
          height: '48px',
          display: 'flex',
          alignItems: 'center',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          background: 'transparent'
        }}>
          <span style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--on-surface-variant)', textShadow: 'var(--heros-text-shadow)' }}>
            Advanced Security Operations
          </span>
        </div>
        
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '48px', padding: '24px' }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
              <Key size={20} color="var(--heros-brand)" />
              <h3 style={{ fontSize: '16px', fontWeight: 600, margin: 0, color: '#fff' }}>Rotate Master Passphrase</h3>
            </div>
            <p style={{ fontSize: '13px', color: 'var(--heros-text-dim)', marginBottom: '24px', lineHeight: 1.6 }}>
              Re-encrypts the entire volume with a new key and fresh salt. Recommended every 90 days for peak isolation.
            </p>
            <HerOSButton 
              className="heros-btn-brand"
              icon={<Key size={16} />}
              style={{ height: '44px', width: '100%', borderRadius: '12px', fontSize: '14px', fontWeight: 700 }}
            >
              CHANGE PASSPHRASE
            </HerOSButton>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
              <RefreshCw size={20} color="var(--secondary)" />
              <h3 style={{ fontSize: '16px', fontWeight: 600, margin: 0, color: '#fff' }}>Purge Sync Cache</h3>
            </div>
            <p style={{ fontSize: '13px', color: 'var(--heros-text-dim)', marginBottom: '24px', lineHeight: 1.6 }}>
              Removes unreferenced eBay metadata and optimizes vault storage. Does not affect your messages.
            </p>
            <HerOSButton 
              className="heros-btn-brand"
              icon={<RefreshCw size={16} />}
              style={{ height: '44px', width: '100%', borderRadius: '12px', fontSize: '14px', fontWeight: 700 }}
            >
              RUN OPTIMIZER
            </HerOSButton>
          </div>
        </div>

        <div style={{ 
          padding: '24px', 
          borderRadius: '24px', 
          background: 'rgba(239, 68, 68, 0.03)', 
          border: '1px solid rgba(239, 68, 68, 0.1)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: '8px'
        }}>
          <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
            <div style={{ width: '44px', height: '44px', borderRadius: '12px', background: 'rgba(239, 68, 68, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <AlertCircle size={24} color="#f87171" />
            </div>
            <div>
              <div style={{ fontSize: '15px', fontWeight: 700, color: '#f87171' }}>Self-Destruct Volume</div>
              <div style={{ fontSize: '13px', color: 'var(--on-surface-variant)' }}>Irreversibly wipe all keys and ciphertext from this machine.</div>
            </div>
          </div>
          <HerOSButton 
            className="heros-btn-danger"
            icon={<Trash2 size={16} />}
            style={{ height: '44px', padding: '0 24px', borderRadius: '12px', fontSize: '14px', fontWeight: 700 }}
          >
            Factory Reset
          </HerOSButton>
        </div>
      </section>
    </div>
  );
}
