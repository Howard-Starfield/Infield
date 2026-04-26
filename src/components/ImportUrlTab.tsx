import { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Link2, Clock, CheckCircle2, FileText, Globe, ChevronDown, ChevronUp, Download,
} from 'lucide-react';
import { commands } from '../bindings';
import { useImportQueue } from '../hooks/useImportQueue';
import { useYtDlpPlugin } from '../hooks/useYtDlpPlugin';
import { PlaylistSelectorModal } from './PlaylistSelectorModal';
import { ScrollShadow } from './ScrollShadow';
import type {
  ImportJobDto,
  UrlMetadataResult,
  AlreadyImportedHit,
  PlaylistEnvelope,
  PlaylistEntry,
  WebMediaImportOpts,
} from '../bindings';
import '../styles/import.css';
import { emitBuddyEvent } from '../buddy/events';

const TERMINAL_STATES = new Set<ImportJobDto['state']>(['done', 'error', 'cancelled']);
const PLAYLIST_RE = /[?&]list=|playlist\?list=/;

// ── Helpers ────────────────────────────────────────────────────
export function detectUrls(text: string): string[] {
  return Array.from(new Set(
    text.split(/[\s\n,]+/)
      .map(s => s.trim())
      .filter(s => /^https?:\/\/\S+\.\S+/.test(s))
  ));
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function makeOpts(keepMedia: boolean): WebMediaImportOpts {
  return {
    keep_media: keepMedia,
    format: { kind: 'mp3_audio' },
    parent_folder_node_id: null,
    playlist_source: null,
  };
}

function jobProgress(job: ImportJobDto): number {
  if (job.state === 'done') return 100;
  if (job.state === 'fetching_meta') return 5;
  if (job.state === 'downloading') {
    const t = job.download_total_bytes ?? 0;
    const b = job.download_bytes ?? 0;
    if (t > 0) return Math.min(50, 10 + Math.round((b / t) * 40));
    return 20;
  }
  if (job.state === 'preparing' || job.state === 'segmenting') return 55;
  if (job.state === 'transcribing') {
    if (job.segment_count > 0) {
      return 60 + Math.round((job.segment_index / job.segment_count) * 30);
    }
    return 65;
  }
  if (job.state === 'post_processing' || job.state === 'finalizing') return 95;
  return 0;
}

function jobStatusLine(job: ImportJobDto): string {
  switch (job.state) {
    case 'queued': return 'Queued';
    case 'fetching_meta': return 'Fetching metadata…';
    case 'downloading': {
      const b = job.download_bytes ?? 0;
      const t = job.download_total_bytes;
      const sizeStr = t ? `${formatBytes(b)} / ${formatBytes(t)}` : formatBytes(b);
      return `Downloading · ${sizeStr}${job.download_speed_human ? ` · ${job.download_speed_human}` : ''}`;
    }
    case 'preparing': case 'segmenting': return 'Preparing audio…';
    case 'transcribing':
      return job.segment_count > 0
        ? `Transcribing · ${job.segment_index} / ${job.segment_count}`
        : 'Transcribing…';
    case 'post_processing': case 'finalizing': return 'Finalizing…';
    case 'done': return 'Saved';
    case 'error': return job.message ?? 'Error';
    case 'cancelled': return 'Cancelled';
    default: return job.state;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function jobTitle(job: ImportJobDto): string {
  return job.web_meta?.title ?? job.file_name;
}

// ── Per-URL preview state ──────────────────────────────────────
type PreviewState =
  | { kind: 'loading' }
  | { kind: 'ready'; meta: UrlMetadataResult; alreadyImported: AlreadyImportedHit | null }
  | { kind: 'playlist'; envelope: PlaylistEnvelope }
  | { kind: 'live' }
  | { kind: 'error'; message: string };

type Format = 'mp3' | 'mp4';

// ── Tab root (ReClip-style single-column layout) ───────────────
export function ImportUrlTab() {
  const { jobs } = useImportQueue();
  const plugin = useYtDlpPlugin();
  const [text, setText] = useState('');
  const [format, setFormat] = useState<Format>('mp3');
  const [keepMedia, setKeepMedia] = useState(true);
  const [previews, setPreviews] = useState<Record<string, PreviewState>>({});
  const [fetching, setFetching] = useState(false);
  const [activePlaylistUrl, setActivePlaylistUrl] = useState<string | null>(null);

  const urls = detectUrls(text);

  // Emit buddy:url-imported once per job transitioning into `done`.
  const reportedDoneRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const job of jobs) {
      if (job.state === 'done' && !reportedDoneRef.current.has(job.id)) {
        reportedDoneRef.current.add(job.id);
        emitBuddyEvent('buddy:url-imported', { jobId: job.id });
      }
    }
  }, [jobs]);

  async function fetchAll() {
    if (urls.length === 0) return;
    setFetching(true);
    const initial: Record<string, PreviewState> = {};
    urls.forEach(u => { initial[u] = { kind: 'loading' }; });
    setPreviews(initial);

    await Promise.all(urls.map(async (url) => {
      try {
        if (PLAYLIST_RE.test(url)) {
          const res = await commands.fetchPlaylistEntries(url);
          if (res.status === 'ok') {
            setPreviews(prev => ({ ...prev, [url]: { kind: 'playlist', envelope: res.data } }));
          } else {
            setPreviews(prev => ({ ...prev, [url]: { kind: 'error', message: res.error } }));
          }
          return;
        }
        const res = await commands.fetchUrlMetadata(url);
        if (res.status === 'error') {
          setPreviews(prev => ({ ...prev, [url]: { kind: 'error', message: res.error } }));
          return;
        }
        const meta = res.data;
        if (meta.is_live) {
          setPreviews(prev => ({ ...prev, [url]: { kind: 'live' } }));
        } else {
          setPreviews(prev => ({ ...prev, [url]: { kind: 'ready', meta, alreadyImported: meta.already_imported } }));
        }
      } catch (e) {
        setPreviews(prev => ({ ...prev, [url]: { kind: 'error', message: String(e) } }));
      }
    }));
    setFetching(false);
  }

  async function downloadOne(url: string) {
    const res = await commands.enqueueImportUrls([url], makeOpts(keepMedia));
    if (res.status === 'error') {
      console.error('enqueueImportUrls failed:', res.error);
      return;
    }
    setPreviews(prev => {
      const next = { ...prev };
      delete next[url];
      return next;
    });
  }

  async function downloadAll() {
    const readyUrls = Object.entries(previews)
      .filter(([_, p]) => p.kind === 'ready' && !(p as { alreadyImported: unknown }).alreadyImported)
      .map(([url]) => url);
    if (readyUrls.length === 0) return;
    const res = await commands.enqueueImportUrls(readyUrls, makeOpts(keepMedia));
    if (res.status === 'error') {
      console.error('enqueueImportUrls failed:', res.error);
      return;
    }
    setPreviews(prev => {
      const next = { ...prev };
      readyUrls.forEach(u => { delete next[u]; });
      return next;
    });
    if (Object.keys(previews).length === readyUrls.length) setText('');
  }

  async function commitPlaylist(envelope: PlaylistEnvelope, sel: PlaylistEntry[]) {
    for (let i = 0; i < sel.length; i++) {
      const e = sel[i];
      const res = await commands.enqueueImportUrls([e.url], {
        ...makeOpts(keepMedia),
        playlist_source: { title: envelope.playlist_title, url: envelope.playlist_url, index: i },
      });
      if (res.status === 'error') console.error('enqueue failed:', res.error);
    }
    setPreviews(prev => {
      const next = { ...prev };
      if (activePlaylistUrl) delete next[activePlaylistUrl];
      return next;
    });
    setActivePlaylistUrl(null);
  }

  const processing = jobs.filter(j => !TERMINAL_STATES.has(j.state));
  const completed = jobs.filter(j => TERMINAL_STATES.has(j.state));

  const previewEntries = Object.entries(previews);
  const readyCount = previewEntries.filter(([_, p]) =>
    p.kind === 'ready' && !(p as { alreadyImported: unknown }).alreadyImported
  ).length;

  return (
    <div className="heros-page-container" style={{ position: 'relative', zIndex: 5, height: '100%', overflowY: 'auto' }}>
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '40px 24px 80px', display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* Hero */}
        <header style={{ textAlign: 'center', marginBottom: 8 }}>
          <div style={{
            width: 64, height: 64, borderRadius: 20,
            background: 'linear-gradient(135deg, var(--heros-brand) 0%, #ff8566 100%)',
            margin: '0 auto 20px auto', display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 12px 32px rgba(var(--heros-brand-rgb, 204, 76, 43), 0.2)',
          }}>
            <Link2 size={32} color="#fff" />
          </div>
          <h1 style={{ fontSize: '28px', fontWeight: 800, color: 'var(--heros-text-premium)', marginBottom: '8px', margin: 0 }}>
            URL Downloader
          </h1>
          <p style={{ color: 'var(--heros-text-muted)', fontSize: '14px', margin: '8px 0 0 0' }}>
            Paste a video, podcast, or playlist URL — audio is downloaded, transcribed, and indexed locally.
          </p>
        </header>

        {/* Format toggle (below hero) */}
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <FormatToggle value={format} onChange={setFormat} />
        </div>

        {!plugin.status?.installed
          ? <PluginMissingBanner plugin={plugin} />
          : (
            <>
              {/* URL textarea */}
              <div className="heros-glass-card" style={{ padding: 18 }}>
                <textarea
                  value={text}
                  onChange={e => setText(e.target.value)}
                  rows={Math.min(8, Math.max(2, text.split('\n').length))}
                  placeholder={`https://www.tiktok.com/@user/video/123\nhttps://www.youtube.com/watch?v=abcdef`}
                  style={{
                    width: '100%',
                    background: 'rgba(0,0,0,0.28)',
                    border: '1px solid rgba(255,255,255,0.06)',
                    borderRadius: 10,
                    padding: '12px 14px',
                    color: '#fff',
                    fontFamily: 'inherit',
                    fontSize: '13px',
                    resize: 'none',
                    outline: 'none',
                  }}
                />
                <p style={{ fontSize: '11px', color: 'var(--heros-text-dim)', margin: '10px 0 0 2px' }}>
                  Multiple links? Separate with spaces, commas, or newlines.
                </p>
              </div>

              {/* FETCH button (full-width, brand-orange) */}
              <button
                className="heros-btn heros-btn-brand"
                onClick={fetchAll}
                disabled={urls.length === 0 || fetching}
                style={{
                  padding: '14px 24px',
                  fontSize: '13px',
                  fontWeight: 800,
                  letterSpacing: '0.18em',
                  textTransform: 'uppercase',
                  borderRadius: 12,
                  width: '100%',
                  justifyContent: 'center',
                }}
              >
                {fetching ? 'Fetching…' : urls.length > 1 ? `Fetch ${urls.length} URLs` : 'Fetch'}
              </button>

              {/* Keep-media toggle */}
              <label
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
                  fontSize: '12px', color: 'var(--heros-text-muted)',
                  alignSelf: 'center',
                }}
                title="When on, the downloaded audio file is kept on disk after transcription."
              >
                <input
                  type="checkbox"
                  checked={keepMedia}
                  onChange={e => setKeepMedia(e.target.checked)}
                  style={{ accentColor: 'var(--heros-brand)' }}
                />
                <span>Keep media file after transcription</span>
              </label>

              {/* Preview cards (one per URL after fetch) */}
              <AnimatePresence>
                {previewEntries.length > 0 && (
                  <motion.div
                    key="preview-stack"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
                  >
                    {previewEntries.map(([url, state]) => (
                      <UrlPreviewCard
                        key={url}
                        url={url}
                        state={state}
                        onDownload={() => downloadOne(url)}
                        onOpenPlaylist={() => setActivePlaylistUrl(url)}
                      />
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* DOWNLOAD ALL */}
              <AnimatePresence>
                {readyCount > 1 && (
                  <motion.button
                    key="download-all"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                    onClick={downloadAll}
                    className="heros-btn"
                    style={{
                      padding: '14px 24px',
                      fontSize: '13px',
                      fontWeight: 800,
                      letterSpacing: '0.18em',
                      textTransform: 'uppercase',
                      borderRadius: 12,
                      background: 'rgba(0,0,0,0.5)',
                      border: '1px solid rgba(255,255,255,0.12)',
                      width: '100%',
                      justifyContent: 'center',
                    }}
                  >
                    Download all ({readyCount})
                  </motion.button>
                )}
              </AnimatePresence>
            </>
          )
        }

        {/* Live progress + recent imports */}
        <ProcessingPanel jobs={processing} />
        <CompletedPanel jobs={completed} />
      </div>

      {activePlaylistUrl && previews[activePlaylistUrl]?.kind === 'playlist' && (
        <PlaylistSelectorModal
          envelope={(previews[activePlaylistUrl] as { kind: 'playlist'; envelope: PlaylistEnvelope }).envelope}
          onCancel={() => setActivePlaylistUrl(null)}
          onCommit={sel => commitPlaylist(
            (previews[activePlaylistUrl] as { kind: 'playlist'; envelope: PlaylistEnvelope }).envelope,
            sel,
          )}
        />
      )}
    </div>
  );
}

// ── Format toggle (MP4 / MP3) ──────────────────────────────────
function FormatToggle({ value, onChange }: { value: Format; onChange: (next: Format) => void }) {
  return (
    <div
      role="tablist"
      aria-label="Download format"
      style={{
        display: 'inline-flex',
        padding: 4,
        gap: 4,
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 'var(--segmented-radius, 999px)',
      }}
    >
      {(['mp4', 'mp3'] as const).map(f => {
        const active = value === f;
        const disabled = f === 'mp4'; // MP4 video downloads not yet implemented
        return (
          <button
            key={f}
            role="tab"
            aria-selected={active}
            aria-disabled={disabled}
            disabled={disabled}
            onClick={() => !disabled && onChange(f)}
            title={disabled ? 'Video downloads coming soon — MP3 audio only for now' : undefined}
            style={{
              padding: '7px 18px',
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
              background: active ? 'var(--heros-brand)' : 'transparent',
              color: active ? '#fff' : disabled ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.55)',
              border: 'none',
              borderRadius: 'var(--segmented-radius, 999px)',
              cursor: disabled ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit',
              transition: 'background 180ms ease, color 180ms ease',
            }}
          >
            {f.toUpperCase()}
          </button>
        );
      })}
    </div>
  );
}

