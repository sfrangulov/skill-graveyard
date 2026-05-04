import type {
  AuditReport,
  EntryReport,
  Bucket,
  LintReport,
  LintFinding,
  PrunePlanItem,
  ProjectMemorySummary,
} from "./types.js";
import type { ApplyResult } from "./prune.js";

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
}

const BUCKET_ORDER: Bucket[] = ["active", "dead", "missing", "hallucinated"];
const BUCKET_LABEL: Record<Bucket, string> = {
  active: "ACTIVE",
  dead: "DEAD",
  missing: "MISSING",
  hallucinated: "HALLUCINATED",
};

function colorize(opts: FormatOptions) {
  return (code: string, s: string) => (opts.color ? `${code}${s}${C.reset}` : s);
}

// Returns the audit split into sections (headline, then one block per non-empty
// bucket, then an optional prune hint) so the CLI can stream them with pauses.
export function formatAuditReportSections(
  report: AuditReport,
  opts: FormatOptions,
): string[] {
  const c = colorize(opts);
  const sections: string[] = [];

  sections.push(
    c(C.bold, `memory-graveyard`) +
      c(C.dim, ` — ${report.windowDays} days · `) +
      `${report.summary.indexedEntries} indexed · ` +
      `${report.summary.onDiskEntries} on disk · ` +
      `${report.summary.totalReads} reads · ` +
      c(C.green, `${report.summary.successfulReads} succeeded`) +
      ` · ` +
      c(report.summary.erroredReads > 0 ? C.red : C.gray, `${report.summary.erroredReads} errored`),
  );

  const grouped = new Map<Bucket, EntryReport[]>();
  for (const r of report.rows) {
    if (!grouped.has(r.bucket)) grouped.set(r.bucket, []);
    grouped.get(r.bucket)!.push(r);
  }

  for (const bucket of BUCKET_ORDER) {
    const rows = grouped.get(bucket) ?? [];
    if (rows.length === 0) continue;
    const lines: string[] = [];
    lines.push(c(C.bold, `${BUCKET_LABEL[bucket]} (${rows.length})`) + c(C.dim, suffixFor(bucket)));
    const nameW = Math.max("entry".length, ...rows.map((r) => r.basename.length));
    const readsW = Math.max("reads".length, ...rows.map((r) => String(r.reads.length).length));
    const errsW = Math.max("errors".length, ...rows.map((r) => String(r.errors.length).length));
    const lineW = Math.max("line".length, ...rows.map((r) => (r.pointer ? String(r.pointer.line).length : 1)));

    lines.push(
      c(
        C.dim,
        `  ${"entry".padEnd(nameW)}  ${"reads".padStart(readsW)}  ${"errors".padStart(errsW)}  ${"last".padEnd(10)}  ${"line".padStart(lineW)}`,
      ),
    );
    for (const r of rows) {
      const name = bucket === "dead" || bucket === "hallucinated" ? c(C.gray, r.basename.padEnd(nameW)) : r.basename.padEnd(nameW);
      const reads = r.reads.length > 0 ? c(C.green, String(r.reads.length).padStart(readsW)) : c(C.dim, "0".padStart(readsW));
      const errs = r.errors.length > 0 ? c(C.red, String(r.errors.length).padStart(errsW)) : c(C.dim, "0".padStart(errsW));
      const last = c(C.gray, formatDate(r.lastReadAt).padEnd(10));
      const lineNo = r.pointer ? String(r.pointer.line).padStart(lineW) : c(C.dim, "—".padStart(lineW));
      lines.push(`  ${name}  ${reads}  ${errs}  ${last}  ${lineNo}`);
    }
    sections.push(lines.join("\n"));
  }

  if ((grouped.get("dead")?.length ?? 0) + (grouped.get("hallucinated")?.length ?? 0) > 0) {
    sections.push(c(C.dim, `→ run: memory-graveyard prune  to clear DEAD entries and broken pointers`));
  }
  return sections;
}

export function formatAuditReport(report: AuditReport, opts: FormatOptions): string {
  return formatAuditReportSections(report, opts).join("\n\n");
}

export function formatAuditJson(report: AuditReport): string {
  const flat = {
    generatedAt: report.generatedAt,
    windowDays: report.windowDays,
    projectKey: report.projectKey,
    memoryDir: report.memoryDir,
    summary: report.summary,
    rows: report.rows.map((r) => ({
      entry: r.basename,
      category: r.bucket,
      inIndex: r.inIndex,
      fileExists: r.fileExists,
      pointerLine: r.pointer?.line ?? null,
      successfulReads: r.reads.length,
      erroredReads: r.errors.length,
      lastReadAt: r.lastReadAt,
    })),
  };
  return JSON.stringify(flat, null, 2);
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return iso.slice(0, 10);
}

