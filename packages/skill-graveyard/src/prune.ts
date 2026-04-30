import { unlink } from "node:fs/promises";
import {
  runAudit,
  type AuditReport,
  type PluginGroup,
} from "./audit.js";

export type PruneSourceFilter = "user" | "agents" | "plugin";

export interface PruneOptions {
  days: number;
  apply: boolean;
  only?: PruneSourceFilter;
  claudeDir?: string;
}

export type PruneAction =
  | {
      kind: "unlink";
      sourceKind: "user" | "agents";
      invokeName: string;
      path: string;
    }
  | {
      kind: "plugin-remove";
      sourceKind: "plugin";
      invokeName: string;
      pluginName: string;
      pluginScope: string;
      command: string;
      skillCount: number;
    };

export interface PruneAppliedEntry {
  action: PruneAction;
  status: "applied" | "skipped" | "failed";
  message?: string;
}

export interface PruneReport {
  generatedAt: string;
  windowDays: number;
  apply: boolean;
  actions: PruneAction[];
  applied: PruneAppliedEntry[];
}

export async function runPrune(opts: PruneOptions): Promise<PruneReport> {
  const audit = await runAudit({ days: opts.days, claudeDir: opts.claudeDir });
  const actions = computePruneActions(audit, opts.only);

  const applied: PruneAppliedEntry[] = [];
  if (opts.apply) {
    for (const action of actions) {
      if (action.kind === "unlink") {
        try {
          await unlink(action.path);
          applied.push({ action, status: "applied" });
        } catch (e) {
          applied.push({
            action,
            status: "failed",
            message: e instanceof Error ? e.message : String(e),
          });
        }
      } else {
        applied.push({
          action,
          status: "skipped",
          message: "plugin removal must be run inside Claude Code",
        });
      }
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    windowDays: audit.windowDays,
    apply: opts.apply,
    actions,
    applied,
  };
}

export function computePruneActions(
  audit: AuditReport,
  filter?: PruneSourceFilter,
): PruneAction[] {
  const out: PruneAction[] = [];
  const rollupKeys = new Set(
    audit.pluginGroups
      .filter((g) => g.rollupCandidate)
      .map(pluginGroupKey),
  );

  for (const row of audit.rows) {
    if (row.category !== "dead") continue;
    if (!row.installed) continue;
    const src = row.installed.source;
    if (src.kind === "user" || src.kind === "agents") {
      if (filter && filter !== src.kind) continue;
      out.push({
        kind: "unlink",
        sourceKind: src.kind,
        invokeName: row.invokeName,
        path: row.installed.skillDir,
      });
    }
  }

  for (const g of audit.pluginGroups) {
    if (!g.rollupCandidate) continue;
    if (filter && filter !== "plugin") continue;
    out.push({
      kind: "plugin-remove",
      sourceKind: "plugin",
      invokeName: `plugin:${g.pluginName}`,
      pluginName: g.pluginName,
      pluginScope: g.pluginScope,
      command: pluginRemoveCommand(g),
      skillCount: g.totalSkills,
    });
  }

  return out;
}

function pluginGroupKey(g: PluginGroup): string {
  return `${g.pluginName}@${g.pluginScope}`;
}

function pluginRemoveCommand(g: PluginGroup): string {
  return `claude /plugin remove ${g.pluginName}@${g.pluginScope}`;
}
