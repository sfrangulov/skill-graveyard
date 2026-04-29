import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverProjectScopedSkills } from "./discovery.js";

function makeProjectWithSkill(skillNames: string[]): string {
  const projectDir = mkdtempSync(join(tmpdir(), "sg-discovery-test-"));
  for (const name of skillNames) {
    const skillDir = join(projectDir, ".claude", "skills", name);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      `---\nname: ${name}\ndescription: test\n---\n`,
    );
  }
  return projectDir;
}

test("discovers a skill in <cwd>/.claude/skills/", async () => {
  const projectDir = makeProjectWithSkill(["my-skill"]);
  try {
    const skills = await discoverProjectScopedSkills([projectDir]);
    const names = skills.map((s) => s.invokeName);
    assert.deepEqual(names, ["my-skill"]);
    const found = skills[0]!;
    assert.equal(found.bareName, "my-skill");
    assert.equal(found.source.kind, "project");
    if (found.source.kind === "project") {
      assert.equal(found.source.projectDir, projectDir);
    }
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
});

test("discovers skill from an ancestor of cwd, not just cwd itself", async () => {
  const projectDir = makeProjectWithSkill(["root-skill"]);
  const childDir = join(projectDir, "src", "deep", "nested");
  mkdirSync(childDir, { recursive: true });
  try {
    const skills = await discoverProjectScopedSkills([childDir]);
    assert.equal(skills.length, 1);
    assert.equal(skills[0]!.bareName, "root-skill");
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
});

test("dedupes when multiple cwds share an ancestor", async () => {
  const projectDir = makeProjectWithSkill(["shared"]);
  const child1 = join(projectDir, "a");
  const child2 = join(projectDir, "b");
  mkdirSync(child1, { recursive: true });
  mkdirSync(child2, { recursive: true });
  try {
    const skills = await discoverProjectScopedSkills([child1, child2]);
    const sharedCount = skills.filter((s) => s.bareName === "shared").length;
    assert.equal(sharedCount, 1);
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
});

test("returns nothing when no .claude/skills/ exists along the path", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sg-discovery-test-"));
  try {
    const skills = await discoverProjectScopedSkills([dir]);
    assert.equal(skills.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ignores skill dirs without SKILL.md", async () => {
  const projectDir = mkdtempSync(join(tmpdir(), "sg-discovery-test-"));
  mkdirSync(join(projectDir, ".claude", "skills", "no-manifest"), {
    recursive: true,
  });
  try {
    const skills = await discoverProjectScopedSkills([projectDir]);
    assert.equal(skills.length, 0);
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
});
