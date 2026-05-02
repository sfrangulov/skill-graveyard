import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runLint } from "./lint.js";

async function buildLintFixture(tmp: string, projectKey: string, indexContent: string, files: Record<string, string>) {
  const memoryDir = join(tmp, "claude", "projects", projectKey, "memory");
  await mkdir(memoryDir, { recursive: true });
  await writeFile(join(memoryDir, "MEMORY.md"), indexContent);
  for (const [name, body] of Object.entries(files)) {
    await writeFile(join(memoryDir, name), body);
  }
  return { claudeDir: join(tmp, "claude") };
}

test("lint #1 surfaces broken pointers", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "mg-lint-bp-"));
  try {
    const { claudeDir } = await buildLintFixture(
      tmp,
      "-p",
      `# x\n\n- [Real entry](real.md) — ok\n- [Ghost entry](ghost.md) — gone\n`,
      { "real.md": "body" },
    );
    const report = await runLint({
      claudeDir,
      projectKey: "-p",
      truncationCutoff: 200,
      staleDays: 30,
    });
    const broken = report.findings.find((f) => f.check === "broken-pointers");
    assert.ok(broken, "expected a broken-pointers finding");
    const details = broken.details as { line: number; title: string; target: string }[];
    assert.equal(details.length, 1);
    assert.equal(details[0]!.target, "ghost.md");
    assert.equal(details[0]!.line, 4);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("lint #2 surfaces orphan files (excluding MEMORY.md)", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "mg-lint-orph-"));
  try {
    const { claudeDir } = await buildLintFixture(
      tmp,
      "-p",
      `# x\n\n- [Indexed](in.md) — ok\n`,
      { "in.md": "body", "stray.md": "loose" },
    );
    const report = await runLint({
      claudeDir,
      projectKey: "-p",
      truncationCutoff: 200,
      staleDays: 30,
    });
    const orphans = report.findings.find((f) => f.check === "orphans");
    assert.ok(orphans, "expected an orphans finding");
    const list = orphans.details as { basename: string; bytes: number }[];
    assert.deepEqual(list.map((x) => x.basename), ["stray.md"]);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
