import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { discoverInstalledSkills, findGitRoot } from "./discovery.js";
import { resolveClaudePaths } from "./paths.js";
import { classifyMarketplaceEntry, type MarketplaceEntry } from "./source_resolver.js";

export interface PluginSource {
  /** "<name>@<marketplace>" */
  pluginId: string;
  pluginName: string;
  marketplaceName: string;
  /** GitHub repo "owner/name" if marketplace is registered, else null. */
  marketplaceRepo: string | null;
  installedVersion: string;
  gitCommitSha: string | null;
  installPath: string;
  /**
   * Skill names installed under this plugin. Populated by the orchestrator
   * (Task 9) after enumeration, before report assembly. Initialized empty here.
   */
  affectedSkills: string[];
}

interface InstalledPluginsFile {
  version: number;
  plugins: Record<
    string,
    Array<{
      scope: string;
      installPath: string;
      version: string;
      gitCommitSha?: string;
    }>
  >;
}

interface KnownMarketplacesFile {
  [name: string]: {
    source: { source: string; repo?: string };
  };
}

export async function enumeratePluginSources(claudeDir: string): Promise<PluginSource[]> {
  const installedPath = join(claudeDir, "plugins", "installed_plugins.json");
  let installed: InstalledPluginsFile;
  try {
    installed = JSON.parse(await readFile(installedPath, "utf-8")) as InstalledPluginsFile;
  } catch {
    return [];
  }
  let markets: KnownMarketplacesFile = {};
  try {
    markets = JSON.parse(
      await readFile(join(claudeDir, "plugins", "known_marketplaces.json"), "utf-8"),
    ) as KnownMarketplacesFile;
  } catch {
    // missing/malformed → all plugins get marketplaceRepo: null
  }

  const out: PluginSource[] = [];
  for (const [pluginId, entries] of Object.entries(installed.plugins ?? {})) {
    const at = pluginId.lastIndexOf("@");
    const pluginName = at >= 0 ? pluginId.slice(0, at) : pluginId;
    const marketplaceName = at >= 0 ? pluginId.slice(at + 1) : "";
    const market = markets[marketplaceName];
    const repo = market?.source.source === "github" ? market.source.repo ?? null : null;
    for (const entry of entries) {
      out.push({
        pluginId,
        pluginName,
        marketplaceName,
        marketplaceRepo: repo,
        installedVersion: entry.version,
        gitCommitSha: entry.gitCommitSha ?? null,
        installPath: entry.installPath,
        affectedSkills: [],
      });
    }
  }
  return out;
}

export interface GitSource {
  rootPath: string;
  displayName: string;
  remoteUrl: string | null;
  branch: string | null;
  installedSha: string;
  affectedSkills: string[];
}

function git(cwd: string, args: string[]): string | null {
  const r = spawnSync("git", args, { cwd, encoding: "utf-8" });
  if (r.status !== 0) return null;
  return r.stdout.trim();
}

export async function enumerateGitSources(claudeDir: string): Promise<GitSource[]> {
  const paths = resolveClaudePaths(claudeDir);
  const skills = await discoverInstalledSkills(paths);
  const byRoot = new Map<string, { skills: string[] }>();
  for (const skill of skills) {
    if (skill.source.kind !== "user" && skill.source.kind !== "agents") continue;
    const root = findGitRoot(skill.skillDir);
    if (!root) continue;
    const entry = byRoot.get(root) ?? { skills: [] };
    entry.skills.push(skill.bareName);
    byRoot.set(root, entry);
  }
  const out: GitSource[] = [];
  for (const [root, { skills: names }] of byRoot) {
    const remoteUrl = git(root, ["remote", "get-url", "origin"]);
    const branch = git(root, ["symbolic-ref", "--short", "HEAD"]);
    const sha = git(root, ["rev-parse", "HEAD"]) ?? "";
    const home = process.env["HOME"];
    const displayName = home && root.startsWith(home + "/") ? "~" + root.slice(home.length) : root;
    out.push({
      rootPath: root,
      displayName,
      remoteUrl,
      branch,
      installedSha: sha,
      affectedSkills: names.sort(),
    });
  }
  return out;
}

export function compareSemver(a: string, b: string): number {
  const norm = (v: string) => v.replace(/^v/, "").split("-")[0]!;
  const [aMaj = 0, aMin = 0, aPat = 0] = norm(a).split(".").map((n) => parseInt(n, 10) || 0);
  const [bMaj = 0, bMin = 0, bPat = 0] = norm(b).split(".").map((n) => parseInt(n, 10) || 0);
  if (aMaj !== bMaj) return aMaj - bMaj;
  if (aMin !== bMin) return aMin - bMin;
  return aPat - bPat;
}

