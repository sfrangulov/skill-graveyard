import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAudit } from "./audit.js";

function makeClaudeWith(opts: {
  mcpServers?: Record<string, unknown>;
  sessions?: { projectKey: string; events: unknown[] }[];
}): string {
  const dir = mkdtempSync(join(tmpdir(), "mcp-audit-test-"));
  if (opts.mcpServers) {
    writeFileSync(
      join(dir, ".claude.json"),
      JSON.stringify({ mcpServers: opts.mcpServers })
    );
  }
  const projectsDir = join(dir, "projects");
  mkdirSync(projectsDir, { recursive: true });
  for (const session of opts.sessions ?? []) {
    const sd = join(projectsDir, session.projectKey);
    mkdirSync(sd, { recursive: true });
    writeFileSync(
      join(sd, "s.jsonl"),
      session.events.map((e) => JSON.stringify(e)).join("\n") + "\n"
    );
  }
  return dir;
}

function event(content: unknown[]): unknown {
  return {
    sessionId: "s1",
    timestamp: "2026-04-29T10:00:00Z",
    type: "assistant",
    message: { content },
  };
}

test("server with successful call lands in 'active'", async () => {
  const dir = makeClaudeWith({
    mcpServers: { pencil: { command: "x" } },
    sessions: [
      {
        projectKey: "p1",
        events: [
          event([
            { type: "tool_use", id: "tu_1", name: "mcp__pencil__batch_design", input: {} },
          ]),
        ],
      },
    ],
  });
  try {
    const report = await runAudit({ claudeDir: dir, windowDays: 30 });
    const pencil = report.rows.find((r) => r.name === "pencil")!;
    assert.equal(pencil.bucket, "active");
    assert.equal(pencil.successfulCalls, 1);
    assert.equal(pencil.toolsInvoked.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("configured server with zero calls lands in 'dead'", async () => {
  const dir = makeClaudeWith({
    mcpServers: { figma: { command: "x" } },
    sessions: [],
  });
  try {
    const report = await runAudit({ claudeDir: dir, windowDays: 30 });
    const figma = report.rows.find((r) => r.name === "figma")!;
    assert.equal(figma.bucket, "dead");
    assert.equal(figma.successfulCalls, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("invocation of a server NOT in claude.json lands in 'missing'", async () => {
  const dir = makeClaudeWith({
    mcpServers: {},
    sessions: [
      {
        projectKey: "p1",
        events: [
          event([
            { type: "tool_use", id: "tu_1", name: "mcp__old_server__do_thing", input: {} },
          ]),
        ],
      },
    ],
  });
  try {
    const report = await runAudit({ claudeDir: dir, windowDays: 30 });
    const old = report.rows.find((r) => r.name === "old_server")!;
    assert.equal(old.bucket, "missing");
    assert.equal(old.configured, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("InputValidationError flips server into 'hallucinated'", async () => {
  const dir = makeClaudeWith({
    mcpServers: { supabase: { command: "x" } },
    sessions: [
      {
        projectKey: "p1",
        events: [
          event([
            { type: "tool_use", id: "tu_1", name: "mcp__supabase__nonexistent", input: {} },
          ]),
          event([
            { type: "tool_result", tool_use_id: "tu_1", is_error: true, content: "InputValidationError" },
          ]),
        ],
      },
    ],
  });
  try {
    const report = await runAudit({ claudeDir: dir, windowDays: 30 });
    const sup = report.rows.find((r) => r.name === "supabase")!;
    // active OR hallucinated — buckets aren't mutually exclusive on success+error mix,
    // but with only an errored call it's hallucinated.
    assert.equal(sup.bucket, "hallucinated");
    assert.equal(sup.erroredCalls, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("filters by --only", async () => {
  const dir = makeClaudeWith({
    mcpServers: { live: { command: "x" }, dead: { command: "y" } },
    sessions: [
      {
        projectKey: "p1",
        events: [
          event([
            { type: "tool_use", id: "tu_1", name: "mcp__live__do", input: {} },
          ]),
        ],
      },
    ],
  });
  try {
    const report = await runAudit({ claudeDir: dir, windowDays: 30, only: "dead" });
    assert.equal(report.rows.length, 1);
    assert.equal(report.rows[0]!.name, "dead");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
