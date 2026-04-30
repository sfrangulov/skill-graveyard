import type { AuditReport, McpServerSummary, McpBucket } from "./types.js";

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
        toolsInvoked: r.toolsInvoked.length,
        toolsErrored: r.toolsErrored.length,
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

  const bucketOrder: McpBucket[] = ["active", "dead", "hallucinated", "missing"];
  for (const bucket of bucketOrder) {
    const rows = byBucket.get(bucket) ?? [];
    if (rows.length === 0) continue;
    lines.push(c(C.bold, `${bucket.toUpperCase()} (${rows.length})`));
    for (const row of rows) {
      lines.push(formatRow(row, opts));
    }
    lines.push("");
  }

  if ((byBucket.get("dead")?.length ?? 0) > 0) {
    lines.push(c(C.dim, `→ run: mcp-graveyard prune  to clear DEAD servers`));
  }

  return lines.join("\n");
}

function formatRow(row: McpServerSummary, opts: FormatOptions): string {
  const c = (code: string, s: string) => (opts.color ? `${code}${s}${C.reset}` : s);
  const name = row.name.padEnd(40);
  const stats = `${row.toolsSeen} tools, ${row.toolsInvoked.length} invoked, ${row.totalCalls} calls`;
  const last = row.lastCallAt ? c(C.gray, `last ${row.lastCallAt.slice(0, 10)}`) : c(C.gray, "—");
  return `  ${name}${stats.padEnd(36)}${last}`;
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
  const dead = summary.toolsSeen - summary.toolsInvoked.length;
  if (dead > 0) {
    lines.push(c(C.bold, `DEAD TOOLS (${dead})`));
    lines.push(c(C.dim, "  (advertised in sessions but never successfully invoked)"));
    // We don't have the full advertised list at this layer — for v1 we surface counts only.
    // Listing each dead tool name requires keeping per-tool data through the aggregation,
    // which is a Task 8 enhancement.
  }
  return lines.join("\n");
}
