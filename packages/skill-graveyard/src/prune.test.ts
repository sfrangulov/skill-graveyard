import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computePruneActions, runPrune } from "./prune.js";
import type { AuditReport, AuditRow, PluginGroup } from "./audit.js";
import type { InstalledSkill } from "@skill-graveyard/core";

function makeRow(opts: {
  invokeName: string;
  category: AuditRow["category"];
  installed?: InstalledSkill | null;
  totalCalls?: number;
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
            erroredCalls: 0,
            uniqueSessions: 1,
            lastCallAt: null,
            firstCallAt: null,
            observedCwds: [],
          },
  };
}

function makeReport(
  rows: AuditRow[],
  pluginGroups: PluginGroup[] = [],
): AuditReport {
  return {
    generatedAt: "2026-04-29T00:00:00.000Z",
    windowDays: 30,
    sessionsAnalyzed: 0,
    filesAnalyzed: 0,
    totalSkillCalls: 0,
    totalErroredCalls: 0,
    paths: {} as AuditReport["paths"],
    rows,
    pluginGroups,
  };
}

test("computePruneActions emits unlink for dead user-level skills", () => {
  const inst: InstalledSkill = {
    invokeName: "old-skill",
    bareName: "old-skill",
    skillDir: "/Users/me/.claude/skills/old-skill",
    source: { kind: "user", dir: "/Users/me/.claude/skills" },
  };
  const report = makeReport([
    makeRow({ invokeName: "old-skill", category: "dead", installed: inst }),
  ]);

  const actions = computePruneActions(report);
  assert.equal(actions.length, 1);
  assert.equal(actions[0]!.kind, "unlink");
  if (actions[0]!.kind === "unlink") {
    assert.equal(actions[0]!.path, "/Users/me/.claude/skills/old-skill");
    assert.equal(actions[0]!.sourceKind, "user");
  }
});

test("computePruneActions emits plugin-remove only for full-rollup plugins", () => {
  const report = makeReport(
    [
      makeRow({
        invokeName: "figma:foo",
        category: "dead",
        installed: {
          invokeName: "figma:foo",
          bareName: "foo",
          skillDir: "/x/figma/skills/foo",
          source: {
            kind: "plugin",
            pluginName: "figma",
            pluginScope: "marketplace",
            dir: "/x/figma/skills",
          },
        },
      }),
    ],
    [
      {
        pluginName: "figma",
        pluginScope: "marketplace",
        totalSkills: 1,
        deadSkills: 1,
        activeSkills: 0,
        invocationCount: 0,
        rollupCandidate: true,
      },
      {
        pluginName: "superpowers",
        pluginScope: "official",
        totalSkills: 7,
        deadSkills: 3,
        activeSkills: 4,
        invocationCount: 100,
        rollupCandidate: false,
      },
    ],
  );

  const actions = computePruneActions(report);
  const pluginRemovals = actions.filter((a) => a.kind === "plugin-remove");
  assert.equal(pluginRemovals.length, 1);
  if (pluginRemovals[0]!.kind === "plugin-remove") {
    assert.equal(pluginRemovals[0]!.pluginName, "figma");
    assert.equal(
      pluginRemovals[0]!.command,
      "claude /plugin remove figma@marketplace",
    );
  }
});

test("computePruneActions skips active rows, projects, and individual plugin skills not in rollup", () => {
  const report = makeReport(
    [
      makeRow({
        invokeName: "live-skill",
        category: "active",
        installed: {
          invokeName: "live-skill",
          bareName: "live-skill",
          skillDir: "/x",
          source: { kind: "user", dir: "/x" },
        },
        totalCalls: 5,
      }),
      makeRow({
        invokeName: "proj-skill",
        category: "dead",
        installed: {
          invokeName: "proj-skill",
          bareName: "proj-skill",
          skillDir: "/p/.claude/skills/proj-skill",
          source: { kind: "project", projectDir: "/p", dir: "/p/.claude/skills" },
        },
      }),
      makeRow({
        invokeName: "superpowers:dead-thing",
        category: "dead",
        installed: {
          invokeName: "superpowers:dead-thing",
          bareName: "dead-thing",
          skillDir: "/sp/skills/dead-thing",
          source: {
            kind: "plugin",
            pluginName: "superpowers",
            pluginScope: "official",
            dir: "/sp/skills",
          },
        },
      }),
    ],
    [
      {
        pluginName: "superpowers",
        pluginScope: "official",
        totalSkills: 7,
        deadSkills: 3,
        activeSkills: 4,
        invocationCount: 100,
        rollupCandidate: false,
      },
    ],
  );

  const actions = computePruneActions(report);
  assert.equal(actions.length, 0);
});

test("computePruneActions --only filter narrows to one source kind", () => {
  const userInst: InstalledSkill = {
    invokeName: "u",
    bareName: "u",
    skillDir: "/u",
    source: { kind: "user", dir: "/usrs" },
  };
  const agentsInst: InstalledSkill = {
    invokeName: "a",
    bareName: "a",
    skillDir: "/a",
    source: { kind: "agents", dir: "/agts" },
  };

  const report = makeReport(
    [
      makeRow({ invokeName: "u", category: "dead", installed: userInst }),
      makeRow({ invokeName: "a", category: "dead", installed: agentsInst }),
    ],
    [
      {
        pluginName: "p",
        pluginScope: "s",
        totalSkills: 1,
        deadSkills: 1,
        activeSkills: 0,
        invocationCount: 0,
        rollupCandidate: true,
      },
    ],
  );

  const onlyUser = computePruneActions(report, "user");
  assert.equal(onlyUser.length, 1);
  assert.equal(onlyUser[0]!.invokeName, "u");

  const onlyPlugin = computePruneActions(report, "plugin");
  assert.equal(onlyPlugin.length, 1);
  assert.equal(onlyPlugin[0]!.kind, "plugin-remove");
});

test("runPrune --apply unlinks symlinks and reports failures", async () => {
  const root = mkdtempSync(join(tmpdir(), "sg-prune-test-"));
  const targetSkill = join(root, "real-skill");
  mkdirSync(targetSkill, { recursive: true });
  writeFileSync(join(targetSkill, "SKILL.md"), "---\nname: real-skill\n---\n");

  const claudeDir = join(root, ".claude");
  const skillsDir = join(claudeDir, "skills");
  mkdirSync(skillsDir, { recursive: true });
  symlinkSync(targetSkill, join(skillsDir, "real-skill"));

  const projectsDir = join(claudeDir, "projects");
  mkdirSync(projectsDir, { recursive: true });

  try {
    const report = await runPrune({
      days: 30,
      apply: true,
      claudeDir,
    });

    const unlinks = report.applied.filter(
      (e) => e.action.kind === "unlink",
    );
    assert.equal(unlinks.length, 1);
    assert.equal(unlinks[0]!.status, "applied");
    assert.equal(existsSync(join(skillsDir, "real-skill")), false);
    assert.equal(existsSync(targetSkill), true);
  } finally {
    try {
      await unlink(join(skillsDir, "real-skill"));
    } catch {}
    rmSync(root, { recursive: true, force: true });
  }
});
