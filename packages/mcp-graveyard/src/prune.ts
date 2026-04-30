import { writeFile, mkdir, rename, chmod } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import type { McpServerSummary, McpServerEntry } from "./types.js";

export interface PrunePlanEntry {
  server: string;
  command: string;
}

export function planPrune(
  rows: McpServerSummary[],
  onlyServer: string | undefined,
): PrunePlanEntry[] {
  return rows
    .filter((r) => r.bucket === "dead")
    .filter((r) => (onlyServer ? r.name === onlyServer : true))
    .map((r) => ({ server: r.name, command: `claude mcp remove ${r.name}` }));
}

export async function writePruneBackup(
  claudeDir: string,
  entries: McpServerEntry[],
  windowDays: number,
): Promise<string> {
  const backupDir = join(claudeDir, "mcp-graveyard-backup");
  await mkdir(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const finalPath = join(backupDir, `${stamp}.json`);
  const tmpPath = `${finalPath}.tmp`;
  const contents = {
    removedAt: new Date().toISOString(),
    claudeDir,
    windowDays,
    servers: Object.fromEntries(
      entries.map((e) => [
        e.name,
        {
          ...(e.command !== null && { command: e.command }),
          ...(e.args !== null && { args: e.args }),
          ...(e.env !== null && { env: e.env }),
        },
      ]),
    ),
    restoreHint: "claude mcp add <name> <command> [args...] (consult JSON above for args/env)",
  };
  await writeFile(tmpPath, JSON.stringify(contents, null, 2), { mode: 0o600, flag: "wx" });
  await chmod(tmpPath, 0o600);
  await rename(tmpPath, finalPath);
  return finalPath;
}

export interface ApplyResult {
  removed: string[];
  failed: { server: string; error: string }[];
}

export function applyPrune(plan: PrunePlanEntry[]): ApplyResult {
  const result: ApplyResult = { removed: [], failed: [] };
  for (const entry of plan) {
    const r = spawnSync("claude", ["mcp", "remove", entry.server], { stdio: "inherit" });
    if (r.status === 0) result.removed.push(entry.server);
    else result.failed.push({ server: entry.server, error: `exit ${r.status ?? "signal " + r.signal}` });
  }
  return result;
}

export function ensureClaudeCliAvailable(): void {
  const r = spawnSync("claude", ["--version"], { stdio: "ignore" });
  if (r.error || r.status !== 0) {
    throw new Error("`claude` CLI not in PATH; install Claude Code or run prune without --apply");
  }
}
