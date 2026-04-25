import { useState, useEffect, useRef } from 'react';
import { Upload } from 'lucide-react';
import { commands } from '../bindings';
import { useImportQueue } from '../hooks/useImportQueue';
import { useYtDlpPlugin } from '../hooks/useYtDlpPlugin';
import type {
  ImportJobDto,
  UrlMetadataResult,
  AlreadyImportedHit,
  PlaylistEnvelope,
  WebMediaImportOpts,
} from '../bindings';
import '../styles/import.css';

const TERMINAL_STATES = new Set<ImportJobDto['state']>(['done', 'error', 'cancelled']);

const PLAYLIST_RE = /[?&]list=|playlist\?list=/;

// ── Helpers ────────────────────────────────────────────────────
export function detectUrls(text: string): string[] {
  return Array.from(new Set(
    text.split(/[\s\n]+/)
      .map(s => s.trim())
      .filter(s => /^https?:\/\/\S+\.\S+/.test(s))
  ));
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

function defaultOpts(): WebMediaImportOpts {
  return {
    keep_media: false,
    format: { kind: 'mp_3_audio' },
    parent_folder_node_id: null,
    playlist_source: null,
  };
}

// ── Preview state machine ──────────────────────────────────────
type PreviewState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; meta: UrlMetadataResult; alreadyImported: AlreadyImportedHit | null }
  | { kind: 'playlist'; envelope: PlaylistEnvelope }
  | { kind: 'live' }
  | { kind: 'error'; message: string };

