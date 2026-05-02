import { stat } from "node:fs/promises";
import { discoverMemoryDirs, resolveClaudePaths, findSessionFiles } from "@skill-graveyard/core";
import { scanEntryFiles } from "./entry_scanner.js";
import { parseMemorySession } from "./memory_parser.js";
import type { ProjectMemorySummary } from "./types.js";

export interface ProjectsOptions {
  claudeDir?: string;
  windowDays: number;
  coldDays: number;
}

export async function runProjects(opts: ProjectsOptions): Promise<ProjectMemorySummary[]> {
  const paths = resolveClaudePaths(opts.claudeDir);
  const dirs = await discoverMemoryDirs(paths.projectsDir);
  const since = Date.now() - opts.windowDays * 24 * 60 * 60 * 1000;
  const sessionFiles = await findSessionFiles(paths.projectsDir, since);
  const sessionsByKey = new Map<string, typeof sessionFiles>();
  for (const sf of sessionFiles) {
    if (!sessionsByKey.has(sf.projectKey)) sessionsByKey.set(sf.projectKey, []);
    sessionsByKey.get(sf.projectKey)!.push(sf);
  }
  const summaries: ProjectMemorySummary[] = [];
  for (const { projectKey, memoryDir } of dirs) {
    const entries = await scanEntryFiles(memoryDir);
    let lastTouchedAt: string | null = null;
    let totalBytes = 0;
    for (const e of entries) {
      totalBytes += e.bytes;
      if (!lastTouchedAt || e.mtime > lastTouchedAt) lastTouchedAt = e.mtime;
    }
    try {
      const memoryMdStat = await stat(`${memoryDir}/MEMORY.md`);
      const iso = new Date(memoryMdStat.mtimeMs).toISOString();
      if (!lastTouchedAt || iso > lastTouchedAt) lastTouchedAt = iso;
    } catch {
      // no MEMORY.md — fine
    }
    let lastReadAt: string | null = null;
    const projSessions = sessionsByKey.get(projectKey) ?? [];
    for (const sf of projSessions) {
      const reads = await parseMemorySession(sf.filepath, sf.projectKey, memoryDir);
      for (const r of reads) {
        if (r.timestamp && (!lastReadAt || r.timestamp > lastReadAt)) lastReadAt = r.timestamp;
      }
    }
    const touchedMs = lastTouchedAt ? Date.parse(lastTouchedAt) : 0;
    const daysSinceTouch = touchedMs ? Math.floor((Date.now() - touchedMs) / (24 * 60 * 60 * 1000)) : Infinity;
    summaries.push({
      projectKey,
      cwd: decodeProjectKey(projectKey),
      memoryDir,
      entryCount: entries.length,
      totalBytes,
      lastReadAt,
      lastTouchedAt,
      daysSinceTouch,
      cold: daysSinceTouch >= opts.coldDays,
    });
  }
  summaries.sort((a, b) => a.daysSinceTouch - b.daysSinceTouch);
  return summaries;
}

function decodeProjectKey(key: string): string | null {
  // Reverse of cwd.replace(/\//g, "-"). Lossy for paths containing literal "-",
  // so we return null when the result doesn't look like an absolute path.
  if (!key.startsWith("-")) return null;
  return key.replace(/-/g, "/");
}
