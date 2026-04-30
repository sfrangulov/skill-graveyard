import type { AuditReport, McpServerSummary, McpBucket } from "./types.js";
import type { PrunePlanEntry } from "./prune.js";
import type { ProjectStat } from "./projects.js";
import type { SuggestRow } from "./suggest.js";

const C = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  gray: "\x1b[90m",
};

interface FormatOptions {
  color: boolean;
}

export function formatAuditJson(report: AuditReport): string {
  return JSON.stringify(
    {
      ...report,
      rows: report.rows.map((r) => ({
        server: r.name,
        category: r.bucket,
        configured: r.configured,
        configuredIn: r.configuredIn,
        toolsSeen: r.toolsSeen,
        toolsInvoked: r.toolsInvoked,
        toolsErrored: r.toolsErrored,
        totalCalls: r.totalCalls,
        successfulCalls: r.successfulCalls,
        erroredCalls: r.erroredCalls,
        lastCallAt: r.lastCallAt,
      })),
    },
    null,
    2,
  );
}

export function formatAuditReport(report: AuditReport, opts: FormatOptions): string {
  const c = (code: string, s: string) => (opts.color ? `${code}${s}${C.reset}` : s);
  const lines: string[] = [];

  // Headline
  lines.push(
    c(C.bold, `mcp-graveyard`) +
      c(C.dim, ` — ${report.windowDays} days · `) +
      `${report.summary.configuredServers} servers configured · ` +
      `${report.summary.totalCalls} calls · ` +
      c(C.green, `${report.summary.successfulCalls} succeeded`) +
      ` · ` +
      c(C.red, `${report.summary.erroredCalls} errored`),
    "",
  );

  // Group by bucket
  const byBucket = new Map<McpBucket, McpServerSummary[]>();
  for (const row of report.rows) {
    if (!byBucket.has(row.bucket)) byBucket.set(row.bucket, []);
    byBucket.get(row.bucket)!.push(row);
  }

  const bucketOrder: McpBucket[] = ["active", "dead", "missing", "hallucinated"];
  for (const bucket of bucketOrder) {
    const rows = byBucket.get(bucket) ?? [];
    if (rows.length === 0) continue;
    lines.push(c(C.bold, `${bucket.toUpperCase()} (${rows.length})`));
    const nameW = Math.max(...rows.map((r) => r.name.length));
    const statsList = rows.map((r) => `${r.toolsSeen} tools, ${r.toolsInvoked.length} invoked, ${r.totalCalls} calls`);
    const statsW = Math.max(...statsList.map((s) => s.length));
    for (let i = 0; i < rows.length; i++) {
      lines.push(formatRow(rows[i]!, statsList[i]!, opts, nameW, statsW));
    }
    lines.push("");
  }

  if ((byBucket.get("dead")?.length ?? 0) > 0) {
    lines.push(c(C.dim, `→ run: mcp-graveyard prune  to clear DEAD servers`));
  }

  return lines.join("\n");
}

function formatRow(row: McpServerSummary, stats: string, opts: FormatOptions, nameW: number, statsW: number): string {
  const c = (code: string, s: string) => (opts.color ? `${code}${s}${C.reset}` : s);
  const name = row.name.padEnd(nameW);
  const last = row.lastCallAt ? c(C.gray, `last ${row.lastCallAt.slice(0, 10)}`) : c(C.gray, "—");
  return `  ${name}  ${stats.padEnd(statsW)}  ${last}`;
}

export function formatDrillDown(server: string, summary: McpServerSummary, opts: FormatOptions): string {
  const c = (code: string, s: string) => (opts.color ? `${code}${s}${C.reset}` : s);
  const lines: string[] = [];
  lines.push(
    c(C.bold, server) +
      c(C.dim, ` — ${summary.toolsSeen} tools · ${summary.toolsInvoked.length} invoked · ${summary.totalCalls} calls`),
    "",
    c(C.bold, `INVOKED (${summary.toolsInvoked.length})`),
  );
  for (const t of summary.toolsInvoked) lines.push(`  ${t}`);
  lines.push("");
  const unsuccessful = summary.toolsSeen - summary.toolsInvoked.length;
  if (unsuccessful > 0) {
    if (summary.bucket === "hallucinated") {
      lines.push(c(C.bold, `HALLUCINATED TOOLS (${unsuccessful})`));
      lines.push(c(C.dim, "  (invoked but consistently errored — these tool names don't exist on a real server)"));
    } else {
      lines.push(c(C.bold, `DEAD TOOLS (${unsuccessful})`));
      lines.push(c(C.dim, "  (advertised in sessions but never successfully invoked)"));
    }
    // We don't have the full advertised list at this layer — for v1 we surface counts only.
    // Listing each dead tool name requires keeping per-tool data through the aggregation,
    // which is a Task 8 enhancement.
  }
  return lines.join("\n");
}

export function formatPruneReport(
  plan: PrunePlanEntry[],
  windowDays: number,
  opts: FormatOptions,
): string {
  const c = (code: string, s: string) => (opts.color ? `${code}${s}${C.reset}` : s);
  if (plan.length === 0) {
    return c(C.dim, `mcp-graveyard prune — nothing to remove (no dead servers in ${windowDays} days)`);
  }
  const lines: string[] = [
    c(C.bold, `mcp-graveyard prune`) +
      c(C.dim, ` — plan: ${plan.length} server${plan.length === 1 ? "" : "s"} to remove`) +
      c(C.dim, ` (0 successful calls in ${windowDays} days)`),
    "",
    ...plan.map((p) => `  ${p.server.padEnd(40)}  ${p.command}`),
    "",
    c(C.dim, `re-run with --apply to execute (backup is automatic)`),
  ];
  return lines.join("\n");
}

export function formatProjectsReport(stats: ProjectStat[], opts: FormatOptions): string {
  const c = (code: string, s: string) => (opts.color ? `${code}${s}${C.reset}` : s);
  if (stats.length === 0) return c(C.dim, "no MCP tool calls in window");
  const lines: string[] = [];
  for (const s of stats) {
    lines.push(`${s.cwd}  ${c(C.dim, `${s.sessions} ses, ${s.totalCalls} calls, ${s.servers.length} servers`)}`);
    const nameW = s.servers.length > 0 ? Math.max(...s.servers.map((srv) => srv.name.length)) : 0;
    for (const srv of s.servers) {
      const mark = srv.hallucinated > 0 ? c(C.red, "✗") : " ";
      const tag = srv.hallucinated > 0 ? c(C.red, ` (${srv.hallucinated} hallucinated)`) : "";
      lines.push(`  ${mark} ${srv.name.padEnd(nameW)}${String(srv.calls).padStart(4)}×${tag}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

export function formatSuggestReport(rows: SuggestRow[], opts: FormatOptions): string {
  const c = (code: string, s: string) => (opts.color ? `${code}${s}${C.reset}` : s);
  if (rows.length === 0) return c(C.dim, "no missing or hallucinated invocations to classify");
  const byCategory = new Map<string, SuggestRow[]>();
  for (const r of rows) {
    if (!byCategory.has(r.category)) byCategory.set(r.category, []);
    byCategory.get(r.category)!.push(r);
  }
  const lines: string[] = [];
  for (const [cat, items] of byCategory) {
    lines.push(c(C.bold, `${cat} (${items.length})`));
    for (const r of items) {
      const tail = r.reason ? c(C.dim, `  — ${r.reason}`) : "";
      lines.push(`  ${r.server}${tail}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
