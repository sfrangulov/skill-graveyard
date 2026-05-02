# memory-graveyard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `memory-graveyard@0.1.0` as the third sister package in the skill-graveyard monorepo. Audits per-project file-based memory (`MEMORY.md` index + `memory/*.md` entries). v1 surface: `audit` (4-bucket per-project), `lint` (5 static checks including unique truncation budget), `prune` (with `--apply` + snapshot backup), `projects` (cross-project sweep).

**Architecture:** Mirrors `mcp-graveyard`'s package shape. Adds one additive helper (`discoverMemoryDirs`) to `@skill-graveyard/core`. Reuses `parseToolCalls<T>` for JSONL parsing. Three memory-specific modules (`index_parser.ts`, `entry_scanner.ts`, `memory_parser.ts`) plus the four subcommands and a `format.ts`. Documentation, release-please, CI, landing page, and skills.sh manifest update in lockstep.

**Tech Stack:** Node ≥18, TypeScript 6 (strict + `noUncheckedIndexedAccess`), npm workspaces, tsx (dev), `node:test` (built-in), `@skill-graveyard/core` (parser/discovery/paths/tokenizer). No new runtime deps.

**Spec:** `docs/specs/2026-05-02-memory-graveyard-design.md`. Read it before starting — bucket semantics, prune snapshot format, lint check details, and "Documentation touch list" are load-bearing.

---

## Task 1: Capture pre-implementation baseline

Pure verification. Confirms the monorepo is green before we add a fourth package.

**Files:** none modified.

- [ ] **Step 1: Clean install + full check**

```sh
npm ci
npm run typecheck
npm test 2>&1 | tee /tmp/mg-baseline-tests.txt
npm run build
```

Expected: typecheck clean, all tests pass across `@skill-graveyard/core`, `skill-graveyard`, `mcp-graveyard`. Note the total test count from the output.

- [ ] **Step 2: Confirm three packages currently exist**

```sh
ls packages/
```

Expected: `core  mcp-graveyard  skill-graveyard` (exactly three directories).

- [ ] **Step 3: No commit (baseline only)**

---

## Task 2: Add `discoverMemoryDirs` to `@skill-graveyard/core`

The only additive change to `core` for the entire feature. Walks `<projectsDir>/*/memory/` and returns memory dirs with their project key. TDD.

**Files:**
- Test: `packages/core/src/discovery.test.ts` (modify — add new test)
- Modify: `packages/core/src/discovery.ts`
- Modify: `packages/core/src/index.ts` (re-export)

- [ ] **Step 1: Write the failing test**

Append to `packages/core/src/discovery.test.ts`:

```ts
test("discoverMemoryDirs returns one entry per project that has a memory/ subdir", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "mg-disc-"));
  try {
    const projectsDir = join(tmp, "projects");
    await mkdir(join(projectsDir, "-Users-alice-projects-foo", "memory"), { recursive: true });
    await writeFile(join(projectsDir, "-Users-alice-projects-foo", "memory", "MEMORY.md"), "");
    await mkdir(join(projectsDir, "-Users-alice-projects-bar"), { recursive: true });
    // bar has no memory/ subdir
    await mkdir(join(projectsDir, "-Users-alice-projects-baz", "memory"), { recursive: true });
    await writeFile(join(projectsDir, "-Users-alice-projects-baz", "memory", "MEMORY.md"), "");

    const dirs = await discoverMemoryDirs(projectsDir);
    const sorted = dirs.map((d) => d.projectKey).sort();
    assert.deepStrictEqual(sorted, [
      "-Users-alice-projects-baz",
      "-Users-alice-projects-foo",
    ]);
    assert.ok(dirs[0]!.memoryDir.endsWith("/memory"));
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("discoverMemoryDirs returns [] when projectsDir is missing", async () => {
  const dirs = await discoverMemoryDirs("/nonexistent/path/does/not/exist");
  assert.deepStrictEqual(dirs, []);
});
```

If `discoverMemoryDirs` isn't already imported at the top of the file, add it to the existing import: `import { discoverInstalledSkills, discoverProjectScopedSkills, findGitRoot, discoverMemoryDirs } from "./discovery.js";`. If the test file lacks `mkdir`/`writeFile` imports from `node:fs/promises`, add them.

- [ ] **Step 2: Run test to verify it fails**

```sh
npm test --workspace=@skill-graveyard/core 2>&1 | tail -20
```

Expected: FAIL with `discoverMemoryDirs is not a function` or import error.

- [ ] **Step 3: Implement in `discovery.ts`**

Append to `packages/core/src/discovery.ts`:

```ts
export interface MemoryDir {
  projectKey: string;
  memoryDir: string;
}

export async function discoverMemoryDirs(projectsDir: string): Promise<MemoryDir[]> {
  let entries: string[];
  try {
    entries = await readdir(projectsDir);
  } catch {
    return [];
  }
  const out: MemoryDir[] = [];
  for (const projectKey of entries) {
    const memoryDir = join(projectsDir, projectKey, "memory");
    try {
      const s = await stat(memoryDir);
      if (s.isDirectory()) out.push({ projectKey, memoryDir });
    } catch {
      continue;
    }
  }
  return out;
}
```

`readdir`, `stat`, `join` are already imported at the top of `discovery.ts` — no new imports needed.

- [ ] **Step 4: Re-export from `core/src/index.ts`**

Edit `packages/core/src/index.ts` to extend the discovery re-export block:

```ts
export {
  discoverInstalledSkills,
  discoverProjectScopedSkills,
  findGitRoot,
  discoverMemoryDirs,
} from "./discovery.js";
export type { SkillSource, InstalledSkill, MemoryDir } from "./discovery.js";
```

- [ ] **Step 5: Run tests + typecheck**

```sh
npm test --workspace=@skill-graveyard/core
npm run typecheck --workspace=@skill-graveyard/core
```

Expected: all tests pass (existing + 2 new), typecheck clean.

- [ ] **Step 6: Build core (other packages depend on its dist)**

```sh
npm run build --workspace=@skill-graveyard/core
```

Expected: `packages/core/dist/discovery.js` and `dist/index.js` updated.

- [ ] **Step 7: Commit**

```sh
git add packages/core/src/discovery.ts packages/core/src/discovery.test.ts packages/core/src/index.ts
git commit -m "feat(core): add discoverMemoryDirs for memory-graveyard"
```

The `feat:` prefix is intentional — release-please will bump core when this commit lands. Acceptable: core's surface is small, version bumps are routine, and the new export is genuinely new public API.

---

## Task 3: Bootstrap `memory-graveyard` package skeleton

Creates the directory and minimal manifests so workspaces commands recognize the new package. No code logic yet — that comes in subsequent tasks. Mirrors `packages/mcp-graveyard/` structure exactly.

**Files:**
- Create: `packages/memory-graveyard/package.json`
- Create: `packages/memory-graveyard/tsconfig.json`
- Create: `packages/memory-graveyard/.gitignore`
- Create: `packages/memory-graveyard/src/.gitkeep`
- Create: `packages/memory-graveyard/README.md` (placeholder — full content comes in Task 20)

- [ ] **Step 1: Write `packages/memory-graveyard/package.json`**

```json
{
  "name": "memory-graveyard",
  "version": "0.1.0",
  "description": "Audit which entries in your project's MEMORY.md Claude actually reads. Per-project, surfaces dead memory entries, broken pointers, and truncation-budget overflow.",
  "type": "module",
  "bin": {
    "memory-graveyard": "dist/cli.js"
  },
  "files": [
    "dist",
    "README.md",
    "LICENSE"
  ],
  "engines": {
    "node": ">=18"
  },
  "scripts": {
    "dev": "tsx src/cli.ts",
    "build": "tsc",
    "postbuild": "chmod +x dist/cli.js",
    "prepublishOnly": "npm -w memory-graveyard run typecheck && npm -w memory-graveyard run test && npm -w memory-graveyard run build",
    "typecheck": "tsc --noEmit",
    "test": "node --import tsx --test src/*.test.ts"
  },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/sfrangulov/skill-graveyard.git",
    "directory": "packages/memory-graveyard"
  },
  "bugs": {
    "url": "https://github.com/sfrangulov/skill-graveyard/issues"
  },
  "homepage": "https://sfrangulov.github.io/skill-graveyard/",
  "keywords": [
    "claude-code",
    "claude",
    "memory",
    "audit",
    "cli",
    "anthropic"
  ],
  "license": "MIT",
  "dependencies": {
    "@skill-graveyard/core": "^0.1.0"
  }
}
```

Note: `bin` is `dist/cli.js` with NO `./` prefix (the documented gotcha — `./` causes npm to silently strip the entry from the published tarball). The `^0.1.0` core dep range will be bumped to whatever the actual published core version is in Task 23 if Task 2 produced a higher version.

- [ ] **Step 2: Write `packages/memory-graveyard/tsconfig.json`**

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

- [ ] **Step 3: Write `packages/memory-graveyard/.gitignore`**

```
dist/
node_modules/
```

- [ ] **Step 4: Create empty src marker**

```sh
touch packages/memory-graveyard/src/.gitkeep
```

- [ ] **Step 5: Write `packages/memory-graveyard/README.md` placeholder**

```markdown
# memory-graveyard

Audit which entries in your project's `MEMORY.md` Claude actually reads.

This README is replaced with full content during implementation; see the parent repo's `README.md` for now.
```

- [ ] **Step 6: Workspace install picks up the new package**

```sh
npm install
```

Expected: succeeds, no warnings about missing workspace. `node_modules/.bin/memory-graveyard` does NOT exist yet (no `dist/` built).

- [ ] **Step 7: Confirm workspace is recognized**

```sh
npm pkg get name --workspace=memory-graveyard
```

Expected: `"memory-graveyard"` printed.

- [ ] **Step 8: Commit**

```sh
git add packages/memory-graveyard/ package-lock.json
git commit -m "chore: scaffold memory-graveyard package"
```

`chore:` because there is no shippable feature yet — release-please will not propose a release for this package on its own.

---

## Task 4: Define types and stub CLI entry

Adds the type vocabulary used across all subsequent tasks, plus a CLI stub that prints `--help` and exits. Subsequent tasks wire real subcommands into it.

**Files:**
- Create: `packages/memory-graveyard/src/types.ts`
- Create: `packages/memory-graveyard/src/cli.ts`

- [ ] **Step 1: Write `src/types.ts`**

```ts
import type { ToolCallBase } from "@skill-graveyard/core";

export type Bucket = "active" | "dead" | "missing" | "hallucinated";

export interface MemoryRead extends ToolCallBase {
  kind: "memory";
  filePath: string;
  memoryFile: string;
  memoryDir: string;
}

export interface Pointer {
  line: number;
  title: string;
  target: string;
  hook: string;
  visible: boolean;
}

export interface EntryFile {
  basename: string;
  path: string;
  exists: boolean;
  frontmatter: { name?: string; description?: string; type?: string } | null;
  bytes: number;
  mtime: string;
}

export interface EntryReport {
  basename: string;
  inIndex: boolean;
  fileExists: boolean;
  pointer: Pointer | null;
  entry: EntryFile | null;
  reads: MemoryRead[];
  errors: MemoryRead[];
  bucket: Bucket;
  lastReadAt: string | null;
}

export interface AuditOptions {
  claudeDir?: string;
  windowDays: number;
  only?: Bucket;
  projectKey?: string;
  cwd?: string;
}

export interface AuditReport {
  generatedAt: string;
  windowDays: number;
  claudeDir: string;
  projectKey: string;
  memoryDir: string;
  summary: {
    indexedEntries: number;
    onDiskEntries: number;
    totalReads: number;
    successfulReads: number;
    erroredReads: number;
  };
  rows: EntryReport[];
}

export interface LintOptions {
  claudeDir?: string;
  projectKey?: string;
  cwd?: string;
  truncationCutoff: number;
  staleDays: number;
}

export interface LintFinding {
  check:
    | "broken-pointers"
    | "orphans"
    | "truncation-budget"
    | "index-size"
    | "stale-dated";
  severity: "error" | "warning" | "info";
  details: unknown;
}

export interface LintReport {
  generatedAt: string;
  memoryDir: string;
  findings: LintFinding[];
  summary: { errors: number; warnings: number; ok: boolean };
}

export interface PrunePlanItem {
  basename: string;
  reason: "dead" | "hallucinated" | "orphan" | "broken-pointer";
  pointerLine: number | null;
  fileExists: boolean;
}

export interface PruneOptions {
  claudeDir?: string;
  projectKey?: string;
  cwd?: string;
  apply: boolean;
  include: { orphans: boolean; brokenPointers: boolean };
  exclude: Set<string>;
  windowDays: number;
}

export interface ProjectMemorySummary {
  projectKey: string;
  cwd: string | null;
  memoryDir: string;
  entryCount: number;
  totalBytes: number;
  lastReadAt: string | null;
  lastTouchedAt: string | null;
  daysSinceTouch: number;
  cold: boolean;
}
```

