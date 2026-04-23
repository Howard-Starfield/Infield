import React from 'react';
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

import { HerOSBackground } from './HerOS';

import { AboutView } from './AboutView';

interface AppShellProps {
  currentPage: string;
  onNavigate: (page: string) => void;
}

export default function AppShell({ currentPage, onNavigate }: AppShellProps) {
  const { vaultData } = useVault();
  const { isLayoutMode } = useLayout();
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
      <TitleBar currentPath={displayPath} />
      <div className={`app-shell ${isLayoutMode ? 'edit-mode' : ''}`}>
        <IconRail currentPage={currentPage} onNavigate={onNavigate} />
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

