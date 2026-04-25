import { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Upload, Link2, Clock, CheckCircle2, FileText, Globe, ChevronDown, ChevronUp,
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
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
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

function jobProgress(job: ImportJobDto): number {
  // Map state to a coarse progress estimate for the bar; refine when bytes available.
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

// ── Preview state machine ──────────────────────────────────────
type PreviewState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; meta: UrlMetadataResult; alreadyImported: AlreadyImportedHit | null }
  | { kind: 'playlist'; envelope: PlaylistEnvelope }
  | { kind: 'live' }
  | { kind: 'error'; message: string };

// ── Tab root ───────────────────────────────────────────────────
export function ImportUrlTab() {
  const { jobs } = useImportQueue();
  const plugin = useYtDlpPlugin();
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewState>({ kind: 'idle' });
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced metadata fetch on URL select.
  useEffect(() => {
    if (!selectedUrl) {
      setPreview({ kind: 'idle' });
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setPreview({ kind: 'loading' });
    debounceRef.current = setTimeout(async () => {
      if (PLAYLIST_RE.test(selectedUrl)) {
        const res = await commands.fetchPlaylistEntries(selectedUrl);
        if (res.status === 'ok') setPreview({ kind: 'playlist', envelope: res.data });
        else setPreview({ kind: 'error', message: res.error });
        return;
      }
      const res = await commands.fetchUrlMetadata(selectedUrl);
      if (res.status === 'error') {
        setPreview({ kind: 'error', message: res.error });
        return;
      }
      const meta = res.data;
      if (meta.is_live) { setPreview({ kind: 'live' }); return; }
      setPreview({ kind: 'ready', meta, alreadyImported: meta.already_imported });
    }, 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [selectedUrl]);

  async function commitSingle(opts: WebMediaImportOpts) {
    if (!selectedUrl) return;
    const result = await commands.enqueueImportUrls([selectedUrl], opts);
    if (result.status === 'error') {
      console.error('enqueueImportUrls failed:', result.error);
      return;
    }
    setSelectedUrl(null);
    setPreview({ kind: 'idle' });
  }

  async function commitBulk(urls: string[], opts: WebMediaImportOpts) {
    const result = await commands.enqueueImportUrls(urls, opts);
    if (result.status === 'error') console.error('enqueueImportUrls failed:', result.error);
  }

  async function commitPlaylist(envelope: PlaylistEnvelope, sel: PlaylistEntry[], opts: WebMediaImportOpts) {
    for (let i = 0; i < sel.length; i++) {
      const e = sel[i];
      const res = await commands.enqueueImportUrls([e.url], {
        ...opts,
        playlist_source: { title: envelope.playlist_title, url: envelope.playlist_url, index: i },
      });
      if (res.status === 'error') console.error('enqueue failed:', res.error);
    }
    setSelectedUrl(null);
    setPreview({ kind: 'idle' });
  }

  const processing = jobs.filter(j => !TERMINAL_STATES.has(j.state));
  const completed = jobs.filter(j => TERMINAL_STATES.has(j.state));

  return (
    <div className="heros-page-container" style={{ position: 'relative', zIndex: 5, height: '100%', display: 'flex', flexDirection: 'column', maxWidth: '1200px', margin: '0 auto', padding: '40px' }}>
      {/* Cinematic Centered Header */}
      <header style={{ marginBottom: '48px', textAlign: 'center', flexShrink: 0 }}>
        <div style={{
          width: 64, height: 64, borderRadius: 20,
          background: 'linear-gradient(135deg, var(--heros-brand) 0%, #ff8566 100%)',
          margin: '0 auto 24px auto', display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 12px 32px rgba(var(--heros-brand-rgb, 204, 76, 43), 0.2)',
        }}>
          <Link2 size={32} color="#fff" />
        </div>
        <h1 style={{ fontSize: '32px', fontWeight: 800, color: 'var(--heros-text-premium)', marginBottom: '8px' }}>
          URL Downloader
        </h1>
        <p style={{ color: 'var(--heros-text-muted)', fontSize: '16px' }}>
          Paste a video, podcast, or playlist URL. Audio is downloaded, transcribed, and indexed locally.
        </p>
      </header>

      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1.6fr', gap: 20, minHeight: 0 }}>
        {/* Left Column: URL Input + Preview */}
        <section className="heros-glass-card" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: 16, height: 'fit-content' }}>
          {!plugin.status?.installed
            ? <PluginMissingBanner plugin={plugin} />
            : <UrlInputBlock onSingle={url => setSelectedUrl(url)} onBulk={urls => commitBulk(urls, defaultOpts())} />
          }
          <PreviewBlock preview={preview} onCommit={commitSingle} />
        </section>

        {/* Right Column: Processing + Completed */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minHeight: 0 }}>
          <ProcessingPanel jobs={processing} />
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

// ── URL input block (drop-zone-styled paste area) ──────────────
function UrlInputBlock({ onSingle, onBulk }: { onSingle: (url: string) => void; onBulk: (urls: string[]) => void }) {
  const [text, setText] = useState('');
  const urls = detectUrls(text);
  const isBulk = urls.length > 1;
  const isSingle = urls.length === 1;
  const isFocused = text.length > 0;

  function handleSubmit() {
    if (isSingle) onSingle(urls[0]);
    else if (isBulk) { onBulk(urls); setText(''); }
  }

  return (
    <>
      <div style={{
        flex: 1, minHeight: 180, borderRadius: 18, background: 'rgba(0,0,0,0.18)',
        border: `2px dashed ${isFocused ? 'var(--heros-brand)' : 'rgba(253,249,243,0.2)'}`,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10,
        padding: 32, transition: 'all 0.25s',
      }}>
        <motion.div
          animate={{ y: isFocused ? -6 : 0 }}
          style={{ color: isFocused ? 'var(--heros-brand)' : 'rgba(253,249,243,0.3)' }}
        >
          <Link2 size={42} strokeWidth={1.2} />
        </motion.div>
        <h3 style={{ fontSize: '16px', fontWeight: 500, margin: '8px 0 0' }}>Paste a URL</h3>
        <p style={{ fontSize: '12px', color: 'var(--heros-text-dim)', margin: 0, textAlign: 'center' }}>
          YouTube, podcasts, social platforms — or paste many URLs (one per line) for bulk import
        </p>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          rows={Math.min(8, Math.max(1, text.split('\n').length))}
          placeholder="https://…"
          style={{
            width: '100%',
            background: 'rgba(0,0,0,0.28)',
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: 12,
            padding: '10px 12px',
            color: '#fff',
            fontFamily: 'inherit',
            fontSize: '12.5px',
            resize: 'none',
            marginTop: 8,
          }}
        />
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: '11px', color: 'var(--heros-text-dim)', fontFamily: 'monospace' }}>
          {urls.length === 0 ? '—' : `${urls.length} URL${urls.length !== 1 ? 's' : ''} detected`}
        </span>
        <button
          className="heros-btn heros-btn-brand"
          disabled={urls.length === 0}
          onClick={handleSubmit}
          style={{ padding: '8px 16px', borderRadius: 12, fontSize: '12px' }}
        >
          {isBulk ? `Import ${urls.length} URLs` : isSingle ? 'Preview' : 'Paste a URL'}
        </button>
      </div>
    </>
  );
}

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

// ── Preview block ──────────────────────────────────────────────
function PreviewBlock({ preview, onCommit }: { preview: PreviewState; onCommit: (opts: WebMediaImportOpts) => void }) {
  if (preview.kind === 'idle') return null;
  if (preview.kind === 'loading') return <div className="preview-skeleton" />;
  if (preview.kind === 'live') return <p className="import-view__empty">Live streams are not supported yet.</p>;
  if (preview.kind === 'error') {
    return (
      <p className="import-view__empty" style={{ color: 'var(--error)' }}>
        {preview.message.toLowerCase().includes('sign in') || preview.message.includes('403')
          ? 'Authentication required — content is restricted.'
          : preview.message.toLowerCase().includes('region') || preview.message.toLowerCase().includes('country')
            ? 'Content regionally unavailable.'
            : `Could not fetch metadata: ${preview.message}`}
      </p>
    );
  }
  if (preview.kind === 'playlist') return null; // shown as modal
  // ready
  const meta = preview.meta;
  const already = preview.alreadyImported;
  return (
    <div className={`preview-card${already ? ' preview-card--already' : ''}`}>
      {meta.thumbnail_url && (
        <img className="preview-card__thumb" src={meta.thumbnail_url} alt={meta.title} loading="lazy" />
      )}
      <div className="preview-card__body">
        <strong style={{ fontSize: 'var(--text-sm)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {meta.title}
        </strong>
        <span className="preview-card__meta">
          {[meta.channel, meta.platform, meta.duration_seconds != null ? formatDuration(meta.duration_seconds) : null]
            .filter(Boolean).join(' · ')}
        </span>
        {already ? (
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            <span className="import-view__empty" style={{ padding: 0, textAlign: 'left' }}>Already imported</span>
            <button className="heros-btn" onClick={() => onCommit(defaultOpts())} style={{ fontSize: 'var(--text-xs)' }}>
              Import anyway
            </button>
          </div>
        ) : (
          <button className="heros-btn heros-btn-brand" onClick={() => onCommit(defaultOpts())}>
            Import →
          </button>
        )}
      </div>
    </div>
  );
}

// ── Processing panel ───────────────────────────────────────────
function ProcessingPanel({ jobs }: { jobs: ImportJobDto[] }) {
  return (
    <section className="heros-glass-card" style={{ flex: 1, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 8, borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '13px', fontWeight: 600 }}>
          <Clock size={15} color="rgba(255,255,255,0.4)" />
          Processing
          <span style={{ padding: '3px 9px', fontSize: '10px', background: 'rgba(255,255,255,0.06)', borderRadius: 14, color: 'var(--heros-text-dim)' }}>
            {jobs.length} active
          </span>
        </div>
      </div>

      <ScrollShadow style={{ flex: 1 }}>
        {jobs.length === 0 ? (
          <p className="import-view__empty">Nothing in flight.</p>
        ) : (
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
        )}
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

  // Track which jobs are "new" since last cycle so the panel can flash a highlight.
  const [recentIds, setRecentIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    // First mount: seed seenIds with everything currently present so existing
    // history doesn't trigger a fake notification on app boot.
    if (!initializedRef.current) {
      jobs.forEach(j => seenIdsRef.current.add(j.id));
      initializedRef.current = true;
      return;
    }
    // Find brand-new completions.
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

  // When auto-expanding, only show the most recent arrivals. When the user
  // manually expands, show the full completed list.
  const visibleJobs = useMemo(() => {
    if (manualExpanded) return jobs;
    if (autoExpanded) return jobs.filter(j => recentIds.has(j.id));
    return [];
  }, [jobs, manualExpanded, autoExpanded, recentIds]);

  return (
    <motion.section
      layout
      className="heros-glass-card"
      style={{
        padding: '16px 18px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        flex: expanded ? 1 : 'none',
        minHeight: 0,
      }}
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
