import type {
  AuditReport,
  AuditRow,
  Category,
  PluginGroup,
} from "./audit.js";
import type {
  PruneAction,
  PruneAppliedEntry,
  PruneReport,
} from "./prune.js";
import type { SuggestBucket, SuggestReport } from "./suggest.js";

const C = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

interface FormatOptions {
  color: boolean;
  filter?: Category;
}

function pluginKey(g: { pluginName: string; pluginScope: string }): string {
  return `${g.pluginName}@${g.pluginScope}`;
}

export function formatReport(report: AuditReport, opts: FormatOptions): string {
  const c = opts.color ? C : new Proxy({} as typeof C, { get: () => "" });
  const lines: string[] = [];

  lines.push(
    `${c.bold}skill-graveyard${c.reset} ${c.dim}— audit ${report.windowDays}d window${c.reset}`,
  );
  lines.push(
    `${c.dim}sessions:${c.reset} ${report.sessionsAnalyzed}  ` +
      `${c.dim}files:${c.reset} ${report.filesAnalyzed}  ` +
      `${c.dim}skill calls:${c.reset} ${report.totalSkillCalls}  ` +
      `${c.dim}errored:${c.reset} ${report.totalErroredCalls}`,
  );
  lines.push("");

  const filtered = opts.filter
    ? report.rows.filter((r) => r.category === opts.filter)
    : report.rows;

  if (filtered.length === 0) {
    lines.push(`${c.dim}(no matching skills)${c.reset}`);
    return lines.join("\n");
  }

  const groups: Array<{
    title: string;
    color: string;
    hint: string;
    rows: AuditRow[];
  }> = [];

  if (!opts.filter || opts.filter === "active") {
    const rows = filtered.filter((r) => r.category === "active");
    if (rows.length) {
      groups.push({
        title: `ACTIVE (${rows.length})`,
        color: c.green,
        hint: "installed and invoked — keep",
        rows,
      });
    }
  }

  if (!opts.filter || opts.filter === "missing") {
    const rows = filtered.filter((r) => r.category === "missing");
    if (rows.length) {
      groups.push({
        title: `MISSING (${rows.length})`,
        color: c.cyan,
        hint: "resolved successfully but source not located — project-scoped, registered by an external framework, or in a path not scanned",
        rows,
      });
    }
  }

  if (!opts.filter || opts.filter === "hallucinated") {
    const rows = filtered.filter((r) => r.category === "hallucinated");
    if (rows.length) {
      groups.push({
        title: `HALLUCINATED (${rows.length})`,
        color: c.yellow,
        hint: "Claude tried to invoke and got an error — likely confused with tool/command names, mostly noise",
        rows,
      });
    }
  }

  for (const g of groups) {
    lines.push(`${g.color}${c.bold}${g.title}${c.reset}  ${c.dim}${g.hint}${c.reset}`);
    lines.push(formatTable(g.rows, c));
    lines.push("");
  }

  if (!opts.filter || opts.filter === "dead") {
    const deadRows = filtered.filter((r) => r.category === "dead");
    const rollupCandidates = report.pluginGroups.filter((g) => g.rollupCandidate);
    const rollupKeys = new Set(rollupCandidates.map(pluginKey));

    const individualDead = deadRows.filter((r) => {
      const inst = r.installed;
      if (!inst || inst.source.kind !== "plugin") return true;
      return !rollupKeys.has(pluginKey(inst.source));
    });

    if (deadRows.length || rollupCandidates.length) {
      const totalDead = deadRows.length;
      lines.push(
        `${c.red}${c.bold}DEAD (${totalDead})${c.reset}  ${c.dim}installed but 0 invocations in ${report.windowDays}d — removal candidates${c.reset}`,
      );

      if (rollupCandidates.length) {
        lines.push(
          `${c.dim}plugin rollups (every skill of the plugin is dead — uninstall the whole plugin):${c.reset}`,
        );
        lines.push(formatPluginRollupTable(rollupCandidates, c));
        lines.push("");
      }

      if (individualDead.length) {
        if (rollupCandidates.length) {
          lines.push(`${c.dim}individual dead skills (not rolled up):${c.reset}`);
        }
        lines.push(formatTable(individualDead, c));
        lines.push("");
      }
    }
  }

  return lines.join("\n").trimEnd();
}

