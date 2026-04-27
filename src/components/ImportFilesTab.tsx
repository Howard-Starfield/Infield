import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import {
  Upload,
  Database,
  FileText,
  Music,
  Film,
  File as FileIcon,
  Plus,
  FolderOpen,
  Globe,
  BookOpen,
  Ghost,
} from 'lucide-react';
import { toast } from 'sonner';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { commands } from '../bindings';
import type { ImportJobDto } from '../bindings';
import { useImportQueue } from '../hooks/useImportQueue';
import { ImportProcessingList, ImportCompletedList } from './ImportQueueLists';
import { TERMINAL_STATES } from '../utils/importJobs';
import '../styles/import.css';

const SUPPORTED_EXTS = [
  'md','markdown','mdx','txt','log','csv','pdf',
  'wav','mp3','m4a','aac','flac','ogg','opus',
  'mp4','mov','mkv','avi','webm','mpeg','mpg','wmv',
];

const DOC_EXTS = ['md','markdown','mdx','txt','log','csv','pdf'];
const AUDIO_EXTS = ['wav','mp3','m4a','aac','flac','ogg','opus'];
const VIDEO_EXTS = ['mp4','mov','mkv','avi','webm','mpeg','mpg','wmv'];

interface ImportFilesTabProps {
  onNavigate: (page: string) => void;
}

