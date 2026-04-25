import { renderHook, waitFor } from '@testing-library/react';
import { useImportQueue } from '../useImportQueue';
import { vi } from 'vitest';

vi.mock('../../bindings', () => ({
  commands: {
    getImportQueue: vi.fn().mockResolvedValue({ status: 'ok', data: { jobs: [] } }),
    importQueuePauseState: vi.fn().mockResolvedValue({ status: 'ok', data: false }),
    cancelImportJob: vi.fn().mockResolvedValue({ status: 'ok', data: null }),
    pauseImportQueue: vi.fn().mockResolvedValue({ status: 'ok', data: null }),
    resumeImportQueue: vi.fn().mockResolvedValue({ status: 'ok', data: null }),
  },
}));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

test('returns empty snapshot initially', async () => {
  const { result } = renderHook(() => useImportQueue());
  await waitFor(() => expect(result.current.jobs).toEqual([]));
});

test('paused is false by default', async () => {
  const { result } = renderHook(() => useImportQueue());
  await waitFor(() => expect(result.current.paused).toBe(false));
});