export type OutdatedStatus = "outdated" | "up-to-date" | "unknown" | "errored";

export interface OutdatedRow {
  kind: "plugin" | "git";
  name: string;
  source?: string;
  status: OutdatedStatus;
  installedVersion: string;
  latestVersion: string;
  affectedSkills: string[];
  reason?: string;
  upgradeHint?: string[];
}

export interface OutdatedReport {
  windowFetchedAt: number;
  cacheHits: number;
  rows: OutdatedRow[];
  counters: { outdated: number; upToDate: number; unknown: number; errored: number };
}

export interface MarketplaceFetchResult {
  data?: { plugins: MarketplaceEntry[] };
  /** Repo HEAD SHA, captured by orchestrator via ls-remote on the marketplace repo. Used by type-D plugins. */
  marketplaceHeadSha?: string;
  error?: string;
}

export interface BuildReportInput {
  plugins: PluginSource[];
  gits: GitSource[];
  marketplaces: Map<string, MarketplaceFetchResult>;
  gitRemoteShas: Map<string, string | { error: string }>;
  cacheHits?: number;
}

export function buildReport(input: BuildReportInput): OutdatedReport {
  const rows: OutdatedRow[] = [];
  for (const p of input.plugins) {
    rows.push(classifyPlugin(p, input.marketplaces, input.gitRemoteShas));
  }
  for (const g of input.gits) {
    rows.push(classifyGit(g, input.gitRemoteShas));
  }
  const counters = { outdated: 0, upToDate: 0, unknown: 0, errored: 0 };
  for (const r of rows) {
    if (r.status === "outdated") counters.outdated++;
    else if (r.status === "up-to-date") counters.upToDate++;
    else if (r.status === "unknown") counters.unknown++;
    else counters.errored++;
  }
  return {
    windowFetchedAt: Date.now(),
    cacheHits: input.cacheHits ?? 0,
    rows,
    counters,
  };
}

const UPDATE_HINT = (id: string): string[] => [`claude plugin update ${id}`];
const REINSTALL_HINT = (id: string): string[] => [
  `claude plugin remove ${id}`,
  `claude plugin install ${id}`,
];
const short = (sha: string): string => sha.slice(0, 7);