function suffixFor(bucket: Bucket): string {
  if (bucket === "dead") return "  — candidates for removal";
  if (bucket === "missing") return "  — orphan files Claude found anyway";
  if (bucket === "hallucinated") return "  — broken pointers Claude tried to follow";
  return "";
}

export function formatLintReport(report: LintReport, opts: FormatOptions): string {
  const c = colorize(opts);
  const lines: string[] = [];
  lines.push(c(C.bold, `memory-graveyard lint`) + c(C.dim, ` — ${report.memoryDir}`));
  lines.push("");
  for (const f of report.findings) {
    lines.push(...renderFinding(f, opts));
    lines.push("");
  }
  if (report.findings.length === 0) {
    lines.push(c(C.green, "All checks passed."));
  } else {
    const infos = report.findings.filter((f) => f.severity === "info").length;
    lines.push(
      c(C.bold, "Summary: ") +
        c(report.summary.errors > 0 ? C.red : C.gray, `${report.summary.errors} errors`) +
        ", " +
        c(report.summary.warnings > 0 ? C.yellow : C.gray, `${report.summary.warnings} warnings`) +
        ", " +
        c(C.dim, `${infos} info`),
    );
  }
  return lines.join("\n");
}

export function formatLintJson(report: LintReport): string {
  return JSON.stringify(report, null, 2);
}

function renderFinding(f: LintFinding, opts: FormatOptions): string[] {
  const c = colorize(opts);
  const sev =
    f.severity === "error"
      ? c(C.red, "✗ error")
      : f.severity === "warning"
        ? c(C.yellow, "! warning")
        : c(C.gray, "· info");
  switch (f.check) {
    case "broken-pointers": {
      const list = f.details as { line: number; title: string; target: string }[];
      const lineW = Math.max("line".length, ...list.map((x) => String(x.line).length + 5));
      const targetW = Math.max(...list.map((x) => x.target.length));
      const out = [`${sev}  ${c(C.bold, `Broken pointers`)} ${c(C.dim, `(${list.length})`)}`];
      for (const x of list) {
        out.push(
          `  ${`line ${x.line}`.padEnd(lineW)}  ${x.target.padEnd(targetW)}  ${c(C.dim, `referenced as "${x.title}"`)}`,
        );
      }
      return out;
    }
    case "orphans": {
      const list = f.details as { basename: string; bytes: number }[];
      const nameW = Math.max(...list.map((x) => x.basename.length));
      const out = [
        `${sev}  ${c(C.bold, `Orphan files`)} ${c(C.dim, `(${list.length}) — present on disk, missing from MEMORY.md`)}`,
      ];
      for (const x of list) out.push(`  ${x.basename.padEnd(nameW)}  ${c(C.dim, `${x.bytes} bytes`)}`);
      return out;
    }
    case "truncation-budget": {
      const d = f.details as {
        total: number;
        visible: number;
        cutOff: number;
        cutoff: number;
        sample: { line: number; title: string; target: string }[];
      };
      const out = [
        `${sev}  ${c(C.bold, `Truncation budget`)} ${c(C.dim, `cutoff: ${d.cutoff} lines`)}`,
        `  Total entries:        ${d.total}`,
        `  Visible to Claude:    ${c(C.green, String(d.visible))}`,
        `  Cut off (lines ${d.cutoff + 1}+): ${c(C.red, String(d.cutOff))}`,
      ];
      if (d.sample.length > 0) {
        out.push("");
        out.push(c(C.dim, `  Below the cutoff (sample):`));
        const lineW = Math.max(...d.sample.map((s) => String(s.line).length + 5));
        const targetW = Math.max(...d.sample.map((s) => s.target.length));
        for (const s of d.sample) {
          out.push(
            `    ${`line ${s.line}`.padEnd(lineW)}  ${s.target.padEnd(targetW)}  ${c(C.dim, `"${s.title}"`)}`,
          );
        }
      }
      return out;
    }
    case "index-size": {
      const d = f.details as { tokens: number; threshold: number; over: boolean };
      const status = d.over
        ? c(C.red, `OVER (> ${d.threshold} tokens)`)
        : c(C.green, `OK (< ${d.threshold} tokens)`);
      return [
        `${sev}  ${c(C.bold, `Index size`)} ${c(C.dim, `${d.tokens} tokens · cl100k_base, 5–15% drift vs Claude tokenizer`)}`,
        `  Status: ${status}`,
      ];
    }
    case "stale-dated": {
      const list = f.details as { basename: string; lastDate: string; daysAgo: number }[];
      const nameW = Math.max(...list.map((x) => x.basename.length));
      const out = [
        `${sev}  ${c(C.bold, `Stale project entries`)} ${c(C.dim, `(${list.length}) — last referenced date older than the threshold`)}`,
      ];
      for (const x of list) {
        out.push(
          `  ${x.basename.padEnd(nameW)}  ${c(C.dim, `last date ${x.lastDate} (${x.daysAgo} days ago)`)}`,
        );
      }
      return out;
    }
  }
}

