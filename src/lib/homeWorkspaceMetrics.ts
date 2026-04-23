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

function markdownWordCount(markdown: string): number {
  const plain = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_~-]+/g, " ")
    .trim();

  if (!plain) return 0;
  return plain.split(/\s+/).filter(Boolean).length;
}

export function weekActivityFromNodes(nodes: WorkspaceNode[]): {
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

  for (const node of nodes) {
    const ts = node.updated_at;
    if (ts < startMs || ts >= endMs) continue;
    const dow = new Date(ts).getDay();
    const idx = (dow + 6) % 7;
    counts[idx]++;
  }

  const total = counts.reduce((a, b) => a + b, 0);
  let mostActiveIndex = 0;
  let max = -1;
  counts.forEach((count, index) => {
    if (count > max) {
      max = count;
      mostActiveIndex = index;
    }
  });

  return { counts, total, mostActiveIndex };
}

export function nodesUpdatedTodayCount(nodes: WorkspaceNode[]): number {
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  const start = t.getTime();
  const end = start + 86400000;
  return nodes.filter((node) => node.updated_at >= start && node.updated_at < end).length;
}

export function averageWordsPerNode(nodes: WorkspaceNode[]): number {
  if (nodes.length === 0) return 0;
  const sum = nodes.reduce((acc, node) => acc + markdownWordCount(node.body ?? ""), 0);
  return Math.round(sum / nodes.length);
}

export function totalWordsFromNodes(nodes: WorkspaceNode[]): number {
  return nodes.reduce((acc, node) => acc + markdownWordCount(node.body ?? ""), 0);
}

export function nodeWordCount(node: WorkspaceNode): number {
  return markdownWordCount(node.body ?? "");
}

export function countRootDatabases(roots: WorkspaceNode[]): number {
  return roots.filter((node) => node.node_type === "database").length;
}
