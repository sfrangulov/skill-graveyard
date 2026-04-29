import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { discoverInstalledSkills, findGitRoot } from "./discovery.js";
import { resolveClaudePaths } from "./paths.js";

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
