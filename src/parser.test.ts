import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSession } from "./parser.js";

function makeSession(events: unknown[]): string {
  const dir = mkdtempSync(join(tmpdir(), "skill-graveyard-test-"));
  const fp = join(dir, "session.jsonl");
  writeFileSync(fp, events.map((e) => JSON.stringify(e)).join("\n") + "\n");
  return fp;
}

function event(opts: {
  sessionId?: string;
  timestamp?: string;
  cwd?: string;
  content: unknown[];
}): unknown {
  const e: Record<string, unknown> = {
    sessionId: opts.sessionId ?? "session-1",
    timestamp: opts.timestamp ?? "2026-04-29T10:00:00.000Z",
    type: "assistant",
    message: { content: opts.content },
  };
  if (opts.cwd !== undefined) e.cwd = opts.cwd;
  return e;
}

test("captures a successful Skill tool_use", async () => {
  const fp = makeSession([
    event({
      content: [
        {
          type: "tool_use",
          id: "tu_1",
          name: "Skill",
          input: { skill: "superpowers:brainstorming" },
        },
      ],
    }),
    event({
      timestamp: "2026-04-29T10:00:01.000Z",
      content: [
        {
          type: "tool_result",
          tool_use_id: "tu_1",
          content: "Launching skill: superpowers:brainstorming",
        },
      ],
    }),
  ]);

  const calls = await parseSession(fp, "proj");
  rmSync(fp, { recursive: true, force: true });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.skill, "superpowers:brainstorming");
  assert.equal(calls[0]!.sessionId, "session-1");
  assert.equal(calls[0]!.errored, false);
  assert.equal(calls[0]!.toolUseId, "tu_1");
});

test("marks errored when result text matches Unknown skill", async () => {
  const fp = makeSession([
    event({
      content: [
        {
          type: "tool_use",
          id: "tu_2",
          name: "Skill",
          input: { skill: "bash" },
        },
      ],
    }),
    event({
      content: [
        {
          type: "tool_result",
          tool_use_id: "tu_2",
          content: "<tool_use_error>Unknown skill: bash. Did you mean batch?</tool_use_error>",
          is_error: true,
        },
      ],
    }),
  ]);

  const calls = await parseSession(fp, "proj");
  rmSync(fp, { recursive: true, force: true });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.errored, true);
  assert.match(calls[0]!.errorReason ?? "", /Unknown skill: bash/);
});

test("marks errored from is_error flag without explicit text match", async () => {
  const fp = makeSession([
    event({
      content: [
        { type: "tool_use", id: "tu_3", name: "Skill", input: { skill: "x" } },
      ],
    }),
    event({
      content: [
        {
          type: "tool_result",
          tool_use_id: "tu_3",
          content: "something else entirely",
          is_error: true,
        },
      ],
    }),
  ]);

  const calls = await parseSession(fp, "proj");
  rmSync(fp, { recursive: true, force: true });

  assert.equal(calls[0]!.errored, true);
  assert.equal(calls[0]!.errorReason, "is_error");
});

test("ignores non-Skill tool_use events", async () => {
  const fp = makeSession([
    event({
      content: [
        {
          type: "tool_use",
          id: "tu_b",
          name: "Bash",
          input: { command: "ls" },
        },
      ],
    }),
  ]);

  const calls = await parseSession(fp, "proj");
  rmSync(fp, { recursive: true, force: true });

  assert.equal(calls.length, 0);
});

test("handles malformed lines gracefully", async () => {
  const dir = mkdtempSync(join(tmpdir(), "skill-graveyard-test-"));
  const fp = join(dir, "session.jsonl");
  writeFileSync(
    fp,
    [
      "not valid json",
      JSON.stringify(
        event({
          content: [
            {
              type: "tool_use",
              id: "tu_x",
              name: "Skill",
              input: { skill: "ok" },
            },
          ],
        }),
      ),
      "{broken",
    ].join("\n"),
  );

  const calls = await parseSession(fp, "proj");
  rmSync(dir, { recursive: true, force: true });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.skill, "ok");
});

test("captures cwd from any prior event in the session", async () => {
  const fp = makeSession([
    event({ cwd: "/Users/me/projects/foo", content: [] }),
    event({
      content: [
        {
          type: "tool_use",
          id: "tu_c",
          name: "Skill",
          input: { skill: "x" },
        },
      ],
    }),
  ]);

  const calls = await parseSession(fp, "proj");
  rmSync(fp, { recursive: true, force: true });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.cwd, "/Users/me/projects/foo");
});

test("captures cwd when on the same event as the tool_use", async () => {
  const fp = makeSession([
    event({
      cwd: "/Users/me/projects/bar",
      content: [
        {
          type: "tool_use",
          id: "tu_d",
          name: "Skill",
          input: { skill: "y" },
        },
      ],
    }),
  ]);

  const calls = await parseSession(fp, "proj");
  rmSync(fp, { recursive: true, force: true });

  assert.equal(calls[0]!.cwd, "/Users/me/projects/bar");
});

test("cwd is null when no event in the session has it", async () => {
  const fp = makeSession([
    event({
      content: [
        {
          type: "tool_use",
          id: "tu_e",
          name: "Skill",
          input: { skill: "z" },
        },
      ],
    }),
  ]);

  const calls = await parseSession(fp, "proj");
  rmSync(fp, { recursive: true, force: true });

  assert.equal(calls[0]!.cwd, null);
});

test("handles array content with text objects in tool_result", async () => {
  const fp = makeSession([
    event({
      content: [
        {
          type: "tool_use",
          id: "tu_a",
          name: "Skill",
          input: { skill: "nope" },
        },
      ],
    }),
    event({
      content: [
        {
          type: "tool_result",
          tool_use_id: "tu_a",
          content: [{ type: "text", text: "InputValidationError: missing 'skill'" }],
        },
      ],
    }),
  ]);

  const calls = await parseSession(fp, "proj");
  rmSync(fp, { recursive: true, force: true });

  assert.equal(calls[0]!.errored, true);
  assert.match(calls[0]!.errorReason ?? "", /InputValidationError/);
});