- [ ] **Step 2: Write `src/cli.ts` stub**

```ts
#!/usr/bin/env node

const USAGE = `memory-graveyard — audit MEMORY.md entry usage

Usage:
  memory-graveyard [audit] [--days N] [--only active|dead|missing|hallucinated]
                          [--json] [--project <path>] [--claude-dir <path>]
  memory-graveyard lint [--truncation-cutoff N] [--stale-days N] [--json]
                        [--project <path>] [--claude-dir <path>]
  memory-graveyard prune [--apply] [--include orphans|broken-pointers]
                         [--exclude <basename>] [--days N] [--json]
                         [--project <path>] [--claude-dir <path>]
  memory-graveyard projects [--cold-days N] [--json] [--claude-dir <path>]
`;

function die(msg: string): never {
  console.error(`memory-graveyard: ${msg}`);
  process.exit(2);
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(USAGE);
    process.exit(0);
  }
  // Subsequent tasks add real subcommand routing here.
  die("not implemented yet — implementation in progress");
}

main().catch((err) => {
  console.error("memory-graveyard:", err instanceof Error ? err.message : err);
  process.exit(1);
});
```

- [ ] **Step 3: Build + smoke-test the stub**

```sh
npm run build --workspace=@skill-graveyard/core
npm run build --workspace=memory-graveyard
node packages/memory-graveyard/dist/cli.js --help
```

Expected: `USAGE` block printed, exit 0.

- [ ] **Step 4: Confirm `not implemented` exit on default invocation**

```sh
node packages/memory-graveyard/dist/cli.js; echo "exit=$?"
```

Expected: `memory-graveyard: not implemented yet — implementation in progress` to stderr, `exit=2`.

- [ ] **Step 5: Commit**

```sh
git add packages/memory-graveyard/src/types.ts packages/memory-graveyard/src/cli.ts
git commit -m "feat(memory-graveyard): scaffold types and CLI entrypoint"
```

---

## Task 5: Implement `index_parser.ts`

Parses `MEMORY.md` into `Pointer[]`. The pointer-line regex is the load-bearing piece. TDD with three test cases: typical line, lines without hook text, mixed non-pointer content.

**Files:**
- Create: `packages/memory-graveyard/src/index_parser.test.ts`
- Create: `packages/memory-graveyard/src/index_parser.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMemoryIndex } from "./index_parser.js";

const SAMPLE = `# Memory Index

Some intro text.

- [Project: foo](project_foo.md) — TS CLI scope and contracts
- [Feedback: testing](feedback_testing.md) — never mock the database
- [User: role](user_role.md)
- malformed line that should be ignored
- [Reference: linear](reference_linear.md) — see project FOO

Footer.
`;

test("parseMemoryIndex extracts pointers with line numbers", () => {
  const pointers = parseMemoryIndex(SAMPLE, 200);
  assert.equal(pointers.length, 4);
  assert.deepEqual(
    pointers.map((p) => p.target),
    ["project_foo.md", "feedback_testing.md", "user_role.md", "reference_linear.md"],
  );
  assert.equal(pointers[0]!.line, 5);
  assert.equal(pointers[0]!.title, "Project: foo");
  assert.equal(pointers[0]!.hook, "TS CLI scope and contracts");
  assert.equal(pointers[2]!.hook, "");
  assert.equal(pointers[0]!.visible, true);
});

test("parseMemoryIndex marks pointers below cutoff as not visible", () => {
  const lines = ["# Memory Index", ""];
  for (let i = 0; i < 250; i++) {
    lines.push(`- [Entry ${i}](entry_${i}.md) — note ${i}`);
  }
  const pointers = parseMemoryIndex(lines.join("\n"), 200);
  const visibleCount = pointers.filter((p) => p.visible).length;
  const hiddenCount = pointers.filter((p) => !p.visible).length;
  assert.equal(visibleCount + hiddenCount, 250);
  assert.equal(visibleCount, 198); // lines 3..200 are pointers, 200-3+1 = 198
  assert.equal(hiddenCount, 52);
});

test("parseMemoryIndex returns [] on empty input", () => {
  assert.deepEqual(parseMemoryIndex("", 200), []);
});
```

- [ ] **Step 2: Run + verify failure**

```sh
npm test --workspace=memory-graveyard 2>&1 | tail -20
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/index_parser.ts`**

```ts
import type { Pointer } from "./types.js";

const POINTER_RE = /^- \[([^\]]+)\]\(([^)]+\.md)\)\s*(?:—\s*(.*))?$/;

export function parseMemoryIndex(content: string, truncationCutoff: number): Pointer[] {
  if (!content) return [];
  const lines = content.split("\n");
  const out: Pointer[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const m = line.match(POINTER_RE);
    if (!m) continue;
    const lineNum = i + 1;
    out.push({
      line: lineNum,
      title: m[1]!,
      target: m[2]!,
      hook: (m[3] ?? "").trim(),
      visible: lineNum <= truncationCutoff,
    });
  }
  return out;
}
```

- [ ] **Step 4: Run + verify pass**

