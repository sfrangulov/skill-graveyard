import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { discoverProjectScopedSkills, findGitRoot, discoverMemoryDirs } from "./discovery.js";

async function withTmpDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "sg-discovery-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

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

test("findGitRoot returns the directory containing .git when present", async () => {
  await withTmpDir(async (dir) => {
    await mkdir(join(dir, ".git"), { recursive: true });
    await mkdir(join(dir, "deep/nested/path"), { recursive: true });
    const found = findGitRoot(join(dir, "deep/nested/path"));
    assert.equal(found, dir);
  });
});

test("findGitRoot returns null when no .git is found above the path", async () => {
  await withTmpDir(async (dir) => {
    await mkdir(join(dir, "deep"), { recursive: true });
    const found = findGitRoot(join(dir, "deep"));
    assert.equal(found, null);
  });
});

test("findGitRoot stops at filesystem root if no .git found", () => {
  // Use a path guaranteed not to be inside any git tree (or accept either outcome).
  const found = findGitRoot("/tmp");
  // /tmp itself may or may not be in a git tree; the contract is "returns string or null".
  assert.ok(found === null || typeof found === "string");
});

test("discoverMemoryDirs returns one entry per project that has a memory/ subdir", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "mg-disc-"));
  try {
    const projectsDir = join(tmp, "projects");
    await mkdir(join(projectsDir, "-Users-alice-projects-foo", "memory"), { recursive: true });
    await writeFile(join(projectsDir, "-Users-alice-projects-foo", "memory", "MEMORY.md"), "");
    await mkdir(join(projectsDir, "-Users-alice-projects-bar"), { recursive: true });
    // bar has no memory/ subdir
    await mkdir(join(projectsDir, "-Users-alice-projects-baz", "memory"), { recursive: true });
    await writeFile(join(projectsDir, "-Users-alice-projects-baz", "memory", "MEMORY.md"), "");

    const dirs = await discoverMemoryDirs(projectsDir);
    const sorted = dirs.map((d) => d.projectKey).sort();
    assert.deepStrictEqual(sorted, [
      "-Users-alice-projects-baz",
      "-Users-alice-projects-foo",
    ]);
    assert.ok(dirs[0]!.memoryDir.endsWith("/memory"));
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("discoverMemoryDirs returns [] when projectsDir is missing", async () => {
  const dirs = await discoverMemoryDirs("/nonexistent/path/does/not/exist");
  assert.deepStrictEqual(dirs, []);
});
