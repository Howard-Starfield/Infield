import React, { useState } from 'react';
import AppShell from './components/AppShell';
import { LayoutProvider } from './contexts/LayoutContext';
import { VaultProvider, useVault } from './contexts/VaultContext';
import { Toaster } from 'sonner';
import { celebrationService } from './services/CelebrationService';

import { Lock as LockIcon, Key, ArrowRight, Eye, EyeOff, Fingerprint, Loader } from 'lucide-react';

import { getCurrentWindow, LogicalSize } from '@tauri-apps/api/window';

import { listen } from '@tauri-apps/api/event';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import LoadingScreen from './components/LoadingScreen';
import { HerOSBackground, HerOSPanel, HerOSInput, HerOSButton, HerOSViewport } from './components/HerOS';
import { SettingsView } from './components/SettingsView';
import { SpotlightOverlay } from './components/SpotlightOverlay';

function AppContent() {
  const [currentPage, setCurrentPage] = useState('inbox');
  const { isLocked, isBooting, unlock, error, vaultData } = useVault();
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isUnlockingLocal, setIsUnlockingLocal] = useState(false);
  const [isSpotlightOpen, setIsSpotlightOpen] = useState(false);

  // Global Spotlight Keyboard Listener
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const preferredTrigger = vaultData?.uiPreferences?.spotlightTrigger || 'KeyF';
      const isPreferred = e.ctrlKey && e.code === preferredTrigger;
      const isFallback = e.ctrlKey && e.code === 'Space';

      if (isPreferred || isFallback) {
        e.preventDefault();
        setIsSpotlightOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    
    // Listen for global shortcut from backend
    let unlisten: any = null;
    const setupListener = async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        unlisten = await listen('spotlight-triggered', () => {
          console.log("Spotlight triggered via global shortcut");
          setIsSpotlightOpen(true);
        });
      } catch (err) {
        console.error("Failed to setup spotlight listener", err);
      }
    };
    
    setupListener();

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (unlisten) unlisten();
    };
  }, []);

  // Sync HerOS Design Tokens with Vault Preferences
  React.useEffect(() => {
    if (vaultData?.uiPreferences) {
      const prefs = vaultData.uiPreferences;
      const root = document.documentElement;
      
      if (prefs.themeColor) {
        root.style.setProperty('--heros-brand', prefs.themeColor);
        root.style.setProperty('--heros-bg-foundation', prefs.themeColor);
        root.style.setProperty('--heros-selection', `${prefs.themeColor}99`); // 60% opacity
      }
      
      if (prefs.glassIntensity !== undefined) {
        // Map 0-100 to logical UI ranges
        const blurValue = (prefs.glassIntensity / 100) * 40; 
        const opacityValue = 0.04 + (prefs.glassIntensity / 100) * 0.16;
        root.style.setProperty('--heros-glass-blur', `${blurValue}px`);
        root.style.setProperty('--heros-glass-fill', `rgba(255, 255, 255, ${opacityValue.toFixed(2)})`);
      }
      
      if (prefs.grainIntensity !== undefined) {
        root.style.setProperty('--heros-grain-opacity', (prefs.grainIntensity / 100).toFixed(2));
      }
      
      // Also sync celebration service
      celebrationService.setPreferences(prefs);
    }
  }, [vaultData?.uiPreferences]);

  // Handle background notifications
  React.useEffect(() => {
    let unlisten: (() => void) | null = null;
    
    const setupListener = async () => {
      // Request permission on mount
      if ("Notification" in window && Notification.permission === "default") {
        await Notification.requestPermission();
      }

      unlisten = await listen<{ accountId: string; conversationId: string }>('new-ebay-message', (event) => {
        const { accountId } = event.payload;
        
        // Show native notification
        if ("Notification" in window && Notification.permission === "granted") {
          new Notification("New eBay Message", {
            body: `New message received for account ${accountId}.`,
            icon: "/favicon_vault.png" // We can use the artifact image path later
          });
        }
        
        // Also show in-app toast
        toast.info(`New message received for ${accountId}`);
      });
    };

    setupListener();
    return () => { if (unlisten) unlisten(); };
  }, []);

  // Once booting is done, show the window (in case it was hidden)
  React.useEffect(() => {
    if (!isBooting) {
      const showWin = async () => {
        const win = getCurrentWindow();
        await win.show();
        await win.setFocus();
      };
      showWin();
    }
  }, [isBooting]);

  return (
    <HerOSViewport>
      {/* ── Global Cinematic Background Layer ── */}
      <motion.div 
        initial={{ backgroundColor: '#cc4c2b' }}
        animate={{ 
          backgroundColor: isBooting ? '#cc4c2b' : 'var(--heros-bg-foundation)',
        }}
        transition={{ duration: 1.2, ease: "easeInOut" }}
        style={{ position: 'absolute', inset: 0, zIndex: 0 }}
      />
      
      <motion.div 
        animate={{ 
          opacity: isBooting ? 0 : 1,
        }}
        className={isLocked && !isBooting ? "login-mode" : ""} 
        transition={{ duration: 1.2 }}
        style={{ position: 'absolute', inset: 0, zIndex: 1 }}
      >
        <HerOSBackground />
      </motion.div>

      <AnimatePresence>
        {isBooting ? (
          <motion.div
            key="boot"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6, ease: "easeInOut" }}
            style={{ width: '100vw', height: '100vh', position: 'relative', zIndex: 10 }}
          >
            <LoadingScreen />
          </motion.div>
        ) : isLocked ? (
          <motion.div
            key="lock"
            className="login-mode"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
            style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10 }}
          >
            
            <div data-tauri-drag-region style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 48, zIndex: 9999, cursor: 'grab' }} />
            
            <main style={{ position: 'relative', zIndex: 10, width: '100%', maxWidth: '400px', padding: '0 24px' }}>
              <HerOSPanel>
                
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '40px' }}>
                  <div style={{ width: '64px', height: '64px', borderRadius: '16px', background: 'rgba(255, 255, 255, 0.08)', border: '1px solid rgba(255, 255, 255, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '24px', boxShadow: '0 8px 32px rgba(0,0,0,0.1)' }}>
                    <LockIcon color="#f0d8d0" size={28} />
                  </div>
                  <h1 style={{ fontSize: '28px', fontWeight: 300, letterSpacing: '0.02em', color: '#fff', marginBottom: '8px', margin: 0 }}>OS<sup style={{ fontSize: '16px' }}>1</sup></h1>
                  <p style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.4em', textTransform: 'uppercase', color: 'rgba(240, 216, 208, 0.8)', textAlign: 'center', margin: 0 }}>Secure Volume</p>
                </div>

                {error && <div style={{ color: '#fff', fontSize: '13px', textAlign: 'center', marginBottom: '16px', padding: '10px', background: 'rgba(255, 0, 0, 0.2)', border: '1px solid rgba(255,0,0,0.3)', borderRadius: '8px' }}>{error}</div>}

                <form onSubmit={async (e) => { 
                  e.preventDefault(); 
                  setIsUnlockingLocal(true);
                  try {
                    await unlock(password); 
                  } finally {
                    setIsUnlockingLocal(false);
                  }
                }} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  
                  <HerOSInput 
                    type="password"
                    placeholder="Master Password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    icon={<Key color="rgba(240, 216, 208, 0.5)" size={18} />}
                  />

                  <div style={{ display: 'flex', gap: '12px' }}>
                    <HerOSButton 
                      type="submit"
                      loading={isUnlockingLocal}
                      icon={isUnlockingLocal ? <Loader className="spin" size={18} /> : <ArrowRight size={18} />}
                      style={{ flex: 1, padding: '16px', borderRadius: '12px', fontWeight: 600, fontSize: '15px', letterSpacing: '0.05em' }}
                    >
                      Unlock
                    </HerOSButton>
                    <HerOSButton 
                      type="button"
                      title="Use Biometric Unlock"
                      style={{ width: '54px', height: '54px', borderRadius: '12px', padding: 0 }}
                    >
                      <Fingerprint size={20} />
                    </HerOSButton>
                  </div>
                </form>

                <div style={{ marginTop: '36px', display: 'flex', justifyContent: 'space-between', fontSize: '14px', fontWeight: 500 }}>
                  <a href="#" style={{ color: 'rgba(255, 255, 255, 0.75)', textDecoration: 'none', transition: 'color 0.2s' }}>Forgot Password?</a>
                  <a href="#" style={{ color: 'rgba(255, 255, 255, 0.75)', textDecoration: 'none', transition: 'color 0.2s' }}>Create New Vault</a>
                </div>

              </HerOSPanel>
            </main>
          </motion.div>
        ) : (
          <motion.div
            key="shell"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
            style={{ position: 'relative', zIndex: 10, width: '100%', height: '100%' }}
          >
            <AppShell currentPage={currentPage} onNavigate={setCurrentPage} />
            <SpotlightOverlay 
              isOpen={isSpotlightOpen} 
              onClose={() => setIsSpotlightOpen(false)}
              onAction={(action) => {
                if (['dashboard', 'inbox', 'security', 'activity', 'capture', 'settings'].includes(action)) {
                  setCurrentPage(action);
                }
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>
      <Toaster 
        theme="dark" 
        position={vaultData?.uiPreferences?.toastPosition || "top-right"} 
        richColors 
        closeButton
      />
    </HerOSViewport>
  );
}

export default function App() {
  return (
    <LayoutProvider>
      <VaultProvider>
        <AppContent />
      </VaultProvider>
    </LayoutProvider>
  );
}
