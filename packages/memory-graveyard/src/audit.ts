import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { resolveClaudePaths, findSessionFiles } from "@skill-graveyard/core";
import { parseMemoryIndex } from "./index_parser.js";
import { scanEntryFiles } from "./entry_scanner.js";
import { parseMemorySession } from "./memory_parser.js";
import type {
  AuditOptions,
  AuditReport,
  EntryReport,
  MemoryRead,
  Pointer,
  EntryFile,
  Bucket,
} from "./types.js";

export async function runAudit(opts: AuditOptions): Promise<AuditReport> {
  const paths = resolveClaudePaths(opts.claudeDir);
  const projectKey = opts.projectKey ?? deriveProjectKeyFromCwd(opts.cwd ?? process.cwd());
  const memoryDir = join(paths.projectsDir, projectKey, "memory");
  const memoryMdPath = join(memoryDir, "MEMORY.md");

  const indexContent = existsSync(memoryMdPath) ? await readFile(memoryMdPath, "utf8") : "";
  const pointers = parseMemoryIndex(indexContent, 200);
  const entries = await scanEntryFiles(memoryDir);

  const since = Date.now() - opts.windowDays * 24 * 60 * 60 * 1000;
  const sessionFiles = await findSessionFiles(paths.projectsDir, since);
  const projectSessions = sessionFiles.filter((sf) => sf.projectKey === projectKey);
  const reads: MemoryRead[] = [];
  for (const sf of projectSessions) {
    const calls = await parseMemorySession(sf.filepath, sf.projectKey, memoryDir);
    for (const c of calls) {
      const t = c.timestamp ? Date.parse(c.timestamp) : NaN;
      if (Number.isFinite(t) && t < since) continue;
      reads.push(c);
    }
  }

  const rows = correlate(pointers, entries, reads);
  const filtered = opts.only ? rows.filter((r) => r.bucket === opts.only) : rows;

  return {
    generatedAt: new Date().toISOString(),
    windowDays: opts.windowDays,
    claudeDir: paths.claudeDir,
    projectKey,
    memoryDir,
    summary: {
      indexedEntries: pointers.length,
      onDiskEntries: entries.length,
      totalReads: reads.length,
      successfulReads: reads.filter((r) => !r.errored).length,
      erroredReads: reads.filter((r) => r.errored).length,
    },
    rows: filtered,
  };
}

function correlate(
  pointers: Pointer[],
  entries: EntryFile[],
  reads: MemoryRead[],
): EntryReport[] {
  const byPointer = new Map(pointers.map((p) => [p.target, p]));
  const byEntry = new Map(entries.map((e) => [e.basename, e]));
  const allBasenames = new Set<string>([
    ...pointers.map((p) => p.target),
    ...entries.map((e) => e.basename),
    ...reads.map((r) => r.memoryFile),
  ]);

  const out: EntryReport[] = [];
  for (const basename of allBasenames) {
    const pointer = byPointer.get(basename) ?? null;
    const entry = byEntry.get(basename) ?? null;
    const myReads = reads.filter((r) => r.memoryFile === basename);
    const successes = myReads.filter((r) => !r.errored);
    const errors = myReads.filter((r) => r.errored);
    const lastReadAt = myReads
      .map((r) => r.timestamp)
      .filter((t): t is string => !!t)
      .sort()
      .pop() ?? null;

    const inIndex = pointer !== null;
    const fileExists = entry !== null;
    const bucket = bucketFor({ inIndex, fileExists, successes: successes.length, errors: errors.length });
    if (bucket === null) continue;

    out.push({
      basename,
      inIndex,
      fileExists,
      pointer,
      entry,
      reads: successes,
      errors,
      bucket,
      lastReadAt,
    });
  }
  out.sort((a, b) => {
    const order: Bucket[] = ["active", "dead", "missing", "hallucinated"];
    const ai = order.indexOf(a.bucket);
    const bi = order.indexOf(b.bucket);
    if (ai !== bi) return ai - bi;
    if (a.reads.length !== b.reads.length) return b.reads.length - a.reads.length;
    return a.basename.localeCompare(b.basename);
  });
  return out;
}

function bucketFor(s: { inIndex: boolean; fileExists: boolean; successes: number; errors: number }): Bucket | null {
  if (s.inIndex && s.fileExists && s.successes >= 1) return "active";
  if (s.inIndex && s.fileExists && s.successes === 0) return "dead";
  if (!s.inIndex && s.fileExists && s.successes >= 1) return "missing";
  if (s.inIndex && !s.fileExists && s.errors >= 1) return "hallucinated";
  // Static-only orphan (file on disk, not in index, never read) → not in any bucket; lint #2 catches it.
  // Static-only broken pointer (in index, file missing, never followed) → lint #1 catches it.
  return null;
}

function deriveProjectKeyFromCwd(cwd: string): string {
  // Claude Code encodes cwd by replacing / with - and prefixing with the leading -.
  return cwd.replace(/\//g, "-");
}
