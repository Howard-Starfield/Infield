import { Upload } from 'lucide-react';
import { useImportQueue } from '../hooks/useImportQueue';
import { useYtDlpPlugin } from '../hooks/useYtDlpPlugin';
import type { ImportJobDto } from '../bindings';
import '../styles/import.css';

const TERMINAL_STATES = new Set<ImportJobDto['state']>(['done', 'error', 'cancelled']);

export function ImportView() {
  const { jobs, paused, cancel, pause, resume } = useImportQueue();
  const plugin = useYtDlpPlugin();

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
          {/* URL input — Task 27; file dropzone — keep current; source chips dormant */}
          <p className="import-view__empty">URL input lands in next task.</p>
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
