import { useState, useEffect, useRef } from 'react';
import { Upload } from 'lucide-react';
import { commands } from '../bindings';
import { useImportQueue } from '../hooks/useImportQueue';
import { useYtDlpPlugin } from '../hooks/useYtDlpPlugin';
import { PlaylistSelectorModal } from './PlaylistSelectorModal';
import type {
  ImportJobDto,
  UrlMetadataResult,
  AlreadyImportedHit,
  PlaylistEnvelope,
  PlaylistEntry,
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
    format: { kind: 'mp3_audio' },
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
    const result = await commands.enqueueImportUrls(urls, opts);
    if (result.status === 'error') {
      console.error('enqueueImportUrls failed:', result.error);
      return;
    }
    setSelectedUrl(null);
    setPreview({ kind: 'idle' });
  }

  async function commitBulk(urls: string[], opts: WebMediaImportOpts) {
    const result = await commands.enqueueImportUrls(urls, opts);
    if (result.status === 'error') {
      console.error('enqueueImportUrls failed:', result.error);
    }
  }

  async function commitPlaylist(
    envelope: PlaylistEnvelope,
    sel: PlaylistEntry[],
    opts: WebMediaImportOpts,
  ) {
    for (let index = 0; index < sel.length; index++) {
      const e = sel[index];
      const result = await commands.enqueueImportUrls([e.url], {
        ...opts,
        playlist_source: { title: envelope.playlist_title, url: envelope.playlist_url, index },
      });
      if (result.status === 'error') console.error('enqueue failed:', result.error);
    }
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
            onBulk={urls => commitBulk(urls, defaultOpts())}
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
      {preview.kind === 'playlist' && (
        <PlaylistSelectorModal
          envelope={preview.envelope}
          onCancel={() => setPreview({ kind: 'idle' })}
          onCommit={sel => commitPlaylist(preview.envelope, sel, defaultOpts())}
        />
      )}
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
  // playlist is handled as a full-screen modal overlay at ImportView level
  if (preview.kind === 'playlist') return null;
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

// ── Queue row helpers ──────────────────────────────────────────
const TERMINAL = new Set<ImportJobDto['state']>(['done', 'error', 'cancelled']);
function isTerminal(state: ImportJobDto['state']) { return TERMINAL.has(state); }

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function renderSubtitle(job: ImportJobDto): string {
  switch (job.state) {
    case 'queued': return 'Queued';
    case 'fetching_meta': return 'Fetching metadata…';
    case 'downloading': {
      const b = job.download_bytes ?? 0;
      const t = job.download_total_bytes;
      return `${formatBytes(b)}${t ? ` / ${formatBytes(t)}` : ''}${job.download_speed_human ? ` · ${job.download_speed_human}` : ''}`;
    }
    case 'preparing':
    case 'segmenting': return 'Preparing audio…';
    case 'transcribing': return job.message ?? `Transcribing · ${job.segment_index} / ${job.segment_count}`;
    case 'post_processing':
    case 'finalizing': return 'Finalizing…';
    case 'extracting_text': return 'Extracting text…';
    case 'creating_note': return 'Creating note…';
    case 'draft_created': return 'Preparing transcription…';
    case 'done': return job.note_id ? 'Saved' : 'Done';
    case 'error': return job.message ?? 'Error';
    case 'cancelled': return 'Cancelled';
    default: return job.state;
  }
}

function PlatformGlyph({ platform, kind }: { platform?: string | null; kind: string }) {
  return (
    <span className="queue-row__glyph">
      {platform?.[0]?.toUpperCase() ?? kind[0].toUpperCase()}
    </span>
  );
}

function QueueRowActions({
  job,
  onCancel,
  onRetry,
  onOpen,
}: {
  job: ImportJobDto;
  onCancel: () => void;
  onRetry?: () => void;
  onOpen?: () => void;
}) {
  if (job.state === 'error' || job.state === 'cancelled') {
    return (
      <>
        {onRetry && <button className="heros-btn" onClick={onRetry}>Retry</button>}
        <button className="heros-btn" onClick={onCancel}>Dismiss</button>
      </>
    );
  }
  if (job.state === 'done') {
    return onOpen ? <button className="heros-btn" onClick={onOpen}>Open</button> : null;
  }
  return <button className="heros-btn" onClick={onCancel}>Cancel</button>;
}

function QueueRow({
  job,
  onCancel,
  onRetry,
  onOpen,
}: {
  job: ImportJobDto;
  onCancel: () => void;
  onRetry?: () => void;
  onOpen?: () => void;
}) {
  const thumb = job.web_meta?.thumbnail_url;
  return (
    <div className="queue-row">
      <div className="queue-row__icon">
        {thumb
          ? <img src={thumb} alt="" />
          : <PlatformGlyph platform={job.web_meta?.platform} kind={job.kind} />}
      </div>
      <div className="queue-row__body">
        <div className="queue-row__title">{job.web_meta?.title ?? job.file_name}</div>
        <small className="queue-row__sub">{renderSubtitle(job)}</small>
        {!isTerminal(job.state) && (
          <div className="queue-row__bar">
            <div
              className="queue-row__bar-fill"
              style={{ width: `${Math.round(job.progress * 100)}%` }}
            />
          </div>
        )}
      </div>
      <div className="queue-row__right">
        <QueueRowActions job={job} onCancel={onCancel} onRetry={onRetry} onOpen={onOpen} />
      </div>
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
  const active = jobs.filter(j => j.state !== 'queued').length;
  const queued = jobs.filter(j => j.state === 'queued').length;

  return (
    <section className="import-view__panel heros-glass-panel">
      <div className="import-view__panel-title">
        <span>
          Processing
          {jobs.length > 0 && (
            <span className="queue-count-summary">
              {active > 0 && ` · active ${active}`}
              {queued > 0 && ` · queued ${queued}`}
            </span>
          )}
        </span>
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
        <div className="queue-list">
          {jobs.map(j => (
            <QueueRow
              key={j.id}
              job={j}
              onCancel={() => cancel(j.id)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function CompletedPanel({ jobs }: { jobs: Job[] }) {
  // No "clear completed" command exists in v1; the queue auto-rotates on the backend.
  // Showing all terminal jobs as-is.
  return (
    <section className="import-view__panel heros-glass-panel">
      <div className="import-view__panel-title">Recent ({jobs.length})</div>
      {jobs.length === 0 ? (
        <p className="import-view__empty">Nothing yet.</p>
      ) : (
        <div className="queue-list">
          {jobs.map(j => (
            <QueueRow key={j.id} job={j} onCancel={() => {}} />
          ))}
        </div>
      )}
    </section>
  );
}
