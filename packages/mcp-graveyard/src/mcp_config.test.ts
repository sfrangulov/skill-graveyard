import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readMcpServers } from "./mcp_config.js";

function makeClaudeJson(claudeJsonContent: object | null): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), "mcp-config-test-"));
  const path = join(dir, ".claude.json");
  if (claudeJsonContent !== null) {
    writeFileSync(path, JSON.stringify(claudeJsonContent));
  }
  return { dir, path };
}

test("returns empty list when ~/.claude.json is missing", async () => {
  const { dir, path } = makeClaudeJson(null);
  try {
    const servers = await readMcpServers(path);
    assert.deepEqual(servers, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("returns empty list when mcpServers key is missing", async () => {
  const { dir, path } = makeClaudeJson({ otherStuff: 42 });
  try {
    const servers = await readMcpServers(path);
    assert.deepEqual(servers, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("parses mcpServers entries with command/args/env", async () => {
  const { dir, path } = makeClaudeJson({
    mcpServers: {
      pencil: {
        command: "npx",
        args: ["-y", "@pencil/mcp"],
        env: { PENCIL_TOKEN: "abc" },
      },
      supabase: {
        command: "npx",
        args: ["@supabase/mcp"],
      },
    },
  });
  try {
    const servers = await readMcpServers(path);
    assert.equal(servers.length, 2);
    const pencil = servers.find((s) => s.name === "pencil")!;
    assert.equal(pencil.command, "npx");
    assert.deepEqual(pencil.args, ["-y", "@pencil/mcp"]);
    assert.deepEqual(pencil.env, { PENCIL_TOKEN: "abc" });
    assert.ok(pencil.configuredIn.endsWith(".claude.json"));
    const supabase = servers.find((s) => s.name === "supabase")!;
    assert.equal(supabase.env, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ignores entries that aren't objects", async () => {
  const { dir, path } = makeClaudeJson({
    mcpServers: {
      good: { command: "x" },
      malformed: "not an object",
    },
  });
  try {
    const servers = await readMcpServers(path);
    assert.equal(servers.length, 1);
    assert.equal(servers[0]!.name, "good");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
