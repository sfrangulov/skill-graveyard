import type { AuditReport, EntryReport, Bucket } from "./types.js";

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