function formatPluginRollupTable(groups: PluginGroup[], c: typeof C): string {
  const headers = ["plugin", "skills", "calls", "removal command"];
  const data = groups.map((g) => [
    `plugin:${g.pluginName}`,
    `${g.deadSkills}/${g.totalSkills}`,
    String(g.invocationCount),
    `claude /plugin remove ${g.pluginName}@${g.pluginScope}`,
  ]);

  const widths = headers.map((h, i) =>
    Math.max(h.length, ...data.map((row) => row[i]?.length ?? 0)),
  );

  const headerLine = headers
    .map((h, i) => c.dim + h.padEnd(widths[i]!) + c.reset)
    .join("  ");
  const sep = c.dim + widths.map((w) => "─".repeat(w)).join("  ") + c.reset;

  const out = [headerLine, sep];
  for (const row of data) {
    out.push(row.map((cell, i) => (cell ?? "").padEnd(widths[i]!)).join("  "));
  }
  return out.join("\n");
}

function formatTable(rows: AuditRow[], c: typeof C): string {
  const headers = ["skill", "calls", "sessions", "errors", "last", "source"];
  const data = rows.map((r) => [
    r.invokeName,
    String(r.usage?.totalCalls ?? 0),
    String(r.usage?.uniqueSessions ?? 0),
    String(r.usage?.erroredCalls ?? 0),
    relativeTime(r.usage?.lastCallAt ?? null),
    sourceLabel(r),
  ]);

  const widths = headers.map((h, i) =>
    Math.max(h.length, ...data.map((row) => row[i]?.length ?? 0)),
  );

  const headerLine = headers
    .map((h, i) => c.dim + h.padEnd(widths[i]!) + c.reset)
    .join("  ");
  const sep = c.dim + widths.map((w) => "─".repeat(w)).join("  ") + c.reset;

  const out = [headerLine, sep];
  for (const row of data) {
    out.push(row.map((cell, i) => (cell ?? "").padEnd(widths[i]!)).join("  "));
  }
  return out.join("\n");
}

function sourceLabel(r: AuditRow): string {
  if (!r.installed) return "—";
  const s = r.installed.source;
  if (s.kind === "plugin") return `plugin:${s.pluginName}`;
  if (s.kind === "project") {
    const base = s.projectDir.split("/").filter(Boolean).pop() ?? s.projectDir;
    return `project:${base}`;
  }
  return s.kind;
}

function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  const diffMs = Date.now() - t;
  const days = Math.floor(diffMs / 86_400_000);
  if (days < 1) {
    const hours = Math.floor(diffMs / 3_600_000);
    return hours <= 0 ? "just now" : `${hours}h ago`;
  }
  return `${days}d ago`;
}

export function formatJson(report: unknown): string {
  return JSON.stringify(report, null, 2);
}

export function formatPruneReport(
  report: PruneReport,
  opts: { color: boolean },
): string {
  const c = opts.color ? C : new Proxy({} as typeof C, { get: () => "" });
  const lines: string[] = [];

  const unlinks = report.actions.filter((a) => a.kind === "unlink");
  const pluginRemovals = report.actions.filter((a) => a.kind === "plugin-remove");

  lines.push(
    `${c.bold}skill-graveyard prune${c.reset} ${c.dim}— ${report.windowDays}d window${c.reset}`,
  );
  lines.push(
    `${c.dim}plan:${c.reset} ${unlinks.length} unlinks, ${pluginRemovals.length} plugin removals  ` +
      `${c.dim}mode:${c.reset} ${report.apply ? "apply" : "dry-run"}`,
  );
  lines.push("");

  if (unlinks.length === 0 && pluginRemovals.length === 0) {
    lines.push(`${c.dim}(nothing to prune)${c.reset}`);
    return lines.join("\n");
  }

  if (unlinks.length) {
    const header = report.apply ? "UNLINKS" : "WOULD UNLINK";
    lines.push(`${c.red}${c.bold}${header} (${unlinks.length})${c.reset}`);
    for (const a of unlinks) {
      if (a.kind !== "unlink") continue;
      lines.push(
        `  ${c.dim}${a.sourceKind}${c.reset}  ${a.invokeName}  ${c.gray}→${c.reset}  ${a.path}`,
      );
    }
    lines.push("");
  }

  if (pluginRemovals.length) {
    lines.push(
      `${c.yellow}${c.bold}PLUGIN REMOVALS (${pluginRemovals.length})${c.reset}  ${c.dim}run inside Claude Code:${c.reset}`,
    );
    for (const a of pluginRemovals) {
      if (a.kind !== "plugin-remove") continue;
      lines.push(
        `  ${a.command}  ${c.dim}# ${a.skillCount} skills, all dead${c.reset}`,
      );
    }
    lines.push("");
  }

  if (report.apply) {
    lines.push(`${c.bold}RESULTS${c.reset}`);
    for (const e of report.applied) {
      lines.push(formatPruneApplied(e, c));
    }
    const failures = report.applied.filter((e) => e.status === "failed").length;
    const applied = report.applied.filter((e) => e.status === "applied").length;
    const skipped = report.applied.filter((e) => e.status === "skipped").length;
    lines.push("");
    lines.push(
      `${c.dim}summary:${c.reset} ${c.green}${applied} applied${c.reset}  ${c.dim}${skipped} skipped${c.reset}  ${failures > 0 ? c.red : c.dim}${failures} failed${c.reset}`,
    );
  } else {
    lines.push(
      `${c.dim}re-run with ${c.bold}--apply${c.reset}${c.dim} to execute the unlinks (plugin removals always print only)${c.reset}`,
    );
  }

  return lines.join("\n").trimEnd();
}

