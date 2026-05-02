import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseMemorySession } from "./memory_parser.js";

const MEMORY_DIR = "/Users/alice/.claude/projects/proj/memory";

const ASSISTANT_TURN = (toolUseId: string, filePath: string) =>
  JSON.stringify({
    type: "assistant",
    sessionId: "sess1",
    timestamp: "2026-05-01T10:00:00Z",
    message: {
      content: [
        { type: "tool_use", id: toolUseId, name: "Read", input: { file_path: filePath } },
      ],
    },
  });

const RESULT_TURN = (toolUseId: string, isError: boolean) =>
  JSON.stringify({
    type: "user",
    sessionId: "sess1",
    timestamp: "2026-05-01T10:00:01Z",
    message: {
      content: [
        {
          type: "tool_result",
          tool_use_id: toolUseId,
          is_error: isError,
          content: isError ? "ENOENT: no such file" : "file contents",
        },
      ],
    },
  });

test("parseMemorySession filters by memory dir and labels errored Reads", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "mg-parse-"));
  try {
    const jsonl = join(tmp, "session.jsonl");
    const okPath = `${MEMORY_DIR}/feedback_x.md`;
    const missPath = `${MEMORY_DIR}/feedback_gone.md`;
    const otherPath = `/Users/alice/projects/foo/README.md`; // not in memory dir
    const lines = [
      ASSISTANT_TURN("t1", okPath),
      RESULT_TURN("t1", false),
      ASSISTANT_TURN("t2", missPath),
      RESULT_TURN("t2", true),
      ASSISTANT_TURN("t3", otherPath),
      RESULT_TURN("t3", false),
    ];
    await writeFile(jsonl, lines.join("\n") + "\n");

    const calls = await parseMemorySession(jsonl, "proj-key", MEMORY_DIR);
    assert.equal(calls.length, 2);
    const byBasename = new Map(calls.map((c) => [c.memoryFile, c]));
    assert.equal(byBasename.get("feedback_x.md")!.errored, false);
    assert.equal(byBasename.get("feedback_gone.md")!.errored, true);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("parseMemorySession excludes Reads of MEMORY.md itself", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "mg-parse2-"));
  try {
    const jsonl = join(tmp, "session.jsonl");
    const lines = [
      ASSISTANT_TURN("t1", `${MEMORY_DIR}/MEMORY.md`),
      RESULT_TURN("t1", false),
      ASSISTANT_TURN("t2", `${MEMORY_DIR}/project_x.md`),
      RESULT_TURN("t2", false),
    ];
    await writeFile(jsonl, lines.join("\n") + "\n");

    const calls = await parseMemorySession(jsonl, "proj-key", MEMORY_DIR);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.memoryFile, "project_x.md");
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
