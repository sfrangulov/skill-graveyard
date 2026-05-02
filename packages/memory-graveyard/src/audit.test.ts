import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAudit } from "./audit.js";

async function buildClaudeFixture(tmp: string, projectKey: string) {
  const projectDir = join(tmp, "claude", "projects", projectKey);
  const memoryDir = join(projectDir, "memory");
  await mkdir(memoryDir, { recursive: true });
  await writeFile(join(memoryDir, "MEMORY.md"),
`# Memory

- [Active entry](active.md) — yes
- [Dead entry](dead.md) — no
- [Hallucinated entry](hallucinated.md) — broken
`);
  await writeFile(join(memoryDir, "active.md"), "active body\n");
  await writeFile(join(memoryDir, "dead.md"), "dead body\n");
  // hallucinated.md does NOT exist on disk; pointer targets a missing file
  await writeFile(join(memoryDir, "orphan.md"), "orphan body\n");

  const sessionFile = join(projectDir, "session1.jsonl");
  const ASSIST = (id: string, file: string) =>
    JSON.stringify({
      type: "assistant",
      sessionId: "s1",
      timestamp: new Date().toISOString(),
      message: { content: [{ type: "tool_use", id, name: "Read", input: { file_path: file } }] },
    });
  const RESULT = (id: string, err: boolean) =>
    JSON.stringify({
      type: "user",
      sessionId: "s1",
      timestamp: new Date().toISOString(),
      message: { content: [{ type: "tool_result", tool_use_id: id, is_error: err, content: err ? "ENOENT" : "ok" }] },
    });
  const lines = [
    ASSIST("t1", join(memoryDir, "active.md")),
    RESULT("t1", false),
    ASSIST("t2", join(memoryDir, "active.md")),
    RESULT("t2", false),
    ASSIST("t3", join(memoryDir, "hallucinated.md")),
    RESULT("t3", true),
    ASSIST("t4", join(memoryDir, "orphan.md")),
    RESULT("t4", false),
  ];
  await writeFile(sessionFile, lines.join("\n") + "\n");
  return { claudeDir: join(tmp, "claude"), memoryDir };
}

test("runAudit assigns buckets correctly", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "mg-audit-"));
  try {
    const projectKey = "-Users-alice-projects-foo";
    const { claudeDir } = await buildClaudeFixture(tmp, projectKey);

    const report = await runAudit({
      claudeDir,
      windowDays: 30,
      projectKey,
    });

    const byBasename = new Map(report.rows.map((r) => [r.basename, r]));
    assert.equal(byBasename.get("active.md")!.bucket, "active");
    assert.equal(byBasename.get("dead.md")!.bucket, "dead");
    assert.equal(byBasename.get("hallucinated.md")!.bucket, "hallucinated");
    assert.equal(byBasename.get("orphan.md")!.bucket, "missing");

    assert.equal(report.summary.indexedEntries, 3);
    assert.equal(report.summary.onDiskEntries, 3); // active, dead, orphan
    assert.equal(report.summary.successfulReads, 3);
    assert.equal(report.summary.erroredReads, 1);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("runAudit --only filters rows", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "mg-audit-only-"));
  try {
    const projectKey = "-Users-alice-projects-foo";
    const { claudeDir } = await buildClaudeFixture(tmp, projectKey);
    const report = await runAudit({
      claudeDir,
      windowDays: 30,
      projectKey,
      only: "dead",
    });
    assert.equal(report.rows.length, 1);
    assert.equal(report.rows[0]!.bucket, "dead");
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