export function ImportFilesTab({ onNavigate }: ImportFilesTabProps) {
  const { jobs, cancel } = useImportQueue();
  const [isDragging, setIsDragging] = useState(false);

  // Filter to non-WebMedia jobs (URL imports live in the Downloader tab).
  const processing = jobs.filter(
    (j) => j.kind !== 'web_media' && j.kind !== 'unknown' && !TERMINAL_STATES.has(j.state),
  );
  const completed = jobs.filter(
    (j) => j.kind !== 'web_media' && j.kind !== 'unknown' && TERMINAL_STATES.has(j.state),
  );

  // Tauri webview drag-drop event — gives real OS paths, unlike HTML5 dataTransfer.
  // Listener is scoped to this tab's mount lifecycle (ImportView only renders one tab
  // at a time), so no global drop handler when the URL tab is active.
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    (async () => {
      const webview = getCurrentWebview();
      unlisten = await webview.onDragDropEvent((event) => {
        switch (event.payload.type) {
          case 'enter':
          case 'over':
            setIsDragging(true);
            break;
          case 'leave':
            setIsDragging(false);
            break;
          case 'drop':
            setIsDragging(false);
            void enqueuePaths(event.payload.paths);
            break;
        }
      });
    })();
    return () => {
      unlisten?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function pickFiles() {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const result = await open({
      multiple: true,
      filters: [
        { name: 'All supported', extensions: SUPPORTED_EXTS },
        { name: 'Documents', extensions: DOC_EXTS },
        { name: 'Audio', extensions: AUDIO_EXTS },
        { name: 'Video', extensions: VIDEO_EXTS },
      ],
    });
    if (Array.isArray(result)) await enqueuePaths(result);
    else if (typeof result === 'string') await enqueuePaths([result]);
  }

  async function enqueuePaths(paths: string[]) {
    if (paths.length === 0) return;
    // Tauri drag-drop sometimes delivers the same path twice in one event;
    // dedupe before calling the backend so users don't see spurious "Already
    // in queue" toasts for files dropped in the same gesture.
    const unique = Array.from(new Set(paths));
    const res = await commands.enqueueImportPaths(unique);
    if (res.status === 'error') {
      toast.error(res.error);
      return;
    }
    if (res.data.rejected.length > 0) {
      const summary =
        res.data.rejected.length === 1
          ? `${basename(res.data.rejected[0].path)}: ${res.data.rejected[0].reason}`
          : `${res.data.rejected.length} files skipped — see console`;
      toast.warning(summary);
      if (res.data.rejected.length > 1) {
        // eslint-disable-next-line no-console
        console.warn('[Knowledge Import] rejected:', res.data.rejected);
      }
    }
  }

  const sourceChips = [
    { name: 'Notion', icon: <Database size={13} /> },
    { name: 'Obsidian', icon: <Plus size={13} /> },
    { name: 'Readwise', icon: <BookOpen size={13} /> },
    { name: 'Bear', icon: <Ghost size={13} /> },
    { name: 'Apple Notes', icon: <FileText size={13} /> },
    { name: 'Browser', icon: <Globe size={13} /> },
  ];

  return (
    <div
      className="heros-page-container"
      style={{
        position: 'relative',
        zIndex: 5,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        maxWidth: '1200px',
        margin: '0 auto',
        padding: '40px',
      }}
    >
      <header style={{ marginBottom: '48px', textAlign: 'center', flexShrink: 0 }}>
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: 20,
            background: 'linear-gradient(135deg, var(--heros-brand) 0%, #ff8566 100%)',
            margin: '0 auto 24px auto',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 12px 32px rgba(var(--heros-brand-rgb, 204, 76, 43), 0.2)',
          }}
        >
          <Upload size={32} color="#fff" />
        </div>
        <h1
          style={{
            fontSize: '32px',
            fontWeight: 800,
            color: 'var(--heros-text-premium)',
            marginBottom: '8px',
          }}
        >
          Knowledge Import
        </h1>
        <p style={{ color: 'var(--heros-text-muted)', fontSize: '16px' }}>
          Bring external knowledge in. Everything is indexed and embedded locally.
        </p>

        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: '24px' }}>
          <button
            className="heros-btn"
            onClick={() => onNavigate('notes')}
            style={{ padding: '10px 20px', borderRadius: 12, fontSize: '13px' }}
          >
            <FolderOpen size={15} /> Imports folder
          </button>
          <button
            className="heros-btn heros-btn-brand"
            onClick={() => void pickFiles()}
            style={{ padding: '10px 20px', borderRadius: 12, fontSize: '13px' }}
          >
            <Plus size={15} /> New Knowledge Batch
          </button>
        </div>
      </header>

      <div
        style={{
          flex: 1,
          display: 'grid',
          gridTemplateColumns: '1fr 1.6fr',
          gap: 20,
          minHeight: 0,
        }}
      >
        {/* Left: Dropzone & Sources */}
        <section
          className="heros-glass-card"
          style={{
            padding: '24px',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            height: 'fit-content',
          }}
        >
          <div
            onClick={() => void pickFiles()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                void pickFiles();
              }
            }}
            style={{
              flex: 1,
              minHeight: 180,
              borderRadius: 18,
              background: 'rgba(0,0,0,0.18)',
              border: `2px dashed ${
                isDragging ? 'var(--heros-brand)' : 'rgba(253,249,243,0.2)'
              }`,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              padding: 32,
              transition: 'all 0.25s',
              cursor: 'pointer',
            }}
          >
            <motion.div
              animate={{ y: isDragging ? -10 : 0 }}
              style={{ color: isDragging ? 'var(--heros-brand)' : 'rgba(253,249,243,0.3)' }}
            >
              <Upload size={42} strokeWidth={1.2} />
            </motion.div>
            <h3 style={{ fontSize: '16px', fontWeight: 500, margin: '8px 0 0' }}>
              Drop files here
            </h3>
            <p style={{ fontSize: '12px', color: 'var(--heros-text-dim)', margin: 0 }}>
              PDFs, markdown, audio, video — up to 2 GB per batch
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div
              className="eyebrow"
              style={{
                fontSize: '10px',
                fontWeight: 700,
                letterSpacing: '0.28em',
                textTransform: 'uppercase',
                color: 'var(--heros-text-dim)',
              }}
            >
              Or connect a source
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {sourceChips.map((chip) => (
                <div
                  key={chip.name}
                  className="heros-btn import-source-chip--disabled"
                  title="Connector coming soon"
                  style={{
                    padding: '6px 12px',
                    borderRadius: 20,
                    fontSize: '11px',
                    gap: 6,
                    display: 'inline-flex',
                    alignItems: 'center',
                    background: 'rgba(255,255,255,0.08)',
                    border: '1px solid rgba(255,255,255,0.12)',
                  }}
                >
                  {chip.icon} {chip.name}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Right: Real queue lists */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minHeight: 0 }}>
          <ImportProcessingList jobs={processing} renderThumb={renderFileThumb} onCancel={cancel} />
          <ImportCompletedList
            jobs={completed}
            renderThumb={renderFileThumb}
            onClear={() => commands.clearCompletedImports()}
          />
        </div>
      </div>
    </div>
  );
}

function renderFileThumb(job: ImportJobDto) {
  const Icon =
    job.kind === 'audio'
      ? Music
      : job.kind === 'video'
        ? Film
        : job.kind === 'pdf' || job.kind === 'markdown' || job.kind === 'plain_text'
          ? FileText
          : FileIcon;
  return (
    <div
      style={{
        width: 32,
        height: 32,
        borderRadius: 9,
        background: 'rgba(255,255,255,0.08)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon size={14} />
    </div>
  );
}

function basename(path: string): string {
  const m = path.match(/[^/\\]+$/);
  return m ? m[0] : path;
}