```sh
npm test --workspace=memory-graveyard
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```sh
git add packages/memory-graveyard/src/index_parser.ts packages/memory-graveyard/src/index_parser.test.ts
git commit -m "feat(memory-graveyard): MEMORY.md index parser"
```

---

## Task 6: Implement `entry_scanner.ts`

For each `memory/*.md` (excluding `MEMORY.md`), reads frontmatter from the first ~50 lines. Tolerant of missing frontmatter. Body is read on demand, not eagerly.

**Files:**
- Create: `packages/memory-graveyard/src/entry_scanner.test.ts`
- Create: `packages/memory-graveyard/src/entry_scanner.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanEntryFiles, parseFrontmatter, readEntryBody } from "./entry_scanner.js";

test("parseFrontmatter extracts name/description/type", () => {
  const fm = parseFrontmatter(`---
name: project_foo
description: Some text
type: project
---

Body here.
`);
  assert.deepEqual(fm, { name: "project_foo", description: "Some text", type: "project" });
});

test("parseFrontmatter returns null on missing block", () => {
  assert.equal(parseFrontmatter("just a body, no fm\n"), null);
});

test("scanEntryFiles enumerates *.md and skips MEMORY.md", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "mg-entry-"));
  try {
    await writeFile(join(tmp, "MEMORY.md"), "");
    await writeFile(
      join(tmp, "project_foo.md"),
      "---\nname: foo\ndescription: x\ntype: project\n---\nbody\n",
    );
    await writeFile(join(tmp, "feedback_bar.md"), "no frontmatter here\n");
    const entries = await scanEntryFiles(tmp);
    const sorted = entries.map((e) => e.basename).sort();
    assert.deepEqual(sorted, ["feedback_bar.md", "project_foo.md"]);
    const foo = entries.find((e) => e.basename === "project_foo.md")!;
    assert.equal(foo.frontmatter?.type, "project");
    const bar = entries.find((e) => e.basename === "feedback_bar.md")!;
    assert.equal(bar.frontmatter, null);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("readEntryBody returns full file content", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "mg-body-"));
  try {
    await writeFile(join(tmp, "x.md"), "---\nname: x\n---\nbody line one\nbody line two\n");
    const body = await readEntryBody(join(tmp, "x.md"));
    assert.match(body, /body line one/);
    assert.match(body, /body line two/);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Verify failure**

```sh
npm test --workspace=memory-graveyard 2>&1 | tail -10
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/entry_scanner.ts`**

```ts
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { EntryFile } from "./types.js";

const FM_RE = /^---\n([\s\S]*?)\n---/;
const KEY_RE = /^([a-zA-Z_][a-zA-Z0-9_-]*):\s*(.*)$/;

export function parseFrontmatter(content: string): EntryFile["frontmatter"] {
  const m = content.match(FM_RE);
  if (!m) return null;
  const fm: NonNullable<EntryFile["frontmatter"]> = {};
  for (const line of m[1]!.split("\n")) {
    const km = line.match(KEY_RE);
    if (!km) continue;
    const k = km[1]!;
    const v = km[2]!.trim();
    if (k === "name" || k === "description" || k === "type") {
      (fm as Record<string, string>)[k] = v;
    }
  }
  return fm;
}

export async function scanEntryFiles(memoryDir: string): Promise<EntryFile[]> {
  let files: string[];
  try {
    files = await readdir(memoryDir);
  } catch {
    return [];
  }
  const out: EntryFile[] = [];
  for (const f of files) {
    if (!f.endsWith(".md") || f === "MEMORY.md") continue;
    const path = join(memoryDir, f);
    let s: Awaited<ReturnType<typeof stat>>;
    try {
      s = await stat(path);
    } catch {
      continue;
    }
    if (!s.isFile()) continue;
    let head = "";
    try {
      head = (await readFile(path, "utf8")).slice(0, 4096);
    } catch {
      // file disappeared between readdir and read — skip
      continue;
    }
    out.push({
      basename: f,
      path,
      exists: true,
      frontmatter: parseFrontmatter(head),
      bytes: s.size,
      mtime: new Date(s.mtimeMs).toISOString(),
    });
  }
  return out;
}

export async function readEntryBody(path: string): Promise<string> {
  return readFile(path, "utf8");
}
```

- [ ] **Step 4: Verify pass**

```sh
npm test --workspace=memory-graveyard
```

Expected: all tests in this file plus Task 5's tests pass.

- [ ] **Step 5: Commit**

```sh
git add packages/memory-graveyard/src/entry_scanner.ts packages/memory-graveyard/src/entry_scanner.test.ts
git commit -m "feat(memory-graveyard): entry-file scanner with frontmatter parsing"
```

---

## Task 7: Implement `memory_parser.ts`

Thin wrapper over `parseToolCalls<T>` that filters Read tool calls targeting a specific memory directory. Unlike `mcp_parser.ts`, no error post-filter is needed — Read's `is_error: true` cleanly indicates ENOENT (file not found), which is exactly the hallucination signal we want.

**Files:**
- Create: `packages/memory-graveyard/src/memory_parser.test.ts`
- Create: `packages/memory-graveyard/src/memory_parser.ts`

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Verify failure**

```sh
npm test --workspace=memory-graveyard 2>&1 | tail -10
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/memory_parser.ts`**

```ts
import { basename, normalize } from "node:path";
import { parseToolCalls } from "@skill-graveyard/core";
import type { MemoryRead } from "./types.js";

export async function parseMemorySession(
  filepath: string,
  projectKey: string,
  memoryDir: string,
): Promise<MemoryRead[]> {
  const dirNorm = normalize(memoryDir).replace(/\/$/, "");
  return parseToolCalls<MemoryRead>(
    filepath,
    projectKey,
    (item) =>
      item.type === "tool_use" &&
      item.name === "Read" &&
      typeof (item.input as { file_path?: unknown } | undefined)?.file_path === "string",
    (item, base) => {
      const fp = (item.input as { file_path: string }).file_path;
      const fpNorm = normalize(fp);
      if (!fpNorm.startsWith(dirNorm + "/")) return null;
      const memoryFile = basename(fpNorm);
      // Exclude reads of MEMORY.md itself — the index is auto-loaded into the system prompt;
      // explicit reads are noise (debugging or recall flows). See spec data-model section.
      if (memoryFile === "MEMORY.md") return null;
      return {
        ...base,
        kind: "memory",
        filePath: fpNorm,
        memoryFile,
        memoryDir: dirNorm,
      };
    },
  );
}
```

- [ ] **Step 4: Verify pass**

```sh
npm test --workspace=memory-graveyard
```

Expected: all tests including the two new ones pass.

- [ ] **Step 5: Commit**

```sh
git add packages/memory-graveyard/src/memory_parser.ts packages/memory-graveyard/src/memory_parser.test.ts
git commit -m "feat(memory-graveyard): JSONL parser for memory Read calls"
```

---

## Task 8: Implement `audit.ts`

Correlates index pointers, on-disk entries, and Read events into `EntryReport[]` with bucket assignment. Per-project (default cwd, `--project` override). Window via `--days`.

**Files:**
- Create: `packages/memory-graveyard/src/audit.test.ts`
- Create: `packages/memory-graveyard/src/audit.ts`

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Verify failure**

```sh
npm test --workspace=memory-graveyard 2>&1 | tail -10
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/audit.ts`**

```ts
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { resolveClaudePaths, findSessionFiles } from "@skill-graveyard/core";
import { parseMemoryIndex } from "./index_parser.js";
import { scanEntryFiles } from "./entry_scanner.js";
import { parseMemorySession } from "./memory_parser.js";
import type {
  AuditOptions,
  AuditReport,
  EntryReport,
  MemoryRead,
  Pointer,
  EntryFile,
  Bucket,
} from "./types.js";

export async function runAudit(opts: AuditOptions): Promise<AuditReport> {
  const paths = resolveClaudePaths(opts.claudeDir);
  const projectKey = opts.projectKey ?? deriveProjectKeyFromCwd(opts.cwd ?? process.cwd());
  const memoryDir = join(paths.projectsDir, projectKey, "memory");
  const memoryMdPath = join(memoryDir, "MEMORY.md");

  const indexContent = existsSync(memoryMdPath) ? await readFile(memoryMdPath, "utf8") : "";
  const pointers = parseMemoryIndex(indexContent, 200);
  const entries = await scanEntryFiles(memoryDir);

  const since = Date.now() - opts.windowDays * 24 * 60 * 60 * 1000;
  const sessionFiles = await findSessionFiles(paths.projectsDir, since);
  const projectSessions = sessionFiles.filter((sf) => sf.projectKey === projectKey);
  const reads: MemoryRead[] = [];
  for (const sf of projectSessions) {
    const calls = await parseMemorySession(sf.filepath, sf.projectKey, memoryDir);
    for (const c of calls) {
      const t = c.timestamp ? Date.parse(c.timestamp) : NaN;
      if (Number.isFinite(t) && t < since) continue;
      reads.push(c);
    }
  }

  const rows = correlate(pointers, entries, reads);
  const filtered = opts.only ? rows.filter((r) => r.bucket === opts.only) : rows;

  return {
    generatedAt: new Date().toISOString(),
    windowDays: opts.windowDays,
    claudeDir: paths.claudeDir,
    projectKey,
    memoryDir,
    summary: {
      indexedEntries: pointers.length,
      onDiskEntries: entries.length,
      totalReads: reads.length,
      successfulReads: reads.filter((r) => !r.errored).length,
      erroredReads: reads.filter((r) => r.errored).length,
    },
    rows: filtered,
  };
}

function correlate(
  pointers: Pointer[],
  entries: EntryFile[],
  reads: MemoryRead[],
): EntryReport[] {
  const byPointer = new Map(pointers.map((p) => [p.target, p]));
  const byEntry = new Map(entries.map((e) => [e.basename, e]));
  const allBasenames = new Set<string>([
    ...pointers.map((p) => p.target),
    ...entries.map((e) => e.basename),
    ...reads.map((r) => r.memoryFile),
  ]);

  const out: EntryReport[] = [];
  for (const basename of allBasenames) {
    const pointer = byPointer.get(basename) ?? null;
    const entry = byEntry.get(basename) ?? null;
    const myReads = reads.filter((r) => r.memoryFile === basename);
    const successes = myReads.filter((r) => !r.errored);
    const errors = myReads.filter((r) => r.errored);
    const lastReadAt = myReads
      .map((r) => r.timestamp)
      .filter((t): t is string => !!t)
      .sort()
      .pop() ?? null;

    const inIndex = pointer !== null;
    const fileExists = entry !== null;
    const bucket = bucketFor({ inIndex, fileExists, successes: successes.length, errors: errors.length });
    if (bucket === null) continue;

    out.push({
      basename,
      inIndex,
      fileExists,
      pointer,
      entry,
      reads: successes,
      errors,
      bucket,
      lastReadAt,
    });
  }
  out.sort((a, b) => {
    const order: Bucket[] = ["active", "dead", "missing", "hallucinated"];
    const ai = order.indexOf(a.bucket);
    const bi = order.indexOf(b.bucket);
    if (ai !== bi) return ai - bi;
    if (a.reads.length !== b.reads.length) return b.reads.length - a.reads.length;
    return a.basename.localeCompare(b.basename);
  });
  return out;
}

function bucketFor(s: { inIndex: boolean; fileExists: boolean; successes: number; errors: number }): Bucket | null {
  if (s.inIndex && s.fileExists && s.successes >= 1) return "active";
  if (s.inIndex && s.fileExists && s.successes === 0) return "dead";
  if (!s.inIndex && s.fileExists && s.successes >= 1) return "missing";
  if (s.inIndex && !s.fileExists && s.errors >= 1) return "hallucinated";
  // Static-only orphan (file on disk, not in index, never read) → not in any bucket; lint #2 catches it.
  // Static-only broken pointer (in index, file missing, never followed) → lint #1 catches it.
  return null;
}

function deriveProjectKeyFromCwd(cwd: string): string {
  // Claude Code encodes cwd by replacing / with - and prefixing with the leading -.
  return cwd.replace(/\//g, "-");
}
```

- [ ] **Step 4: Verify pass**

```sh
npm test --workspace=memory-graveyard
```

Expected: 2 new tests pass.

- [ ] **Step 5: Commit**

```sh
git add packages/memory-graveyard/src/audit.ts packages/memory-graveyard/src/audit.test.ts
git commit -m "feat(memory-graveyard): audit subcommand correlation and bucketing"
```

---

## Task 9: Implement `format.ts` for audit + wire to CLI

Renders `AuditReport` as a human table grouped by bucket and as JSON. Also exposes the audit-only CLI path for now; lint/prune/projects formatters are added in their own tasks.

**Files:**
- Create: `packages/memory-graveyard/src/format.ts`
- Modify: `packages/memory-graveyard/src/cli.ts`

- [ ] **Step 1: Write `src/format.ts`**

```ts
import type { AuditReport, EntryReport, Bucket } from "./types.js";

interface FormatOptions {
  color: boolean;
}

const BUCKET_ORDER: Bucket[] = ["active", "dead", "missing", "hallucinated"];
const BUCKET_LABEL: Record<Bucket, string> = {
  active: "ACTIVE",
  dead: "DEAD",
  missing: "MISSING",
  hallucinated: "HALLUCINATED",
};

export function formatAuditReport(report: AuditReport, opts: FormatOptions): string {
  const lines: string[] = [];
  lines.push(
    `memory-graveyard — ${report.windowDays} days · ${report.summary.indexedEntries} entries indexed · ${report.summary.onDiskEntries} on disk · ${report.summary.totalReads} reads · ${report.summary.successfulReads} succeeded · ${report.summary.erroredReads} errored`,
  );
  lines.push("");

  const grouped = new Map<Bucket, EntryReport[]>();
  for (const r of report.rows) {
    if (!grouped.has(r.bucket)) grouped.set(r.bucket, []);
    grouped.get(r.bucket)!.push(r);
  }

  for (const bucket of BUCKET_ORDER) {
    const rows = grouped.get(bucket) ?? [];
    if (rows.length === 0) continue;
    lines.push(`${BUCKET_LABEL[bucket]} (${rows.length})${suffixFor(bucket)}`);
    lines.push(
      `  ${pad("entry", 32)} ${pad("reads", 7)} ${pad("errors", 7)} ${pad("last", 12)} ${pad("line", 5)}`,
    );
    for (const r of rows) {
      lines.push(
        `  ${pad(r.basename, 32)} ${pad(String(r.reads.length), 7)} ${pad(String(r.errors.length), 7)} ${pad(formatDate(r.lastReadAt), 12)} ${pad(r.pointer ? String(r.pointer.line) : "—", 5)}`,
      );
    }
    lines.push("");
  }

  if ((grouped.get("dead")?.length ?? 0) + (grouped.get("hallucinated")?.length ?? 0) > 0) {
    lines.push("→ run: memory-graveyard prune  to clear DEAD entries and broken pointers");
  }
  return lines.join("\n");
}

export function formatAuditJson(report: AuditReport): string {
  const flat = {
    generatedAt: report.generatedAt,
    windowDays: report.windowDays,
    projectKey: report.projectKey,
    memoryDir: report.memoryDir,
    summary: report.summary,
    rows: report.rows.map((r) => ({
      entry: r.basename,
      category: r.bucket,
      inIndex: r.inIndex,
      fileExists: r.fileExists,
      pointerLine: r.pointer?.line ?? null,
      successfulReads: r.reads.length,
      erroredReads: r.errors.length,
      lastReadAt: r.lastReadAt,
    })),
  };
  return JSON.stringify(flat, null, 2);
}

function pad(s: string, n: number): string {
  if (s.length >= n) return s;
  return s + " ".repeat(n - s.length);
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return iso.slice(0, 10);
}

function suffixFor(bucket: Bucket): string {
  if (bucket === "dead") return " — candidates for removal";
  if (bucket === "missing") return " — orphan files Claude found anyway";
  return "";
}
```

`opts.color` is unused in v1 — accepted for API symmetry with sister packages. Wiring color codes is deferred.

- [ ] **Step 2: Replace `src/cli.ts` to wire audit**

Overwrite with:

```ts
#!/usr/bin/env node
import { runAudit } from "./audit.js";
import { formatAuditReport, formatAuditJson } from "./format.js";
import type { Bucket } from "./types.js";

const VALID_BUCKETS: Bucket[] = ["active", "dead", "missing", "hallucinated"];

interface Args {
  subcommand: "audit" | "lint" | "prune" | "projects";
  days: number;
  json: boolean;
  only: Bucket | undefined;
  claudeDir: string | undefined;
  project: string | undefined;
  apply: boolean;
  include: { orphans: boolean; brokenPointers: boolean };
  exclude: Set<string>;
  truncationCutoff: number;
  staleDays: number;
  coldDays: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    subcommand: "audit",
    days: 30,
    json: false,
    only: undefined,
    claudeDir: undefined,
    project: undefined,
    apply: false,
    include: { orphans: false, brokenPointers: false },
    exclude: new Set(),
    truncationCutoff: 200,
    staleDays: 30,
    coldDays: 90,
  };
  let i = 0;
  if (argv[i] && !argv[i]!.startsWith("--") && !argv[i]!.startsWith("-")) {
    const sub = argv[i] as Args["subcommand"];
    if (sub !== "audit" && sub !== "lint" && sub !== "prune" && sub !== "projects") {
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
    else if (a === "--only") {
      const v = argv[++i] as Bucket;
      if (!VALID_BUCKETS.includes(v)) die(`--only must be one of ${VALID_BUCKETS.join("|")}`);
      args.only = v;
    } else if (a === "--claude-dir") args.claudeDir = argv[++i];
    else if (a === "--project") args.project = argv[++i];
    else if (a === "--include") {
      const v = argv[++i]!;
      for (const item of v.split(",")) {
        if (item === "orphans") args.include.orphans = true;
        else if (item === "broken-pointers") args.include.brokenPointers = true;
        else die(`--include unknown value: ${item}`);
      }
    } else if (a === "--exclude") args.exclude.add(argv[++i]!);
    else if (a === "--truncation-cutoff") args.truncationCutoff = Number(argv[++i]);
    else if (a === "--stale-days") args.staleDays = Number(argv[++i]);
    else if (a === "--cold-days") args.coldDays = Number(argv[++i]);
    else if (a === "--help" || a === "-h") usage();
    else die(`unknown flag: ${a}`);
  }
  return args;
}

const USAGE = `memory-graveyard — audit MEMORY.md entry usage

Usage:
  memory-graveyard [audit] [--days N] [--only active|dead|missing|hallucinated]
                          [--json] [--project <path>] [--claude-dir <path>]
  memory-graveyard lint [--truncation-cutoff N] [--stale-days N] [--json]
                        [--project <path>] [--claude-dir <path>]
  memory-graveyard prune [--apply] [--include orphans|broken-pointers]
                         [--exclude <basename>] [--days N] [--json]
                         [--project <path>] [--claude-dir <path>]
  memory-graveyard projects [--cold-days N] [--json] [--claude-dir <path>]
`;

function usage(): never {
  console.log(USAGE);
  process.exit(0);
}

function die(msg: string): never {
  console.error(`memory-graveyard: ${msg}`);
  process.exit(2);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.subcommand === "audit") {
    const report = await runAudit({
      claudeDir: args.claudeDir,
      windowDays: args.days,
      only: args.only,
      projectKey: args.project,
    });
    if (args.json) {
      console.log(formatAuditJson(report));
      return;
    }
    console.log(formatAuditReport(report, { color: process.stdout.isTTY ?? false }));
    return;
  }
  // lint / prune / projects wired in later tasks
  die(`subcommand "${args.subcommand}" not yet implemented`);
}

main().catch((err) => {
  console.error("memory-graveyard:", err instanceof Error ? err.message : err);
  process.exit(1);
});
```

- [ ] **Step 3: Build, smoke-test on the live repo's own memory dir**

```sh
npm run build --workspace=memory-graveyard
node packages/memory-graveyard/dist/cli.js --days 30 --json | head -40
```

Expected: a JSON document with `generatedAt`, `summary`, `rows[]`. The `projectKey` should match the encoding of the cwd.

- [ ] **Step 4: Run typecheck + tests**

```sh
npm run typecheck --workspace=memory-graveyard
npm test --workspace=memory-graveyard
```

Expected: pass.

- [ ] **Step 5: Commit**

```sh
git add packages/memory-graveyard/src/format.ts packages/memory-graveyard/src/cli.ts
git commit -m "feat(memory-graveyard): wire audit subcommand to CLI"
```

---

## Task 10: Implement `lint` checks #1 and #2 (broken pointers, orphans)

These two checks are pure static analysis on `MEMORY.md` and the memory dir. Bundled because they share the same data load (parse index, list dir).

**Files:**
- Create: `packages/memory-graveyard/src/lint.test.ts`
- Create: `packages/memory-graveyard/src/lint.ts`

- [ ] **Step 1: Write the failing tests for #1 and #2**

```ts
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
```

- [ ] **Step 2: Verify failure**

```sh
npm test --workspace=memory-graveyard 2>&1 | tail -10
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lint.ts` (checks #1 and #2 only — others added in next tasks)**

```ts
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { resolveClaudePaths } from "@skill-graveyard/core";
import { parseMemoryIndex } from "./index_parser.js";
import { scanEntryFiles } from "./entry_scanner.js";
import type { LintOptions, LintReport, LintFinding } from "./types.js";

export async function runLint(opts: LintOptions): Promise<LintReport> {
  const paths = resolveClaudePaths(opts.claudeDir);
  const projectKey = opts.projectKey ?? deriveProjectKeyFromCwd(opts.cwd ?? process.cwd());
  const memoryDir = join(paths.projectsDir, projectKey, "memory");
  const memoryMdPath = join(memoryDir, "MEMORY.md");
  const indexContent = existsSync(memoryMdPath) ? await readFile(memoryMdPath, "utf8") : "";
  const pointers = parseMemoryIndex(indexContent, opts.truncationCutoff);
  const entries = await scanEntryFiles(memoryDir);

  const findings: LintFinding[] = [];

  // #1 — broken pointers
  const brokenList = pointers
    .filter((p) => !existsSync(join(memoryDir, p.target)))
    .map((p) => ({ line: p.line, title: p.title, target: p.target }));
  if (brokenList.length > 0) {
    findings.push({ check: "broken-pointers", severity: "error", details: brokenList });
  }

  // #2 — orphans
  const indexed = new Set(pointers.map((p) => p.target));
  const orphanList = entries
    .filter((e) => !indexed.has(e.basename))
    .map((e) => ({ basename: e.basename, bytes: e.bytes }));
  if (orphanList.length > 0) {
    findings.push({ check: "orphans", severity: "warning", details: orphanList });
  }

  // Checks #3, #4, #5 added by subsequent tasks.

  const errors = findings.filter((f) => f.severity === "error").length;
  const warnings = findings.filter((f) => f.severity === "warning").length;
  return {
    generatedAt: new Date().toISOString(),
    memoryDir,
    findings,
    summary: { errors, warnings, ok: findings.length === 0 },
  };
}

function deriveProjectKeyFromCwd(cwd: string): string {
  return cwd.replace(/\//g, "-");
}
```

- [ ] **Step 4: Verify pass**

```sh
npm test --workspace=memory-graveyard
```

Expected: 2 new lint tests pass.

- [ ] **Step 5: Commit**

```sh
git add packages/memory-graveyard/src/lint.ts packages/memory-graveyard/src/lint.test.ts
git commit -m "feat(memory-graveyard): lint checks #1 broken-pointers and #2 orphans"
```

---

## Task 11: Implement `lint` check #3 — truncation budget

The unique-to-memory-graveyard check. Counts how many pointers fall above/below the truncation cutoff and surfaces a sample.

**Files:**
- Modify: `packages/memory-graveyard/src/lint.ts`
- Modify: `packages/memory-graveyard/src/lint.test.ts`

- [ ] **Step 1: Append failing test**

Append to `lint.test.ts`:

```ts
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
      truncationCutoff: 10, // line 3..12 visible (10 entries), 13..32 cut off (20 entries)
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
```

- [ ] **Step 2: Verify failure**

```sh
npm test --workspace=memory-graveyard 2>&1 | tail -10
```

Expected: FAIL — finding undefined.

- [ ] **Step 3: Implement check #3 in `lint.ts`**

In `runLint`, immediately after the `// #2 — orphans` block, insert:

```ts
  // #3 — truncation budget
  const cutOff = pointers.filter((p) => !p.visible);
  if (cutOff.length > 0) {
    findings.push({
      check: "truncation-budget",
      severity: "warning",
      details: {
        total: pointers.length,
        visible: pointers.length - cutOff.length,
        cutOff: cutOff.length,
        cutoff: opts.truncationCutoff,
        sample: cutOff.slice(0, 5).map((p) => ({ line: p.line, target: p.target, title: p.title })),
      },
    });
  }
```

- [ ] **Step 4: Verify pass**

```sh
npm test --workspace=memory-graveyard
```

Expected: both new tests pass.

- [ ] **Step 5: Commit**

```sh
git add packages/memory-graveyard/src/lint.ts packages/memory-graveyard/src/lint.test.ts
git commit -m "feat(memory-graveyard): lint check #3 truncation budget"
```

---

## Task 12: Implement `lint` check #4 — index size

Token count of `MEMORY.md` via the core tokenizer. Heuristic threshold: warn if > 5000 tokens.

**Files:**
- Modify: `packages/memory-graveyard/src/lint.ts`
- Modify: `packages/memory-graveyard/src/lint.test.ts`

- [ ] **Step 1: Append failing test**

Append to `lint.test.ts`:

```ts
test("lint #4 always emits an index-size finding (info or warning)", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "mg-lint-size-"));
  try {
    const { claudeDir } = await buildLintFixture(
      tmp,
      "-p",
      `# x\n\n- [E1](e1.md) — n\n`,
      { "e1.md": "b" },
    );
    const report = await runLint({
      claudeDir,
      projectKey: "-p",
      truncationCutoff: 200,
      staleDays: 30,
    });
    const size = report.findings.find((f) => f.check === "index-size");
    assert.ok(size, "expected an index-size finding");
    const d = size.details as { tokens: number; threshold: number; over: boolean };
    assert.ok(d.tokens > 0);
    assert.equal(d.threshold, 5000);
    assert.equal(d.over, false);
    assert.equal(size.severity, "info");
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Verify failure**

```sh
npm test --workspace=memory-graveyard 2>&1 | tail -10
```

Expected: FAIL — `size` undefined.

- [ ] **Step 3: Implement check #4**

Add `import { estimateTokens } from "@skill-graveyard/core";` to the top of `lint.ts` (next to existing core imports).

After the truncation-budget block, insert:

```ts
  // #4 — index size
  const tokens = estimateTokens(indexContent);
  const threshold = 5000;
  const over = tokens > threshold;
  findings.push({
    check: "index-size",
    severity: over ? "warning" : "info",
    details: { tokens, threshold, over },
  });
```

The summary calculation already counts `errors`/`warnings`; an `info` finding doesn't fail the build. Adjust the `ok` field calculation in the summary so info-only findings don't flip it:

Replace the existing return block:

```ts
  const errors = findings.filter((f) => f.severity === "error").length;
  const warnings = findings.filter((f) => f.severity === "warning").length;
  return {
    generatedAt: new Date().toISOString(),
    memoryDir,
    findings,
    summary: { errors, warnings, ok: errors === 0 && warnings === 0 },
  };
```

- [ ] **Step 4: Verify pass**

```sh
npm test --workspace=memory-graveyard
```

Expected: all tests including new one pass.

- [ ] **Step 5: Commit**

```sh
git add packages/memory-graveyard/src/lint.ts packages/memory-graveyard/src/lint.test.ts
git commit -m "feat(memory-graveyard): lint check #4 index size in tokens"
```

---

## Task 13: Implement `lint` check #5 — stale dated entries

Scans entry bodies (only for `type: project`) for ISO dates and flags entries whose newest date is older than `staleDays`.

**Files:**
- Modify: `packages/memory-graveyard/src/lint.ts`
- Modify: `packages/memory-graveyard/src/lint.test.ts`

- [ ] **Step 1: Append failing test**

```ts
test("lint #5 flags stale type:project entries; ignores other types", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "mg-lint-stale-"));
  try {
    const oldDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const recentDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const { claudeDir } = await buildLintFixture(
      tmp,
      "-p",
      `# x\n\n- [Old](old.md) — n\n- [Recent](recent.md) — n\n- [FB](fb.md) — n\n`,
      {
        "old.md":
          `---\nname: old\ntype: project\n---\n\nDate: ${oldDate}\n`,
        "recent.md":
          `---\nname: recent\ntype: project\n---\n\nDate: ${recentDate}\n`,
        "fb.md":
          `---\nname: fb\ntype: feedback\n---\n\nDate: ${oldDate}\n`,
      },
    );
    const report = await runLint({
      claudeDir,
      projectKey: "-p",
      truncationCutoff: 200,
      staleDays: 30,
    });
    const stale = report.findings.find((f) => f.check === "stale-dated");
    assert.ok(stale, "expected a stale-dated finding");
    const list = stale.details as { basename: string; lastDate: string; daysAgo: number }[];
    assert.equal(list.length, 1);
    assert.equal(list[0]!.basename, "old.md");
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Verify failure**

```sh
npm test --workspace=memory-graveyard 2>&1 | tail -10
```

Expected: FAIL.

- [ ] **Step 3: Implement check #5**

Add to top of `lint.ts`: `import { readEntryBody } from "./entry_scanner.js";`.

Append (still inside `runLint`, after check #4):

```ts
  // #5 — stale dated project entries
  const dateRe = /\b20\d{2}-\d{2}-\d{2}\b/g;
  const cutoff = Date.now() - opts.staleDays * 24 * 60 * 60 * 1000;
  const staleList: { basename: string; lastDate: string; daysAgo: number }[] = [];
  for (const e of entries) {
    if (e.frontmatter?.type !== "project") continue;
    let body: string;
    try {
      body = await readEntryBody(e.path);
    } catch {
      continue;
    }
    const matches = body.match(dateRe);
    if (!matches || matches.length === 0) continue;
    const sorted = [...matches].sort();
    const lastDate = sorted[sorted.length - 1]!;
    const ts = Date.parse(lastDate + "T00:00:00Z");
    if (!Number.isFinite(ts)) continue;
    if (ts < cutoff) {
      const daysAgo = Math.floor((Date.now() - ts) / (24 * 60 * 60 * 1000));
      staleList.push({ basename: e.basename, lastDate, daysAgo });
    }
  }
  if (staleList.length > 0) {
    findings.push({ check: "stale-dated", severity: "warning", details: staleList });
  }
```

- [ ] **Step 4: Verify pass**

```sh
npm test --workspace=memory-graveyard
```

Expected: all 5 lint checks tested and passing.

- [ ] **Step 5: Commit**

```sh
git add packages/memory-graveyard/src/lint.ts packages/memory-graveyard/src/lint.test.ts
git commit -m "feat(memory-graveyard): lint check #5 stale type:project entries"
```

---

## Task 14: Wire `lint` to `format.ts` and CLI

Adds `formatLintReport` / `formatLintJson`, routes `memory-graveyard lint` through them, and sets exit code based on findings.

**Files:**
- Modify: `packages/memory-graveyard/src/format.ts`
- Modify: `packages/memory-graveyard/src/cli.ts`

- [ ] **Step 1: Add lint formatters in `format.ts`**

Append:

```ts
import type { LintReport, LintFinding } from "./types.js";

export function formatLintReport(report: LintReport, _opts: FormatOptions): string {
  const lines: string[] = [];
  lines.push(`memory-graveyard lint — ${report.memoryDir}`);
  lines.push("");
  for (const f of report.findings) {
    lines.push(...renderFinding(f));
    lines.push("");
  }
  if (report.findings.length === 0) {
    lines.push("All checks passed.");
  } else {
    lines.push(
      `Summary: ${report.summary.errors} errors, ${report.summary.warnings} warnings, ${
        report.findings.filter((f) => f.severity === "info").length
      } info`,
    );
  }
  return lines.join("\n");
}

export function formatLintJson(report: LintReport): string {
  return JSON.stringify(report, null, 2);
}

function renderFinding(f: LintFinding): string[] {
  switch (f.check) {
    case "broken-pointers": {
      const list = f.details as { line: number; title: string; target: string }[];
      const out = [`Broken pointers (${list.length}):`];
      for (const x of list) out.push(`  line ${x.line}   ${x.target}   referenced as "${x.title}"`);
      return out;
    }
    case "orphans": {
      const list = f.details as { basename: string; bytes: number }[];
      const out = [`Orphan files (${list.length}) — present on disk, missing from MEMORY.md:`];
      for (const x of list) out.push(`  ${x.basename}   ${x.bytes} bytes`);
      return out;
    }
    case "truncation-budget": {
      const d = f.details as {
        total: number;
        visible: number;
        cutOff: number;
        cutoff: number;
        sample: { line: number; title: string; target: string }[];
      };
      const out = [
        `Truncation budget — cutoff: ${d.cutoff} lines`,
        `  Total entries:        ${d.total}`,
        `  Visible to Claude:    ${d.visible}`,
        `  Cut off (lines ${d.cutoff + 1}+): ${d.cutOff}`,
      ];
      if (d.sample.length > 0) {
        out.push("");
        out.push("  Below the cutoff (sample):");
        for (const s of d.sample) out.push(`    line ${s.line}   ${s.target}   "${s.title}"`);
      }
      return out;
    }
    case "index-size": {
      const d = f.details as { tokens: number; threshold: number; over: boolean };
      return [
        `Index size — ${d.tokens} tokens (cl100k_base; 5–15% drift vs Claude tokenizer)`,
        `  Status: ${d.over ? `OVER (> ${d.threshold} tokens)` : `OK (< ${d.threshold} tokens)`}`,
      ];
    }
    case "stale-dated": {
      const list = f.details as { basename: string; lastDate: string; daysAgo: number }[];
      const out = [`Stale project entries (${list.length}) — last referenced date older than the threshold:`];
      for (const x of list) out.push(`  ${x.basename}   last date ${x.lastDate} (${x.daysAgo} days ago)`);
      return out;
    }
  }
}
```

- [ ] **Step 2: Wire into `cli.ts`**

Add imports near the top:

```ts
import { runLint } from "./lint.js";
import { formatLintReport, formatLintJson } from "./format.js";
```

Replace the trailing block that handles `audit` and the `die(...)` fallthrough with:

```ts
  if (args.subcommand === "audit") {
    const report = await runAudit({
      claudeDir: args.claudeDir,
      windowDays: args.days,
      only: args.only,
      projectKey: args.project,
    });
    if (args.json) {
      console.log(formatAuditJson(report));
      return;
    }
    console.log(formatAuditReport(report, { color: process.stdout.isTTY ?? false }));
    return;
  }
  if (args.subcommand === "lint") {
    const report = await runLint({
      claudeDir: args.claudeDir,
      projectKey: args.project,
      truncationCutoff: args.truncationCutoff,
      staleDays: args.staleDays,
    });
    if (args.json) {
      console.log(formatLintJson(report));
    } else {
      console.log(formatLintReport(report, { color: process.stdout.isTTY ?? false }));
    }
    if (!report.summary.ok) process.exit(1);
    return;
  }
  // prune / projects wired in later tasks
  die(`subcommand "${args.subcommand}" not yet implemented`);
```

- [ ] **Step 3: Build, smoke-test against the live repo**

```sh
npm run build --workspace=memory-graveyard
node packages/memory-graveyard/dist/cli.js lint
echo "exit=$?"
```

Expected: lint output for the current project. Exit code is 0 if clean, 1 otherwise — both are valid here, just verify it returns a value.

- [ ] **Step 4: Tests + typecheck**

```sh
npm run typecheck --workspace=memory-graveyard
npm test --workspace=memory-graveyard
```

Expected: pass.

- [ ] **Step 5: Commit**

```sh
git add packages/memory-graveyard/src/format.ts packages/memory-graveyard/src/cli.ts
git commit -m "feat(memory-graveyard): wire lint subcommand to CLI"
```

---

## Task 15: Implement `prune` plan

Builds a `PrunePlanItem[]` from an `AuditReport`. No fs side effects in this task.

**Files:**
- Create: `packages/memory-graveyard/src/prune.test.ts`
- Create: `packages/memory-graveyard/src/prune.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { planPrune } from "./prune.js";
import type { AuditReport, EntryReport, LintReport } from "./types.js";

const baseReport: AuditReport = {
  generatedAt: "2026-05-02T00:00:00Z",
  windowDays: 30,
  claudeDir: "/c",
  projectKey: "p",
  memoryDir: "/m",
  summary: { indexedEntries: 0, onDiskEntries: 0, totalReads: 0, successfulReads: 0, erroredReads: 0 },
  rows: [],
};

const row = (basename: string, bucket: EntryReport["bucket"], pointerLine: number | null): EntryReport => ({
  basename,
  inIndex: pointerLine !== null,
  fileExists: bucket !== "hallucinated",
  pointer: pointerLine === null ? null : { line: pointerLine, title: "x", target: basename, hook: "", visible: true },
  entry: null,
  reads: [],
  errors: [],
  bucket,
  lastReadAt: null,
});

const emptyLint: LintReport = {
  generatedAt: "2026-05-02T00:00:00Z",
  memoryDir: "/m",
  findings: [],
  summary: { errors: 0, warnings: 0, ok: true },
};

test("planPrune by default targets dead and hallucinated", () => {
  const audit: AuditReport = {
    ...baseReport,
    rows: [
      row("a.md", "active", 5),
      row("d.md", "dead", 8),
      row("h.md", "hallucinated", 12),
      row("o.md", "missing", null),
    ],
  };
  const plan = planPrune(audit, emptyLint, {
    include: { orphans: false, brokenPointers: false },
    exclude: new Set(),
  });
  const reasons = plan.map((p) => `${p.basename}:${p.reason}`).sort();
  assert.deepEqual(reasons, ["d.md:dead", "h.md:hallucinated"]);
});

test("planPrune --include orphans adds orphan files from lint", () => {
  const audit = baseReport;
  const lint: LintReport = {
    ...emptyLint,
    findings: [
      { check: "orphans", severity: "warning", details: [{ basename: "stray.md", bytes: 100 }] },
    ],
  };
  const plan = planPrune(audit, lint, {
    include: { orphans: true, brokenPointers: false },
    exclude: new Set(),
  });
  assert.deepEqual(
    plan.map((p) => p.basename + ":" + p.reason),
    ["stray.md:orphan"],
  );
});

test("planPrune --include broken-pointers adds broken pointers without errored reads", () => {
  const audit = baseReport;
  const lint: LintReport = {
    ...emptyLint,
    findings: [
      {
        check: "broken-pointers",
        severity: "error",
        details: [{ line: 9, title: "X", target: "stale.md" }],
      },
    ],
  };
  const plan = planPrune(audit, lint, {
    include: { orphans: false, brokenPointers: true },
    exclude: new Set(),
  });
  assert.deepEqual(
    plan.map((p) => p.basename + ":" + p.reason),
    ["stale.md:broken-pointer"],
  );
  assert.equal(plan[0]!.pointerLine, 9);
});

test("planPrune respects --exclude", () => {
  const audit: AuditReport = {
    ...baseReport,
    rows: [row("d1.md", "dead", 5), row("d2.md", "dead", 6)],
  };
  const plan = planPrune(audit, emptyLint, {
    include: { orphans: false, brokenPointers: false },
    exclude: new Set(["d1.md"]),
  });
  assert.deepEqual(plan.map((p) => p.basename), ["d2.md"]);
});
```

- [ ] **Step 2: Verify failure**

```sh
npm test --workspace=memory-graveyard 2>&1 | tail -10
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/prune.ts` (plan only — apply comes in Task 16)**

```ts
import type {
  AuditReport,
  LintReport,
  PrunePlanItem,
} from "./types.js";

interface PlanFlags {
  include: { orphans: boolean; brokenPointers: boolean };
  exclude: Set<string>;
}

export function planPrune(audit: AuditReport, lint: LintReport, flags: PlanFlags): PrunePlanItem[] {
  const plan: PrunePlanItem[] = [];
  for (const r of audit.rows) {
    if (r.bucket === "dead") {
      plan.push({
        basename: r.basename,
        reason: "dead",
        pointerLine: r.pointer?.line ?? null,
        fileExists: r.fileExists,
      });
    } else if (r.bucket === "hallucinated") {
      plan.push({
        basename: r.basename,
        reason: "hallucinated",
        pointerLine: r.pointer?.line ?? null,
        fileExists: false,
      });
    }
  }
  if (flags.include.orphans) {
    const orph = lint.findings.find((f) => f.check === "orphans");
    if (orph) {
      const list = orph.details as { basename: string; bytes: number }[];
      for (const o of list) plan.push({ basename: o.basename, reason: "orphan", pointerLine: null, fileExists: true });
    }
  }
  if (flags.include.brokenPointers) {
    const bp = lint.findings.find((f) => f.check === "broken-pointers");
    if (bp) {
      const list = bp.details as { line: number; title: string; target: string }[];
      const audited = new Set(audit.rows.filter((r) => r.bucket === "hallucinated").map((r) => r.basename));
      for (const x of list) {
        if (audited.has(x.target)) continue; // already in plan as hallucinated
        plan.push({ basename: x.target, reason: "broken-pointer", pointerLine: x.line, fileExists: false });
      }
    }
  }
  return plan.filter((p) => !flags.exclude.has(p.basename));
}
```

- [ ] **Step 4: Verify pass**

```sh
npm test --workspace=memory-graveyard
```

Expected: 4 prune-plan tests pass.

- [ ] **Step 5: Commit**

```sh
git add packages/memory-graveyard/src/prune.ts packages/memory-graveyard/src/prune.test.ts
git commit -m "feat(memory-graveyard): prune plan computation"
```

---

## Task 16: Implement `prune --apply` with snapshot backup

The destructive path. Writes a timestamped snapshot in `<memoryDir>/.graveyard-backup/`, applies edits to `MEMORY.md`, deletes flagged entry files. Idempotent — re-running on a partially-applied state is a no-op for already-removed lines.

**Files:**
- Modify: `packages/memory-graveyard/src/prune.ts`
- Modify: `packages/memory-graveyard/src/prune.test.ts`

- [ ] **Step 1: Append failing test**

```ts
import { mkdtemp, mkdir, writeFile, readFile, readdir, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { applyPrune } from "./prune.js";
// (re-uses imports already present at top — duplicates are fine in tests)

test("applyPrune snapshots, edits MEMORY.md, deletes files", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "mg-apply-"));
  try {
    await writeFile(
      join(tmp, "MEMORY.md"),
      `# x\n\n- [Keep](keep.md) — yes\n- [Drop](drop.md) — no\n- [Ghost](ghost.md) — gone\n`,
    );
    await writeFile(join(tmp, "keep.md"), "keep");
    await writeFile(join(tmp, "drop.md"), "drop");
    // ghost.md doesn't exist

    const result = await applyPrune(tmp, [
      { basename: "drop.md", reason: "dead", pointerLine: 4, fileExists: true },
      { basename: "ghost.md", reason: "hallucinated", pointerLine: 5, fileExists: false },
    ]);

    assert.equal(result.deleted.length, 1);
    assert.deepEqual(result.deleted, ["drop.md"]);
    assert.equal(result.removedPointerLines.length, 2);
    assert.equal(existsSync(join(tmp, "drop.md")), false);

    const after = await readFile(join(tmp, "MEMORY.md"), "utf8");
    assert.match(after, /\[Keep\]/);
    assert.doesNotMatch(after, /\[Drop\]/);
    assert.doesNotMatch(after, /\[Ghost\]/);

    const backupRoot = join(tmp, ".graveyard-backup");
    const backups = await readdir(backupRoot);
    assert.equal(backups.length, 1);
    const backupDir = join(backupRoot, backups[0]!);
    assert.ok(existsSync(join(backupDir, "MEMORY.md")));
    assert.ok(existsSync(join(backupDir, "drop.md")));
    assert.ok(existsSync(join(backupDir, "manifest.json")));
    const manifest = JSON.parse(await readFile(join(backupDir, "manifest.json"), "utf8"));
    assert.equal(manifest.deletedFiles.length, 1);
    assert.equal(manifest.removedPointerLines.length, 2);

    const dirStat = await stat(backupDir);
    assert.equal((dirStat.mode & 0o777).toString(8), "700");
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("applyPrune is idempotent on already-removed pointer lines", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "mg-apply-idem-"));
  try {
    await writeFile(join(tmp, "MEMORY.md"), `# x\n\n- [Keep](keep.md) — yes\n`);
    await writeFile(join(tmp, "keep.md"), "k");
    const result = await applyPrune(tmp, [
      { basename: "missing.md", reason: "hallucinated", pointerLine: 99, fileExists: false },
    ]);
    assert.equal(result.deleted.length, 0);
    assert.equal(result.removedPointerLines.length, 0);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Verify failure**

```sh
npm test --workspace=memory-graveyard 2>&1 | tail -10
```

Expected: FAIL — `applyPrune` not exported.

- [ ] **Step 3: Implement `applyPrune` in `prune.ts`**

Add imports at top:

```ts
import { mkdir, writeFile, readFile, copyFile, unlink, chmod } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { parseMemoryIndex } from "./index_parser.js";
```

Append to the file:

```ts
export interface ApplyResult {
  deleted: string[];
  failed: { basename: string; error: string }[];
  removedPointerLines: number[];
  backupDir: string;
}

export async function applyPrune(
  memoryDir: string,
  plan: PrunePlanItem[],
): Promise<ApplyResult> {
  const memoryMdPath = join(memoryDir, "MEMORY.md");
  const indexContent = existsSync(memoryMdPath) ? await readFile(memoryMdPath, "utf8") : "";
  const pointers = parseMemoryIndex(indexContent, Number.POSITIVE_INFINITY);
  const planTargets = new Set(plan.map((p) => p.basename));
  const linesToRemove = new Set(
    pointers.filter((p) => planTargets.has(p.target)).map((p) => p.line),
  );

  // 1. Snapshot
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = join(memoryDir, ".graveyard-backup", ts);
  await mkdir(backupDir, { recursive: true });
  await chmod(backupDir, 0o700);
  if (indexContent) {
    await writeFile(join(backupDir, "MEMORY.md"), indexContent, { mode: 0o600 });
  }
  const filesToDelete: string[] = [];
  for (const item of plan) {
    if (!item.fileExists) continue;
    const src = join(memoryDir, item.basename);
    if (!existsSync(src)) continue;
    await copyFile(src, join(backupDir, item.basename));
    await chmod(join(backupDir, item.basename), 0o600);
    filesToDelete.push(item.basename);
  }

  // 2. MEMORY.md edits
  const removedLines: number[] = [];
  if (linesToRemove.size > 0 && indexContent) {
    const lines = indexContent.split("\n");
    const filtered = lines.filter((_, i) => {
      const lineNum = i + 1;
      if (linesToRemove.has(lineNum)) {
        removedLines.push(lineNum);
        return false;
      }
      return true;
    });
    await writeFile(memoryMdPath, filtered.join("\n"));
  }

  // 3. Delete entry files
  const deleted: string[] = [];
  const failed: { basename: string; error: string }[] = [];
  for (const basename of filesToDelete) {
    try {
      await unlink(join(memoryDir, basename));
      deleted.push(basename);
    } catch (e) {
      failed.push({ basename, error: e instanceof Error ? e.message : String(e) });
    }
  }

  // 4. Manifest
  const manifest = {
    removedAt: new Date().toISOString(),
    memoryDir,
    deletedFiles: deleted,
    removedPointerLines: pointers
      .filter((p) => removedLines.includes(p.line))
      .map((p) => ({ line: p.line, title: p.title, target: p.target })),
    failed,
    restoreHint: `cp -i ${backupDir}/MEMORY.md ${memoryMdPath} && cp -i ${backupDir}/*.md ${memoryDir}/`,
  };
  await writeFile(join(backupDir, "manifest.json"), JSON.stringify(manifest, null, 2), { mode: 0o600 });

  return { deleted, failed, removedPointerLines: removedLines, backupDir };
}
```

- [ ] **Step 4: Verify pass**

```sh
npm test --workspace=memory-graveyard
```

Expected: both new tests pass; existing tests still pass.

- [ ] **Step 5: Commit**

```sh
git add packages/memory-graveyard/src/prune.ts packages/memory-graveyard/src/prune.test.ts
git commit -m "feat(memory-graveyard): prune --apply with snapshot backup"
```

---

## Task 17: Wire `prune` to format/CLI

Adds `formatPruneReport` printing the plan + post-apply summary, and routes the `prune` subcommand.

**Files:**
- Modify: `packages/memory-graveyard/src/format.ts`
- Modify: `packages/memory-graveyard/src/cli.ts`

- [ ] **Step 1: Add prune formatter**

Append to `format.ts`:

```ts
import type { PrunePlanItem } from "./types.js";
import type { ApplyResult } from "./prune.js";

export function formatPruneReport(plan: PrunePlanItem[], opts: { apply: boolean }): string {
  if (plan.length === 0) {
    return "memory-graveyard prune — nothing to do.";
  }
  const lines: string[] = [];
  const fileCount = plan.filter((p) => p.fileExists).length;
  const pointerCount = plan.filter((p) => p.pointerLine !== null).length;
  lines.push("memory-graveyard prune — plan");
  lines.push(`  ${fileCount} entry files to delete`);
  lines.push(`  ${pointerCount} pointer lines to remove`);
  lines.push("");
  for (const item of plan) {
    lines.push(`  [${item.reason.padEnd(16)}] ${item.basename}${item.pointerLine ? `  (line ${item.pointerLine})` : ""}`);
  }
  if (!opts.apply) {
    lines.push("");
    lines.push("re-run with --apply to execute (backup is automatic)");
  }
  return lines.join("\n");
}

export function formatApplyResult(result: ApplyResult): string {
  const lines: string[] = [];
  lines.push(`backup: ${result.backupDir}`);
  lines.push(`deleted: ${result.deleted.length} files`);
  lines.push(`pointer lines removed: ${result.removedPointerLines.length}`);
  if (result.failed.length > 0) {
    lines.push("failed:");
    for (const f of result.failed) lines.push(`  ${f.basename}: ${f.error}`);
  }
  return lines.join("\n");
}
```

- [ ] **Step 2: Wire `prune` into `cli.ts`**

Add to imports at the top:

```ts
import { planPrune, applyPrune } from "./prune.js";
import { formatPruneReport, formatApplyResult } from "./format.js";
```

Insert the prune branch above the trailing `die(...)`, before any later subcommand routing:

```ts
  if (args.subcommand === "prune") {
    const audit = await runAudit({
      claudeDir: args.claudeDir,
      windowDays: args.days,
      projectKey: args.project,
    });
    const lint = await runLint({
      claudeDir: args.claudeDir,
      projectKey: args.project,
      truncationCutoff: args.truncationCutoff,
      staleDays: args.staleDays,
    });
    const plan = planPrune(audit, lint, { include: args.include, exclude: args.exclude });
    if (args.json) {
      console.log(JSON.stringify({ plan, applied: args.apply }, null, 2));
    } else {
      console.log(formatPruneReport(plan, { apply: args.apply }));
    }
    if (!args.apply) return;
    const result = await applyPrune(audit.memoryDir, plan);
    if (!args.json) console.log(formatApplyResult(result));
    if (result.failed.length > 0) process.exit(1);
    return;
  }
```

- [ ] **Step 3: Build, dry-run smoke test**

```sh
npm run build --workspace=memory-graveyard
node packages/memory-graveyard/dist/cli.js prune
```

Expected: human plan output (no `--apply` → no fs writes).

- [ ] **Step 4: Tests + typecheck**

```sh
npm run typecheck --workspace=memory-graveyard
npm test --workspace=memory-graveyard
```

Expected: pass.

- [ ] **Step 5: Commit**

```sh
git add packages/memory-graveyard/src/format.ts packages/memory-graveyard/src/cli.ts
git commit -m "feat(memory-graveyard): wire prune subcommand to CLI"
```

---

## Task 18: Implement `projects` cross-project sweep

Walks `~/.claude/projects/*/memory/` and produces `ProjectMemorySummary[]`. Uses `discoverMemoryDirs` from core (Task 2).

**Files:**
- Create: `packages/memory-graveyard/src/projects.test.ts`
- Create: `packages/memory-graveyard/src/projects.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, utimes, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runProjects } from "./projects.js";

