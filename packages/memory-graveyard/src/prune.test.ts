import { test } from "node:test";
import assert from "node:assert/strict";
import { planPrune } from "./prune.js";
import type { AuditReport, EntryReport, LintReport } from "./types.js";

const baseReport: AuditReport = {
  generatedAt: "2026-05-02T00:00:00Z",
  windowDays: 30,
  claudeDir: "/c",
  projectKey: "p",
  memoryDir: "/m",
  summary: { indexedEntries: 0, onDiskEntries: 0, totalReads: 0, successfulReads: 0, erroredReads: 0 },
  rows: [],
};

const row = (basename: string, bucket: EntryReport["bucket"], pointerLine: number | null): EntryReport => ({
  basename,
  inIndex: pointerLine !== null,
  fileExists: bucket !== "hallucinated",
  pointer: pointerLine === null ? null : { line: pointerLine, title: "x", target: basename, hook: "", visible: true },
  entry: null,
  reads: [],
  errors: [],
  bucket,
  lastReadAt: null,
});

const emptyLint: LintReport = {
  generatedAt: "2026-05-02T00:00:00Z",
  memoryDir: "/m",
  findings: [],
  summary: { errors: 0, warnings: 0, ok: true },
};

test("planPrune by default targets dead and hallucinated", () => {
  const audit: AuditReport = {
    ...baseReport,
    rows: [
      row("a.md", "active", 5),
      row("d.md", "dead", 8),
      row("h.md", "hallucinated", 12),
      row("o.md", "missing", null),
    ],
  };
  const plan = planPrune(audit, emptyLint, {
    include: { orphans: false, brokenPointers: false },
    exclude: new Set(),
  });
  const reasons = plan.map((p) => `${p.basename}:${p.reason}`).sort();
  assert.deepEqual(reasons, ["d.md:dead", "h.md:hallucinated"]);
});

test("planPrune --include orphans adds orphan files from lint", () => {
  const audit = baseReport;
  const lint: LintReport = {
    ...emptyLint,
    findings: [
      { check: "orphans", severity: "warning", details: [{ basename: "stray.md", bytes: 100 }] },
    ],
  };
  const plan = planPrune(audit, lint, {
    include: { orphans: true, brokenPointers: false },
    exclude: new Set(),
  });
  assert.deepEqual(
    plan.map((p) => p.basename + ":" + p.reason),
    ["stray.md:orphan"],
  );
});

test("planPrune --include broken-pointers adds broken pointers without errored reads", () => {
  const audit = baseReport;
  const lint: LintReport = {
    ...emptyLint,
    findings: [
      {
        check: "broken-pointers",
        severity: "error",
        details: [{ line: 9, title: "X", target: "stale.md" }],
      },
    ],
  };
  const plan = planPrune(audit, lint, {
    include: { orphans: false, brokenPointers: true },
    exclude: new Set(),
  });
  assert.deepEqual(
    plan.map((p) => p.basename + ":" + p.reason),
    ["stale.md:broken-pointer"],
  );
  assert.equal(plan[0]!.pointerLine, 9);
});

test("planPrune respects --exclude", () => {
  const audit: AuditReport = {
    ...baseReport,
    rows: [row("d1.md", "dead", 5), row("d2.md", "dead", 6)],
  };
  const plan = planPrune(audit, emptyLint, {
    include: { orphans: false, brokenPointers: false },
    exclude: new Set(["d1.md"]),
  });
  assert.deepEqual(plan.map((p) => p.basename), ["d2.md"]);
});
