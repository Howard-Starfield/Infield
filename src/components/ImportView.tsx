import { useState } from 'react';
import { Upload } from 'lucide-react';
import { useImportQueue } from '../hooks/useImportQueue';
import { useYtDlpPlugin } from '../hooks/useYtDlpPlugin';
import type { ImportJobDto } from '../bindings';
import '../styles/import.css';

const TERMINAL_STATES = new Set<ImportJobDto['state']>(['done', 'error', 'cancelled']);

// ── URL detection ──────────────────────────────────────────────
export function detectUrls(text: string): string[] {
  return Array.from(new Set(
    text.split(/[\s\n]+/)
      .map(s => s.trim())
      .filter(s => /^https?:\/\/\S+\.\S+/.test(s))
  ));
}

// ── Top-level view ─────────────────────────────────────────────
export function ImportView() {
  const { jobs, paused, cancel, pause, resume } = useImportQueue();
  const plugin = useYtDlpPlugin();
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null);

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

// ── Plugin missing banner (Task 27 placeholder; full impl in T29) ──
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
