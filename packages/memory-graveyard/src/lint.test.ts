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

test("lint #3 reports pointers below the truncation cutoff", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "mg-lint-trunc-"));
  try {
    const lines = ["# x", ""];
    const files: Record<string, string> = {};
    for (let i = 0; i < 30; i++) {
      lines.push(`- [E${i}](e${i}.md) — note ${i}`);
      files[`e${i}.md`] = "body";
    }
    const { claudeDir } = await buildLintFixture(tmp, "-p", lines.join("\n") + "\n", files);
    const report = await runLint({
      claudeDir,
      projectKey: "-p",
      truncationCutoff: 12, // line 3..12 visible (10 entries), 13..32 cut off (20 entries)
      staleDays: 30,
    });
    const trunc = report.findings.find((f) => f.check === "truncation-budget");
    assert.ok(trunc, "expected a truncation-budget finding");
    const d = trunc.details as { total: number; visible: number; cutOff: number; sample: { line: number; target: string }[] };
    assert.equal(d.total, 30);
    assert.equal(d.visible, 10);
    assert.equal(d.cutOff, 20);
    assert.ok(d.sample.length > 0);
    assert.ok(d.sample[0]!.line > 10);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("lint #3 omits the finding when cutOff == 0", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "mg-lint-trunc-ok-"));
  try {
    const { claudeDir } = await buildLintFixture(
      tmp,
      "-p",
      `# x\n\n- [E1](e1.md) — n\n- [E2](e2.md) — n\n`,
      { "e1.md": "b", "e2.md": "b" },
    );
    const report = await runLint({
      claudeDir,
      projectKey: "-p",
      truncationCutoff: 200,
      staleDays: 30,
    });
    const trunc = report.findings.find((f) => f.check === "truncation-budget");
    assert.equal(trunc, undefined);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