test("runProjects emits one summary per memory dir, marks cold ones", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "mg-proj-"));
  try {
    const projectsDir = join(tmp, "claude", "projects");
    const fresh = join(projectsDir, "-fresh", "memory");
    const cold = join(projectsDir, "-cold", "memory");
    await mkdir(fresh, { recursive: true });
    await mkdir(cold, { recursive: true });
    await writeFile(join(fresh, "MEMORY.md"), "# x\n");
    await writeFile(join(fresh, "a.md"), "body");
    await writeFile(join(cold, "MEMORY.md"), "# x\n");
    await writeFile(join(cold, "b.md"), "body");
    const oldDate = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000);
    await utimes(join(cold, "MEMORY.md"), oldDate, oldDate);
    await utimes(join(cold, "b.md"), oldDate, oldDate);

    const stats = await runProjects({ claudeDir: join(tmp, "claude"), windowDays: 30, coldDays: 90 });
    const byKey = new Map(stats.map((s) => [s.projectKey, s]));
    assert.equal(byKey.get("-cold")!.cold, true);
    assert.equal(byKey.get("-fresh")!.cold, false);
    assert.equal(byKey.get("-cold")!.entryCount, 1);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Verify failure**

```sh
npm test --workspace=memory-graveyard 2>&1 | tail -10
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/projects.ts`**

