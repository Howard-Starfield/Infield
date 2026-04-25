import { useCallback, useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { commands } from '../bindings';
import type { PluginStatus, UpdateCheckResult } from '../bindings';

// InstallProgress: not exported from Rust (no Type derive on the enum);
// define a matching TS shape inline so consumers can type progress events.
export type InstallProgress =
  | { phase: 'fetching_metadata' }
  | { phase: 'downloading'; bytes: number; total: number | null }
  | { phase: 'verifying' }
  | { phase: 'finalizing' }
  | { phase: 'done' };

export function useYtDlpPlugin() {
  const [status, setStatus] = useState<PluginStatus | null>(null);
  const [installProgress, setInstallProgress] = useState<InstallProgress | null>(null);
  const [installing, setInstalling] = useState(false);

  const refresh = useCallback(async () => {
    const result = await commands.ytDlpPluginStatus();
    if (result.status === 'ok') {
      setStatus(result.data);
    }
  }, []);

  useEffect(() => {
    refresh();
    const offState = listen('plugin-state-changed', () => refresh());
    const offProg = listen<InstallProgress>('plugin-install-progress', e => setInstallProgress(e.payload));
    return () => { offState.then(u => u()); offProg.then(u => u()); };
  }, [refresh]);

  const install = useCallback(async () => {
    setInstalling(true);
    setInstallProgress(null);
    try {
      await commands.installYtDlpPlugin();
    } finally {
      setInstalling(false);
      refresh();
    }
  }, [refresh]);

  const checkUpdate = useCallback(async (): Promise<UpdateCheckResult | null> => {
    const result = await commands.checkYtDlpUpdate();
    refresh();
    if (result.status === 'ok') {
      return result.data;
    }
    return null;
  }, [refresh]);

  const uninstall = useCallback(async () => {
    await commands.uninstallYtDlpPlugin();
    refresh();
  }, [refresh]);

  return { status, installProgress, installing, install, checkUpdate, uninstall, refresh };
}
