import React, { useState, useEffect } from 'react';
import { 
  X, 
  Globe, 
  Shield, 
  ArrowRight, 
  ExternalLink, 
  Loader2, 
  CheckCircle2, 
  AlertCircle,
  Settings,
  Lock,
  Key
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { HerOSInput } from './HerOS';
import { 
  beginEbayOAuthNative, 
  startEbayOAuthCallbackListenerNative, 
  openExternalUrlNative,
  getLatestEbayOAuthCallbackResultNative,
  exchangeEbayAuthCodeNative,
  saveEbayOAuthAppSettingsNative
} from '../tauri-bridge';
import { useVault } from '../contexts/VaultContext';
import { toast } from 'sonner';

interface EbayConnectModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function EbayConnectModal({ isOpen, onClose }: EbayConnectModalProps) {
  const { vaultData, setVaultData } = useVault();
  const [step, setStep] = useState<'config' | 'start' | 'waiting' | 'success'>('config');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form states for config
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [ruName, setRuName] = useState('');
  const [accountLabel, setAccountLabel] = useState('');
  const [scopes, setScopes] = useState({
    messages: true,
    orders: true,
    listings: false,
    fulfillment: true
  });
  const [transport, setTransport] = useState<'loopback' | 'https_bridge'>('loopback');
  const [bridgeUrl, setBridgeUrl] = useState('');

  // OAuth status
  const [authUrl, setAuthUrl] = useState('');
  const [callbackResult, setCallbackResult] = useState<any>(null);

  // Pre-fill config if exists
  useEffect(() => {
    if (vaultData?.ebayOAuthApp) {
      setClientId(vaultData.ebayOAuthApp.clientId || '');
      setRuName(vaultData.ebayOAuthApp.ruName || '');
      // We don't pre-fill secret for security, but user can leave blank if already stored
    }
  }, [vaultData]);

  const handleSaveConfig = async () => {
    setLoading(true);
    setError(null);
    try {
      const scopeString = [
        scopes.messages ? 'https://api.ebay.com/oauth/api_scope/commerce.chat.readonly https://api.ebay.com/oauth/api_scope/commerce.chat.contact' : '',
        scopes.orders ? 'https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly' : '',
        scopes.listings ? 'https://api.ebay.com/oauth/api_scope/sell.inventory.readonly' : '',
        scopes.fulfillment ? 'https://api.ebay.com/oauth/api_scope/sell.fulfillment' : ''
      ].filter(Boolean).join(' ');

      const result = await saveEbayOAuthAppSettingsNative(
        clientId,
        clientSecret,
        ruName,
        undefined, // port
        undefined, // auth
        undefined, // token
        transport,
        bridgeUrl || null,
        scopeString
      );
      if (result) {
        setVaultData(result.vault);
        setStep('start');
        toast.success('App credentials saved to vault');
      }
    } catch (e: any) {
      setError(e.toString());
      toast.error('Failed to save settings');
    } finally {
      setLoading(false);
    }
  };

  const handleBeginAuth = async () => {
    setLoading(true);
    setError(null);
    try {
      // 1. Start listener
      const listener = await startEbayOAuthCallbackListenerNative();
      if (!listener) throw new Error("Failed to start local listener");

      // 2. Begin OAuth session
      const startResult = await beginEbayOAuthNative(accountLabel || undefined);
      if (!startResult) throw new Error("Failed to initiate OAuth");

      setAuthUrl(startResult.authorizationUrl);
      
      // 3. Open browser
      await openExternalUrlNative(startResult.authorizationUrl);
      
      setStep('waiting');
      toast.info('Browser opened for consent');
    } catch (e: any) {
      setError(e.toString());
    } finally {
      setLoading(false);
    }
  };

  // Poll for callback result
  useEffect(() => {
    let interval: any;
    if (step === 'waiting') {
      interval = setInterval(async () => {
        const result = await getLatestEbayOAuthCallbackResultNative();
        if (result && result.status === 'success') {
          setCallbackResult(result);
          setStep('success');
          clearInterval(interval);
          toast.success('eBay authorization successful');
        } else if (result && result.status === 'error') {
          setError(result.errorDescription || 'Authorization failed');
          setStep('start');
          clearInterval(interval);
        }
      }, 2000);
    }
    return () => clearInterval(interval);
  }, [step]);

  const handleFinalize = async () => {
    setLoading(true);
    try {
      const result = await exchangeEbayAuthCodeNative(vaultData!);
      if (result) {
        setVaultData(result.vault);
        toast.success('Account connected and keys stored!');
        onClose();
      }
    } catch (e: any) {
      setError(e.toString());
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 10000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0, 0, 0, 0.85)', backdropFilter: 'blur(12px)'
    }}>
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 30 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="heros-glass-card heros-shadow"
        style={{
          width: '100%', maxWidth: '520px', background: 'rgba(15, 15, 20, 0.9)',
          borderRadius: '28px', border: '1px solid rgba(255,255,255,0.08)',
          overflow: 'hidden'
        }}
      >
        {/* Header */}
        <div style={{ padding: '24px 32px', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.02)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ width: 44, height: 44, borderRadius: '12px', background: 'rgba(204, 76, 43, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(204, 76, 43, 0.2)' }}>
              <Globe size={22} color="var(--heros-brand)" />
            </div>
            <div>
              <h2 style={{ fontSize: '18px', fontWeight: 800, color: '#fff', margin: 0, letterSpacing: '-0.01em' }}>Connect eBay Account</h2>
              <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)', margin: 0, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Secure OAuth Integration</p>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.05)', border: 'none', color: '#fff', cursor: 'pointer', width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s ease' }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: '32px' }}>
          <AnimatePresence mode="wait">
            {step === 'config' && (
              <motion.div key="config" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                <h3 style={{ fontSize: '11px', fontWeight: 800, color: 'var(--heros-brand)', textTransform: 'uppercase', letterSpacing: '0.2em', marginBottom: '24px', display: 'flex', alignItems: 'center', gap: 12 }}>
                  <Settings size={16} /> 1. App Credentials
                </h3>
                <p style={{ fontSize: '14px', color: 'rgba(255,255,255,0.6)', marginBottom: '32px', lineHeight: 1.6 }}>
                  Enter your eBay Developer Application details. These will be stored encrypted in your vault.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', color: 'rgba(255,255,255,0.4)', marginBottom: '8px', letterSpacing: '0.04em', fontWeight: 600 }}>Client ID (App ID)</label>
                    <HerOSInput type="text" value={clientId} onChange={e => setClientId(e.target.value)} placeholder="Production Client ID" />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', color: 'rgba(255,255,255,0.4)', marginBottom: '8px', letterSpacing: '0.04em', fontWeight: 600 }}>Client Secret (Cert ID)</label>
                    <HerOSInput type="password" value={clientSecret} onChange={e => setClientSecret(e.target.value)} placeholder="••••••••••••••••" icon={<Lock size={14} />} />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', color: 'rgba(255,255,255,0.4)', marginBottom: '8px', letterSpacing: '0.04em', fontWeight: 600 }}>RuName (Redirect URI Name)</label>
                    <HerOSInput type="text" value={ruName} onChange={e => setRuName(e.target.value)} placeholder="Your-RuName-Example" />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '12px', color: 'rgba(255,255,255,0.4)', marginBottom: '12px' }}>OAuth Callback Transport</label>
                    <div style={{ display: 'flex', gap: '12px' }}>
                      <button 
                        onClick={() => setTransport('loopback')}
                        style={{ ...toggleStyle, background: transport === 'loopback' ? 'rgba(204, 76, 43, 0.15)' : 'rgba(255,255,255,0.03)', border: `1px solid ${transport === 'loopback' ? 'var(--heros-brand)' : 'rgba(255,255,255,0.05)'}`, color: transport === 'loopback' ? 'var(--heros-brand)' : 'rgba(255,255,255,0.4)' }}
                      >Local Listener</button>
                      <button 
                        onClick={() => setTransport('https_bridge')}
                        style={{ ...toggleStyle, background: transport === 'https_bridge' ? 'rgba(204, 76, 43, 0.15)' : 'rgba(255,255,255,0.03)', border: `1px solid ${transport === 'https_bridge' ? 'var(--heros-brand)' : 'rgba(255,255,255,0.05)'}`, color: transport === 'https_bridge' ? 'var(--heros-brand)' : 'rgba(255,255,255,0.4)' }}
                      >HTTPS Bridge</button>
                    </div>
                  </div>

                  {transport === 'https_bridge' && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}>
                      <label style={{ display: 'block', fontSize: '12px', color: 'rgba(255,255,255,0.4)', marginBottom: '8px' }}>Bridge Website URL</label>
                      <HerOSInput type="text" value={bridgeUrl} onChange={e => setBridgeUrl(e.target.value)} placeholder="https://your-bridge.com/callback" />
                    </motion.div>
                  )}

                  <div style={{ marginTop: '8px' }}>
                    <label style={{ display: 'block', fontSize: '12px', color: 'rgba(255,255,255,0.4)', marginBottom: '12px' }}>Connection Scopes (Permissions)</label>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                      {[
                        { id: 'messages', label: 'eBay Messages' },
                        { id: 'orders', label: 'Order History' },
                        { id: 'listings', label: 'Store Listings' },
                        { id: 'fulfillment', label: 'Fulfillment' }
                      ].map(s => (
                        <div key={s.id} 
                          onClick={() => setScopes(prev => ({ ...prev, [s.id]: !prev[s.id as keyof typeof prev] }))}
                          style={{ 
                            padding: '12px', borderRadius: '12px', background: scopes[s.id as keyof typeof scopes] ? 'rgba(204, 76, 43, 0.1)' : 'rgba(255,255,255,0.02)',
                            border: `1px solid ${scopes[s.id as keyof typeof scopes] ? 'var(--heros-brand)' : 'rgba(255,255,255,0.05)'}`,
                            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px', transition: 'all 0.2s'
                          }}
                        >
                          <div style={{ width: '18px', height: '18px', borderRadius: '5px', border: `1.5px solid ${scopes[s.id as keyof typeof scopes] ? 'var(--heros-brand)' : 'rgba(255,255,255,0.15)'}`, background: scopes[s.id as keyof typeof scopes] ? 'var(--heros-brand)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            {scopes[s.id as keyof typeof scopes] && <CheckCircle2 size={12} color="#fff" />}
                          </div>
                          <span style={{ fontSize: '13px', fontWeight: 600, color: scopes[s.id as keyof typeof scopes] ? '#fff' : 'rgba(255,255,255,0.5)' }}>{s.label}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <button 
                  onClick={handleSaveConfig} 
                  disabled={loading || !clientId || !ruName}
                  style={{ ...btnStyle, marginTop: '40px', background: 'var(--heros-brand)', color: '#fff' }}
                >
                  {loading ? <Loader2 className="spin" size={18} /> : 'Save & Continue'}
                </button>
              </motion.div>
            )}

            {step === 'start' && (
              <motion.div key="start" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                <h3 style={{ fontSize: '11px', fontWeight: 800, color: 'var(--heros-brand)', textTransform: 'uppercase', letterSpacing: '0.2em', marginBottom: '24px', display: 'flex', alignItems: 'center', gap: 12 }}>
                  <Shield size={16} /> 2. Launch Authorization
                </h3>
                <p style={{ fontSize: '14px', color: 'rgba(255,255,255,0.6)', marginBottom: '32px', lineHeight: 1.6 }}>
                  The vault will now launch a temporary secure listener on your machine to receive the login token.
                </p>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', color: 'rgba(255,255,255,0.4)', marginBottom: '8px', fontWeight: 600 }}>Account Label (Optional)</label>
                  <HerOSInput type="text" value={accountLabel} onChange={e => setAccountLabel(e.target.value)} placeholder="e.g. Primary Store" />
                </div>
                <button 
                  onClick={handleBeginAuth} 
                  disabled={loading}
                  style={{ ...btnStyle, marginTop: '40px', background: 'var(--heros-brand)', color: '#fff' }}
                >
                  {loading ? <Loader2 className="spin" size={18} /> : 'Launch Browser'}
                </button>
              </motion.div>
            )}

            {step === 'waiting' && (
              <motion.div key="waiting" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} style={{ textAlign: 'center', padding: '20px 0' }}>
                <div style={{ width: '72px', height: '72px', borderRadius: '50%', background: 'rgba(204, 76, 43, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px auto', border: '1px solid rgba(204, 76, 43, 0.2)' }}>
                  <Loader2 size={32} color="var(--heros-brand)" className="spin" />
                </div>
                <h3 style={{ fontSize: '20px', fontWeight: 800, color: '#fff', marginBottom: '12px' }}>Waiting for eBay...</h3>
                <p style={{ fontSize: '15px', color: 'rgba(255,255,255,0.5)', marginBottom: '32px', lineHeight: 1.6 }}>
                  Please complete the sign-in in your browser. The vault is listening for the secure callback.
                </p>
                <button 
                  onClick={() => openExternalUrlNative(authUrl)}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '0 auto', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', padding: '10px 20px', borderRadius: '100px', color: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: '14px' }}
                >
                  <ExternalLink size={16} /> Re-open Browser
                </button>
              </motion.div>
            )}

            {step === 'success' && (
              <motion.div key="success" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} style={{ textAlign: 'center' }}>
                <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: 'rgba(16,185,129,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px auto' }}>
                  <CheckCircle2 size={32} color="var(--success)" />
                </div>
                <h3 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '8px' }}>Identity Verified</h3>
                <p style={{ fontSize: '14px', color: 'var(--on-surface-variant)', marginBottom: '32px', lineHeight: 1.6 }}>
                  The temporary token has been received. Click below to exchange it for permanent encrypted keys.
                </p>
                <button 
                  onClick={handleFinalize} 
                  disabled={loading}
                  style={{ ...btnStyle, background: 'var(--success)', color: '#fff' }}
                >
                  {loading ? <Loader2 className="animate-spin" /> : 'Store Keys in Vault'}
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {error && (
            <div style={{ 
              marginTop: '24px', padding: '12px', borderRadius: '8px', background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.2)', color: 'var(--error)', fontSize: '13px',
              display: 'flex', gap: '8px', alignItems: 'flex-start'
            }}>
              <AlertCircle size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
              {error}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '12px 16px',
  background: 'var(--surface-container-low)',
  border: '1px solid rgba(255,255,255,0.05)',
  borderRadius: '12px',
  color: 'var(--on-surface)',
  fontSize: '14px',
  outline: 'none'
};

const toggleStyle: React.CSSProperties = {
  flex: 1,
  padding: '10px',
  borderRadius: '10px',
  color: 'var(--on-surface)',
  fontSize: '12px',
  fontWeight: 600,
  cursor: 'pointer',
  transition: 'all 0.2s',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center'
};

const btnStyle: React.CSSProperties = {
  width: '100%',
  padding: '14px',
  borderRadius: '12px',
  background: 'var(--primary)',
  color: 'var(--on-primary)',
  border: 'none',
  fontWeight: 700,
  fontSize: '15px',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '8px',
  boxShadow: '0 8px 24px -8px rgba(128,131,255,0.4)'
};
