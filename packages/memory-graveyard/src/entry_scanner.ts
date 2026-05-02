import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { EntryFile } from "./types.js";

const FM_RE = /^---\n([\s\S]*?)\n---/;
const KEY_RE = /^([a-zA-Z_][a-zA-Z0-9_-]*):\s*(.*)$/;

export function parseFrontmatter(content: string): EntryFile["frontmatter"] {
  const m = content.match(FM_RE);
  if (!m) return null;
  const fm: NonNullable<EntryFile["frontmatter"]> = {};
  for (const line of m[1]!.split("\n")) {
    const km = line.match(KEY_RE);
    if (!km) continue;
    const k = km[1]!;
    const v = km[2]!.trim();
    if (k === "name" || k === "description" || k === "type") {
      (fm as Record<string, string>)[k] = v;
    }
  }
  return fm;
}

export async function scanEntryFiles(memoryDir: string): Promise<EntryFile[]> {
  let files: string[];
  try {
    files = await readdir(memoryDir);
  } catch {
    return [];
  }
  const out: EntryFile[] = [];
  for (const f of files) {
    if (!f.endsWith(".md") || f === "MEMORY.md") continue;
    const path = join(memoryDir, f);
    let s: Awaited<ReturnType<typeof stat>>;
    try {
      s = await stat(path);
    } catch {
      continue;
    }
    if (!s.isFile()) continue;
    let head = "";
    try {
      head = (await readFile(path, "utf8")).slice(0, 4096);
    } catch {
      // file disappeared between readdir and read — skip
      continue;
    }
    out.push({
      basename: f,
      path,
      exists: true,
      frontmatter: parseFrontmatter(head),
      bytes: s.size,
      mtime: new Date(s.mtimeMs).toISOString(),
    });
  }
  return out;
}

export async function readEntryBody(path: string): Promise<string> {
  return readFile(path, "utf8");
}
