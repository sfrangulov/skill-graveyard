import {
  findSessionFiles,
  parseSession,
  type SkillCall,
} from "./parser.js";
import {
  discoverInstalledSkills,
  type InstalledSkill,
} from "./discovery.js";
import { resolveClaudePaths, type ClaudePaths } from "./paths.js";

export interface AuditOptions {
  days: number;
  claudeDir?: string;
}

export interface UsageStat {
  invokeName: string;
  totalCalls: number;
  erroredCalls: number;
  uniqueSessions: number;
  lastCallAt: string | null;
  firstCallAt: string | null;
  observedCwds: string[];
}

export type Category = "active" | "dead" | "missing" | "hallucinated";

export interface AuditRow {
  invokeName: string;
  installed: InstalledSkill | null;
  usage: UsageStat | null;
  category: Category;
}

export interface PluginGroup {
  pluginName: string;
  pluginScope: string;
  totalSkills: number;
  deadSkills: number;
  activeSkills: number;
  invocationCount: number;
  rollupCandidate: boolean;
}

export interface AuditReport {
  generatedAt: string;
  windowDays: number;
  sessionsAnalyzed: number;
  filesAnalyzed: number;
  totalSkillCalls: number;
  totalErroredCalls: number;
  paths: ClaudePaths;
  rows: AuditRow[];
  pluginGroups: PluginGroup[];
}

export async function runAudit(opts: AuditOptions): Promise<AuditReport> {
  const paths = resolveClaudePaths(opts.claudeDir);
  const sinceMs = Date.now() - opts.days * 24 * 60 * 60 * 1000;

  const files = await findSessionFiles(paths.projectsDir, sinceMs);
  const allCalls: SkillCall[] = [];
  const sessionIds = new Set<string>();

  const concurrency = 16;
  let i = 0;
  async function worker() {
    while (i < files.length) {
      const idx = i++;
      const f = files[idx];
      if (!f) continue;
      try {
        const calls = await parseSession(f.filepath, f.projectKey);
        for (const c of calls) {
          allCalls.push(c);
          sessionIds.add(c.sessionId);
        }
      } catch {}
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, files.length) }, () => worker()),
  );

  const cwds = new Set<string>();
  for (const c of allCalls) {
    if (c.cwd) cwds.add(c.cwd);
  }

  const installed = await discoverInstalledSkills(paths, cwds);
  const installedByInvoke = new Map<string, InstalledSkill>();
  for (const s of installed) installedByInvoke.set(s.invokeName, s);

  const usageMap = new Map<string, UsageStat>();
  const cwdSets = new Map<string, Set<string>>();
  for (const call of allCalls) {
    const u =
      usageMap.get(call.skill) ??
      ({
        invokeName: call.skill,
        totalCalls: 0,
        erroredCalls: 0,
        uniqueSessions: 0,
        lastCallAt: null,
        firstCallAt: null,
        observedCwds: [],
      } satisfies UsageStat);
    u.totalCalls++;
    if (call.errored) u.erroredCalls++;
    const ts = call.timestamp;
    if (ts) {
      if (!u.firstCallAt || ts < u.firstCallAt) u.firstCallAt = ts;
      if (!u.lastCallAt || ts > u.lastCallAt) u.lastCallAt = ts;
    }
    usageMap.set(call.skill, u);
    if (call.cwd) {
      const set = cwdSets.get(call.skill) ?? new Set<string>();
      set.add(call.cwd);
      cwdSets.set(call.skill, set);
    }
  }
  for (const [name, set] of cwdSets) {
    const u = usageMap.get(name);
    if (u) u.observedCwds = [...set].sort();
  }

  const sessionsByInvoke = new Map<string, Set<string>>();
  for (const call of allCalls) {
    const set = sessionsByInvoke.get(call.skill) ?? new Set<string>();
    set.add(call.sessionId);
    sessionsByInvoke.set(call.skill, set);
  }
  for (const [name, set] of sessionsByInvoke) {
    const u = usageMap.get(name);
    if (u) u.uniqueSessions = set.size;
  }

  const rows: AuditRow[] = [];
  const seenNames = new Set<string>();

  for (const inst of installed) {
    seenNames.add(inst.invokeName);
    const usage = usageMap.get(inst.invokeName) ?? null;
    rows.push({
      invokeName: inst.invokeName,
      installed: inst,
      usage,
      category: usage ? "active" : "dead",
    });
  }

  for (const [name, usage] of usageMap) {
    if (seenNames.has(name)) continue;
    const inst = installedByInvoke.get(name) ?? null;
    let category: Category;
    if (inst) category = "active";
    else if (usage.erroredCalls === 0) category = "missing";
    else category = "hallucinated";
    rows.push({ invokeName: name, installed: inst, usage, category });
  }

  rows.sort((a, b) => {
    const order = { active: 0, missing: 1, hallucinated: 2, dead: 3 } as const;
    if (order[a.category] !== order[b.category]) {
      return order[a.category] - order[b.category];
    }
    const ac = a.usage?.totalCalls ?? 0;
    const bc = b.usage?.totalCalls ?? 0;
    if (ac !== bc) return bc - ac;
    return a.invokeName.localeCompare(b.invokeName);
  });

  const pluginGroups = computePluginGroups(rows);

  return {
    generatedAt: new Date().toISOString(),
    windowDays: opts.days,
    sessionsAnalyzed: sessionIds.size,
    filesAnalyzed: files.length,
    totalSkillCalls: allCalls.length,
    totalErroredCalls: allCalls.filter((c) => c.errored).length,
    paths,
    rows,
    pluginGroups,
  };
}

function computePluginGroups(rows: AuditRow[]): PluginGroup[] {
  const byKey = new Map<string, PluginGroup>();
  for (const row of rows) {
    const inst = row.installed;
    if (!inst || inst.source.kind !== "plugin") continue;
    const key = `${inst.source.pluginName}@${inst.source.pluginScope}`;
    let g = byKey.get(key);
    if (!g) {
      g = {
        pluginName: inst.source.pluginName,
        pluginScope: inst.source.pluginScope,
        totalSkills: 0,
        deadSkills: 0,
        activeSkills: 0,
        invocationCount: 0,
        rollupCandidate: false,
      };
      byKey.set(key, g);
    }
    g.totalSkills++;
    if (row.category === "dead") g.deadSkills++;
    else if (row.category === "active") g.activeSkills++;
    g.invocationCount += row.usage?.totalCalls ?? 0;
  }
  const out = [...byKey.values()];
  for (const g of out) {
    g.rollupCandidate = g.totalSkills > 0 && g.deadSkills === g.totalSkills;
  }
  out.sort((a, b) => {
    if (a.rollupCandidate !== b.rollupCandidate) return a.rollupCandidate ? -1 : 1;
    if (a.deadSkills !== b.deadSkills) return b.deadSkills - a.deadSkills;
    return a.pluginName.localeCompare(b.pluginName);
  });
  return out;
}
