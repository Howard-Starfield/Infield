import React, { useState } from 'react';
import { useVault } from '../contexts/VaultContext';
import { Activity as ActivityIcon, Search, Filter, Calendar, FileText, Shield, User, Globe, AlertTriangle } from 'lucide-react';
import { motion } from 'framer-motion';
import { HerOSInput, HerOSButton } from './HerOS';

interface ActivityProps {
  onNavigate: (page: string) => void;
}

export function ActivityView({ onNavigate }: ActivityProps) {
  const { vaultData } = useVault();
  const [search, setSearch] = useState('');
  
  const audits = (vaultData?.audits || []).filter(a => 
    a.action.toLowerCase().includes(search.toLowerCase()) || 
    a.detail.toLowerCase().includes(search.toLowerCase())
  );

  const getActionIcon = (action: string) => {
    const lower = action.toLowerCase();
    if (lower.includes('vault')) return <Shield size={16} color="var(--primary)" />;
    if (lower.includes('ebay')) return <Globe size={16} color="var(--secondary)" />;
    if (lower.includes('password')) return <User size={16} color="var(--tertiary)" />;
    if (lower.includes('error')) return <AlertTriangle size={16} color="var(--error)" />;
    return <FileText size={16} color="var(--on-surface-variant)" />;
  };

  return (
    <div className="heros-page-container" style={{ padding: 0 }}>
      <header style={{ padding: '40px 40px 24px 40px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
          <div>
            <h1 style={{ fontSize: '32px', fontWeight: 700, color: 'var(--on-surface)', marginBottom: '4px' }}>Activity Log</h1>
            <p style={{ color: 'var(--on-surface-variant)', fontSize: '15px' }}>A tamper-proof record of all vault and marketplace events.</p>
          </div>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            <div style={{ width: '320px', height: '44px' }}>
              <HerOSInput 
                placeholder="Filter logs..." 
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                icon={<Search size={18} />}
                style={{ height: '44px' }}
              />
            </div>
            <HerOSButton 
              className="heros-btn-brand" 
              icon={<Filter size={18} />}
              style={{ height: '44px', padding: '0 24px', borderRadius: '12px', fontSize: '14px', fontWeight: 700 }}
            >
              Filter
            </HerOSButton>
          </div>
        </div>
      </header>

      <div style={{ flex: 1, overflow: 'auto', padding: '0 40px 40px 40px' }} className="custom-scrollbar">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {audits.length === 0 ? (
            <div className="heros-glass-card" style={{ textAlign: 'center', padding: '80px', color: 'var(--on-surface-variant)' }}>
              <ActivityIcon size={48} style={{ opacity: 0.2, marginBottom: '16px' }} />
              <p style={{ fontSize: '15px' }}>No activity records match your filter.</p>
            </div>
          ) : (
            audits.map((audit, i) => (
              <motion.div
                key={audit.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.02 }}
                className="heros-glass-card"
                style={{
                  display: 'grid',
                  gridTemplateColumns: '200px 1fr 220px',
                  padding: '16px 24px',
                  alignItems: 'center',
                  gap: '24px',
                  borderRadius: '16px'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{ 
                    width: '36px', height: '36px', borderRadius: '10px', 
                    background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center' 
                  }}>
                    {getActionIcon(audit.action)}
                  </div>
                  <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--on-surface)' }}>{audit.action}</span>
                </div>
                <div style={{ fontSize: '14px', color: 'var(--on-surface-variant)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {audit.detail}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'flex-end', color: 'rgba(255,255,255,0.3)', fontSize: '12px', fontWeight: 500 }}>
                  <Calendar size={14} />
                  {new Date(audit.at).toLocaleString()}
                </div>
              </motion.div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
