import type { ImportJobDto } from '../bindings';

export const TERMINAL_STATES: ReadonlySet<ImportJobDto['state']> = new Set([
  'done',
  'error',
  'cancelled',
]);

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function jobProgress(job: ImportJobDto): number {
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

export function jobStatusLine(job: ImportJobDto): string {
  switch (job.state) {
    case 'queued':
      return 'Queued';
    case 'fetching_meta':
      return 'Fetching metadata…';
    case 'downloading': {
      const b = job.download_bytes ?? 0;
      const t = job.download_total_bytes;
      const sizeStr = t ? `${formatBytes(b)} / ${formatBytes(t)}` : formatBytes(b);
      return `Downloading · ${sizeStr}${
        job.download_speed_human ? ` · ${job.download_speed_human}` : ''
      }`;
    }
    case 'preparing':
    case 'segmenting':
      return job.current_step ?? 'Preparing audio…';
    case 'transcribing':
      return job.segment_count > 0
        ? `Transcribing · ${job.segment_index} / ${job.segment_count}`
        : 'Transcribing…';
    case 'draft_created':
      return 'Draft created…';
    case 'extracting_text':
      return 'Extracting text…';
    case 'creating_note':
      return 'Creating note…';
    case 'post_processing':
    case 'finalizing':
      return 'Finalizing…';
    case 'done':
      return 'Saved';
    case 'error':
      return job.message ?? 'Error';
    case 'cancelled':
      return 'Cancelled';
    default:
      return job.state;
  }
}

export function jobTitle(job: ImportJobDto): string {
  return job.web_meta?.title ?? job.file_name;
}