```ts
import { stat } from "node:fs/promises";
import { discoverMemoryDirs, resolveClaudePaths, findSessionFiles } from "@skill-graveyard/core";
import { scanEntryFiles } from "./entry_scanner.js";
import { parseMemorySession } from "./memory_parser.js";
import type { ProjectMemorySummary } from "./types.js";

export interface ProjectsOptions {
  claudeDir?: string;
  windowDays: number;
  coldDays: number;
}

export async function runProjects(opts: ProjectsOptions): Promise<ProjectMemorySummary[]> {
  const paths = resolveClaudePaths(opts.claudeDir);
  const dirs = await discoverMemoryDirs(paths.projectsDir);
  const since = Date.now() - opts.windowDays * 24 * 60 * 60 * 1000;
  const sessionFiles = await findSessionFiles(paths.projectsDir, since);
  const sessionsByKey = new Map<string, typeof sessionFiles>();
  for (const sf of sessionFiles) {
    if (!sessionsByKey.has(sf.projectKey)) sessionsByKey.set(sf.projectKey, []);
    sessionsByKey.get(sf.projectKey)!.push(sf);
  }
  const summaries: ProjectMemorySummary[] = [];
  for (const { projectKey, memoryDir } of dirs) {
    const entries = await scanEntryFiles(memoryDir);
    let lastTouchedAt: string | null = null;
    let totalBytes = 0;
    for (const e of entries) {
      totalBytes += e.bytes;
      if (!lastTouchedAt || e.mtime > lastTouchedAt) lastTouchedAt = e.mtime;
    }
    try {
      const memoryMdStat = await stat(`${memoryDir}/MEMORY.md`);
      const iso = new Date(memoryMdStat.mtimeMs).toISOString();
      if (!lastTouchedAt || iso > lastTouchedAt) lastTouchedAt = iso;
    } catch {
      // no MEMORY.md — fine
    }
    let lastReadAt: string | null = null;
    const projSessions = sessionsByKey.get(projectKey) ?? [];
    for (const sf of projSessions) {
      const reads = await parseMemorySession(sf.filepath, sf.projectKey, memoryDir);
      for (const r of reads) {
        if (r.timestamp && (!lastReadAt || r.timestamp > lastReadAt)) lastReadAt = r.timestamp;
      }
    }
    const touchedMs = lastTouchedAt ? Date.parse(lastTouchedAt) : 0;
    const daysSinceTouch = touchedMs ? Math.floor((Date.now() - touchedMs) / (24 * 60 * 60 * 1000)) : Infinity;
    summaries.push({
      projectKey,
      cwd: decodeProjectKey(projectKey),
      memoryDir,
      entryCount: entries.length,
      totalBytes,
      lastReadAt,
      lastTouchedAt,
      daysSinceTouch,
      cold: daysSinceTouch >= opts.coldDays,
    });
  }
  summaries.sort((a, b) => a.daysSinceTouch - b.daysSinceTouch);
  return summaries;
}

function decodeProjectKey(key: string): string | null {
  // Reverse of cwd.replace(/\//g, "-"). Lossy for paths containing literal "-",
  // so we return null when the result doesn't look like an absolute path.
  if (!key.startsWith("-")) return null;
  return key.replace(/-/g, "/");
}
```

