import type { Pointer } from "./types.js";

const POINTER_RE = /^- \[([^\]]+)\]\(([^)]+\.md)\)\s*(?:—\s*(.*))?$/;

export function parseMemoryIndex(content: string, truncationCutoff: number): Pointer[] {
  if (!content) return [];
  const lines = content.split("\n");
  const out: Pointer[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const m = line.match(POINTER_RE);
    if (!m) continue;
    const lineNum = i + 1;
    out.push({
      line: lineNum,
      title: m[1]!,
      target: m[2]!,
      hook: (m[3] ?? "").trim(),
      visible: lineNum <= truncationCutoff,
    });
  }
  return out;
}
