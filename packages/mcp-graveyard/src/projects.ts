import { findSessionFiles, resolveClaudePaths } from "@skill-graveyard/core";
import { parseMcpSession } from "./mcp_parser.js";

export interface ProjectStat {
  cwd: string;
  sessions: number;
  totalCalls: number;
  servers: { name: string; calls: number; errored: number }[];
}

export interface ProjectsOptions {
  claudeDir?: string;
  windowDays: number;
}

export async function runProjects(opts: ProjectsOptions): Promise<ProjectStat[]> {
  const paths = resolveClaudePaths(opts.claudeDir);
  const since = Date.now() - opts.windowDays * 24 * 60 * 60 * 1000;
  const files = await findSessionFiles(paths.projectsDir, since);
  const byCwd = new Map<string, { sessions: Set<string>; calls: { server: string; errored: boolean }[] }>();
  for (const sf of files) {
    const calls = await parseMcpSession(sf.filepath, sf.projectKey);
    for (const c of calls) {
      const cwd = c.cwd ?? "(unknown)";
      if (!byCwd.has(cwd)) byCwd.set(cwd, { sessions: new Set(), calls: [] });
      const entry = byCwd.get(cwd)!;
      entry.sessions.add(c.sessionId);
      entry.calls.push({ server: c.server, errored: c.errored });
    }
  }
  const out: ProjectStat[] = [];
  for (const [cwd, data] of byCwd) {
    const byServer = new Map<string, { calls: number; errored: number }>();
    for (const c of data.calls) {
      if (!byServer.has(c.server)) byServer.set(c.server, { calls: 0, errored: 0 });
      const e = byServer.get(c.server)!;
      e.calls++;
      if (c.errored) e.errored++;
    }
    out.push({
      cwd,
      sessions: data.sessions.size,
      totalCalls: data.calls.length,
      servers: [...byServer.entries()]
        .map(([name, v]) => ({ name, ...v }))
        .sort((a, b) => b.calls - a.calls),
    });
  }
  return out.sort((a, b) => b.totalCalls - a.totalCalls);
}
