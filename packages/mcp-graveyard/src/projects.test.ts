import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runProjects } from "./projects.js";

test("groups successful calls by cwd", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mcp-projects-test-"));
  const projects = join(dir, "projects");
  mkdirSync(projects, { recursive: true });
  const sd = join(projects, "p1");
  mkdirSync(sd, { recursive: true });
  const events = [
    {
      sessionId: "s1",
      timestamp: "2026-04-29T10:00:00Z",
      cwd: "/home/u/proj-a",
      type: "assistant",
      message: { content: [{ type: "tool_use", id: "tu_1", name: "mcp__pencil__do", input: {} }] },
    },
  ];
  writeFileSync(join(sd, "s.jsonl"), events.map((e) => JSON.stringify(e)).join("\n") + "\n");
  try {
    const report = await runProjects({ claudeDir: dir, windowDays: 30 });
    assert.equal(report.length, 1);
    assert.equal(report[0]!.cwd, "/home/u/proj-a");
    assert.equal(report[0]!.servers[0]!.name, "pencil");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