- [ ] **Step 4: Verify pass**

```sh
npm test --workspace=memory-graveyard
```

Expected: pass.

- [ ] **Step 5: Commit**

```sh
git add packages/memory-graveyard/src/projects.ts packages/memory-graveyard/src/projects.test.ts
git commit -m "feat(memory-graveyard): cross-project sweep"
```

---

## Task 19: Wire `projects` to format/CLI

**Files:**
- Modify: `packages/memory-graveyard/src/format.ts`
- Modify: `packages/memory-graveyard/src/cli.ts`

- [ ] **Step 1: Add formatter**

Append to `format.ts`:

```ts
import type { ProjectMemorySummary } from "./types.js";

export function formatProjectsReport(stats: ProjectMemorySummary[], _opts: FormatOptions): string {
  if (stats.length === 0) return "No memory dirs found across projects.";
  const lines: string[] = [];
  for (const s of stats) {
    const cold = s.cold ? " ✗ COLD" : "";
    const cwdDisplay = s.cwd ?? s.projectKey;
    const last = s.lastTouchedAt ? s.lastTouchedAt.slice(0, 10) : "—";
    lines.push(
      `${pad(cwdDisplay, 50)} ${s.entryCount} entries · ${formatBytes(s.totalBytes)} · last touched ${last}  (${s.daysSinceTouch}d)${cold}`,
    );
  }
  return lines.join("\n");
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
```

