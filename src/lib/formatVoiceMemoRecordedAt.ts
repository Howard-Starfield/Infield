/**
 * Voice memo "recorded at" display: `3:42 PM (4/16/2026)` — en-US 12h time + M/D/YYYY in parentheses.
 * Uses `created_at` epoch milliseconds from the note row.
 */
export function formatVoiceMemoRecordedAt(epochMs: number): string {
  const d = new Date(epochMs);
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(d);
  const date = new Intl.DateTimeFormat("en-US", {
    month: "numeric",
    day: "numeric",
    year: "numeric",
  }).format(d);
  return `${time} (${date})`;
}
