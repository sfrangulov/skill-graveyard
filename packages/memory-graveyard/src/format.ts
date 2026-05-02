import type { AuditReport, EntryReport, Bucket, LintReport, LintFinding, PrunePlanItem } from "./types.js";
import type { ApplyResult } from "./prune.js";

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

export function formatAuditReport(report: AuditReport, opts: FormatOptions): string {
  const lines: string[] = [];
  lines.push(
    `memory-graveyard — ${report.windowDays} days · ${report.summary.indexedEntries} entries indexed · ${report.summary.onDiskEntries} on disk · ${report.summary.totalReads} reads · ${report.summary.successfulReads} succeeded · ${report.summary.erroredReads} errored`,
  );
  lines.push("");

  const grouped = new Map<Bucket, EntryReport[]>();
  for (const r of report.rows) {
    if (!grouped.has(r.bucket)) grouped.set(r.bucket, []);
    grouped.get(r.bucket)!.push(r);
  }

  for (const bucket of BUCKET_ORDER) {
    const rows = grouped.get(bucket) ?? [];
    if (rows.length === 0) continue;
    lines.push(`${BUCKET_LABEL[bucket]} (${rows.length})${suffixFor(bucket)}`);
    lines.push(
      `  ${pad("entry", 32)} ${pad("reads", 7)} ${pad("errors", 7)} ${pad("last", 12)} ${pad("line", 5)}`,
    );
    for (const r of rows) {
      lines.push(
        `  ${pad(r.basename, 32)} ${pad(String(r.reads.length), 7)} ${pad(String(r.errors.length), 7)} ${pad(formatDate(r.lastReadAt), 12)} ${pad(r.pointer ? String(r.pointer.line) : "—", 5)}`,
      );
    }
    lines.push("");
  }

  if ((grouped.get("dead")?.length ?? 0) + (grouped.get("hallucinated")?.length ?? 0) > 0) {
    lines.push("→ run: memory-graveyard prune  to clear DEAD entries and broken pointers");
  }
  return lines.join("\n");
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

function pad(s: string, n: number): string {
  if (s.length >= n) return s;
  return s + " ".repeat(n - s.length);
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return iso.slice(0, 10);
}

function suffixFor(bucket: Bucket): string {
  if (bucket === "dead") return " — candidates for removal";
  if (bucket === "missing") return " — orphan files Claude found anyway";
  return "";
}

export function formatLintReport(report: LintReport, _opts: FormatOptions): string {
  const lines: string[] = [];
  lines.push(`memory-graveyard lint — ${report.memoryDir}`);
  lines.push("");
  for (const f of report.findings) {
    lines.push(...renderFinding(f));
    lines.push("");
  }
  if (report.findings.length === 0) {
    lines.push("All checks passed.");
  } else {
    lines.push(
      `Summary: ${report.summary.errors} errors, ${report.summary.warnings} warnings, ${
        report.findings.filter((f) => f.severity === "info").length
      } info`,
    );
  }
  return lines.join("\n");
}

export function formatLintJson(report: LintReport): string {
  return JSON.stringify(report, null, 2);
}

function renderFinding(f: LintFinding): string[] {
  switch (f.check) {
    case "broken-pointers": {
      const list = f.details as { line: number; title: string; target: string }[];
      const out = [`Broken pointers (${list.length}):`];
      for (const x of list) out.push(`  line ${x.line}   ${x.target}   referenced as "${x.title}"`);
      return out;
    }
    case "orphans": {
      const list = f.details as { basename: string; bytes: number }[];
      const out = [`Orphan files (${list.length}) — present on disk, missing from MEMORY.md:`];
      for (const x of list) out.push(`  ${x.basename}   ${x.bytes} bytes`);
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
        `Truncation budget — cutoff: ${d.cutoff} lines`,
        `  Total entries:        ${d.total}`,
        `  Visible to Claude:    ${d.visible}`,
        `  Cut off (lines ${d.cutoff + 1}+): ${d.cutOff}`,
      ];
      if (d.sample.length > 0) {
        out.push("");
        out.push("  Below the cutoff (sample):");
        for (const s of d.sample) out.push(`    line ${s.line}   ${s.target}   "${s.title}"`);
      }
      return out;
    }
    case "index-size": {
      const d = f.details as { tokens: number; threshold: number; over: boolean };
      return [
        `Index size — ${d.tokens} tokens (cl100k_base; 5–15% drift vs Claude tokenizer)`,
        `  Status: ${d.over ? `OVER (> ${d.threshold} tokens)` : `OK (< ${d.threshold} tokens)`}`,
      ];
    }
    case "stale-dated": {
      const list = f.details as { basename: string; lastDate: string; daysAgo: number }[];
      const out = [`Stale project entries (${list.length}) — last referenced date older than the threshold:`];
      for (const x of list) out.push(`  ${x.basename}   last date ${x.lastDate} (${x.daysAgo} days ago)`);
      return out;
    }
  }
}

export function formatPruneReport(plan: PrunePlanItem[], opts: { apply: boolean }): string {
  if (plan.length === 0) {
    return "memory-graveyard prune — nothing to do.";
  }
  const lines: string[] = [];
  const fileCount = plan.filter((p) => p.fileExists).length;
  const pointerCount = plan.filter((p) => p.pointerLine !== null).length;
  lines.push("memory-graveyard prune — plan");
  lines.push(`  ${fileCount} entry files to delete`);
  lines.push(`  ${pointerCount} pointer lines to remove`);
  lines.push("");
  for (const item of plan) {
    lines.push(`  [${item.reason.padEnd(16)}] ${item.basename}${item.pointerLine ? `  (line ${item.pointerLine})` : ""}`);
  }
  if (!opts.apply) {
    lines.push("");
    lines.push("re-run with --apply to execute (backup is automatic)");
  }
  return lines.join("\n");
}

export function formatApplyResult(result: ApplyResult): string {
  const lines: string[] = [];
  lines.push(`backup: ${result.backupDir}`);
  lines.push(`deleted: ${result.deleted.length} files`);
  lines.push(`pointer lines removed: ${result.removedPointerLines.length}`);
  if (result.failed.length > 0) {
    lines.push("failed:");
    for (const f of result.failed) lines.push(`  ${f.basename}: ${f.error}`);
  }
  return lines.join("\n");
}
