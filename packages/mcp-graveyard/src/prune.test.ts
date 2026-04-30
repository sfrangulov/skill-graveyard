import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planPrune, writePruneBackup } from "./prune.js";
import type { McpServerSummary, McpServerEntry } from "./types.js";

function summary(name: string, bucket: McpServerSummary["bucket"], cfgIn: string | null = "/x/.claude.json"): McpServerSummary {
  return {
    name,
    bucket,
    configured: bucket !== "missing",
    configuredIn: cfgIn,
    toolsSeen: 0,
    toolsInvoked: [],
    toolsErrored: [],
    totalCalls: 0,
    successfulCalls: 0,
    erroredCalls: 0,
    lastCallAt: null,
  };
}

test("planPrune lists only DEAD servers", () => {
  const rows = [
    summary("alive", "active"),
    summary("zombie", "dead"),
    summary("ghost", "missing"),
    summary("typo", "hallucinated"),
  ];
  const plan = planPrune(rows, undefined);
  assert.deepEqual(plan.map((p) => p.server), ["zombie"]);
});

test("planPrune respects --only filter", () => {
  const rows = [summary("a", "dead"), summary("b", "dead")];
  const plan = planPrune(rows, "b");
  assert.deepEqual(plan.map((p) => p.server), ["b"]);
});

test("writePruneBackup writes a file with mode 0o600 and exact server entries", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mcp-prune-test-"));
  try {
    const entries: McpServerEntry[] = [
      { name: "a", command: "x", args: ["y"], env: { K: "v" }, configuredIn: "/cfg" },
      { name: "b", command: null, args: null, env: null, configuredIn: "/cfg" },
    ];
    const path = await writePruneBackup(dir, entries, 30);
    const txt = readFileSync(path, "utf8");
    const parsed = JSON.parse(txt);
    assert.equal(parsed.windowDays, 30);
    assert.deepEqual(Object.keys(parsed.servers).sort(), ["a", "b"]);
    assert.equal(parsed.servers.a.command, "x");
    assert.deepEqual(parsed.servers.a.args, ["y"]);
    assert.deepEqual(parsed.servers.a.env, { K: "v" });
    // mode 0o600
    const { statSync } = await import("node:fs");
    const stat = statSync(path);
    assert.equal((stat.mode & 0o777), 0o600);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("writePruneBackup creates timestamped filename in <claudeDir>/mcp-graveyard-backup/", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mcp-prune-test-"));
  try {
    const path = await writePruneBackup(dir, [], 30);
    const backupDir = join(dir, "mcp-graveyard-backup");
    const files = readdirSync(backupDir);
    assert.equal(files.length, 1);
    assert.match(files[0]!, /^\d{4}-\d{2}-\d{2}T.*\.json$/);
    assert.ok(path.endsWith(files[0]!));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
