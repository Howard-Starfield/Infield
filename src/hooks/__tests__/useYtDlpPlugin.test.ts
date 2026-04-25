import { renderHook, waitFor } from '@testing-library/react';
import { useYtDlpPlugin } from '../useYtDlpPlugin';
import { vi } from 'vitest';

vi.mock('../../bindings', () => ({
  commands: {
    ytDlpPluginStatus: vi.fn().mockResolvedValue({
      status: 'ok',
      data: {
        installed: false,
        version: null,
        installed_at: null,
        last_checked_at: null,
        latest_available: null,
        size_bytes: null,
      },
    }),
    installYtDlpPlugin: vi.fn().mockResolvedValue({ status: 'ok', data: null }),
    checkYtDlpUpdate: vi.fn().mockResolvedValue({
      status: 'ok',
      data: { current: null, latest: 'v1', update_available: true },
    }),
    uninstallYtDlpPlugin: vi.fn().mockResolvedValue({ status: 'ok', data: null }),
  },
}));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

test('initial status reflects not installed', async () => {
  const { result } = renderHook(() => useYtDlpPlugin());
  await waitFor(() => expect(result.current.status?.installed).toBe(false));
});

test('installing starts as false', () => {
  const { result } = renderHook(() => useYtDlpPlugin());
  expect(result.current.installing).toBe(false);
});

test('installProgress starts as null', () => {
  const { result } = renderHook(() => useYtDlpPlugin());
  expect(result.current.installProgress).toBeNull();
});