export function formatPruneReport(plan: PrunePlanItem[], opts: { apply: boolean; color?: boolean }): string {
  const c = colorize({ color: opts.color ?? false });
  if (plan.length === 0) {
    return c(C.dim, "memory-graveyard prune — nothing to do.");
  }
  const lines: string[] = [];
  const fileCount = plan.filter((p) => p.fileExists).length;
  const pointerCount = plan.filter((p) => p.pointerLine !== null).length;
  lines.push(c(C.bold, "memory-graveyard prune") + c(C.dim, " — plan"));
  lines.push(`  ${c(C.red, String(fileCount))} entry files to delete`);
  lines.push(`  ${c(C.red, String(pointerCount))} pointer lines to remove`);
  lines.push("");

  const reasonW = Math.max(...plan.map((p) => p.reason.length));
  const nameW = Math.max(...plan.map((p) => p.basename.length));
  for (const item of plan) {
    const reason = c(C.yellow, `[${item.reason.padEnd(reasonW)}]`);
    const lineSuffix = item.pointerLine ? c(C.dim, `  (line ${item.pointerLine})`) : "";
    lines.push(`  ${reason}  ${item.basename.padEnd(nameW)}${lineSuffix}`);
  }
  if (!opts.apply) {
    lines.push("");
    lines.push(c(C.dim, "re-run with --apply to execute (backup is automatic)"));
  }
  return lines.join("\n");
}

export function formatApplyResult(result: ApplyResult, opts?: FormatOptions): string {
  const c = colorize(opts ?? { color: false });
  const lines: string[] = [];
  lines.push(c(C.dim, `backup: ${result.backupDir}`));
  lines.push(`${c(C.green, `✓ ${result.deleted.length}`)} files deleted, ${c(C.green, String(result.removedPointerLines.length))} pointer lines removed`);
  if (result.failed.length > 0) {
    lines.push(c(C.red, "failed:"));
    for (const f of result.failed) lines.push(`  ${f.basename}: ${f.error}`);
  }
  return lines.join("\n");
}

export function formatProjectsReport(stats: ProjectMemorySummary[], opts: FormatOptions): string {
  const c = colorize(opts);
  if (stats.length === 0) return c(C.dim, "No memory dirs found across projects.");

  const lines: string[] = [];
  const cwdW = Math.max(...stats.map((s) => (s.cwd ?? s.projectKey).length));
  const entriesW = Math.max(
    "entries".length,
    ...stats.map((s) => `${s.entryCount} entries`.length),
  );
  const sizeW = Math.max(...stats.map((s) => formatBytes(s.totalBytes).length));

  for (const s of stats) {
    const cwdDisplay = s.cwd ?? s.projectKey;
    const last = s.lastTouchedAt ? s.lastTouchedAt.slice(0, 10) : "—";
    const days = Number.isFinite(s.daysSinceTouch) ? `${s.daysSinceTouch}d` : "—";
    const entries = `${s.entryCount} entries`.padEnd(entriesW);
    const size = formatBytes(s.totalBytes).padStart(sizeW);
    const cwdStr = s.cold ? c(C.gray, cwdDisplay.padEnd(cwdW)) : cwdDisplay.padEnd(cwdW);
    const cold = s.cold ? "  " + c(C.red, "✗ COLD") : "";
    lines.push(
      `${cwdStr}  ${c(C.dim, entries)}  ${c(C.dim, size)}  ${c(C.dim, `last ${last}`)}  ${c(C.dim, `(${days})`)}${cold}`,
    );
  }
  return lines.join("\n");
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