// ── Top-level view ─────────────────────────────────────────────
export function ImportView() {
  const { jobs, paused, cancel, pause, resume } = useImportQueue();
  const plugin = useYtDlpPlugin();
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewState>({ kind: 'idle' });
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced fetch when selectedUrl changes
  useEffect(() => {
    if (!selectedUrl) {
      setPreview({ kind: 'idle' });
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setPreview({ kind: 'loading' });
    debounceRef.current = setTimeout(async () => {
      // Playlist detection by URL shape before fetching
      if (PLAYLIST_RE.test(selectedUrl)) {
        const res = await commands.fetchPlaylistEntries(selectedUrl);
        if (res.status === 'ok') {
          setPreview({ kind: 'playlist', envelope: res.data });
        } else {
          setPreview({ kind: 'error', message: res.error });
        }
        return;
      }
      const res = await commands.fetchUrlMetadata(selectedUrl);
      if (res.status === 'error') {
        setPreview({ kind: 'error', message: res.error });
        return;
      }
      const meta = res.data;
      if (meta.is_live) {
        setPreview({ kind: 'live' });
        return;
      }
      setPreview({ kind: 'ready', meta, alreadyImported: meta.already_imported });
    }, 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [selectedUrl]);

  async function commitSingle(opts: WebMediaImportOpts) {
    if (!selectedUrl) return;
    const urls = [selectedUrl];
    await commands.enqueueImportUrls(urls, opts);
    setSelectedUrl(null);
    setPreview({ kind: 'idle' });
  }

  const processing = jobs.filter(j => !TERMINAL_STATES.has(j.state));
  const completed = jobs.filter(j => TERMINAL_STATES.has(j.state));

  return (
    <div className="heros-page-container import-view">
      <header className="import-view__header">
        <div className="import-view__icon"><Upload size={32} /></div>
        <h1>Intelligence Ingestion</h1>
        <p>Bring external knowledge in. Indexed and embedded locally.</p>
      </header>
      <div className="import-view__grid">
        <section className="import-view__left heros-glass-card">
          {!plugin.status?.installed && <PluginMissingBanner plugin={plugin} />}
          <UrlInputSection
            onSingle={url => setSelectedUrl(url)}
            onBulk={urls => {
              // Task 29 wires bulk handler; placeholder for now
              console.log('[ImportView] bulk enqueue', urls);
            }}
          />
          <PreviewSection preview={preview} onCommit={commitSingle} />
        </section>
        <div className="import-view__right">
          <ProcessingPanel
            jobs={processing}
            paused={paused}
            pause={pause}
            resume={resume}
            cancel={cancel}
          />
          <CompletedPanel jobs={completed} />
        </div>
      </div>
    </div>
  );
}

// ── URL input section ──────────────────────────────────────────
function UrlInputSection({
  onSingle,
  onBulk,
}: {
  onSingle: (url: string) => void;
  onBulk: (urls: string[]) => void;
}) {
  const [text, setText] = useState('');
  const urls = detectUrls(text);
  const isBulk = urls.length > 1;
  const isSingle = urls.length === 1;

  function handleSubmit() {
    if (isSingle) {
      onSingle(urls[0]);
    } else if (isBulk) {
      onBulk(urls);
    }
  }

  return (
    <div className="url-input">
      <textarea
        className="url-input__textarea"
        rows={5}
        placeholder={"Paste a URL or multiple URLs (one per line)\nhttps://youtube.com/watch?v=…"}
        value={text}
        onChange={e => setText(e.target.value)}
      />
      <div className="url-input__controls">
        <button
          className="heros-btn heros-btn-brand"
          disabled={urls.length === 0}
          onClick={handleSubmit}
        >
          {isBulk ? `Import ${urls.length} URLs` : 'Preview'}
        </button>
        {urls.length > 0 && (
          <span className="url-input__count">
            {urls.length} URL{urls.length !== 1 ? 's' : ''} detected
          </span>
        )}
      </div>
    </div>
  );
}

// ── Preview section (dispatches on PreviewState) ───────────────
function PreviewSection({
  preview,
  onCommit,
}: {
  preview: PreviewState;
  onCommit: (opts: WebMediaImportOpts) => void;
}) {
  if (preview.kind === 'idle') return null;
  if (preview.kind === 'loading') return <div className="preview-skeleton" />;
  if (preview.kind === 'live') return <PreviewLive />;
  if (preview.kind === 'error') return (
    <p className="import-view__empty" style={{ color: 'var(--error)' }}>
      {preview.message.includes('403') || preview.message.toLowerCase().includes('sign in')
        ? 'Authentication required — content is restricted.'
        : preview.message.includes('geo') || preview.message.toLowerCase().includes('region')
          ? 'Content regionally unavailable.'
          : `Could not fetch metadata: ${preview.message}`}
    </p>
  );
  if (preview.kind === 'playlist') return <PreviewPlaylist envelope={preview.envelope} onCommit={onCommit} />;
  // ready
  return (
    <PreviewCard
      meta={preview.meta}
      alreadyImported={preview.alreadyImported}
      onCommit={() => onCommit(defaultOpts())}
    />
  );
}

// ── PreviewCard ────────────────────────────────────────────────
function PreviewCard({
  meta,
  alreadyImported,
  onCommit,
}: {
  meta: UrlMetadataResult;
  alreadyImported: AlreadyImportedHit | null | undefined;
  onCommit: () => void;
}) {
  return (
    <div className={`preview-card${alreadyImported ? ' preview-card--already' : ''}`}>
      {meta.thumbnail_url && (
        <img
          className="preview-card__thumb"
          src={meta.thumbnail_url}
          alt={meta.title}
          loading="lazy"
        />
      )}
      <div className="preview-card__body">
        <strong style={{ fontSize: 'var(--text-sm)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {meta.title}
        </strong>
        <span className="preview-card__meta">
          {[meta.channel, meta.platform, meta.duration_seconds != null ? formatDuration(meta.duration_seconds) : null]
            .filter(Boolean).join(' · ')}
        </span>
        {alreadyImported ? (
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            <span className="import-view__empty" style={{ padding: 0, textAlign: 'left' }}>
              Already imported
            </span>
            <button className="heros-btn" onClick={onCommit} style={{ fontSize: 'var(--text-xs)' }}>
              Import anyway
            </button>
          </div>
        ) : (
          <button className="heros-btn heros-btn-brand" onClick={onCommit}>
            Import →
          </button>
        )}
      </div>
    </div>
  );
}

// ── PreviewPlaylist ────────────────────────────────────────────
function PreviewPlaylist({
  envelope,
  onCommit,
}: {
  envelope: PlaylistEnvelope;
  onCommit: (opts: WebMediaImportOpts) => void;
}) {
  return (
    <div className="preview-card">
      <div className="preview-card__body">
        <strong style={{ fontSize: 'var(--text-sm)' }}>{envelope.playlist_title}</strong>
        <span className="preview-card__meta">
          {envelope.entries.length} items{envelope.channel ? ` · ${envelope.channel}` : ''}
        </span>
        <p className="import-view__empty" style={{ padding: 0, textAlign: 'left', fontSize: 'var(--text-xs)' }}>
          Playlist selector (Task 30) — import all or pick tracks.
        </p>
        <button
          className="heros-btn heros-btn-brand"
          onClick={() => onCommit(defaultOpts())}
        >
          Import all ({envelope.entries.length})
        </button>
      </div>
    </div>
  );
}

// ── PreviewLive ────────────────────────────────────────────────
function PreviewLive() {
  return (
    <p className="import-view__empty">Live streams are not supported yet.</p>
  );
}

// ── Plugin missing banner ──────────────────────────────────────
function PluginMissingBanner({ plugin }: { plugin: ReturnType<typeof useYtDlpPlugin> }) {
  if (plugin.installing) {
    const p = plugin.installProgress;
    let label = 'Preparing…';
    if (p?.phase === 'downloading') {
      const pct = p.total ? Math.round((p.bytes / p.total) * 100) : 0;
      label = `Downloading… ${pct}%`;
    } else if (p?.phase === 'verifying') label = 'Verifying…';
    else if (p?.phase === 'finalizing') label = 'Installing…';
    return <div className="plugin-banner">{label}</div>;
  }
  return (
    <div className="plugin-banner">
      <div>
        <strong>Media downloader not installed</strong>
        <p>~12 MB · Required for URL imports</p>
      </div>
      <button className="heros-btn heros-btn-brand" onClick={plugin.install}>Install</button>
    </div>
  );
}

// ── Job list panels ────────────────────────────────────────────
type Job = ImportJobDto;

function ProcessingPanel({ jobs, paused, pause, resume, cancel }: {
  jobs: Job[];
  paused: boolean;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  cancel: (id: string) => Promise<void>;
}) {
  return (
    <section className="import-view__panel heros-glass-panel">
      <div className="import-view__panel-title">
        Processing ({jobs.length})
        {jobs.length > 0 && (
          <button
            className="heros-btn"
            onClick={() => (paused ? resume() : pause())}
            style={{ marginLeft: 'var(--space-3)' }}
          >
            {paused ? 'Resume' : 'Pause'}
          </button>
        )}
      </div>
      {jobs.length === 0 ? (
        <p className="import-view__empty">Nothing in flight.</p>
      ) : (
        <ul>
          {jobs.map(j => (
            <li key={j.id}>
              {j.file_name} — {j.state}
              <button className="heros-btn" onClick={() => cancel(j.id)} style={{ marginLeft: 'var(--space-2)' }}>
                Cancel
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CompletedPanel({ jobs }: { jobs: Job[] }) {
  return (
    <section className="import-view__panel heros-glass-panel">
      <div className="import-view__panel-title">Recent ({jobs.length})</div>
      {jobs.length === 0 ? (
        <p className="import-view__empty">Nothing yet.</p>
      ) : (
        <ul>
          {jobs.map(j => (
            <li key={j.id}>{j.file_name} — {j.state}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
