import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, readdir, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { planPrune, applyPrune } from "./prune.js";
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

test("applyPrune snapshots, edits MEMORY.md, deletes files", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "mg-apply-"));
  try {
    await writeFile(
      join(tmp, "MEMORY.md"),
      `# x\n\n- [Keep](keep.md) — yes\n- [Drop](drop.md) — no\n- [Ghost](ghost.md) — gone\n`,
    );
    await writeFile(join(tmp, "keep.md"), "keep");
    await writeFile(join(tmp, "drop.md"), "drop");
    // ghost.md doesn't exist

    const result = await applyPrune(tmp, [
      { basename: "drop.md", reason: "dead", pointerLine: 4, fileExists: true },
      { basename: "ghost.md", reason: "hallucinated", pointerLine: 5, fileExists: false },
    ]);

    assert.equal(result.deleted.length, 1);
    assert.deepEqual(result.deleted, ["drop.md"]);
    assert.equal(result.removedPointerLines.length, 2);
    assert.equal(existsSync(join(tmp, "drop.md")), false);

    const after = await readFile(join(tmp, "MEMORY.md"), "utf8");
    assert.match(after, /\[Keep\]/);
    assert.doesNotMatch(after, /\[Drop\]/);
    assert.doesNotMatch(after, /\[Ghost\]/);

    const backupRoot = join(tmp, ".graveyard-backup");
    const backups = await readdir(backupRoot);
    assert.equal(backups.length, 1);
    const backupDir = join(backupRoot, backups[0]!);
    assert.ok(existsSync(join(backupDir, "MEMORY.md")));
    assert.ok(existsSync(join(backupDir, "drop.md")));
    assert.ok(existsSync(join(backupDir, "manifest.json")));
    const manifest = JSON.parse(await readFile(join(backupDir, "manifest.json"), "utf8"));
    assert.equal(manifest.deletedFiles.length, 1);
    assert.equal(manifest.removedPointerLines.length, 2);

    const dirStat = await stat(backupDir);
    assert.equal((dirStat.mode & 0o777).toString(8), "700");
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("applyPrune is idempotent on already-removed pointer lines", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "mg-apply-idem-"));
  try {
    await writeFile(join(tmp, "MEMORY.md"), `# x\n\n- [Keep](keep.md) — yes\n`);
    await writeFile(join(tmp, "keep.md"), "k");
    const result = await applyPrune(tmp, [
      { basename: "missing.md", reason: "hallucinated", pointerLine: 99, fileExists: false },
    ]);
    assert.equal(result.deleted.length, 0);
    assert.equal(result.removedPointerLines.length, 0);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
