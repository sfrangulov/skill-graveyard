# mcp-graveyard v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `mcp-graveyard` CLI that audits MCP server tools the same way `skill-graveyard` audits skills: surface dead servers (configured, never invoked) and hallucinated tool calls (invoked names that fail with `InputValidationError`). Ship as `mcp-graveyard@0.1.0` on npm.

**Architecture:** New package `packages/mcp-graveyard/` consuming `@skill-graveyard/core` for session parsing and discovery primitives. Server-first audit (one row per MCP server, server is the unit of action). v1 subcommands: `audit` (default), `prune` (with `--apply` and automatic backup), `projects`, `suggest`. Reads `~/.claude.json` for `mcpServers` config, parses JSONL for invocations, no subprocess to MCP servers.

**Tech Stack:** TypeScript (strict + `noUncheckedIndexedAccess`), `node:test`, `@skill-graveyard/core` for parsing/discovery, `node:child_process` for `claude mcp remove`, `node:fs` for backup writes. No new runtime deps.

**Spec:** `docs/specs/2026-04-29-mcp-graveyard-design.md`. Read it first.

**Prerequisite:** Plan A (`2026-04-29-monorepo-migration-plan.md`) must have landed. This plan assumes `packages/core/` exists with `parseToolCalls<T>`, `findSessionFiles`, `resolveClaudePaths`, `findGitRoot`, etc. exported.

---

## Task 1: Bootstrap mcp-graveyard package skeleton

**Files:**
- Create: `packages/mcp-graveyard/package.json`
- Create: `packages/mcp-graveyard/tsconfig.json`
- Create: `packages/mcp-graveyard/src/cli.ts` (placeholder)

- [ ] **Step 1: Write `packages/mcp-graveyard/package.json`**

```json
{
  "name": "mcp-graveyard",
  "version": "0.1.0",
  "description": "Audit which MCP server tools your Claude Code sessions actually invoke. Server-first, surfaces dead servers and hallucinated calls.",
  "type": "module",
  "bin": {
    "mcp-graveyard": "dist/cli.js"
  },
  "files": ["dist", "README.md", "LICENSE"],
  "engines": { "node": ">=18" },
  "scripts": {
    "dev": "tsx src/cli.ts",
    "build": "tsc",
    "postbuild": "chmod +x dist/cli.js",
    "prepublishOnly": "npm -w mcp-graveyard run typecheck && npm -w mcp-graveyard run test && npm -w mcp-graveyard run build",
    "typecheck": "tsc --noEmit",
    "test": "node --import tsx --test src/*.test.ts"
  },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/sfrangulov/skill-graveyard.git",
    "directory": "packages/mcp-graveyard"
  },
  "bugs": { "url": "https://github.com/sfrangulov/skill-graveyard/issues" },
  "homepage": "https://sfrangulov.github.io/skill-graveyard/",
  "keywords": ["claude-code", "claude", "mcp", "audit", "cli", "anthropic"],
  "license": "MIT",
  "dependencies": {
    "@skill-graveyard/core": "^0.1.0"
  }
}
```

- [ ] **Step 2: Write `packages/mcp-graveyard/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "declaration": false
  },
  "include": ["src/**/*"],
  "exclude": ["src/**/*.test.ts", "node_modules", "dist"]
}
```

- [ ] **Step 3: Write placeholder `packages/mcp-graveyard/src/cli.ts`**

```ts
#!/usr/bin/env node
console.log("mcp-graveyard 0.1.0 — placeholder");
```

- [ ] **Step 4: Install + build + smoke**

```sh
npm install
npm run build --workspace=mcp-graveyard
node packages/mcp-graveyard/dist/cli.js
```

Expected: prints `mcp-graveyard 0.1.0 — placeholder`.

- [ ] **Step 5: Commit**

```sh
git add packages/mcp-graveyard package-lock.json
git commit -m "mcp-graveyard: bootstrap package skeleton"
```

---

## Task 2: Define internal types

**Files:**
- Create: `packages/mcp-graveyard/src/types.ts`

- [ ] **Step 1: Write `types.ts`**

```ts
import type { ToolCallBase } from "@skill-graveyard/core";

export interface McpToolCall extends ToolCallBase {
  rawName: string;     // e.g. "mcp__plugin_supabase_supabase__apply_migration"
  server: string;      // "plugin_supabase_supabase"
  tool: string;        // "apply_migration"
}

export interface McpServerEntry {
  name: string;
  command: string | null;
  args: string[] | null;
  env: Record<string, string> | null;
  configuredIn: string;   // absolute path of ~/.claude.json
}

export type McpBucket = "active" | "dead" | "missing" | "hallucinated";

export interface McpServerSummary {
  name: string;
  configured: boolean;
  configuredIn: string | null;
  toolsAdvertised: number;       // distinct mcp__<server>__* names seen in window
  toolsInvoked: string[];        // tools with ≥1 successful call (sorted)
  toolsErrored: string[];        // tools with InputValidationError (sorted)
  totalCalls: number;
  successfulCalls: number;
  erroredCalls: number;
  bucket: McpBucket;
  lastCallAt: string | null;
}

export interface AuditOptions {
  claudeDir?: string;
  windowDays: number;
  only?: McpBucket;
}

export interface AuditReport {
  generatedAt: string;
  windowDays: number;
  claudeDir: string;
  summary: {
    configuredServers: number;
    totalCalls: number;
    successfulCalls: number;
    erroredCalls: number;
  };
  rows: McpServerSummary[];
}
```

- [ ] **Step 2: Typecheck**

```sh
npm run typecheck --workspace=mcp-graveyard
```

Expected: clean. (No tests yet — types only.)

- [ ] **Step 3: Commit**

```sh
git add packages/mcp-graveyard/src/types.ts
git commit -m "mcp-graveyard: internal types"
```

---

## Task 3: `mcp_config.ts` — read mcpServers from ~/.claude.json (TDD)

**Files:**
- Create: `packages/mcp-graveyard/src/mcp_config.test.ts`
- Create: `packages/mcp-graveyard/src/mcp_config.ts`

- [ ] **Step 1: Write failing tests**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readMcpServers } from "./mcp_config.js";

