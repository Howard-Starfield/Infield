import { useState } from 'react';
import { Download } from 'lucide-react';
import { useYtDlpPlugin } from '../hooks/useYtDlpPlugin';
import type { UpdateCheckResult } from '../bindings';
import '../styles/settings-extensions.css';

function formatRelative(iso: string | null): string {
  if (!iso) return 'never';
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return new Date(iso).toLocaleDateString();
}

export function SettingsExtensionsView() {
  const plugin = useYtDlpPlugin();
  const [updateCheck, setUpdateCheck] = useState<UpdateCheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleCheckUpdate = async () => {
    setError(null);
    try {
      const r = await plugin.checkUpdate();
      setUpdateCheck(r);
    } catch (e) {
      setError(String(e));
    }
  };

  const handleInstall = async () => {
    setError(null);
    try { await plugin.install(); }
    catch (e) { setError(String(e)); }
  };

  const handleUninstall = async () => {
    if (!confirm('Uninstall yt-dlp? Active URL imports will be cancelled.')) return;
    setError(null);
    try { await plugin.uninstall(); }
    catch (e) { setError(String(e)); }
  };

  const installed = plugin.status?.installed ?? false;

  return (
    <div className="settings-extensions">
      <h2>Extensions</h2>
      <div className="extension-card heros-glass-card">
        <div className="extension-card__icon">
          <Download size={32} />
        </div>
        <div className="extension-card__body">
          <h3>Media downloader (yt-dlp)</h3>
          <p className="extension-card__status">
            {installed
              ? `Installed · v${plugin.status?.version ?? '?'} · Last checked ${formatRelative(plugin.status?.last_checked_at ?? null)}`
              : 'Not installed · 12 MB'}
          </p>
          <p className="extension-card__desc">
            Enables URL imports from YouTube, podcasts, and 1000+ other sites.
          </p>
          <div className="extension-card__actions">
            {installed ? (
              <>
                <button className="heros-btn" onClick={() => void handleCheckUpdate()}>Check for update</button>
                <button className="heros-btn heros-btn-danger" onClick={() => void handleUninstall()}>Uninstall</button>
              </>
            ) : (
              <button
                className="heros-btn heros-btn-brand"
                onClick={() => void handleInstall()}
                disabled={plugin.installing}
              >
                {plugin.installing ? 'Installing…' : 'Install (12 MB)'}
              </button>
            )}
          </div>
          {updateCheck?.update_available && (
            <p className="extension-card__update">Update available: v{updateCheck.latest}</p>
          )}
          {error && <p className="extension-card__error">{error}</p>}
        </div>
      </div>
    </div>
  );
}
