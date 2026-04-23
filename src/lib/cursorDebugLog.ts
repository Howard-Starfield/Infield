import { invoke } from '@tauri-apps/api/core'

const SESSION = '840aad'

/** NDJSON line to workspace `debug-840aad.log` via Tauri (works when ingest HTTP does not). */
export function cursorDebugLog(payload: Record<string, unknown>) {
  const line = JSON.stringify({
    sessionId: SESSION,
    timestamp: Date.now(),
    ...payload,
  })
  // #region agent log
  void invoke('append_cursor_debug_log', { line }).catch((err) => {
    try {
      sessionStorage.setItem(
        'cursor_debug_last_invoke_error',
        `${Date.now()}:${String(err)}`,
      )
    } catch {
      /* ignore */
    }
  })
  // #endregion
}
