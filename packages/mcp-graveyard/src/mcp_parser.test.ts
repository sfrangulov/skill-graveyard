import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseMcpName, parseMcpSession } from "./mcp_parser.js";

test("parseMcpName handles single-segment server", () => {
  assert.deepEqual(parseMcpName("mcp__pencil__batch_design"), {
    server: "pencil",
    tool: "batch_design",
  });
});

test("parseMcpName handles multi-segment server with single underscores", () => {
  assert.deepEqual(parseMcpName("mcp__plugin_supabase_supabase__apply_migration"), {
    server: "plugin_supabase_supabase",
    tool: "apply_migration",
  });
});

test("parseMcpName handles tool name with underscore", () => {
  assert.deepEqual(parseMcpName("mcp__claude_ai_Gmail__create_draft"), {
    server: "claude_ai_Gmail",
    tool: "create_draft",
  });
});

test("parseMcpName returns null for non-mcp prefix", () => {
  assert.equal(parseMcpName("Skill"), null);
  assert.equal(parseMcpName("Bash"), null);
});

test("parseMcpName returns null when no __ delimiter inside body", () => {
  assert.equal(parseMcpName("mcp__incomplete"), null);
});

function makeSession(events: unknown[]): string {
  const dir = mkdtempSync(join(tmpdir(), "mcp-parser-test-"));
  const fp = join(dir, "session.jsonl");
  writeFileSync(fp, events.map((e) => JSON.stringify(e)).join("\n") + "\n");
  return fp;
}

function event(content: unknown[]): unknown {
  return {
    sessionId: "s1",
    timestamp: "2026-04-29T10:00:00Z",
    type: "assistant",
    message: { content },
  };
}

test("parseMcpSession captures successful mcp__ tool_use", async () => {
  const fp = makeSession([
    event([
      { type: "tool_use", id: "tu_1", name: "mcp__pencil__batch_design", input: {} },
    ]),
  ]);
  const calls = await parseMcpSession(fp, "proj");
  rmSync(fp, { force: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.server, "pencil");
  assert.equal(calls[0]!.tool, "batch_design");
  assert.equal(calls[0]!.errored, false);
});

test("parseMcpSession ignores non-mcp tool_use", async () => {
  const fp = makeSession([
    event([
      { type: "tool_use", id: "tu_1", name: "Skill", input: { skill: "x" } },
      { type: "tool_use", id: "tu_2", name: "Bash", input: {} },
    ]),
  ]);
  const calls = await parseMcpSession(fp, "proj");
  rmSync(fp, { force: true });
  assert.equal(calls.length, 0);
});

test("parseMcpSession marks call as errored when tool_result has InputValidationError", async () => {
  const fp = makeSession([
    event([
      { type: "tool_use", id: "tu_1", name: "mcp__supabase__list_tables_xx", input: {} },
    ]),
    event([
      { type: "tool_result", tool_use_id: "tu_1", is_error: true, content: "InputValidationError: unknown tool" },
    ]),
  ]);
  const calls = await parseMcpSession(fp, "proj");
  rmSync(fp, { force: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.errored, true);
});

test("parseMcpSession ignores tool_result errors that aren't InputValidationError", async () => {
  // Tool ran and returned an error — this is runtime, not hallucination. Skip.
  const fp = makeSession([
    event([
      { type: "tool_use", id: "tu_1", name: "mcp__supabase__execute_sql", input: {} },
    ]),
    event([
      { type: "tool_result", tool_use_id: "tu_1", is_error: true, content: "PostgresError: syntax error at line 1" },
    ]),
  ]);
  const calls = await parseMcpSession(fp, "proj");
  rmSync(fp, { force: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.errored, false, "non-validation runtime errors don't count as hallucinations");
});
