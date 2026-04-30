import { findSessionFiles, parseSession, type SkillCall } from "./parser.js";
import { discoverInstalledSkills, resolveClaudePaths } from "@skill-graveyard/core";

export interface ProjectSkillStat {
  invokeName: string;
  calls: number;
  errored: number;
  installed: boolean;
}

export interface ProjectStat {
  displayPath: string;
  projectKey: string;
  cwd: string | null;
  sessions: number;
  totalCalls: number;
  totalErrored: number;
  uniqueSkills: number;
  skills: ProjectSkillStat[];
}

export interface ProjectsReport {
  generatedAt: string;
  windowDays: number;
  totalProjects: number;
  totalSessions: number;
  totalSkillCalls: number;
  projects: ProjectStat[];
}

export interface ProjectsOptions {
  days: number;
  claudeDir?: string;
}

export async function runProjects(opts: ProjectsOptions): Promise<ProjectsReport> {
  const paths = resolveClaudePaths(opts.claudeDir);
  const sinceMs = Date.now() - opts.days * 24 * 60 * 60 * 1000;

  const files = await findSessionFiles(paths.projectsDir, sinceMs);
  const allCalls: SkillCall[] = [];
  const concurrency = 16;
  let i = 0;
  async function worker() {
    while (i < files.length) {
      const idx = i++;
      const f = files[idx];
      if (!f) continue;
      try {
        const calls = await parseSession(f.filepath, f.projectKey);
        for (const c of calls) allCalls.push(c);
      } catch {}
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, files.length) }, () => worker()),
  );

  const cwdSet = new Set<string>();
  for (const c of allCalls) if (c.cwd) cwdSet.add(c.cwd);

  const installed = await discoverInstalledSkills(paths, cwdSet);
  const installedNames = new Set(installed.map((s) => s.invokeName));

  return computeProjects(allCalls, installedNames, opts.days);
}

interface ProjectAccumulator {
  displayPath: string;
  projectKey: string;
  cwd: string | null;
  sessions: Set<string>;
  totalCalls: number;
  totalErrored: number;
  perSkill: Map<string, { calls: number; errored: number }>;
}

export function computeProjects(
  calls: SkillCall[],
  installedNames: ReadonlySet<string>,
  windowDays: number,
): ProjectsReport {
  const byKey = new Map<string, ProjectAccumulator>();

  for (const call of calls) {
    const key = call.cwd ?? `:${call.projectKey}`;
    let acc = byKey.get(key);
    if (!acc) {
      acc = {
        displayPath: call.cwd ?? decodeProjectKey(call.projectKey),
        projectKey: call.projectKey,
        cwd: call.cwd,
        sessions: new Set(),
        totalCalls: 0,
        totalErrored: 0,
        perSkill: new Map(),
      };
      byKey.set(key, acc);
    }
    acc.sessions.add(call.sessionId);
    acc.totalCalls++;
    if (call.errored) acc.totalErrored++;
    const s = acc.perSkill.get(call.skill) ?? { calls: 0, errored: 0 };
    s.calls++;
    if (call.errored) s.errored++;
    acc.perSkill.set(call.skill, s);
  }

  const projects: ProjectStat[] = [];
  for (const acc of byKey.values()) {
    const skills: ProjectSkillStat[] = [];
    for (const [name, s] of acc.perSkill) {
      skills.push({
        invokeName: name,
        calls: s.calls,
        errored: s.errored,
        installed: installedNames.has(name),
      });
    }
    skills.sort((a, b) => b.calls - a.calls || a.invokeName.localeCompare(b.invokeName));
    projects.push({
      displayPath: acc.displayPath,
      projectKey: acc.projectKey,
      cwd: acc.cwd,
      sessions: acc.sessions.size,
      totalCalls: acc.totalCalls,
      totalErrored: acc.totalErrored,
      uniqueSkills: skills.length,
      skills,
    });
  }

  projects.sort(
    (a, b) =>
      b.totalCalls - a.totalCalls ||
      b.sessions - a.sessions ||
      a.displayPath.localeCompare(b.displayPath),
  );

  let totalSessions = 0;
  let totalSkillCalls = 0;
  for (const p of projects) {
    totalSessions += p.sessions;
    totalSkillCalls += p.totalCalls;
  }

  return {
    generatedAt: new Date().toISOString(),
    windowDays,
    totalProjects: projects.length,
    totalSessions,
    totalSkillCalls,
    projects,
  };
}

function decodeProjectKey(key: string): string {
  if (key.startsWith("-")) return "/" + key.slice(1).replace(/-/g, "/");
  return key;
}