function classifyPlugin(
  p: PluginSource,
  marketplaces: Map<string, MarketplaceFetchResult>,
  shas: Map<string, string | { error: string }>,
): OutdatedRow {
  const base = {
    kind: "plugin" as const,
    name: p.pluginId,
    source: `plugin:${p.pluginName}`,
    affectedSkills: p.affectedSkills,
    installedVersion: p.installedVersion,
  };
  if (!p.marketplaceRepo) {
    return { ...base, status: "unknown", latestVersion: "?", reason: "no registered marketplace" };
  }
  const market = marketplaces.get(p.marketplaceRepo);
  if (!market) {
    return { ...base, status: "errored", latestVersion: "?", reason: "marketplace not fetched" };
  }
  if (market.error || !market.data) {
    return { ...base, status: "errored", latestVersion: "?", reason: market.error ?? "marketplace not fetched" };
  }
  const entry = market.data.plugins.find((x) => x.name === p.pluginName);
  if (!entry) {
    return { ...base, status: "unknown", latestVersion: "?", reason: "plugin not listed in marketplace" };
  }

  const strat = classifyMarketplaceEntry(entry);

  switch (strat.kind) {
    case "version-on-entry": {
      const latest = strat.version;
      if (p.installedVersion === "unknown") {
        return {
          ...base,
          status: "outdated",
          latestVersion: latest,
          reason: "installed without version metadata; reinstall to refresh",
          upgradeHint: REINSTALL_HINT(p.pluginId),
        };
      }
      if (compareSemver(p.installedVersion, latest) >= 0) {
        return { ...base, status: "up-to-date", latestVersion: latest };
      }
      return { ...base, status: "outdated", latestVersion: latest, upgradeHint: UPDATE_HINT(p.pluginId) };
    }

    case "sha-pinned": {
      if (!p.gitCommitSha) {
        return {
          ...base,
          status: "unknown",
          latestVersion: short(strat.sha),
          reason: "no local commit recorded; reinstall to refresh",
          upgradeHint: REINSTALL_HINT(p.pluginId),
        };
      }
      if (p.gitCommitSha === strat.sha) {
        return {
          ...base,
          status: "up-to-date",
          installedVersion: short(p.gitCommitSha),
          latestVersion: short(strat.sha),
        };
      }
      return {
        ...base,
        status: "outdated",
        installedVersion: short(p.gitCommitSha),
        latestVersion: short(strat.sha),
        upgradeHint: UPDATE_HINT(p.pluginId),
      };
    }

    case "sha-pinned-or-ref":
    case "ls-remote-upstream": {
      const key = `${strat.url}@${strat.branch}`;
      return classifyByLsRemote(p, base, key, shas);
    }

    case "ls-remote-marketplace": {
      if (p.installedVersion === "unknown") {
        return {
          ...base,
          status: "outdated",
          latestVersion: short(market.marketplaceHeadSha ?? "?"),
          reason: "installed without version metadata (marketplace-internal plugin); reinstall to refresh",
          upgradeHint: REINSTALL_HINT(p.pluginId),
        };
      }
      if (!p.gitCommitSha) {
        return {
          ...base,
          status: "unknown",
          latestVersion: short(market.marketplaceHeadSha ?? "?"),
          reason: "no local commit recorded for marketplace-internal plugin",
          upgradeHint: REINSTALL_HINT(p.pluginId),
        };
      }
      if (!market.marketplaceHeadSha) {
        return { ...base, status: "errored", latestVersion: "?", reason: "marketplace HEAD not fetched" };
      }
      if (p.gitCommitSha === market.marketplaceHeadSha) {
        return {
          ...base,
          status: "up-to-date",
          installedVersion: short(p.gitCommitSha),
          latestVersion: short(market.marketplaceHeadSha),
        };
      }
      return {
        ...base,
        status: "outdated",
        installedVersion: short(p.gitCommitSha),
        latestVersion: short(market.marketplaceHeadSha),
        upgradeHint: UPDATE_HINT(p.pluginId),
      };
    }

    case "unknown-shape":
      return {
        ...base,
        status: "unknown",
        latestVersion: "?",
        reason: "marketplace entry shape not recognized",
      };
  }
}

function classifyByLsRemote(
  p: PluginSource,
  base: {
    kind: "plugin";
    name: string;
    source: string;
    affectedSkills: string[];
    installedVersion: string;
  },
  key: string,
  shas: Map<string, string | { error: string }>,
): OutdatedRow {
  const got = shas.get(key);
  if (got === undefined) {
    return { ...base, status: "errored", latestVersion: "?", reason: "remote sha not fetched" };
  }
  if (typeof got === "object") {
    return { ...base, status: "errored", latestVersion: "?", reason: got.error };
  }
  if (!p.gitCommitSha) {
    return {
      ...base,
      status: "unknown",
      latestVersion: short(got),
      reason: "no local commit recorded; reinstall to refresh",
      upgradeHint: REINSTALL_HINT(p.pluginId),
    };
  }
  if (p.gitCommitSha === got) {
    return {
      ...base,
      status: "up-to-date",
      installedVersion: short(p.gitCommitSha),
      latestVersion: short(got),
    };
  }
  return {
    ...base,
    status: "outdated",
    installedVersion: short(p.gitCommitSha),
    latestVersion: short(got),
    upgradeHint: UPDATE_HINT(p.pluginId),
  };
}

function classifyGit(g: GitSource, shas: Map<string, string | { error: string }>): OutdatedRow {
  const base = {
    kind: "git" as const,
    name: g.displayName,
    affectedSkills: g.affectedSkills,
    installedVersion: short(g.installedSha),
  };
  if (!g.remoteUrl) return { ...base, status: "unknown", latestVersion: "?", reason: "no origin remote" };
  if (!g.branch) return { ...base, status: "unknown", latestVersion: "?", reason: "detached HEAD" };
  const key = `${g.remoteUrl}@${g.branch}`;
  const got = shas.get(key);
  if (got === undefined) return { ...base, status: "errored", latestVersion: "?", reason: "remote sha not fetched" };
  if (typeof got === "object") return { ...base, status: "errored", latestVersion: "?", reason: got.error };
  if (g.installedSha === got) return { ...base, status: "up-to-date", latestVersion: short(got) };
  return {
    ...base,
    status: "outdated",
    latestVersion: short(got),
    upgradeHint: [`git -C ${g.rootPath} pull --ff-only`],
  };
}