function makeClaudeDir(claudeJsonContent: object | null): string {
  const dir = mkdtempSync(join(tmpdir(), "mcp-config-test-"));
  if (claudeJsonContent !== null) {
    writeFileSync(join(dir, ".claude.json"), JSON.stringify(claudeJsonContent));
  }
  return dir;
}

test("returns empty list when ~/.claude.json is missing", async () => {
  const dir = makeClaudeDir(null);
  try {
    const servers = await readMcpServers(dir);
    assert.deepEqual(servers, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("returns empty list when mcpServers key is missing", async () => {
  const dir = makeClaudeDir({ otherStuff: 42 });
  try {
    const servers = await readMcpServers(dir);
    assert.deepEqual(servers, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("parses mcpServers entries with command/args/env", async () => {
  const dir = makeClaudeDir({
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
    const servers = await readMcpServers(dir);
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
  const dir = makeClaudeDir({
    mcpServers: {
      good: { command: "x" },
      malformed: "not an object",
    },
  });
  try {
    const servers = await readMcpServers(dir);
    assert.equal(servers.length, 1);
    assert.equal(servers[0]!.name, "good");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Verify tests fail**

```sh
npm test --workspace=mcp-graveyard
```

Expected: failure ("Cannot find module './mcp_config.js'" or similar).

- [ ] **Step 3: Implement `mcp_config.ts`**

```ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { McpServerEntry } from "./types.js";

export async function readMcpServers(claudeDir: string): Promise<McpServerEntry[]> {
  const path = join(claudeDir, ".claude.json");
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!isObject(parsed)) return [];
  const mcpServers = parsed.mcpServers;
  if (!isObject(mcpServers)) return [];

  const out: McpServerEntry[] = [];
  for (const [name, entry] of Object.entries(mcpServers)) {
    if (!isObject(entry)) continue;
    out.push({
      name,
      command: typeof entry.command === "string" ? entry.command : null,
      args: Array.isArray(entry.args)
        ? entry.args.filter((a): a is string => typeof a === "string")
        : null,
      env: isObject(entry.env)
        ? Object.fromEntries(
            Object.entries(entry.env).filter(
              ([, v]) => typeof v === "string"
            ) as [string, string][]
          )
        : null,
      configuredIn: path,
    });
  }
  return out;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
```

- [ ] **Step 4: Tests pass**

```sh
npm test --workspace=mcp-graveyard
```

Expected: all four tests pass.

- [ ] **Step 5: Commit**

```sh
git add packages/mcp-graveyard/src/mcp_config.{ts,test.ts}
git commit -m "mcp-graveyard: read mcpServers from ~/.claude.json"
```

---

## Task 4: `mcp_parser.ts` — parse JSONL for mcp__ tool calls (TDD)

**Files:**
- Create: `packages/mcp-graveyard/src/mcp_parser.test.ts`
- Create: `packages/mcp-graveyard/src/mcp_parser.ts`

- [ ] **Step 1: Write failing tests**

```ts
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
```

- [ ] **Step 2: Verify tests fail**

```sh
npm test --workspace=mcp-graveyard
```

Expected: failure ("Cannot find module './mcp_parser.js'").

- [ ] **Step 3: Implement `mcp_parser.ts`**

```ts
import { parseToolCalls } from "@skill-graveyard/core";
import type { McpToolCall } from "./types.js";

export function parseMcpName(name: string): { server: string; tool: string } | null {
  const PREFIX = "mcp__";
  if (!name.startsWith(PREFIX)) return null;
  const body = name.slice(PREFIX.length);
  const lastSep = body.lastIndexOf("__");
  if (lastSep <= 0) return null;
  const server = body.slice(0, lastSep);
  const tool = body.slice(lastSep + 2);
  if (!server || !tool) return null;
  return { server, tool };
}

export async function parseMcpSession(
  filepath: string,
  projectKey: string,
): Promise<McpToolCall[]> {
  return parseToolCalls<McpToolCall>(
    filepath,
    projectKey,
    (item) =>
      item.type === "tool_use" &&
      typeof item.name === "string" &&
      item.name.startsWith("mcp__"),
    (item, base) => {
      const rawName = typeof item.name === "string" ? item.name : "";
      const parsed = parseMcpName(rawName);
      if (!parsed) return null;
      const call: McpToolCall = { ...base, rawName, server: parsed.server, tool: parsed.tool };
      // Override default error filter: we only count InputValidationError as "hallucinated".
      // parseToolCalls already populates `errored: true` for any is_error result.
      // We post-filter here (see below).
      return call;
    },
  ).then((calls) =>
    calls.map((call) => {
      if (!call.errored) return call;
      const reason = call.errorReason ?? "";
      const isValidationError = /InputValidationError|tool not found|unknown tool|does not exist/i.test(reason);
      if (isValidationError) return call;
      // Tool ran but returned a runtime error — not hallucination, reset.
      return { ...call, errored: false, errorReason: null };
    }),
  );
}
```

⚠ **Note about post-filtering**: `parseToolCalls<T>` (in `core/parser.ts`, defined in Plan A Task 8) marks any `tool_result.is_error === true` OR pattern match on a generic regex as `errored`. For mcp-graveyard, only `InputValidationError`-style messages count as hallucinations; runtime errors from tools that exist and ran don't. Easiest fix: post-filter the `errored` flag here. Alternative would be to add a third param to `parseToolCalls` for an error-classification predicate, but that's a core API change and not worth it unless other consumers also need to discriminate.

- [ ] **Step 4: Tests pass**

```sh
npm test --workspace=mcp-graveyard
```

Expected: all 8 tests pass.

- [ ] **Step 5: Commit**

```sh
git add packages/mcp-graveyard/src/mcp_parser.{ts,test.ts}
git commit -m "mcp-graveyard: parse mcp__ tool_use from sessions"
```

---

## Task 5: `audit.ts` — aggregate calls into server-level buckets (TDD)

**Files:**
- Create: `packages/mcp-graveyard/src/audit.test.ts`
- Create: `packages/mcp-graveyard/src/audit.ts`

- [ ] **Step 1: Write failing tests**

```ts
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
```

- [ ] **Step 2: Verify tests fail**

```sh
npm test --workspace=mcp-graveyard
```

Expected: failure ("Cannot find module './audit.js'").

- [ ] **Step 3: Implement `audit.ts`**

```ts
import { findSessionFiles, resolveClaudePaths } from "@skill-graveyard/core";
import { readMcpServers } from "./mcp_config.js";
import { parseMcpSession } from "./mcp_parser.js";
import type { McpServerEntry, McpServerSummary, McpBucket, AuditOptions, AuditReport, McpToolCall } from "./types.js";

export async function runAudit(opts: AuditOptions): Promise<AuditReport> {
  const paths = resolveClaudePaths(opts.claudeDir);
  const since = Date.now() - opts.windowDays * 24 * 60 * 60 * 1000;
  const [servers, sessionFiles] = await Promise.all([
    readMcpServers(paths.claudeDir),
    findSessionFiles(paths.projectsDir, since),
  ]);
  const allCalls: McpToolCall[] = [];
  for (const sf of sessionFiles) {
    const calls = await parseMcpSession(sf.filepath, sf.projectKey);
    for (const c of calls) {
      if (c.timestamp && Date.parse(c.timestamp) < since) continue;
      allCalls.push(c);
    }
  }
  const summaries = aggregate(servers, allCalls);
  const filtered = opts.only ? summaries.filter((s) => s.bucket === opts.only) : summaries;
  return {
    generatedAt: new Date().toISOString(),
    windowDays: opts.windowDays,
    claudeDir: paths.claudeDir,
    summary: {
      configuredServers: servers.length,
      totalCalls: allCalls.length,
      successfulCalls: allCalls.filter((c) => !c.errored).length,
      erroredCalls: allCalls.filter((c) => c.errored).length,
    },
    rows: filtered,
  };
}

function aggregate(servers: McpServerEntry[], calls: McpToolCall[]): McpServerSummary[] {
  const byServer = new Map<string, McpToolCall[]>();
  for (const call of calls) {
    if (!byServer.has(call.server)) byServer.set(call.server, []);
    byServer.get(call.server)!.push(call);
  }
  const configured = new Map(servers.map((s) => [s.name, s]));
  const allServerNames = new Set([...configured.keys(), ...byServer.keys()]);

  const summaries: McpServerSummary[] = [];
  for (const name of allServerNames) {
    const cfg = configured.get(name);
    const serverCalls = byServer.get(name) ?? [];
    const successCalls = serverCalls.filter((c) => !c.errored);
    const errorCalls = serverCalls.filter((c) => c.errored);
    const toolsInvoked = [...new Set(successCalls.map((c) => c.tool))].sort();
    const toolsErrored = [...new Set(errorCalls.map((c) => c.tool))].sort();
    const toolsAdvertised = new Set(serverCalls.map((c) => c.tool)).size;
    const lastCall = serverCalls
      .map((c) => c.timestamp)
      .filter((t): t is string => t !== null)
      .sort()
      .pop() ?? null;

    let bucket: McpBucket;
    if (cfg && successCalls.length > 0) bucket = "active";
    else if (!cfg && successCalls.length > 0) bucket = "missing";
    else if (errorCalls.length > 0) bucket = "hallucinated";
    else bucket = "dead";   // configured & 0 calls of any kind

    summaries.push({
      name,
      configured: !!cfg,
      configuredIn: cfg?.configuredIn ?? null,
      toolsAdvertised,
      toolsInvoked,
      toolsErrored,
      totalCalls: serverCalls.length,
      successfulCalls: successCalls.length,
      erroredCalls: errorCalls.length,
      bucket,
      lastCallAt: lastCall,
    });
  }
  return summaries.sort((a, b) => a.name.localeCompare(b.name));
}
```

- [ ] **Step 4: Tests pass**

```sh
npm test --workspace=mcp-graveyard
```

Expected: all 5 audit tests pass plus all earlier tests.

- [ ] **Step 5: Commit**

```sh
git add packages/mcp-graveyard/src/audit.{ts,test.ts}
git commit -m "mcp-graveyard: server-level audit buckets"
```

---

## Task 6: `format.ts` — terminal output for audit (text + JSON)

**Files:**
- Create: `packages/mcp-graveyard/src/format.ts`

No test file — `format.ts` in skill-graveyard has no tests either, and visual diffing is best done by eye (smoke-tested via the CLI).

- [ ] **Step 1: Write `format.ts`**

```ts
import type { AuditReport, McpServerSummary, McpBucket } from "./types.js";

const C = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  gray: "\x1b[90m",
};

interface FormatOptions {
  color: boolean;
}

export function formatAuditJson(report: AuditReport): string {
  return JSON.stringify(
    {
      ...report,
      rows: report.rows.map((r) => ({
        server: r.name,
        category: r.bucket,
        configured: r.configured,
        configuredIn: r.configuredIn,
        toolsAdvertised: r.toolsAdvertised,
        toolsInvoked: r.toolsInvoked.length,
        toolsErrored: r.toolsErrored.length,
        totalCalls: r.totalCalls,
        successfulCalls: r.successfulCalls,
        erroredCalls: r.erroredCalls,
        lastCallAt: r.lastCallAt,
      })),
    },
    null,
    2,
  );
}

export function formatAuditReport(report: AuditReport, opts: FormatOptions): string {
  const c = (code: string, s: string) => (opts.color ? `${code}${s}${C.reset}` : s);
  const lines: string[] = [];

  // Headline
  lines.push(
    c(C.bold, `mcp-graveyard`) +
      c(C.dim, ` — ${report.windowDays} days · `) +
      `${report.summary.configuredServers} servers configured · ` +
      `${report.summary.totalCalls} calls · ` +
      c(C.green, `${report.summary.successfulCalls} succeeded`) +
      ` · ` +
      c(C.red, `${report.summary.erroredCalls} errored`),
    "",
  );

  // Group by bucket
  const byBucket = new Map<McpBucket, McpServerSummary[]>();
  for (const row of report.rows) {
    if (!byBucket.has(row.bucket)) byBucket.set(row.bucket, []);
    byBucket.get(row.bucket)!.push(row);
  }

  const bucketOrder: McpBucket[] = ["active", "dead", "hallucinated", "missing"];
  for (const bucket of bucketOrder) {
    const rows = byBucket.get(bucket) ?? [];
    if (rows.length === 0) continue;
    lines.push(c(C.bold, `${bucket.toUpperCase()} (${rows.length})`));
    for (const row of rows) {
      lines.push(formatRow(row, opts));
    }
    lines.push("");
  }

  if ((byBucket.get("dead")?.length ?? 0) > 0) {
    lines.push(c(C.dim, `→ run: mcp-graveyard prune  to clear DEAD servers`));
  }

  return lines.join("\n");
}

function formatRow(row: McpServerSummary, opts: FormatOptions): string {
  const c = (code: string, s: string) => (opts.color ? `${code}${s}${C.reset}` : s);
  const name = row.name.padEnd(40);
  const stats = `${row.toolsAdvertised} tools, ${row.toolsInvoked.length} invoked, ${row.totalCalls} calls`;
  const last = row.lastCallAt ? c(C.gray, `last ${row.lastCallAt.slice(0, 10)}`) : c(C.gray, "—");
  return `  ${name}${stats.padEnd(36)}${last}`;
}

export function formatDrillDown(server: string, summary: McpServerSummary, opts: FormatOptions): string {
  const c = (code: string, s: string) => (opts.color ? `${code}${s}${C.reset}` : s);
  const lines: string[] = [];
  lines.push(
    c(C.bold, server) +
      c(C.dim, ` — ${summary.toolsAdvertised} tools · ${summary.toolsInvoked.length} invoked · ${summary.totalCalls} calls`),
    "",
    c(C.bold, `INVOKED (${summary.toolsInvoked.length})`),
  );
  for (const t of summary.toolsInvoked) lines.push(`  ${t}`);
  lines.push("");
  const dead = summary.toolsAdvertised - summary.toolsInvoked.length;
  if (dead > 0) {
    lines.push(c(C.bold, `DEAD TOOLS (${dead})`));
    lines.push(c(C.dim, "  (advertised in sessions but never successfully invoked)"));
    // We don't have the full advertised list at this layer — for v1 we surface counts only.
    // Listing each dead tool name requires keeping per-tool data through the aggregation,
    // which is a Task 8 enhancement.
  }
  return lines.join("\n");
}
```

⚠ The `formatDrillDown` "DEAD TOOLS" list shows count only in v1, not names — `audit.ts` aggregation discards per-tool detail beyond `toolsInvoked`/`toolsErrored`. Listing names requires propagating `toolsAdvertised: string[]` through the summary shape; that's a Task 8 follow-up if it turns out to be the most-requested missing piece. Don't pre-emptively add it.

- [ ] **Step 2: Typecheck**

```sh
npm run typecheck --workspace=mcp-graveyard
```

Expected: clean.

- [ ] **Step 3: Commit**

```sh
git add packages/mcp-graveyard/src/format.ts
git commit -m "mcp-graveyard: terminal + JSON formatting"
```

---

## Task 7: `cli.ts` — argument routing for `audit` (default)

**Files:**
- Modify: `packages/mcp-graveyard/src/cli.ts` (replace the placeholder)

- [ ] **Step 1: Replace `cli.ts`**

```ts
#!/usr/bin/env node
import { runAudit } from "./audit.js";
import { formatAuditReport, formatAuditJson, formatDrillDown } from "./format.js";
import type { McpBucket } from "./types.js";

const VALID_BUCKETS: McpBucket[] = ["active", "dead", "missing", "hallucinated"];

interface Args {
  subcommand: "audit" | "prune" | "projects" | "suggest";
  days: number;
  json: boolean;
  only: McpBucket | undefined;
  tools: string | undefined;
  claudeDir: string | undefined;
  apply: boolean;       // for prune
  pruneOnly: string | undefined;  // server-name filter for prune
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    subcommand: "audit",
    days: 30,
    json: false,
    only: undefined,
    tools: undefined,
    claudeDir: undefined,
    apply: false,
    pruneOnly: undefined,
  };
  let i = 0;
  if (argv[i] && !argv[i]!.startsWith("--")) {
    const sub = argv[i] as Args["subcommand"];
    if (sub !== "audit" && sub !== "prune" && sub !== "projects" && sub !== "suggest") {
      die(`unknown subcommand: ${argv[i]}`);
    }
    args.subcommand = sub;
    i++;
  }
  for (; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--json") args.json = true;
    else if (a === "--apply") args.apply = true;
    else if (a === "--days") args.days = Number(argv[++i]);
    else if (a === "--only" && args.subcommand === "audit") {
      const v = argv[++i] as McpBucket;
      if (!VALID_BUCKETS.includes(v)) die(`--only must be one of ${VALID_BUCKETS.join("|")}`);
      args.only = v;
    } else if (a === "--only" && args.subcommand === "prune") {
      args.pruneOnly = argv[++i];
    } else if (a === "--tools") args.tools = argv[++i];
    else if (a === "--claude-dir") args.claudeDir = argv[++i];
    else if (a === "--help" || a === "-h") usage();
    else die(`unknown flag: ${a}`);
  }
  return args;
}

function usage(): never {
  console.log(`mcp-graveyard — audit MCP server tool usage

Usage:
  mcp-graveyard [audit] [--days N] [--only ACTIVE|DEAD|MISSING|HALLUCINATED]
                       [--tools <server>] [--json] [--claude-dir <path>]
  mcp-graveyard prune [--apply] [--only <server>] [--claude-dir <path>]
  mcp-graveyard projects [--days N] [--claude-dir <path>]
  mcp-graveyard suggest [--days N] [--claude-dir <path>]
`);
  process.exit(0);
}

function die(msg: string): never {
  console.error(`mcp-graveyard: ${msg}`);
  process.exit(2);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.subcommand !== "audit") {
    die(`subcommand "${args.subcommand}" not implemented yet`);
  }
  const report = await runAudit({
    claudeDir: args.claudeDir,
    windowDays: args.days,
    only: args.only,
  });
  if (args.json) {
    console.log(formatAuditJson(report));
    return;
  }
  if (args.tools) {
    const summary = report.rows.find((r) => r.name === args.tools);
    if (!summary) die(`server "${args.tools}" not found`);
    console.log(formatDrillDown(args.tools, summary, { color: process.stdout.isTTY ?? false }));
    return;
  }
  console.log(formatAuditReport(report, { color: process.stdout.isTTY ?? false }));
}

main().catch((err) => {
  console.error("mcp-graveyard:", err instanceof Error ? err.message : err);
  process.exit(1);
});
```

- [ ] **Step 2: Build + smoke test**

```sh
npm run build --workspace=mcp-graveyard
node packages/mcp-graveyard/dist/cli.js --json --days 7 | head -c 300
```

Expected: a JSON snippet starting with `{"generatedAt":...`. Empty `rows` array if you have no MCP servers configured / no calls in window — that's OK.

- [ ] **Step 3: Commit**

```sh
git add packages/mcp-graveyard/src/cli.ts
git commit -m "mcp-graveyard: cli routing for audit"
```

---

## Task 8: Implement `prune` (plan + --apply with backup)

**Files:**
- Create: `packages/mcp-graveyard/src/prune.test.ts`
- Create: `packages/mcp-graveyard/src/prune.ts`
- Modify: `packages/mcp-graveyard/src/cli.ts` (wire up `prune` subcommand)
- Modify: `packages/mcp-graveyard/src/format.ts` (add `formatPruneReport`)

The dry-run path is purely a function over the audit report. The `--apply` path is harder to test (forks `claude mcp remove`); we test the planning + backup serialization, leaving exec'd-CLI mocked at the integration boundary.

- [ ] **Step 1: Write failing tests for the planning + backup**

```ts
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
    toolsAdvertised: 0,
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
```

- [ ] **Step 2: Verify tests fail**

```sh
npm test --workspace=mcp-graveyard
```

Expected: failure ("Cannot find module './prune.js'").

- [ ] **Step 3: Implement `prune.ts`**

```ts
import { writeFile, mkdir, rename, chmod } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import type { McpServerSummary, McpServerEntry } from "./types.js";

export interface PrunePlanEntry {
  server: string;
  command: string;
}

export function planPrune(
  rows: McpServerSummary[],
  onlyServer: string | undefined,
): PrunePlanEntry[] {
  return rows
    .filter((r) => r.bucket === "dead")
    .filter((r) => (onlyServer ? r.name === onlyServer : true))
    .map((r) => ({ server: r.name, command: `claude mcp remove ${r.server ?? r.name}` }));
}

export async function writePruneBackup(
  claudeDir: string,
  entries: McpServerEntry[],
  windowDays: number,
): Promise<string> {
  const backupDir = join(claudeDir, "mcp-graveyard-backup");
  await mkdir(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const finalPath = join(backupDir, `${stamp}.json`);
  const tmpPath = `${finalPath}.tmp`;
  const contents = {
    removedAt: new Date().toISOString(),
    claudeDir,
    windowDays,
    servers: Object.fromEntries(
      entries.map((e) => [
        e.name,
        {
          ...(e.command !== null && { command: e.command }),
          ...(e.args !== null && { args: e.args }),
          ...(e.env !== null && { env: e.env }),
        },
      ]),
    ),
    restoreHint: "claude mcp add <name> <command> [args...] (consult JSON above for args/env)",
  };
  await writeFile(tmpPath, JSON.stringify(contents, null, 2), { mode: 0o600 });
  await chmod(tmpPath, 0o600);
  await rename(tmpPath, finalPath);
  return finalPath;
}

export interface ApplyResult {
  removed: string[];
  failed: { server: string; error: string }[];
}

export function applyPrune(plan: PrunePlanEntry[]): ApplyResult {
  const result: ApplyResult = { removed: [], failed: [] };
  for (const entry of plan) {
    const r = spawnSync("claude", ["mcp", "remove", entry.server], { stdio: "inherit" });
    if (r.status === 0) result.removed.push(entry.server);
    else result.failed.push({ server: entry.server, error: `exit ${r.status ?? "signal " + r.signal}` });
  }
  return result;
}

export function ensureClaudeCliAvailable(): void {
  const r = spawnSync("claude", ["--version"], { stdio: "ignore" });
  if (r.error || r.status !== 0) {
    throw new Error("`claude` CLI not in PATH; install Claude Code or run prune without --apply");
  }
}
```

- [ ] **Step 4: Tests pass**

```sh
npm test --workspace=mcp-graveyard
```

Expected: all 4 prune tests pass.

- [ ] **Step 5: Add `formatPruneReport` to `format.ts`**

```ts
export function formatPruneReport(
  plan: PrunePlanEntry[],
  windowDays: number,
  opts: FormatOptions,
): string {
  const c = (code: string, s: string) => (opts.color ? `${code}${s}${C.reset}` : s);
  if (plan.length === 0) {
    return c(C.dim, `mcp-graveyard prune — nothing to remove (no dead servers in ${windowDays} days)`);
  }
  const lines: string[] = [
    c(C.bold, `mcp-graveyard prune`) +
      c(C.dim, ` — plan: ${plan.length} server${plan.length === 1 ? "" : "s"} to remove`) +
      c(C.dim, ` (0 successful calls in ${windowDays} days)`),
    "",
    ...plan.map((p) => `  ${p.server.padEnd(40)}  ${p.command}`),
    "",
    c(C.dim, `re-run with --apply to execute (backup is automatic)`),
  ];
  return lines.join("\n");
}
```

Add the corresponding import for `PrunePlanEntry` from `./prune.js`.

- [ ] **Step 6: Wire `prune` into `cli.ts`**

The full backup entries (command/args/env) aren't in the audit summary — we re-read `~/.claude.json` to get them, then write the backup BEFORE running any `claude mcp remove`.

Add this branch in `cli.ts main()` before the audit branch, with the necessary imports at the top of the file:

```ts
import { planPrune, applyPrune, writePruneBackup, ensureClaudeCliAvailable } from "./prune.js";
import { readMcpServers } from "./mcp_config.js";
import { formatPruneReport } from "./format.js";

// ... inside main()
if (args.subcommand === "prune") {
  const report = await runAudit({
    claudeDir: args.claudeDir,
    windowDays: args.days,
  });
  const plan = planPrune(report.rows, args.pruneOnly);
  if (!args.apply) {
    console.log(formatPruneReport(plan, args.days, { color: process.stdout.isTTY ?? false }));
    return;
  }
  ensureClaudeCliAvailable();
  const allEntries = await readMcpServers(report.claudeDir);
  const entries = plan
    .map((p) => allEntries.find((e) => e.name === p.server))
    .filter((e): e is NonNullable<typeof e> => e !== undefined);
  const backupPath = await writePruneBackup(report.claudeDir, entries, args.days);
  console.log(`backup: ${backupPath}`);
  const result = applyPrune(plan);
  console.log(`removed: ${result.removed.length}/${plan.length}`);
  if (result.failed.length > 0) {
    console.log(`failed:`);
    for (const f of result.failed) console.log(`  ${f.server}: ${f.error}`);
    process.exit(1);
  }
  return;
}
```

- [ ] **Step 7: Build + smoke (DRY-RUN ONLY — never run --apply against your real config in dev)**

```sh
npm run build --workspace=mcp-graveyard
node packages/mcp-graveyard/dist/cli.js prune
```

Expected: prints either "nothing to remove" or a list of dead servers with their `claude mcp remove` commands. Does NOT execute anything.

- [ ] **Step 8: Commit**

```sh
git add packages/mcp-graveyard/src
git commit -m "mcp-graveyard: prune (plan + --apply with backup)"
```

---

## Task 9: Implement `projects`

**Files:**
- Create: `packages/mcp-graveyard/src/projects.test.ts`
- Create: `packages/mcp-graveyard/src/projects.ts`
- Modify: `packages/mcp-graveyard/src/format.ts` (add `formatProjectsReport`)
- Modify: `packages/mcp-graveyard/src/cli.ts` (wire up)

- [ ] **Step 1: Write failing test**

```ts
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
```

- [ ] **Step 2: Verify it fails, then implement**

```ts
import { findSessionFiles, resolveClaudePaths } from "@skill-graveyard/core";
import { parseMcpSession } from "./mcp_parser.js";

export interface ProjectStat {
  cwd: string;
  sessions: number;
  totalCalls: number;
  servers: { name: string; calls: number; errored: number }[];
}

export interface ProjectsOptions {
  claudeDir?: string;
  windowDays: number;
}

export async function runProjects(opts: ProjectsOptions): Promise<ProjectStat[]> {
  const paths = resolveClaudePaths(opts.claudeDir);
  const since = Date.now() - opts.windowDays * 24 * 60 * 60 * 1000;
  const files = await findSessionFiles(paths.projectsDir, since);
  const byCwd = new Map<string, { sessions: Set<string>; calls: { server: string; errored: boolean }[] }>();
  for (const sf of files) {
    const calls = await parseMcpSession(sf.filepath, sf.projectKey);
    for (const c of calls) {
      const cwd = c.cwd ?? "(unknown)";
      if (!byCwd.has(cwd)) byCwd.set(cwd, { sessions: new Set(), calls: [] });
      const entry = byCwd.get(cwd)!;
      entry.sessions.add(c.sessionId);
      entry.calls.push({ server: c.server, errored: c.errored });
    }
  }
  const out: ProjectStat[] = [];
  for (const [cwd, data] of byCwd) {
    const byServer = new Map<string, { calls: number; errored: number }>();
    for (const c of data.calls) {
      if (!byServer.has(c.server)) byServer.set(c.server, { calls: 0, errored: 0 });
      const e = byServer.get(c.server)!;
      e.calls++;
      if (c.errored) e.errored++;
    }
    out.push({
      cwd,
      sessions: data.sessions.size,
      totalCalls: data.calls.length,
      servers: [...byServer.entries()]
        .map(([name, v]) => ({ name, ...v }))
        .sort((a, b) => b.calls - a.calls),
    });
  }
  return out.sort((a, b) => b.totalCalls - a.totalCalls);
}
```

- [ ] **Step 3: `formatProjectsReport` in `format.ts`**

```ts
import type { ProjectStat } from "./projects.js";

export function formatProjectsReport(stats: ProjectStat[], opts: FormatOptions): string {
  const c = (code: string, s: string) => (opts.color ? `${code}${s}${C.reset}` : s);
  if (stats.length === 0) return c(C.dim, "no MCP tool calls in window");
  const lines: string[] = [];
  for (const s of stats) {
    lines.push(`${s.cwd}  ${c(C.dim, `${s.sessions} ses, ${s.totalCalls} calls, ${s.servers.length} servers`)}`);
    for (const srv of s.servers) {
      const mark = srv.errored > 0 ? c(C.red, "✗") : " ";
      const errorTag = srv.errored > 0 ? c(C.red, ` (${srv.errored} errored)`) : "";
      lines.push(`  ${mark} ${srv.name.padEnd(40)}${String(srv.calls).padStart(4)}×${errorTag}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
```

- [ ] **Step 4: Wire into cli.ts**

In `main()`:

```ts
if (args.subcommand === "projects") {
  const stats = await runProjects({ claudeDir: args.claudeDir, windowDays: args.days });
  if (args.json) {
    console.log(JSON.stringify(stats, null, 2));
    return;
  }
  console.log(formatProjectsReport(stats, { color: process.stdout.isTTY ?? false }));
  return;
}
```

- [ ] **Step 5: Tests pass + commit**

```sh
npm test --workspace=mcp-graveyard
npm run build --workspace=mcp-graveyard
node packages/mcp-graveyard/dist/cli.js projects --days 7 | head -c 500

git add packages/mcp-graveyard/src
git commit -m "mcp-graveyard: projects subcommand"
```

---

## Task 10: Implement `suggest`

**Files:**
- Create: `packages/mcp-graveyard/src/suggest.test.ts`
- Create: `packages/mcp-graveyard/src/suggest.ts`
- Modify: `packages/mcp-graveyard/src/format.ts` (add `formatSuggestReport`)
- Modify: `packages/mcp-graveyard/src/cli.ts` (wire)

Categories:
- **TYPO** — server name within Levenshtein distance ≤2 of a configured server.
- **REMOVED SERVER** — for v1 we don't have the "was once configured" history; placeholder bucket = any missing server that doesn't fit the other categories.
- **TOOL/SERVER CONFUSION** — server name matches a known built-in CC tool name (use `KNOWN_TOOLS` from core).
- **UNCLASSIFIED** — none of the above.

- [ ] **Step 1: Write failing tests**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { classify, type SuggestRow } from "./suggest.js";

const configured = ["supabase", "playwright", "pencil"];

test("typo within distance 2 → TYPO", () => {
  const result = classify("supbase", configured);
  assert.equal(result.category, "TYPO");
  assert.equal(result.match, "supabase");
});

test("name matches built-in tool → TOOL_CONFUSION", () => {
  const result = classify("Bash", configured);
  assert.equal(result.category, "TOOL_CONFUSION");
});

test("no match → UNCLASSIFIED", () => {
  const result = classify("zzz_nonsense", configured);
  assert.equal(result.category, "UNCLASSIFIED");
});

test("exact match to configured doesn't count (caller filters those out)", () => {
  const result = classify("supabase", configured);
  // distance 0 still counts as TYPO under our logic; caller must filter out exact matches before classifying.
  assert.equal(result.category, "TYPO");
});
```

- [ ] **Step 2: Implement `suggest.ts`**

```ts
import { KNOWN_TOOLS } from "@skill-graveyard/core";

export type SuggestCategory = "TYPO" | "REMOVED_SERVER" | "TOOL_CONFUSION" | "UNCLASSIFIED";

export interface SuggestRow {
  server: string;
  category: SuggestCategory;
  match?: string;          // configured server name for TYPO
  reason?: string;
}

export function classify(server: string, configuredServers: string[]): SuggestRow {
  if (KNOWN_TOOLS.has(server)) {
    return { server, category: "TOOL_CONFUSION", reason: `"${server}" is a built-in CC tool name, not an MCP server` };
  }
  for (const c of configuredServers) {
    if (levenshtein(server, c) <= 2) {
      return { server, category: "TYPO", match: c, reason: `≈ "${c}" (distance ${levenshtein(server, c)})` };
    }
  }
  return { server, category: "UNCLASSIFIED" };
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[] = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j]!;
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[j] = Math.min(dp[j]! + 1, dp[j - 1]! + 1, prev + cost);
      prev = tmp;
    }
  }
  return dp[n]!;
}
```

Plus `runSuggest`:

```ts
import { runAudit } from "./audit.js";
import { readMcpServers } from "./mcp_config.js";
import type { SuggestCategory } from "./suggest.js";  // export above

export async function runSuggest(opts: { claudeDir?: string; windowDays: number }): Promise<SuggestRow[]> {
  const report = await runAudit({ claudeDir: opts.claudeDir, windowDays: opts.windowDays });
  const configured = report.rows.filter((r) => r.configured).map((r) => r.name);
  const targets = report.rows.filter((r) => r.bucket === "missing" || r.bucket === "hallucinated");
  const out: SuggestRow[] = [];
  for (const t of targets) {
    if (configured.includes(t.name)) continue;  // exact match — not actionable
    out.push(classify(t.name, configured));
  }
  return out;
}
```

- [ ] **Step 3: Verify tests pass**

```sh
npm test --workspace=mcp-graveyard
```

Expected: all suggest tests pass.

- [ ] **Step 4: Add `formatSuggestReport` to `format.ts`**

```ts
import type { SuggestRow } from "./suggest.js";

export function formatSuggestReport(rows: SuggestRow[], opts: FormatOptions): string {
  const c = (code: string, s: string) => (opts.color ? `${code}${s}${C.reset}` : s);
  if (rows.length === 0) return c(C.dim, "no missing or hallucinated invocations to classify");
  const byCategory = new Map<string, SuggestRow[]>();
  for (const r of rows) {
    if (!byCategory.has(r.category)) byCategory.set(r.category, []);
    byCategory.get(r.category)!.push(r);
  }
  const lines: string[] = [];
  for (const [cat, items] of byCategory) {
    lines.push(c(C.bold, `${cat} (${items.length})`));
    for (const r of items) {
      const tail = r.reason ? c(C.dim, `  — ${r.reason}`) : "";
      lines.push(`  ${r.server}${tail}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
```

- [ ] **Step 5: Wire `suggest` into `cli.ts main()`**

```ts
if (args.subcommand === "suggest") {
  const rows = await runSuggest({ claudeDir: args.claudeDir, windowDays: args.days });
  if (args.json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  console.log(formatSuggestReport(rows, { color: process.stdout.isTTY ?? false }));
  return;
}
```

- [ ] **Step 6: Smoke + commit**

```sh
npm run build --workspace=mcp-graveyard
node packages/mcp-graveyard/dist/cli.js suggest --days 7

git add packages/mcp-graveyard/src
git commit -m "mcp-graveyard: suggest classifier"
```

---

## Task 11: Slash command + plugin manifest

**Files:**
- Create: `packages/mcp-graveyard/.claude-plugin/plugin.json`
- Create: `packages/mcp-graveyard/commands/audit-mcp-tools.md`
- Modify: `packages/mcp-graveyard/package.json` (extend `files` to include plugin assets)

- [ ] **Step 1: Plugin manifest**

```json
{
  "name": "mcp-graveyard",
  "version": "0.1.0",
  "description": "Audit which MCP server tools your Claude Code sessions actually invoke. Server-first, surfaces dead servers and hallucinated calls.",
  "homepage": "https://sfrangulov.github.io/skill-graveyard/",
  "license": "MIT",
  "keywords": ["audit", "mcp", "tools"]
}
```

- [ ] **Step 2: Slash command**

`packages/mcp-graveyard/commands/audit-mcp-tools.md`:

```markdown
---
description: Run mcp-graveyard to audit MCP server tool usage and surface unused servers
---

Run `npx mcp-graveyard` to surface MCP servers configured in `~/.claude.json` that your Claude Code sessions never actually invoke. Output is a server-first table grouped into ACTIVE / DEAD / HALLUCINATED / MISSING buckets.

For removal candidates, run `npx mcp-graveyard prune` to print the plan, then `npx mcp-graveyard prune --apply` to execute (with automatic backup of removed config).
```

- [ ] **Step 3: Update `files` in `packages/mcp-graveyard/package.json`**

```json
"files": ["dist", "README.md", "LICENSE", ".claude-plugin", "commands"]
```

These paths are relative to the package root (not `../..` like skill-graveyard's hack), because mcp-graveyard's plugin assets live INSIDE the package — they were created here in this task, not at repo root.

- [ ] **Step 4: Verify pack contents**

```sh
npm pack --workspace=mcp-graveyard --dry-run 2>&1 | grep -E "(\.claude-plugin|commands|dist/cli)"
```

Expected: lines for `.claude-plugin/plugin.json`, `commands/audit-mcp-tools.md`, `dist/cli.js`.

- [ ] **Step 5: Commit**

```sh
git add packages/mcp-graveyard
git commit -m "mcp-graveyard: plugin manifest + slash command"
```

---

## Task 12: README, docs site, and final verification

**Files:**
- Create: `packages/mcp-graveyard/README.md`
- Modify: `README.md` (root) — add a brief "see also: mcp-graveyard" pointer
- Modify: `docs/index.html` — add mcp-graveyard mention if it's a marketing surface
- Modify: `CLAUDE.md` — note that there are now two CLIs in the monorepo

- [ ] **Step 1: Write `packages/mcp-graveyard/README.md`**

Mirror the structure of skill-graveyard's README but for MCP. Key sections:
- One-liner explaining dual signal (dead servers + hallucinated calls)
- Install: `npx mcp-graveyard`
- Usage: list of subcommands with example output
- What it reads: `~/.claude.json` (mcpServers), `~/.claude/projects/**/*.jsonl`
- What it does NOT do: subprocess to MCP servers, project-scoped `.mcp.json`, telemetry

(The implementing agent should pattern-match against skill-graveyard's existing README and adapt section by section.)

- [ ] **Step 2: Add mcp-graveyard mention to root `README.md`**

Insert a short "Companion tool" section near the top:

```markdown
### Companion tool: mcp-graveyard

The same dual-signal idea applied to MCP server tools: which configured servers
does Claude actually invoke, and which tool names is it hallucinating?

```sh
npx mcp-graveyard
```

Server-first audit, ~~`prune`~~ with automatic backup, and `projects` /
`suggest` for finer signals. See [packages/mcp-graveyard](packages/mcp-graveyard/).
```

- [ ] **Step 3: Update `CLAUDE.md` "Layout" section**

Add a third bullet about packages/mcp-graveyard in the package layout list.

- [ ] **Step 4: Update CI matrix to include mcp-graveyard**

Modify `.github/workflows/ci.yml`:

```yaml
matrix:
  package: ["@skill-graveyard/core", "skill-graveyard", "mcp-graveyard"]
  node: [20, 22]
```

- [ ] **Step 5: Full pre-publish verification**

```sh
rm -rf node_modules packages/*/node_modules packages/*/dist
npm install
npm run build --workspaces
npm run typecheck --workspaces
npm test --workspaces

# Pack each
npm pack --workspace=@skill-graveyard/core --dry-run 2>&1 | grep "npm notice"
npm pack --workspace=skill-graveyard --dry-run 2>&1 | grep "npm notice"
npm pack --workspace=mcp-graveyard --dry-run 2>&1 | grep "npm notice"

# Smoke each binary
node packages/skill-graveyard/dist/cli.js --json --days 1 | head -c 200
node packages/mcp-graveyard/dist/cli.js --json --days 1 | head -c 200
```

Expected: all green; both CLIs return JSON shapes.

- [ ] **Step 6: Commit**

```sh
git add README.md CLAUDE.md docs packages/mcp-graveyard/README.md .github/workflows/ci.yml
git commit -m "mcp-graveyard: docs, root readme link, ci matrix"
```

---

## Out of scope (deliberately deferred)

- **`cost` subcommand.** The hard part is sourcing full tool JSON Schemas (not just names) — needs its own brainstorm.
- **`outdated` subcommand for MCP servers.** Servers map to npm packages or git repos; technically extends Plan A's `source_resolver` but boilerplate-heavy for v1.
- **Per-tool disable.** Claude Code doesn't support disabling individual tools within a server; only whole-server `claude mcp remove`.
- **`<project>/.mcp.json` parsing.** Per-project artefacts intentionally out of scope, mirroring skill-graveyard's `<project>/.claude/skills/` exclusion.
- **Marketplace registration for the new plugin.** The repo's existing marketplace registration path is out-of-band (handled by claude-plugins-official or whichever registry hosts skill-graveyard). Adding mcp-graveyard there is a coordination task with that registry, not code.
- **`restore` subcommand.** Backup format is restore-friendly but restore is manual in v1 (one less moving part).

---

## Self-review checklist

After all tasks:

1. **All four bucket categories** have at least one test case in `audit.test.ts`. ✓
2. **`prune --apply` writes backup BEFORE the first `claude mcp remove`** (verified in cli.ts wiring, Task 8 Step 6).
3. **Backup file mode is `0o600`** (test in Task 8 Step 1).
4. **Tool name parser** handles single-segment, multi-segment, tool-with-underscore, and rejects non-`mcp__` (tests in Task 4).
5. **`InputValidationError` distinguished from runtime errors** (test in Task 4 Step 1, "ignores tool_result errors that aren't InputValidationError").
6. **CI matrix runs 6 cells** (3 packages × 2 node versions), all green (Task 12 Step 4).
7. **No new runtime deps** — `mcp-graveyard` depends only on `@skill-graveyard/core`. Verify with `cat packages/mcp-graveyard/package.json | jq .dependencies`.
8. **No subprocess to MCP servers** — confirmed by reading the source: only `child_process` use is `spawnSync("claude", ...)` for `mcp remove` and `--version` check. Nothing executes user MCP servers.