// ── Single-URL preview card (shown after Fetch) ────────────────
function UrlPreviewCard({
  url, state, onDownload, onOpenPlaylist,
}: {
  url: string;
  state: PreviewState;
  onDownload: () => void;
  onOpenPlaylist: () => void;
}) {
  if (state.kind === 'loading') {
    return (
      <div className="heros-glass-card" style={{ padding: 14, opacity: 0.6 }}>
        <div style={{ fontSize: 12, color: 'var(--heros-text-dim)' }}>Fetching {shorten(url)}…</div>
      </div>
    );
  }
  if (state.kind === 'live') {
    return (
      <div className="heros-glass-card" style={{ padding: 14 }}>
        <div style={{ fontSize: 12, color: 'var(--heros-text-muted)' }}>
          Live streams aren't supported yet — {shorten(url)}
        </div>
      </div>
    );
  }
  if (state.kind === 'error') {
    const msg = state.message.toLowerCase().includes('sign in') || state.message.includes('403')
      ? 'Authentication required.'
      : state.message.toLowerCase().includes('region') || state.message.toLowerCase().includes('country')
        ? 'Content regionally unavailable.'
        : state.message;
    return (
      <div className="heros-glass-card" style={{ padding: 14, borderColor: 'rgba(239,68,68,0.3)' }}>
        <div style={{ fontSize: 12, color: '#ffb4b4' }}>{shorten(url)}</div>
        <div style={{ fontSize: 11, color: 'var(--heros-text-dim)', marginTop: 4 }}>{msg}</div>
      </div>
    );
  }
  if (state.kind === 'playlist') {
    const env = state.envelope;
    return (
      <div className="heros-glass-card" style={{ padding: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {env.playlist_title}
            </div>
            <div style={{ fontSize: 11, color: 'var(--heros-text-dim)', marginTop: 2 }}>
              Playlist · {env.entries.length} videos · {env.channel ?? '—'}
            </div>
          </div>
          <button className="heros-btn heros-btn-brand" onClick={onOpenPlaylist}>
            Choose videos…
          </button>
        </div>
      </div>
    );
  }
  // ready
  const meta = state.meta;
  const already = state.alreadyImported;
  const heights = meta.available_video_heights ?? [];
  return (
    <div className={`heros-glass-card${already ? ' preview-card--already' : ''}`} style={{ padding: 14 }}>
      <div style={{ display: 'flex', gap: 14 }}>
        {meta.thumbnail_url && (
          <img
            src={meta.thumbnail_url}
            alt={meta.title}
            loading="lazy"
            style={{ width: 110, height: 62, objectFit: 'cover', borderRadius: 8, flexShrink: 0 }}
          />
        )}
        <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {meta.title}
          </div>
          <div style={{ fontSize: 11, color: 'var(--heros-text-dim)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            {[meta.channel, meta.duration_seconds != null ? formatDuration(meta.duration_seconds) : null]
              .filter(Boolean).join(' · ')}
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 6 }}>
            {already ? (
              <>
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: '4px 10px', borderRadius: 6,
                  background: 'rgba(245,158,11,0.18)', color: '#ffd58a',
                  textTransform: 'uppercase', letterSpacing: '0.1em',
                }}>
                  Already imported
                </span>
                <button
                  onClick={onDownload}
                  className="heros-btn"
                  style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6 }}
                >
                  Download anyway
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={onDownload}
                  className="heros-btn heros-btn-brand"
                  style={{
                    fontSize: 11, fontWeight: 700, padding: '6px 14px', borderRadius: 6,
                    letterSpacing: '0.12em', textTransform: 'uppercase',
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                  }}
                >
                  <Download size={12} /> Download
                </button>
                {heights.length > 0 && heights.slice().reverse().slice(0, 6).map(h => (
                  <span
                    key={h}
                    title="Video heights detected — only audio (MP3) is downloaded for now"
                    style={{
                      fontSize: 10, fontWeight: 700, padding: '4px 10px', borderRadius: 6,
                      background: 'rgba(255,255,255,0.06)',
                      color: 'rgba(255,255,255,0.45)',
                      textTransform: 'uppercase', letterSpacing: '0.08em',
                      cursor: 'help',
                    }}
                  >
                    {h}p
                  </span>
                ))}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function shorten(url: string): string {
  if (url.length <= 60) return url;
  return url.slice(0, 28) + '…' + url.slice(-28);
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

// ── Processing panel ───────────────────────────────────────────
function ProcessingPanel({ jobs }: { jobs: ImportJobDto[] }) {
  if (jobs.length === 0) return null;
  return (
    <section className="heros-glass-card" style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 8, borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '13px', fontWeight: 600 }}>
          <Clock size={15} color="rgba(255,255,255,0.4)" />
          Processing
          <span style={{ padding: '3px 9px', fontSize: '10px', background: 'rgba(255,255,255,0.06)', borderRadius: 14, color: 'var(--heros-text-dim)' }}>
            {jobs.length} active
          </span>
        </div>
      </div>

      <ScrollShadow style={{ maxHeight: 280 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <AnimatePresence initial={false}>
            {jobs.map((job, i) => (
              <motion.div
                key={job.id}
                layout
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ delay: i * 0.05 }}
                className="import-row-hover"
                style={{
                  display: 'grid', gridTemplateColumns: '32px 1fr auto', gap: 12, alignItems: 'center',
                  padding: '10px 12px', borderRadius: 12, background: 'rgba(0,0,0,0.14)',
                  border: '1px solid rgba(255,255,255,0.04)', transition: 'all 0.2s',
                }}
              >
                <JobThumb job={job} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '12.5px', color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {jobTitle(job)}
                  </div>
                  <div style={{ fontSize: '10.5px', color: 'var(--heros-text-dim)', marginTop: 1, fontFamily: 'monospace' }}>
                    {jobStatusLine(job)}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 80, height: 4, background: 'rgba(0,0,0,0.28)', borderRadius: 2, overflow: 'hidden', position: 'relative' }}>
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${jobProgress(job)}%` }}
                      className="shimmer-bar"
                      style={{ height: '100%', background: 'linear-gradient(90deg, #f0d8d0, #fff)', borderRadius: 2, boxShadow: '0 0 8px rgba(253,249,243,0.5)' }}
                    />
                  </div>
                  <div style={{ fontSize: '10px', fontWeight: 700, padding: '4px 8px', borderRadius: 8, background: 'rgba(255,255,255,0.08)', color: 'var(--heros-text-dim)', fontFamily: 'monospace' }}>
                    {jobProgress(job)}%
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </ScrollShadow>
    </section>
  );
}

// ── Completed panel — auto-expands on new arrival, hides 1s later ──
function CompletedPanel({ jobs }: { jobs: ImportJobDto[] }) {
  const [autoExpanded, setAutoExpanded] = useState(false);
  const [manualExpanded, setManualExpanded] = useState(false);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const initializedRef = useRef(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const expanded = autoExpanded || manualExpanded;

  const [recentIds, setRecentIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!initializedRef.current) {
      jobs.forEach(j => seenIdsRef.current.add(j.id));
      initializedRef.current = true;
      return;
    }
    const newOnes = jobs.filter(j => !seenIdsRef.current.has(j.id));
    if (newOnes.length === 0) return;

    newOnes.forEach(j => seenIdsRef.current.add(j.id));
    setRecentIds(prev => {
      const next = new Set(prev);
      newOnes.forEach(j => next.add(j.id));
      return next;
    });
    setAutoExpanded(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      setAutoExpanded(false);
      setRecentIds(new Set());
    }, 1000);
  }, [jobs]);

  useEffect(() => () => { if (hideTimerRef.current) clearTimeout(hideTimerRef.current); }, []);

  const visibleJobs = useMemo(() => {
    if (manualExpanded) return jobs;
    if (autoExpanded) return jobs.filter(j => recentIds.has(j.id));
    return [];
  }, [jobs, manualExpanded, autoExpanded, recentIds]);

  if (jobs.length === 0) return null;

  return (
    <motion.section
      layout
      className="heros-glass-card"
      style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}
    >
      <button
        type="button"
        onClick={() => setManualExpanded(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          paddingBottom: 8, borderBottom: '1px solid rgba(255,255,255,0.05)',
          background: 'transparent', border: 'none', borderRadius: 0,
          color: 'inherit', cursor: 'pointer', font: 'inherit', textAlign: 'left', width: '100%',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '13px', fontWeight: 600 }}>
          <CheckCircle2 size={15} color="#9cf0c9" />
          Completed
          <span style={{ padding: '3px 9px', fontSize: '10px', background: 'rgba(255,255,255,0.06)', borderRadius: 14, color: 'var(--heros-text-dim)' }}>
            {jobs.length}
          </span>
        </div>
        {manualExpanded ? <ChevronUp size={14} color="rgba(255,255,255,0.4)" /> : <ChevronDown size={14} color="rgba(255,255,255,0.4)" />}
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="completed-body"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25 }}
            style={{ overflow: 'hidden' }}
          >
            <ScrollShadow style={{ maxHeight: 320 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <AnimatePresence initial={false}>
                  {visibleJobs.map(job => {
                    const isRecent = recentIds.has(job.id);
                    return (
                      <motion.div
                        key={job.id}
                        layout
                        initial={{ opacity: 0, scale: 0.96 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.96 }}
                        className="import-row-hover"
                        style={{
                          display: 'grid', gridTemplateColumns: '32px 1fr auto', gap: 12, alignItems: 'center',
                          padding: '10px 12px', borderRadius: 12,
                          background: isRecent ? 'rgba(16,185,129,0.10)' : 'rgba(0,0,0,0.14)',
                          border: `1px solid ${isRecent ? 'rgba(16,185,129,0.3)' : 'rgba(255,255,255,0.04)'}`,
                          opacity: isRecent ? 1 : 0.72,
                          transition: 'background 200ms ease, border 200ms ease',
                        }}
                      >
                        <JobThumb job={job} />
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: '12.5px', color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {jobTitle(job)}
                          </div>
                          <div style={{ fontSize: '10.5px', color: 'var(--heros-text-dim)', marginTop: 1, fontFamily: 'monospace' }}>
                            {jobStatusLine(job)}
                          </div>
                        </div>
                        <div style={{
                          fontSize: '10px', fontWeight: 700, padding: '4px 8px', borderRadius: 8,
                          background: job.state === 'done' ? 'rgba(16,185,129,0.18)' : 'rgba(239,68,68,0.18)',
                          color: job.state === 'done' ? '#9cf0c9' : '#ffb4b4',
                          textTransform: 'uppercase', letterSpacing: '0.1em',
                        }}>
                          {job.state}
                        </div>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>
            </ScrollShadow>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  );
}

// ── Job thumbnail ──────────────────────────────────────────────
function JobThumb({ job }: { job: ImportJobDto }) {
  const thumb = job.web_meta?.thumbnail_url;
  if (thumb) {
    return (
      <div style={{ width: 32, height: 32, borderRadius: 9, overflow: 'hidden', background: 'rgba(255,255,255,0.08)' }}>
        <img src={thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </div>
    );
  }
  const platform = job.web_meta?.platform ?? '';
  const Icon = platform.toLowerCase().includes('youtube') ? Globe : FileText;
  return (
    <div style={{ width: 32, height: 32, borderRadius: 9, background: 'rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Icon size={14} />
    </div>
  );
}
