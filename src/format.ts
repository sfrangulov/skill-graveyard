import type { AuditReport, AuditRow } from "./audit.js";

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

import type { Category } from "./audit.js";

interface FormatOptions {
  color: boolean;
  filter?: Category;
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

  if (!opts.filter || opts.filter === "dead") {
    const rows = filtered.filter((r) => r.category === "dead");
    if (rows.length) {
      groups.push({
        title: `DEAD (${rows.length})`,
        color: c.red,
        hint: `installed but 0 invocations in ${report.windowDays}d — removal candidates`,
        rows,
      });
    }
  }

  for (const g of groups) {
    lines.push(`${g.color}${c.bold}${g.title}${c.reset}  ${c.dim}${g.hint}${c.reset}`);
    lines.push(formatTable(g.rows, c));
    lines.push("");
  }

  return lines.join("\n").trimEnd();
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

export function formatJson(report: AuditReport): string {
  return JSON.stringify(report, null, 2);
}
