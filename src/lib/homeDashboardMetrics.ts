import type { Note } from "@/bindings";
import type { WorkspaceNode } from "@/types/workspace";

/** Monday 00:00:00 local for the week containing `d`. */
export function startOfWeekMonday(d: Date): Date {
  const copy = new Date(d);
  const day = copy.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + diff);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

/** Count notes whose `updated_at` falls on each weekday Mon–Sun of the current week. */
export function weekActivityFromNotes(notes: Note[]): {
  counts: number[];
  total: number;
  mostActiveIndex: number;
} {
  const start = startOfWeekMonday(new Date());
  const weekEnd = new Date(start);
  weekEnd.setDate(weekEnd.getDate() + 7);
  const counts = [0, 0, 0, 0, 0, 0, 0];
  const startMs = start.getTime();
  const endMs = weekEnd.getTime();

  for (const n of notes) {
    const ts = n.updated_at;
    if (ts < startMs || ts >= endMs) continue;
    const dow = new Date(ts).getDay();
    const idx = (dow + 6) % 7;
    counts[idx]++;
  }

  const total = counts.reduce((a, b) => a + b, 0);
  let mostActiveIndex = 0;
  let max = -1;
  counts.forEach((c, i) => {
    if (c > max) {
      max = c;
      mostActiveIndex = i;
    }
  });
  return { counts, total, mostActiveIndex };
}

export function notesUpdatedTodayCount(notes: Note[]): number {
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  const start = t.getTime();
  const end = start + 86400000;
  return notes.filter((n) => n.updated_at >= start && n.updated_at < end).length;
}

export function averageWordsPerNote(notes: Note[]): number {
  if (notes.length === 0) return 0;
  const sum = notes.reduce((s, n) => s + (n.word_count ?? 0), 0);
  return Math.round(sum / notes.length);
}

export function countRootDatabases(roots: WorkspaceNode[]): number {
  return roots.filter((n) => n.node_type === "database").length;
}