function formatPruneApplied(e: PruneAppliedEntry, c: typeof C): string {
  if (e.status === "applied" && e.action.kind === "unlink") {
    return `  ${c.green}✓${c.reset} unlinked ${e.action.path}`;
  }
  if (e.status === "failed" && e.action.kind === "unlink") {
    return `  ${c.red}✗${c.reset} ${e.action.path} — ${e.message ?? "unknown error"}`;
  }
  if (e.status === "skipped" && e.action.kind === "plugin-remove") {
    return `  ${c.dim}→${c.reset} run inside CC: ${e.action.command}`;
  }
  return `  ${e.status} ${e.action.invokeName}`;
}

export function formatSuggestReport(
  report: SuggestReport,
  opts: { color: boolean },
): string {
  const c = opts.color ? C : new Proxy({} as typeof C, { get: () => "" });
  const lines: string[] = [];

  lines.push(
    `${c.bold}skill-graveyard suggest${c.reset} ${c.dim}— ${report.windowDays}d window${c.reset}`,
  );
  lines.push(
    `${c.dim}actionable groups:${c.reset} ${report.totalActionable}`,
  );
  lines.push("");

  const sections: { bucket: SuggestBucket; title: string; color: string; hint: string }[] = [
    {
      bucket: "external_framework",
      title: "EXTERNAL FRAMEWORK",
      color: c.cyan,
      hint: "skill is registered by another framework Claude Code runs inside — document it in your CLAUDE.md so future Claude knows it's valid",
    },
    {
      bucket: "typo",
      title: "LIKELY TYPO",
      color: c.yellow,
      hint: "close to an installed skill name — review the call sites",
    },
    {
      bucket: "tool_confusion",
      title: "TOOL/SKILL CONFUSION",
      color: c.gray,
      hint: "Claude invoked a built-in CC tool name (Bash, Read, ...) as a skill — known model failure mode, not actionable",
    },
    {
      bucket: "unclassified",
      title: "UNCLASSIFIED",
      color: c.gray,
      hint: "no matching pattern — review manually",
    },
  ];

  for (const sec of sections) {
    const entries = report.groups[sec.bucket];
    if (!entries.length) continue;

    const totalCalls = entries.reduce((s, e) => s + e.invocations, 0);
    lines.push(
      `${sec.color}${c.bold}${sec.title} (${entries.length})${c.reset}  ${c.dim}${totalCalls} calls${c.reset}`,
    );
    lines.push(`${c.dim}${sec.hint}${c.reset}`);

    if (sec.bucket === "external_framework") {
      const byFramework = new Map<string, typeof entries>();
      for (const e of entries) {
        const k = e.framework ?? "unknown";
        const arr = byFramework.get(k) ?? [];
        arr.push(e);
        byFramework.set(k, arr);
      }
      for (const [fw, list] of byFramework) {
        const names = list.map((e) => e.invokeName).join(", ");
        const calls = list.reduce((s, e) => s + e.invocations, 0);
        lines.push(`  ${c.bold}~/.${fw}/${c.reset}  ${c.dim}${calls} calls${c.reset}`);
        lines.push(`    ${names}`);
      }
    } else if (sec.bucket === "typo") {
      for (const e of entries) {
        lines.push(
          `  ${c.bold}${e.invokeName}${c.reset} → ${e.closestMatch}  ${c.dim}(${e.invocations} calls; ${e.detail})${c.reset}`,
        );
      }
    } else {
      const names = entries.map((e) => `${e.invokeName} (${e.invocations})`).join(", ");
      lines.push(`  ${names}`);
    }
    lines.push("");
  }

  if (report.totalActionable === 0 && Object.values(report.groups).every((g) => g.length === 0)) {
    lines.push(`${c.dim}(nothing to suggest — all hallucinations and missing entries are accounted for)${c.reset}`);
  }

  return lines.join("\n").trimEnd();
}
