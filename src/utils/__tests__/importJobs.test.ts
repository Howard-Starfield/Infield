import { describe, it, expect } from 'vitest';
import {
  formatBytes,
  formatDuration,
  jobProgress,
  jobStatusLine,
  jobTitle,
  TERMINAL_STATES,
} from '../importJobs';
import type { ImportJobDto } from '../../bindings';

function fakeJob(overrides: Partial<ImportJobDto> = {}): ImportJobDto {
  return {
    id: 'job-1',
    file_name: 'song.mp3',
    source_path: '/tmp/song.mp3',
    kind: 'audio',
    state: 'queued',
    message: null,
    note_id: null,
    progress: 0,
    segment_index: 0,
    segment_count: 0,
    current_step: null,
    ...overrides,
  } as ImportJobDto;
}

describe('formatBytes', () => {
  it('formats < 1 KB', () => expect(formatBytes(512)).toBe('512 B'));
  it('formats KB', () => expect(formatBytes(2048)).toBe('2.0 KB'));
  it('formats MB', () => expect(formatBytes(5_242_880)).toBe('5.0 MB'));
  it('formats GB', () => expect(formatBytes(1_073_741_824)).toBe('1.00 GB'));
});

describe('formatDuration', () => {
  it('formats sub-hour', () => expect(formatDuration(125)).toBe('2:05'));
  it('formats with hours', () => expect(formatDuration(3725)).toBe('1:02:05'));
});

describe('jobProgress', () => {
  it('returns 100 when done', () =>
    expect(jobProgress(fakeJob({ state: 'done' }))).toBe(100));
  it('scales transcribing by segment ratio', () => {
    const j = fakeJob({ state: 'transcribing', segment_count: 10, segment_index: 5 });
    expect(jobProgress(j)).toBe(75);
  });
});

describe('jobStatusLine', () => {
  it('honors current_step during preparing', () => {
    const j = fakeJob({ state: 'preparing', current_step: 'Detecting speech…' });
    expect(jobStatusLine(j)).toBe('Detecting speech…');
  });
  it('falls back when current_step null', () => {
    const j = fakeJob({ state: 'preparing', current_step: null });
    expect(jobStatusLine(j)).toBe('Preparing audio…');
  });
});

describe('jobTitle', () => {
  it('prefers web_meta.title', () => {
    const j = fakeJob({
      web_meta: { title: 'YouTube Vid', thumbnail_url: null, platform: 'youtube' } as any,
    });
    expect(jobTitle(j)).toBe('YouTube Vid');
  });
  it('falls back to file_name', () => {
    expect(jobTitle(fakeJob())).toBe('song.mp3');
  });
});

describe('TERMINAL_STATES', () => {
  it('contains exactly done/error/cancelled', () => {
    expect(TERMINAL_STATES.has('done')).toBe(true);
    expect(TERMINAL_STATES.has('error')).toBe(true);
    expect(TERMINAL_STATES.has('cancelled')).toBe(true);
    expect(TERMINAL_STATES.has('queued')).toBe(false);
  });
});
