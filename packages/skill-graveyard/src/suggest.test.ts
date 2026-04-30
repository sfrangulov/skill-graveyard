import test from "node:test";
import assert from "node:assert/strict";
import { classifyAudit, levenshtein } from "./suggest.js";
import type { AuditReport, AuditRow } from "./audit.js";
import type { InstalledSkill } from "@skill-graveyard/core";

function makeRow(opts: {
  invokeName: string;
  category: AuditRow["category"];
  installed?: InstalledSkill | null;
  totalCalls?: number;
  observedCwds?: string[];
  errored?: number;
}): AuditRow {
  return {
    invokeName: opts.invokeName,
    category: opts.category,
    installed: opts.installed ?? null,
    usage:
      opts.totalCalls === undefined
        ? null
        : {
            invokeName: opts.invokeName,
            totalCalls: opts.totalCalls,
            erroredCalls: opts.errored ?? 0,
            uniqueSessions: 1,
            lastCallAt: null,
            firstCallAt: null,
            observedCwds: opts.observedCwds ?? [],
          },
  };
}

function makeReport(rows: AuditRow[]): AuditReport {
  return {
    generatedAt: "2026-04-29T00:00:00.000Z",
    windowDays: 30,
    sessionsAnalyzed: 0,
    filesAnalyzed: 0,
    totalSkillCalls: 0,
    totalErroredCalls: 0,
    paths: {} as AuditReport["paths"],
    rows,
    pluginGroups: [],
  };
}

test("classifies tool/skill confusion (case-insensitive)", () => {
  const report = makeReport([
    makeRow({
      invokeName: "Bash",
      category: "hallucinated",
      totalCalls: 5,
      errored: 5,
    }),
    makeRow({
      invokeName: "read",
      category: "hallucinated",
      totalCalls: 3,
      errored: 3,
    }),
  ]);

  const out = classifyAudit(report);
  assert.equal(out.groups.tool_confusion.length, 2);
  assert.deepEqual(
    out.groups.tool_confusion.map((e) => e.invokeName).sort(),
    ["Bash", "read"],
  );
});

test("classifies external_framework only for MISSING (not HALLUCINATED)", () => {
  const home = "/home/u";
  process.env["HOME"] = home;

  const report = makeReport([
    makeRow({
      invokeName: "paperclip",
      category: "missing",
      totalCalls: 5,
      observedCwds: [
        `${home}/.paperclip/instances/x`,
        `${home}/.paperclip/instances/y`,
      ],
    }),
    makeRow({
      invokeName: "batch",
      category: "hallucinated",
      totalCalls: 6,
      errored: 6,
      observedCwds: [`${home}/.claude-mem/foo`],
    }),
  ]);

  const out = classifyAudit(report);
  const ext = out.groups.external_framework;
  assert.equal(ext.length, 1);
  assert.equal(ext[0]!.invokeName, "paperclip");
  assert.equal(ext[0]!.framework, "paperclip");

  const allOther = [
    ...out.groups.tool_confusion,
    ...out.groups.typo,
    ...out.groups.unclassified,
  ];
  assert.equal(
    allOther.find((e) => e.invokeName === "batch")?.bucket,
    "unclassified",
  );
});

test("typo classification uses Levenshtein distance ≤ 2", () => {
  const installed: InstalledSkill = {
    invokeName: "task-management",
    bareName: "task-management",
    skillDir: "/x",
    source: { kind: "user", dir: "/x" },
  };
  const report = makeReport([
    makeRow({
      invokeName: "task-management",
      category: "active",
      installed,
      totalCalls: 1,
    }),
    makeRow({
      invokeName: "tsk-management",
      category: "missing",
      totalCalls: 2,
    }),
    makeRow({
      invokeName: "completely-different",
      category: "missing",
      totalCalls: 1,
    }),
  ]);

  const out = classifyAudit(report);
  assert.equal(out.groups.typo.length, 1);
  assert.equal(out.groups.typo[0]!.invokeName, "tsk-management");
  assert.equal(out.groups.typo[0]!.closestMatch, "task-management");
  assert.equal(out.groups.unclassified.length, 1);
  assert.equal(out.groups.unclassified[0]!.invokeName, "completely-different");
});

test("active and dead rows are not classified", () => {
  const inst: InstalledSkill = {
    invokeName: "x",
    bareName: "x",
    skillDir: "/x",
    source: { kind: "user", dir: "/x" },
  };
  const report = makeReport([
    makeRow({ invokeName: "x", category: "active", installed: inst, totalCalls: 5 }),
    makeRow({ invokeName: "y", category: "dead", installed: inst }),
  ]);

  const out = classifyAudit(report);
  const total =
    out.groups.tool_confusion.length +
    out.groups.external_framework.length +
    out.groups.typo.length +
    out.groups.unclassified.length;
  assert.equal(total, 0);
});

test("levenshtein basic distances", () => {
  assert.equal(levenshtein("", ""), 0);
  assert.equal(levenshtein("a", ""), 1);
  assert.equal(levenshtein("", "abc"), 3);
  assert.equal(levenshtein("kitten", "sitting"), 3);
  assert.equal(levenshtein("foo", "foo"), 0);
  assert.equal(levenshtein("read", "Read"), 1);
});