- [ ] **Step 2: Wire CLI**

Add imports at top:

```ts
import { runProjects } from "./projects.js";
import { formatProjectsReport } from "./format.js";
```

Insert before the trailing `die(...)`:

```ts
  if (args.subcommand === "projects") {
    const stats = await runProjects({
      claudeDir: args.claudeDir,
      windowDays: args.days,
      coldDays: args.coldDays,
    });
    if (args.json) {
      console.log(JSON.stringify(stats, null, 2));
    } else {
      console.log(formatProjectsReport(stats, { color: process.stdout.isTTY ?? false }));
    }
    return;
  }
```

- [ ] **Step 3: Build, smoke test**

```sh
npm run build --workspace=memory-graveyard
node packages/memory-graveyard/dist/cli.js projects | head -10
```

Expected: list of projects sorted by `daysSinceTouch` ascending, with cold ones marked.

- [ ] **Step 4: Tests + typecheck**

```sh
npm run typecheck --workspace=memory-graveyard
npm test --workspace=memory-graveyard
```

Expected: pass.

- [ ] **Step 5: Commit**

```sh
git add packages/memory-graveyard/src/format.ts packages/memory-graveyard/src/cli.ts
git commit -m "feat(memory-graveyard): wire projects subcommand to CLI"
```

---

## Task 20: Write `packages/memory-graveyard/README.md`

Full package README, mirrors `packages/mcp-graveyard/README.md` style. Replaces the placeholder from Task 3.

**Files:**
- Modify: `packages/memory-graveyard/README.md`

- [ ] **Step 1: Read mcp-graveyard's README for tone**

```sh
cat packages/mcp-graveyard/README.md | head -80
```

This is reference, no edits.

- [ ] **Step 2: Overwrite `packages/memory-graveyard/README.md`**

