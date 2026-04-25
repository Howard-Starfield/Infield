import { useEffect, useState, useCallback } from 'react';
import { listen } from '@tauri-apps/api/event';
import { commands } from '../bindings';
import type { ImportQueueSnapshot } from '../bindings';

export function useImportQueue() {
  const [snapshot, setSnapshot] = useState<ImportQueueSnapshot | null>(null);
  const [paused, setPaused] = useState(false);

  const refresh = useCallback(async () => {
    const snapResult = await commands.getImportQueue();
    if (snapResult.status === 'ok') {
      setSnapshot(snapResult.data);
    }
    const pausedResult = await commands.importQueuePauseState();
    if (pausedResult.status === 'ok') {
      setPaused(pausedResult.data);
    }
  }, []);

  useEffect(() => {
    refresh();
    const unlistenP = listen('import-queue-updated', () => { refresh(); });
    return () => { unlistenP.then(u => u()); };
  }, [refresh]);

  const cancel = useCallback(async (jobId: string) => {
    await commands.cancelImportJob(jobId);
    refresh();
  }, [refresh]);

  const pause = useCallback(async () => {
    await commands.pauseImportQueue();
    setPaused(true);
  }, []);

  const resume = useCallback(async () => {
    await commands.resumeImportQueue();
    setPaused(false);
  }, []);

  return { jobs: snapshot?.jobs ?? [], paused, cancel, pause, resume, refresh };
}
