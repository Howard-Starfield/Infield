import React, { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { commands } from '../bindings';
import { TitleBar } from './TitleBar';
import { IconRail } from './IconRail';
import { InboxView } from './InboxView';
import { SettingsView } from './SettingsView';
import { useVault } from '../contexts/VaultContext';
import { motion, AnimatePresence } from 'motion/react';
import { useLayout } from '../contexts/LayoutContext';
import { DashboardView } from './DashboardView';
import { ActivityView } from './ActivityView';
import { SecurityView } from './SecurityView';
import { CaptureView } from './CaptureView';
import { SearchView } from './SearchView';
import { ImportView } from './ImportView';
import { AudioView } from './AudioView';
import { SystemAudioView } from './SystemAudioView';
import { NotesView } from './NotesView';
import { DatabasesView } from './DatabasesView';
import { BuddyView } from './BuddyView';
import { SpotlightOverlay } from './SpotlightOverlay';

import { HerOSBackground } from './HerOS';

import { AboutView } from './AboutView';

interface AppShellProps {
  currentPage: string;
  onNavigate: (page: string) => void;
}

export default function AppShell({ currentPage, onNavigate }: AppShellProps) {
  const { vaultData } = useVault();
  const { isLayoutMode } = useLayout();
  const [isNavExpanded, setIsNavExpanded] = useState(false);
  const [spotlightVisible, setSpotlightVisible] = useState(false)

  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      // Cmd+N → new root doc (only on notes page)
      if (e.key.toLowerCase() === 'n' && !e.shiftKey && currentPage === 'notes') {
        e.preventDefault()
        try {
          const res = await commands.createNode(null, 'document', 'Untitled')
          if (res.status === 'ok') {
            window.dispatchEvent(new CustomEvent('notes:open', { detail: res.data.id }))
          } else {
            toast.error('Could not create document', { description: res.error })
          }
        } catch (err) {
          toast.error('Could not create document', {
            description: err instanceof Error ? err.message : String(err),
          })
        }
      }
      // Cmd+Shift+J → today's daily note
      if (e.key.toLowerCase() === 'j' && e.shiftKey) {
        e.preventDefault()
        const iso = new Date().toISOString().slice(0, 10)
        try {
          const res = await commands.getOrCreateDailyNote(iso)
          if (res.status === 'ok') {
            onNavigate('notes')
            window.dispatchEvent(new CustomEvent('notes:open', { detail: res.data.id }))
          } else {
            toast.error("Couldn't open today's daily note", { description: res.error })
          }
        } catch (err) {
          toast.error("Couldn't open today's daily note", {
            description: err instanceof Error ? err.message : String(err),
          })
        }
      }
      // Cmd+T → new tab + new doc (notes only; auto-navigate if elsewhere).
      if (e.key.toLowerCase() === 't' && !e.shiftKey) {
        e.preventDefault()
        onNavigate('notes')
        window.dispatchEvent(new Event('notes:new-tab'))
        return
      }
      // Cmd+W → close active tab (notes only).
      if (e.key.toLowerCase() === 'w' && currentPage === 'notes') {
        e.preventDefault()
        window.dispatchEvent(new Event('notes:close-active'))
        return
      }
      // Cmd+1..9 → switch tab (notes only; 1-based from user, 0-based in state).
      if (currentPage === 'notes' && /^[1-9]$/.test(e.key)) {
        // Skip when focus is in an editable element — let the field/CM6 see the digit.
        const target = e.target as HTMLElement | null
        const tag = target?.tagName
        if (
          tag === 'INPUT' ||
          tag === 'TEXTAREA' ||
          target?.isContentEditable ||
          target?.closest('.cm-editor')
        ) return
        e.preventDefault()
        const idx = Number(e.key) - 1
        window.dispatchEvent(new CustomEvent('notes:switch-index', { detail: idx }))
        return
      }
      // Cmd+K → toggle Spotlight (any page).
      if (e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSpotlightVisible((v) => !v)
        return
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [currentPage, onNavigate])

  const workspaceLabel = vaultData?.workspaceLabel || 'Workspace';
  const displayPath = `${workspaceLabel} / ${currentPage === 'dashboard' ? 'Home' : currentPage.charAt(0).toUpperCase() + currentPage.slice(1)}`;

  const pageVariants = {
    initial: { opacity: 0, y: 8, filter: 'blur(4px)' },
    animate: { opacity: 1, y: 0, filter: 'blur(0px)' },
    exit: { opacity: 0, y: -8, filter: 'blur(4px)' }
  };

  const transition = {
    type: "spring",
    stiffness: 380,
    damping: 30,
    mass: 1
  };

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {spotlightVisible && (
        <SpotlightOverlay
          onDismiss={() => setSpotlightVisible(false)}
          onOpenPreview={(nodeId) => {
            setSpotlightVisible(false)
            onNavigate('notes')
            window.dispatchEvent(new CustomEvent('notes:open', { detail: nodeId }))
          }}
          onOpenInNewTab={(nodeId) => {
            setSpotlightVisible(false)
            onNavigate('notes')
            window.dispatchEvent(new CustomEvent('notes:open-new-tab', { detail: nodeId }))
          }}
        />
      )}
      <TitleBar
        currentPath={displayPath}
        isNavExpanded={isNavExpanded}
        onToggleNav={() => setIsNavExpanded((value) => !value)}
      />
      <div className={`app-shell ${isLayoutMode ? 'edit-mode' : ''}`}>
        <IconRail currentPage={currentPage} onNavigate={onNavigate} isExpanded={isNavExpanded} />
        <main style={{ flex: 1, position: 'relative', display: 'flex', overflow: 'hidden' }}>
          <AnimatePresence mode="wait">
            <motion.div
              key={currentPage}
              initial="initial"
              animate="animate"
              exit="exit"
              variants={pageVariants}
              transition={transition}
              style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}
            >
              {currentPage === 'dashboard' && <DashboardView onNavigate={onNavigate} />}
              {currentPage === 'buddy' && <BuddyView />}
              {currentPage === 'about' && <AboutView />}
              {currentPage === 'search' && <SearchView />}
              {currentPage === 'import' && <ImportView />}
              {currentPage === 'audio' && <AudioView />}
              {currentPage === 'system-audio' && <SystemAudioView />}
              {currentPage === 'notes' && <NotesView />}
              {currentPage === 'databases' && <DatabasesView />}
              {currentPage === 'inbox' && <InboxView onNavigate={onNavigate} />}
              {currentPage === 'activity' && <ActivityView onNavigate={onNavigate} />}
              {currentPage === 'security' && <SecurityView onNavigate={onNavigate} />}
              {currentPage === 'capture' && <CaptureView onNavigate={onNavigate} />}
              {currentPage === 'settings' && <div style={{ flex: 1, overflow: 'auto' }}><SettingsView onNavigate={onNavigate} /></div>}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}