```markdown
# memory-graveyard

Audit which entries in your project's `MEMORY.md` Claude actually reads. Surfaces dead memory entries, broken pointers, and (uniquely) entries that fall below the system-prompt truncation cutoff and are invisible to Claude.

```sh
npx memory-graveyard@latest             # audit current project's memory
npx memory-graveyard@latest lint        # static checks on MEMORY.md
npx memory-graveyard@latest prune       # plan removal of dead entries
npx memory-graveyard@latest projects    # cross-project sweep — find cold memory dirs
```

All analysis is local; reads `~/.claude/projects/<project>/memory/` and the per-project session JSONL logs. No network calls.

## What it surfaces

Memory entries from `MEMORY.md` are sorted into four buckets:

1. **Active** — file exists, indexed in `MEMORY.md`, Read at least once in the window.
2. **Dead** — file exists, indexed, zero successful Reads. Removal candidate.
3. **Missing** — file exists, NOT in `MEMORY.md`, but Claude found it anyway. Re-index candidate.
4. **Hallucinated** — pointer in `MEMORY.md` ⇒ file does not exist; Claude tried to follow and got an error. Broken pointer with confirmed cost.

Static-only issues (broken pointers never followed, orphan files never read, truncation-budget overflow) are surfaced by `lint`.

## Subcommands

- **`audit`** (default) — bucket table for the current project. `--days N`, `--only <bucket>`, `--json`, `--project <path>`, `--claude-dir <path>`.
- **`lint`** — five static checks on `MEMORY.md` and the memory dir:
  1. Broken pointers (entries referenced but missing on disk).
  2. Orphan files (on disk but not in `MEMORY.md`).
  3. **Truncation budget** — how many entries fall below the configured cutoff (default 200 lines) and are therefore invisible in the system prompt.
  4. Index size (token count, with the same `cl100k_base` 5–15% drift disclaimer as `skill-graveyard cost`).
  5. Stale dated entries — `type: project` entries whose newest absolute date is older than `--stale-days` (default 30).
  Exit code 1 on any error/warning, 0 otherwise.
- **`prune`** — print a removal plan for `dead` entries and `hallucinated` pointers. `--apply` executes (with automatic snapshot backup in `.graveyard-backup/<timestamp>/`). `--include orphans|broken-pointers` opts in additional groups.
- **`projects`** — sweep all `~/.claude/projects/*/memory/` and surface cold memory dirs (`--cold-days N`).

## Why a tool

`MEMORY.md` is auto-loaded into the system prompt at session start. Above the line-cutoff, every entry costs tokens; below, it's invisible to Claude. Both are wasted budget. The tool surfaces both at once.

## Companion tools

- [`skill-graveyard`](https://www.npmjs.com/package/skill-graveyard) — same pattern for installed skills.
- [`mcp-graveyard`](https://www.npmjs.com/package/mcp-graveyard) — same pattern for MCP servers.

## License

MIT
```

- [ ] **Step 3: Verify in npm pack contents**

```sh
npm run build --workspace=memory-graveyard
npm pack --workspace=memory-graveyard --dry-run 2>&1 | grep -E "README|LICENSE|cli\.js" | head
```

Expected: `README.md`, `LICENSE` (if it exists at package root — copy if missing), `dist/cli.js` listed. If `LICENSE` is not present, copy from repo root: `cp LICENSE packages/memory-graveyard/LICENSE`.

- [ ] **Step 4: Commit**

```sh
git add packages/memory-graveyard/README.md packages/memory-graveyard/LICENSE
git commit -m "docs(memory-graveyard): full package README"
```

---

## Task 21: Create `skills/memory-graveyard/SKILL.md`

skills.sh manifest. Mirror `skills/mcp-graveyard/SKILL.md`.

**Files:**
- Create: `skills/memory-graveyard/SKILL.md`

- [ ] **Step 1: Write the SKILL.md**

```markdown
---
name: memory-graveyard
description: Audit which entries in your project's MEMORY.md Claude actually reads. Use when the user wants to find dead memory entries, broken pointers in MEMORY.md, orphan memory files, or surface entries that fall below the system-prompt truncation cutoff. Triggers on "audit MEMORY.md", "dead memory entries", "broken memory pointers", "memory hygiene", "unused memory", "memory truncation". Runs locally; reads ~/.claude/projects session JSONL logs and memory directories. No network calls.
---

# memory-graveyard

CLI that audits per-project file-based memory (`MEMORY.md` index + `memory/*.md` entries). Bucketed audit (ACTIVE / DEAD / MISSING / HALLUCINATED) plus a static linter that flags broken pointers, orphan files, truncation-budget overflow, index size, and stale dated entries.

## How to invoke

Run via `npx memory-graveyard@latest <subcommand> [flags]` — no install needed.

## Subcommands

- `audit` (default) — 4-bucket per-project table. Flags: `--days N`, `--only <bucket>`, `--json`, `--project <path>`, `--claude-dir <path>`.
- `lint` — static checks on `MEMORY.md` and the memory dir. Flags: `--truncation-cutoff N` (default 200), `--stale-days N` (default 30), `--json`. Exit 1 on findings.
- `prune` — plan removal of dead entries and hallucinated pointers. `--apply` to execute (with snapshot backup in `.graveyard-backup/<timestamp>/`). `--include orphans|broken-pointers`, `--exclude <basename>`.
- `projects` — cross-project sweep, surfaces cold memory dirs. `--cold-days N` (default 90).

## Decision flow

- "what entries in my MEMORY.md are dead?" → `npx memory-graveyard@latest`
- "is anything in MEMORY.md broken?" → `npx memory-graveyard@latest lint`
- "clean up MEMORY.md" → `prune`, then `--apply`
- "which projects have stale memory dirs?" → `projects`

After running, print output verbatim. Do not summarize unless the user asks.
```

- [ ] **Step 2: Commit**

```sh
git add skills/memory-graveyard/SKILL.md
git commit -m "docs: skills.sh manifest for memory-graveyard"
```

---

## Task 22: Update root `README.md` and sister-package READMEs

Add a memory-graveyard companion section after mcp-graveyard's, and add a one-line cross-link in skill-graveyard / mcp-graveyard READMEs.

**Files:**
- Modify: `README.md`
- Modify: `packages/skill-graveyard/README.md`
- Modify: `packages/mcp-graveyard/README.md`

- [ ] **Step 1: Read existing companion section in root README**

```sh
grep -n -B1 -A20 "mcp-graveyard" README.md | head -40
```

Note the section delimiter style used (heading level, opening sentence pattern, code block style). The new section copies the same shape.

- [ ] **Step 2: Insert memory-graveyard companion section**

Find the closing line of the mcp-graveyard section in `README.md`. Immediately after it, add:

```markdown
## Companion: memory-graveyard

Same four-bucket model (active / dead / missing / hallucinated), applied to per-project file-based memory: the `MEMORY.md` index + `memory/*.md` entries that auto-load into the system prompt at session start.

```sh
npx memory-graveyard@latest             # audit current project's memory
npx memory-graveyard@latest lint        # static checks (broken pointers, orphans,
                                        #  truncation budget, index size, stale dates)
npx memory-graveyard@latest prune       # plan removal; --apply executes with snapshot
npx memory-graveyard@latest projects    # cross-project sweep — find cold memory dirs
```

Sample CLI output (anonymized — `clientco/web-platform` stands in for a real project):

```
memory-graveyard — 30 days · 14 entries indexed · 16 on disk · 53 reads · 47 succeeded · 6 errored

ACTIVE (4)
  entry                            reads   errors   last         line
  feedback_release_flow.md         18      0        2026-05-02   12
  ...

DEAD (8) — candidates for removal
  ...

HALLUCINATED (2)
  ...

→ run: memory-graveyard prune  to clear DEAD entries and broken pointers
```

`lint` is the unique-to-memory check: it surfaces entries below the system-prompt truncation cutoff (default 200 lines) — the entries Claude can't see until you ask for them by name. All analysis is local; no network calls.
```

- [ ] **Step 3: Add cross-link to skill-graveyard README**

In `packages/skill-graveyard/README.md`, find the existing "Companion: mcp-graveyard" section (or similar). Add immediately below it:

```markdown
## Companion: memory-graveyard

Same dual-signal pattern, applied to per-project `MEMORY.md` entries. See [`memory-graveyard`](https://www.npmjs.com/package/memory-graveyard).
```

- [ ] **Step 4: Add cross-link to mcp-graveyard README**

In `packages/mcp-graveyard/README.md`, find the bottom section listing companions. Add a `memory-graveyard` bullet:

```markdown
- [`memory-graveyard`](https://www.npmjs.com/package/memory-graveyard) — same pattern for per-project `MEMORY.md` entries.
```

If no companions section exists yet, append a new H2 `## Companion tools` and start the bullet list with both `skill-graveyard` and `memory-graveyard`.

- [ ] **Step 5: Commit**

```sh
git add README.md packages/skill-graveyard/README.md packages/mcp-graveyard/README.md
git commit -m "docs: add memory-graveyard companion sections to all READMEs"
```

---

## Task 23: Update `CLAUDE.md`

Three load-bearing edits documented in the spec's "Documentation touch list".

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update Layout section**

In `CLAUDE.md` Layout section (the bulleted list of `packages/...`), insert after the `packages/mcp-graveyard/` line:

```markdown
- `packages/memory-graveyard/` — published as `memory-graveyard`. CLI auditing per-project `MEMORY.md` index + `memory/*.md` entries. v1 surface: `audit`, `lint`, `prune`, `projects`. Same monorepo conventions; no plugin distribution.
```

In the `skills/...` paragraph (where the existing two `SKILL.md` files are listed), append `, skills/memory-graveyard/SKILL.md`.

- [ ] **Step 2: Add Intentional Non-Features entry**

Find the "Intentional non-features" subheading (under Development). Append a new bullet at the end of the list:

```markdown
- **`prune --apply` semantics differ across the three CLIs by design.** `mcp-graveyard prune --apply` and `memory-graveyard prune --apply` both execute (with backups), because they operate on files we own. `skill-graveyard prune` only prints removal commands — disabling installed skills/plugins requires invoking Claude Code's runtime (`claude /plugin remove`), which is fragile from outside CC. Don't "fix" this divergence to match — the asymmetry is the right answer.
```

- [ ] **Step 3: Update Release section CI matrix line**

In the Release → CI subsection, find the line describing the matrix (currently "6-cell matrix: `{@skill-graveyard/core, skill-graveyard, mcp-graveyard} × {Node 20, Node 22}`"). Replace with:

```markdown
`.github/workflows/ci.yml` runs `typecheck`, `test`, `build` per workspace via an 8-cell matrix: `{@skill-graveyard/core, skill-graveyard, mcp-graveyard, memory-graveyard} × {Node 20, Node 22}`. **`fail-fast: false`** — one cell's failure does not cancel the others. Before any CLI's typecheck/test/build runs, a conditional step builds `@skill-graveyard/core` first (the CLIs import types from `packages/core/dist/`).
```

- [ ] **Step 4: Verify CLAUDE.md still reads coherently**

```sh
grep -n "memory-graveyard" CLAUDE.md
```

Expected: at least three matches (Layout entry, intentional-non-features entry, CI matrix line).

- [ ] **Step 5: Commit**

```sh
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for memory-graveyard package"
```

---

## Task 24: Register memory-graveyard with release-please

Adds the package to `release-please-config.json`, `.release-please-manifest.json`, and the `release-please.yml` workflow's outputs/publish steps.

**Files:**
- Modify: `release-please-config.json`
- Modify: `.release-please-manifest.json`
- Modify: `.github/workflows/release-please.yml`

- [ ] **Step 1: Add `release-please-config.json` entry**

In the `packages` object, after the `packages/mcp-graveyard` entry, add:

```json
    "packages/memory-graveyard": {
      "package-name": "memory-graveyard",
      "component": "memory-graveyard"
    }
```

(remember to add the comma after the previous block)

- [ ] **Step 2: Add `.release-please-manifest.json` entry**

Append to the JSON object:

```json
  "packages/memory-graveyard": "0.1.0"
```

(again, add the comma after the previous entry)

- [ ] **Step 3: Add output line + publish step in workflow**

In `.github/workflows/release-please.yml`, add to the `outputs:` block:

```yaml
      memory_released: ${{ steps.release.outputs['packages/memory-graveyard--release_created'] }}
```

In the `publish` job, after the existing `Publish mcp-graveyard` step, add:

```yaml
      - name: Publish memory-graveyard
        if: needs.release-please.outputs.memory_released == 'true'
        run: npm publish --workspace=memory-graveyard --provenance
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

- [ ] **Step 4: Validate JSON**

```sh
node -e "JSON.parse(require('fs').readFileSync('release-please-config.json', 'utf8'))"
node -e "JSON.parse(require('fs').readFileSync('.release-please-manifest.json', 'utf8'))"
```

Expected: both run without errors. (No output is fine — a syntax error would throw.)

- [ ] **Step 5: Commit**

```sh
git add release-please-config.json .release-please-manifest.json .github/workflows/release-please.yml
git commit -m "ci: register memory-graveyard with release-please"
```

---

## Task 25: Extend CI matrix

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Add memory-graveyard to the matrix**

Locate the `matrix:` block. Update the `package:` array to:

```yaml
        package: ["@skill-graveyard/core", "skill-graveyard", "mcp-graveyard", "memory-graveyard"]
```

Verify the existing conditional step that builds `@skill-graveyard/core` before non-core packages still applies. The condition is typically `if: matrix.package != '@skill-graveyard/core'`. If it lists packages explicitly (e.g. `if: matrix.package == 'skill-graveyard' || matrix.package == 'mcp-graveyard'`), extend to include `'memory-graveyard'`.

- [ ] **Step 2: Confirm locally**

```sh
grep -n "memory-graveyard" .github/workflows/ci.yml
```

Expected: at least one match (in the matrix package list).

- [ ] **Step 3: Commit**

```sh
git add .github/workflows/ci.yml
git commit -m "ci: add memory-graveyard to test matrix"
```

---

## Task 26: Update landing page `docs/index.html`

Add a memory-graveyard companion section in the same style as mcp-graveyard's section. Sample CLI output uses anonymized project names.

**Files:**
- Modify: `docs/index.html`

- [ ] **Step 1: Locate existing companion section**

```sh
grep -n -i "mcp-graveyard" docs/index.html | head
```

Note the section markup used: heading tag, surrounding `<section>` or `<div>`, code-block style.

- [ ] **Step 2: Duplicate the structure for memory-graveyard**

Below the mcp-graveyard section, insert a parallel block. Adapt copy and code samples — preserve the same CSS classes, same heading hierarchy, same anchor-id convention (e.g. `id="memory-graveyard"`).

The intro copy:

> Same four-bucket model, applied to per-project file-based memory — the `MEMORY.md` index + `memory/*.md` entries that auto-load into Claude's system prompt. Surfaces dead entries, broken pointers, and (uniquely) entries below the truncation cutoff that Claude can't see until you ask for them.

Code sample (anonymized — use `clientco/web-platform` or similar in any sample paths/cwds):

```sh
npx memory-graveyard@latest             # audit current project's memory
npx memory-graveyard@latest lint        # static checks (broken pointers, orphans,
                                        #  truncation budget, index size, stale dates)
npx memory-graveyard@latest prune       # plan removal; --apply executes with snapshot
npx memory-graveyard@latest projects    # cross-project sweep
```

Sample audit output snippet (anonymized — see existing mcp-graveyard sample for tone):

```
memory-graveyard — 30 days · 14 entries indexed · 16 on disk · 53 reads · 47 succeeded · 6 errored

ACTIVE (4)
  entry                            reads   errors   last         line
  feedback_release_flow.md         18      0        2026-05-02   12
  project_clientco_platform.md      9      0        2026-05-01   10
  ...

DEAD (8) — candidates for removal
  ...

HALLUCINATED (2)
  feedback_doesnotexist.md          0      2       2026-04-15   34
  ...

→ run: memory-graveyard prune  to clear DEAD entries and broken pointers
```

If the page has a top-level nav listing the three companion tools, add `memory-graveyard` to it pointing at the new anchor.

- [ ] **Step 3: Local visual smoke test**

```sh
python3 -m http.server -d docs 8888 &
SERVER_PID=$!
sleep 1
curl -s http://localhost:8888/ | grep -c "memory-graveyard"
kill $SERVER_PID
```

Expected: count > 0 (memory-graveyard appears at least in the new section, ideally also in nav). No 404s.

- [ ] **Step 4: Commit**

```sh
git add docs/index.html
git commit -m "docs(site): add memory-graveyard companion section"
```

---

## Task 27: Final verification, build artifact check, and full-monorepo green light

Confirms the new package builds + tests cleanly alongside the existing three, and that nothing in the existing packages regressed.

**Files:** none modified.

- [ ] **Step 1: Clean install + full check across all four packages**

```sh
rm -rf node_modules packages/*/node_modules packages/*/dist
npm install
npm run build --workspace=@skill-graveyard/core
npm run typecheck
npm test
npm run build
```

Expected: typecheck clean, all tests pass (existing + the new memory-graveyard tests), all four packages build.

- [ ] **Step 2: Confirm the `bin` entry survives `npm pack`**

```sh
cd packages/memory-graveyard && npm pack --dry-run 2>&1 | grep "bin"; cd -
```

Expected: at least one mention of `bin` (or specifically `dist/cli.js` listed under bin / Tarball Contents). If `bin` is absent from the published manifest, the `./` prefix gotcha has snuck in — fix `package.json` and re-run.

- [ ] **Step 3: End-to-end smoke test on the live repo**

```sh
node packages/memory-graveyard/dist/cli.js --help
node packages/memory-graveyard/dist/cli.js audit --json | head -40
node packages/memory-graveyard/dist/cli.js lint
echo "lint exit=$?"
node packages/memory-graveyard/dist/cli.js prune
node packages/memory-graveyard/dist/cli.js projects | head
```

Expected: each command produces sensible output. `lint` exit code is 0 or 1 depending on the live state; both are valid. `prune` (no `--apply`) makes no fs changes — confirm with `git status`.

- [ ] **Step 4: Confirm clean working tree**

```sh
git status
```

Expected: nothing to commit. If anything appears, investigate before pushing — `prune` without `--apply` should never write files.

- [ ] **Step 5: Push to main**

Per CLAUDE.md, do not push automatically. Confirm with the user, then:

```sh
git log --oneline -20
git push
```

After push: release-please runs, opens a Release PR adding `memory-graveyard@0.1.0` (and bumping `@skill-graveyard/core` if Task 2 commit triggered it). Merging the Release PR triggers the publish job — which uses the workflow updates from Task 24 to publish memory-graveyard to npm.

---

## Self-review

(This is the last block of the plan, not a task. Reviewed by the plan author.)

**Spec coverage:**
- Architecture (pipeline, core reuse): Tasks 2, 7. ✓
- 4-bucket audit model: Tasks 8, 9. ✓
- All 5 lint checks (broken pointers, orphans, truncation, size, stale): Tasks 10–14. ✓
- prune plan + apply with snapshot: Tasks 15–17. ✓
- projects cross-project sweep: Tasks 18, 19. ✓
- Documentation (root README, package README, sister READMEs, CLAUDE.md, SKILL.md): Tasks 20–23. ✓
- Release-please + CI: Tasks 24, 25. ✓
- Landing page: Task 26. ✓
- "Intentional non-features" recorded: Task 23 step 2. ✓
- No Claude Code plugin (post-`b99926b`): no task introduces a `.claude-plugin/` — confirmed by absence. ✓

**Type consistency:**
- `Bucket = "active" | "dead" | "missing" | "hallucinated"` defined in Task 4, used in Tasks 8, 9, 14. ✓
- `MemoryRead`, `Pointer`, `EntryFile`, `EntryReport`, `LintReport`, `PrunePlanItem`, `ProjectMemorySummary` all defined Task 4, used consistently in subsequent tasks. ✓
- `runAudit`, `runLint`, `runProjects`, `planPrune`, `applyPrune` all defined and consumed with matching signatures. ✓

**Placeholder scan:** No `TBD`/`TODO`/"add appropriate error handling"/"similar to" in the plan body. Each task has actual code or actual diff instructions. ✓
