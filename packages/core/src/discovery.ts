import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, parse } from "node:path";
import type { ClaudePaths } from "./paths.js";

export type SkillSource =
  | { kind: "user"; dir: string }
  | { kind: "agents"; dir: string }
  | { kind: "plugin"; pluginName: string; pluginScope: string; dir: string }
  | { kind: "project"; projectDir: string; dir: string };

export interface InstalledSkill {
  invokeName: string;
  bareName: string;
  source: SkillSource;
  skillDir: string;
}

export async function discoverInstalledSkills(
  paths: ClaudePaths,
  projectCwds?: Iterable<string>,
): Promise<InstalledSkill[]> {
  const out: InstalledSkill[] = [];

  for (const dir of [paths.userSkillsDir, paths.agentsSkillsDir]) {
    const kind = dir === paths.userSkillsDir ? "user" : "agents";
    const skills = await listSkillsInDir(dir);
    for (const s of skills) {
      out.push({
        invokeName: s.bareName,
        bareName: s.bareName,
        source: { kind, dir },
        skillDir: s.skillDir,
      });
    }
  }

  const plugins = await readInstalledPlugins(paths.installedPluginsJson);
  for (const p of plugins) {
    const skillsRoot = join(p.installPath, "skills");
    const skills = await listSkillsInDir(skillsRoot);
    for (const s of skills) {
      out.push({
        invokeName: `${p.pluginName}:${s.bareName}`,
        bareName: s.bareName,
        source: {
          kind: "plugin",
          pluginName: p.pluginName,
          pluginScope: p.pluginScope,
          dir: skillsRoot,
        },
        skillDir: s.skillDir,
      });
    }
  }

  if (projectCwds) {
    const projectSkills = await discoverProjectScopedSkills(projectCwds);
    out.push(...projectSkills);
  }

  return dedupeByInvokeName(out);
}

export async function discoverProjectScopedSkills(
  cwds: Iterable<string>,
): Promise<InstalledSkill[]> {
  const home = homedir();
  const candidates = collectAncestors(cwds, home);

  const out: InstalledSkill[] = [];
  for (const dir of candidates) {
    const skillsRoot = join(dir, ".claude", "skills");
    const skills = await listSkillsInDir(skillsRoot);
    for (const s of skills) {
      out.push({
        invokeName: s.bareName,
        bareName: s.bareName,
        source: { kind: "project", projectDir: dir, dir: skillsRoot },
        skillDir: s.skillDir,
      });
    }
  }
  return out;
}

function collectAncestors(cwds: Iterable<string>, home: string): Set<string> {
  const candidates = new Set<string>();
  for (const cwd of cwds) {
    if (!cwd) continue;
    let p = cwd;
    while (p && p !== "/" && p !== home) {
      candidates.add(p);
      const parent = dirname(p);
      if (parent === p) break;
      p = parent;
    }
  }
  return candidates;
}

interface RawSkillDir {
  bareName: string;
  skillDir: string;
}

async function listSkillsInDir(dir: string): Promise<RawSkillDir[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const out: RawSkillDir[] = [];
  for (const name of entries) {
    if (name.startsWith(".")) continue;
    const skillDir = join(dir, name);
    let s;
    try {
      s = await stat(skillDir);
    } catch {
      continue;
    }
    if (!s.isDirectory()) continue;
    if (!(await hasSkillManifest(skillDir))) continue;
    out.push({ bareName: name, skillDir });
  }
  return out;
}

async function hasSkillManifest(skillDir: string): Promise<boolean> {
  for (const candidate of ["SKILL.md", "skill.md"]) {
    try {
      const s = await stat(join(skillDir, candidate));
      if (s.isFile()) return true;
    } catch {}
  }
  return false;
}

interface PluginRecord {
  pluginName: string;
  pluginScope: string;
  installPath: string;
}

async function readInstalledPlugins(
  jsonPath: string,
): Promise<PluginRecord[]> {
  let raw: string;
  try {
    raw = await readFile(jsonPath, "utf8");
  } catch {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (typeof parsed !== "object" || parsed === null) return [];
  const plugins = (parsed as { plugins?: unknown }).plugins;
  if (typeof plugins !== "object" || plugins === null) return [];

  const out: PluginRecord[] = [];
  for (const [key, valRaw] of Object.entries(plugins)) {
    const at = key.indexOf("@");
    const pluginName = at >= 0 ? key.slice(0, at) : key;
    const pluginScope = at >= 0 ? key.slice(at + 1) : "";
    const arr = Array.isArray(valRaw) ? valRaw : [];
    for (const item of arr) {
      if (typeof item !== "object" || item === null) continue;
      const installPath = (item as { installPath?: unknown }).installPath;
      if (typeof installPath === "string" && installPath.length > 0) {
        out.push({ pluginName, pluginScope, installPath });
      }
    }
  }
  return out;
}

function dedupeByInvokeName(items: InstalledSkill[]): InstalledSkill[] {
  const seen = new Map<string, InstalledSkill>();
  for (const it of items) {
    if (!seen.has(it.invokeName)) seen.set(it.invokeName, it);
  }
  return [...seen.values()];
}

export interface MemoryDir {
  projectKey: string;
  memoryDir: string;
}

export async function discoverMemoryDirs(projectsDir: string): Promise<MemoryDir[]> {
  let entries: string[];
  try {
    entries = await readdir(projectsDir);
  } catch {
    return [];
  }
  const out: MemoryDir[] = [];
  for (const projectKey of entries) {
    const memoryDir = join(projectsDir, projectKey, "memory");
    try {
      const s = await stat(memoryDir);
      if (s.isDirectory()) out.push({ projectKey, memoryDir });
    } catch {
      continue;
    }
  }
  return out;
}

/** Walks up from `start`, returns the first directory containing a `.git` entry, or null. */
export function findGitRoot(start: string): string | null {
  let cur = start;
  const root = parse(cur).root;
  while (true) {
    if (existsSync(join(cur, ".git"))) return cur;
    if (cur === root) return null;
    const next = dirname(cur);
    if (next === cur) return null;
    cur = next;
  }
}
