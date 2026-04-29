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

const HEADLINE_WIDTH = 60;
const BAR_WIDTH = 16;
const WRAP_WIDTH = 80;

function pluginKey(g: { pluginName: string; pluginScope: string }): string {
  return `${g.pluginName}@${g.pluginScope}`;
}

function colors(use: boolean): typeof C {
  if (use) return C;
  return new Proxy({} as typeof C, { get: () => "" });
}

function bar(value: number, max: number, width: number): string {
  if (max <= 0 || value <= 0) return "░".repeat(width);
  const exact = (value / max) * width;
  if (exact < 1) return "▏" + "░".repeat(width - 1);
  const filled = Math.min(width, Math.round(exact));
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function rule(width: number, c: typeof C, char = "─"): string {
  return c.dim + char.repeat(width) + c.reset;
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

function shortenPath(p: string): string {
  const home = process.env["HOME"] ?? "";
  if (home && p.startsWith(home + "/")) return "~/" + p.slice(home.length + 1);
  return p;
}

function wrapNames(names: string[], indent: string, maxWidth: number): string[] {
  if (names.length === 0) return [];
  const lines: string[] = [];
  let current = indent + names[0];
  for (let i = 1; i < names.length; i++) {
    const candidate = current + ", " + names[i];
    if (candidate.length > maxWidth) {
      lines.push(current + ",");
      current = indent + names[i];
    } else {
      current = candidate;
    }
  }
  lines.push(current);
  return lines;
}

export function formatJson(report: unknown): string {
  return JSON.stringify(report, null, 2);
}

export function formatReport(report: AuditReport, opts: FormatOptions): string {
  const c = colors(opts.color);
  const lines: string[] = [];

  lines.push(...formatHeadline(report, c));
  lines.push("");

  const filtered = opts.filter
    ? report.rows.filter((r) => r.category === opts.filter)
    : report.rows;

  if (filtered.length === 0 && (!opts.filter || opts.filter !== "dead")) {
    lines.push(`${c.dim}(no matching skills)${c.reset}`);
    return lines.join("\n");
  }

  if (!opts.filter || opts.filter === "active") {
    const rows = filtered.filter((r) => r.category === "active");
    if (rows.length) {
      lines.push(...formatActiveSection(rows, c));
      lines.push("");
    }
  }

  if (!opts.filter || opts.filter === "missing") {
    const rows = filtered.filter((r) => r.category === "missing");
    if (rows.length) {
      lines.push(...formatMissingSection(rows, c));
      lines.push("");
    }
  }

  if (!opts.filter || opts.filter === "hallucinated") {
    const rows = filtered.filter((r) => r.category === "hallucinated");
    if (rows.length) {
      lines.push(...formatHallucinatedSection(rows, c));
      lines.push("");
    }
  }

  if (!opts.filter || opts.filter === "dead") {
    const deadRows = report.rows.filter((r) => r.category === "dead");
    const rollups = report.pluginGroups.filter((g) => g.rollupCandidate);
    if (deadRows.length || rollups.length) {
      lines.push(...formatDeadSection(deadRows, rollups, report.windowDays, c));
      lines.push("");
    }
  }

  return lines.join("\n").trimEnd();
}

function formatHeadline(report: AuditReport, c: typeof C): string[] {
  const installed = report.rows.filter((r) => r.installed).length;
  const active = report.rows.filter((r) => r.category === "active").length;
  const dead = report.rows.filter((r) => r.category === "dead").length;
  const missing = report.rows.filter((r) => r.category === "missing").length;
  const hallucinatedNames = report.rows.filter(
    (r) => r.category === "hallucinated",
  ).length;
  const usedPct = installed > 0 ? Math.round((active / installed) * 100) : 0;

  const usageBar = bar(active, installed, 32);
  const lines: string[] = [];
  lines.push(rule(HEADLINE_WIDTH, c));
  lines.push(
    ` ${c.bold}skill-graveyard${c.reset} ${c.dim}— ${report.windowDays}d audit${c.reset}`,
  );
  lines.push(
    ` ${c.bold}${installed}${c.reset} installed   ` +
      `${c.green}${active} active${c.reset} · ` +
      `${c.red}${dead} dead${c.reset} · ` +
      `${c.cyan}${missing} missing${c.reset}`,
  );
  lines.push(
    `              ${c.green}${usageBar}${c.reset}  ${c.dim}${usedPct}% used${c.reset}`,
  );
  lines.push(
    ` ${c.dim}${report.sessionsAnalyzed} sessions, ${report.totalSkillCalls} calls, ${report.totalErroredCalls} errored${c.reset}`,
  );
  if (hallucinatedNames > 0) {
    lines.push(
      ` ${c.yellow}+${hallucinatedNames}${c.reset}${c.dim} hallucinated names ${c.reset}${c.dim}(telemetry)${c.reset}`,
    );
  }
  lines.push(rule(HEADLINE_WIDTH, c));
  return lines;
}

function formatActiveSection(rows: AuditRow[], c: typeof C): string[] {
  const max = Math.max(...rows.map((r) => r.usage?.totalCalls ?? 0));
  const skillW = Math.max(
    "skill".length,
    ...rows.map((r) => r.invokeName.length),
  );
  const lastW = Math.max(
    "last".length,
    ...rows.map((r) => relativeTime(r.usage?.lastCallAt ?? null).length),
  );

  const lines: string[] = [];
  lines.push(
    `${c.green}${c.bold}ACTIVE (${rows.length})${c.reset}  ${c.dim}installed and invoked — keep${c.reset}`,
  );
  lines.push(
    `${c.dim}${"skill".padEnd(skillW)}  ${"usage".padEnd(BAR_WIDTH + 4)}  ${"last".padEnd(lastW)}  source${c.reset}`,
  );

  for (const r of rows) {
    const calls = r.usage?.totalCalls ?? 0;
    const b = bar(calls, max, BAR_WIDTH);
    const callsStr = String(calls).padStart(3);
    const last = relativeTime(r.usage?.lastCallAt ?? null).padEnd(lastW);
    const src = sourceLabel(r);
    lines.push(
      `${r.invokeName.padEnd(skillW)}  ${c.green}${b}${c.reset} ${callsStr}  ${c.dim}${last}${c.reset}  ${c.dim}${src}${c.reset}`,
    );
  }
  return lines;
}

function formatMissingSection(rows: AuditRow[], c: typeof C): string[] {
  const lines: string[] = [];
  lines.push(
    `${c.cyan}${c.bold}MISSING (${rows.length})${c.reset}  ${c.dim}resolved but source not located — project-scoped or external framework${c.reset}`,
  );
  const skillW = Math.max(
    "skill".length,
    ...rows.map((r) => r.invokeName.length),
  );
  for (const r of rows) {
    const calls = r.usage?.totalCalls ?? 0;
    const last = relativeTime(r.usage?.lastCallAt ?? null);
    lines.push(
      `  ${r.invokeName.padEnd(skillW)}  ${String(calls).padStart(3)} calls  ${c.dim}(${last})${c.reset}`,
    );
  }
  lines.push(`  ${c.dim}→ skill-graveyard suggest    for actionable classification${c.reset}`);
  return lines;
}

function formatHallucinatedSection(rows: AuditRow[], c: typeof C): string[] {
  const totalCalls = rows.reduce(
    (s, r) => s + (r.usage?.totalCalls ?? 0),
    0,
  );
  const sorted = [...rows].sort(
    (a, b) => (b.usage?.totalCalls ?? 0) - (a.usage?.totalCalls ?? 0),
  );

  const lines: string[] = [];
  lines.push(
    `${c.yellow}${c.bold}HALLUCINATED (${rows.length} names, ${totalCalls} calls)${c.reset}  ${c.dim}Claude→tool/skill confusion, mostly noise${c.reset}`,
  );

  const top = sorted.slice(0, 5);
  const tail = sorted.slice(5);
  const topStr = top
    .map((r) => `${r.invokeName} (${r.usage?.totalCalls ?? 0})`)
    .join(", ");
  lines.push(`  ${c.dim}top:${c.reset} ${topStr}`);

  if (tail.length) {
    const tailNames = tail.map((r) => r.invokeName);
    const tailLines = wrapNames(tailNames, "    ", WRAP_WIDTH);
    lines.push(`  ${c.dim}tail (${tail.length}):${c.reset}`);
    for (const l of tailLines) lines.push(`${c.dim}${l}${c.reset}`);
  }
  lines.push(`  ${c.dim}→ skill-graveyard suggest    for actionable classification${c.reset}`);
  return lines;
}

function formatDeadSection(
  deadRows: AuditRow[],
  rollups: PluginGroup[],
  windowDays: number,
  c: typeof C,
): string[] {
  const rollupKeys = new Set(rollups.map(pluginKey));
  const individual = deadRows.filter((r) => {
    const inst = r.installed;
    if (!inst || inst.source.kind !== "plugin") return true;
    return !rollupKeys.has(pluginKey(inst.source));
  });

  const lines: string[] = [];
  lines.push(
    `${c.red}${c.bold}DEAD (${deadRows.length})${c.reset}  ${c.dim}installed, 0 invocations in ${windowDays}d — removal candidates${c.reset}`,
  );
  lines.push("");

  if (rollups.length) {
    lines.push(
      `  ${c.bold}plugin rollups (${rollups.length})${c.reset}  ${c.dim}every skill of the plugin is dead — uninstall whole plugin${c.reset}`,
    );
    const pluginW = Math.max(
      ...rollups.map((g) => `plugin:${g.pluginName}`.length),
    );
    const skillsW = Math.max(...rollups.map((g) => `${g.totalSkills} skills`.length));
    for (const g of rollups) {
      const label = `plugin:${g.pluginName}`.padEnd(pluginW);
      const skills = `${g.totalSkills} ${g.totalSkills === 1 ? "skill" : "skills"}`.padEnd(skillsW);
      lines.push(
        `    ${label}  ${c.dim}${skills}${c.reset}  claude /plugin remove ${g.pluginName}@${g.pluginScope}`,
      );
    }
    lines.push("");
  }

  if (individual.length) {
    const grouped = groupDeadIndividual(individual);
    lines.push(
      `  ${c.bold}individual (${individual.length})${c.reset}`,
    );
    for (const g of grouped) {
      lines.push(
        `    ${c.bold}${g.label}${c.reset}  ${c.dim}(${g.names.length})${c.reset}` +
          (g.note ? `  ${c.dim}— ${g.note}${c.reset}` : ""),
      );
      for (const l of wrapNames(g.names, "      ", WRAP_WIDTH)) {
        lines.push(l);
      }
      if (g.hint) lines.push(`      ${c.dim}→ ${g.hint}${c.reset}`);
    }
  }

  return lines;
}

interface DeadGroup {
  label: string;
  names: string[];
  note?: string;
  hint?: string;
}

function groupDeadIndividual(rows: AuditRow[]): DeadGroup[] {
  const groups = new Map<string, DeadGroup>();
  for (const row of rows) {
    const inst = row.installed;
    if (!inst) continue;
    const src = inst.source;

    let key: string;
    let label: string;
    let displayName: string;
    let note: string | undefined;
    let hint: string | undefined;

    if (src.kind === "user") {
      key = "user";
      label = "user";
      displayName = row.invokeName;
      hint = "skill-graveyard prune --only user";
    } else if (src.kind === "agents") {
      key = "agents";
      label = "agents";
      displayName = row.invokeName;
      hint = "skill-graveyard prune --only agents";
    } else if (src.kind === "plugin") {
      key = `plugin:${src.pluginName}`;
      label = `plugin:${src.pluginName}`;
      const prefix = `${src.pluginName}:`;
      displayName = row.invokeName.startsWith(prefix)
        ? row.invokeName.slice(prefix.length)
        : row.invokeName;
      note = "partial — plugin still has active skills, keep installed";
    } else if (src.kind === "project") {
      const base = src.projectDir.split("/").filter(Boolean).pop() ?? src.projectDir;
      key = `project:${base}`;
      label = `project:${base}`;
      displayName = row.invokeName;
      note = "project-scoped — out of scope for prune";
    } else {
      key = "other";
      label = "other";
      displayName = row.invokeName;
    }

    const g = groups.get(key) ?? { label, names: [], note, hint };
    g.names.push(displayName);
    groups.set(key, g);
  }

  for (const g of groups.values()) g.names.sort();

  const order: Record<string, number> = {
    user: 0,
    agents: 1,
  };
  return [...groups.values()].sort((a, b) => {
    const ao = order[a.label] ?? (a.label.startsWith("plugin:") ? 2 : 3);
    const bo = order[b.label] ?? (b.label.startsWith("plugin:") ? 2 : 3);
    if (ao !== bo) return ao - bo;
    return a.label.localeCompare(b.label);
  });
}

export function formatPruneReport(
  report: PruneReport,
  opts: { color: boolean },
): string {
  const c = colors(opts.color);
  const lines: string[] = [];

  const unlinks = report.actions.filter(
    (a): a is Extract<PruneAction, { kind: "unlink" }> => a.kind === "unlink",
  );
  const pluginRemovals = report.actions.filter(
    (a): a is Extract<PruneAction, { kind: "plugin-remove" }> =>
      a.kind === "plugin-remove",
  );

  lines.push(
    `${c.bold}skill-graveyard prune${c.reset} ${c.dim}— ${report.windowDays}d window  (mode: ${report.apply ? "apply" : "dry-run"})${c.reset}`,
  );
  lines.push(
    `${c.dim}plan:${c.reset} ${unlinks.length} unlinks, ${pluginRemovals.length} plugin removals`,
  );
  lines.push("");

  if (unlinks.length === 0 && pluginRemovals.length === 0) {
    lines.push(`${c.dim}(nothing to prune)${c.reset}`);
    return lines.join("\n");
  }

  if (unlinks.length) {
    const header = report.apply ? "UNLINKED" : "WOULD UNLINK";
    const byKind = new Map<string, typeof unlinks>();
    for (const u of unlinks) {
      const arr = byKind.get(u.sourceKind) ?? [];
      arr.push(u);
      byKind.set(u.sourceKind, arr);
    }
    lines.push(
      `${c.red}${c.bold}${header} (${unlinks.length})${c.reset}`,
    );
    for (const [kind, group] of byKind) {
      lines.push(
        `  ${c.bold}${kind}${c.reset} ${c.dim}(${group.length})${c.reset}`,
      );
      for (const u of group) {
        lines.push(`    ${shortenPath(u.path)}`);
      }
    }
    lines.push("");
  }

  if (pluginRemovals.length) {
    lines.push(
      `${c.yellow}${c.bold}PLUGIN REMOVALS (${pluginRemovals.length})${c.reset}  ${c.dim}run inside Claude Code:${c.reset}`,
    );
    for (const a of pluginRemovals) {
      lines.push(
        `  ${a.command}  ${c.dim}# ${a.skillCount} ${a.skillCount === 1 ? "skill" : "skills"}, all dead${c.reset}`,
      );
    }
    lines.push("");
  }

  if (report.apply) {
    const failures = report.applied.filter((e) => e.status === "failed");
    const applied = report.applied.filter((e) => e.status === "applied");
    const skipped = report.applied.filter((e) => e.status === "skipped");

    if (failures.length) {
      lines.push(`${c.red}${c.bold}FAILURES (${failures.length})${c.reset}`);
      for (const e of failures) {
        if (e.action.kind === "unlink") {
          lines.push(
            `  ${c.red}✗${c.reset} ${shortenPath(e.action.path)} — ${e.message ?? "unknown"}`,
          );
        }
      }
      lines.push("");
    }
    lines.push(
      `${c.dim}summary:${c.reset} ${c.green}${applied.length} applied${c.reset}  ${c.dim}${skipped.length} skipped (plugin)${c.reset}  ${failures.length > 0 ? c.red : c.dim}${failures.length} failed${c.reset}`,
    );
  } else {
    lines.push(
      `${c.dim}re-run with ${c.bold}--apply${c.reset}${c.dim} to execute the unlinks (plugin removals always print only)${c.reset}`,
    );
  }

  return lines.join("\n").trimEnd();
}

export function formatSuggestReport(
  report: SuggestReport,
  opts: { color: boolean },
): string {
  const c = colors(opts.color);
  const lines: string[] = [];

  const totalNames = Object.values(report.groups).reduce(
    (s, g) => s + g.length,
    0,
  );
  const totalCalls = Object.values(report.groups).reduce(
    (s, g) => s + g.reduce((ss, e) => ss + e.invocations, 0),
    0,
  );

  lines.push(
    `${c.bold}skill-graveyard suggest${c.reset} ${c.dim}— ${report.windowDays}d window${c.reset}`,
  );
  lines.push(
    `${c.dim}${totalNames} unique names, ${totalCalls} calls, ${report.totalActionable} actionable groups${c.reset}`,
  );
  lines.push("");

  const sections: {
    bucket: SuggestBucket;
    title: string;
    color: string;
    hint: string;
  }[] = [
    {
      bucket: "external_framework",
      title: "EXTERNAL FRAMEWORK",
      color: c.cyan,
      hint: "registered by another framework Claude Code runs inside — document in CLAUDE.md",
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
      hint: "Claude invoked a built-in CC tool name as a skill — known model failure mode",
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
    const sectionCalls = entries.reduce((s, e) => s + e.invocations, 0);
    lines.push(
      `${sec.color}${c.bold}${sec.title} (${entries.length} names, ${sectionCalls} calls)${c.reset}`,
    );
    lines.push(`  ${c.dim}${sec.hint}${c.reset}`);

    if (sec.bucket === "external_framework") {
      const byFramework = new Map<string, typeof entries>();
      for (const e of entries) {
        const k = e.framework ?? "unknown";
        const arr = byFramework.get(k) ?? [];
        arr.push(e);
        byFramework.set(k, arr);
      }
      for (const [fw, list] of byFramework) {
        const calls = list.reduce((s, e) => s + e.invocations, 0);
        lines.push(
          `  ${c.bold}~/.${fw}/${c.reset}  ${c.dim}${list.length} names, ${calls} calls${c.reset}`,
        );
        for (const l of wrapNames(
          list.map((e) => e.invokeName),
          "    ",
          WRAP_WIDTH,
        )) {
          lines.push(l);
        }
      }
    } else if (sec.bucket === "typo") {
      for (const e of entries) {
        lines.push(
          `  ${c.bold}${e.invokeName}${c.reset} → ${e.closestMatch}  ${c.dim}(${e.invocations} calls; ${e.detail})${c.reset}`,
        );
      }
    } else {
      const tagged = entries.map((e) => `${e.invokeName} (${e.invocations})`);
      for (const l of wrapNames(tagged, "  ", WRAP_WIDTH)) {
        lines.push(l);
      }
    }
    lines.push("");
  }

  if (totalNames === 0) {
    lines.push(
      `${c.dim}(nothing to suggest — all hallucinations and missing entries are accounted for)${c.reset}`,
    );
  }

  return lines.join("\n").trimEnd();
}
