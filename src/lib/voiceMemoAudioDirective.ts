/** Legacy UI-only line from earlier builds; stripped on save / plain text. */
export function stripLegacyVoiceMemoAudioLine(md: string): string {
  return md.replace(/^\s*::voice_memo_audio[^\n]*\n+/m, "");
}

/** Per-clip players persisted in markdown; stripped for plain-text / search only. */
export function stripVoiceMemoRecordingDirectives(md: string): string {
  return md.replace(/^\s*::voice_memo_recording\{[^}]*\}\s*\n?/gm, "");
}

export function stripVoiceMemoDirectivesForPlainText(md: string): string {
  return stripVoiceMemoRecordingDirectives(stripLegacyVoiceMemoAudioLine(md));
}

/**
 * Old voice memos only had `audio_file_path` in SQLite with plain transcript body.
 * Inject a single recording directive so the MDX player appears until the note is saved again.
 */
export function ensureVoiceMemoEditorMarkdown(
  sourceType: string,
  content: string,
  audioPath: string | null | undefined,
): string {
  let md = stripLegacyVoiceMemoAudioLine(content ?? "");
  if (sourceType !== "voice_memo") return md;
  const t = md.trimStart();
  if (/^::voice_memo_recording\{/.test(t)) return md;
  const p = audioPath?.trim();
  if (!p) return md;
  const escaped = p.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `::voice_memo_recording{path="${escaped}"}\n\n${md}`;
}
