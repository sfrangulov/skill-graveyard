# Monorepo Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert `skill-graveyard` repo into an npm workspaces monorepo with a published `@skill-graveyard/core` package, preparing for a sister `mcp-graveyard` package. Ships `skill-graveyard@0.8.0` with **no user-visible behavior change**.

**Architecture:** Workspaces root holds `packages/core/` (shared parser, discovery, paths, tokenizer, known_tools — published) and `packages/skill-graveyard/` (existing CLI, refactored to import from core). The parser becomes generic so a future `mcp-graveyard` can reuse it without touching skill-specific code paths. **`format.ts` stays in `skill-graveyard`** — its current shape imports types from every subcommand (audit, prune, suggest, cost, outdated, projects), so moving it whole would create a circular dependency from core → skill-graveyard. Splitting out reusable terminal/color primitives is deferred to Plan B, where the actual second consumer (mcp-graveyard) will reveal what the shared subset really is. Plugin assets (`.claude-plugin/`, `commands/`) **stay at repo root** for this phase to avoid breaking marketplace installations; the dual-plugin layout is Plan B's job.

**Tech Stack:** Node ≥18, TypeScript 6 (strict + `noUncheckedIndexedAccess`), npm workspaces, tsx (dev runner), `node:test` (built-in), no new deps.

**Spec:** `docs/specs/2026-04-29-mcp-graveyard-design.md`. Read the "Architecture: monorepo" and "Testing, CI, release" sections.

---

## Task 1: Capture pre-migration baseline

Pure verification, zero changes. Confirms we know what "still works" means.

**Files:** none modified.

- [ ] **Step 1: Snapshot test count + build artifacts**

```sh
npm ci
npm run typecheck
npm test 2>&1 | tee /tmp/sg-baseline-tests.txt
npm run build
ls dist/
```

Expected: typecheck clean, all tests pass, `dist/cli.js`, `dist/audit.js`, etc. exist with `chmod +x` on `cli.js`. Note the test count from output (e.g. "# tests 47").

- [ ] **Step 2: Smoke-test the CLI**

```sh
node dist/cli.js --json --days 1 | head -c 200
```

Expected: a JSON snippet starting with `{"generatedAt":...`. No crash.

- [ ] **Step 3: No commit (baseline only)**

---

## Task 2: Bootstrap workspaces root

**Files:**
- Modify: `package.json`
- Create: `tsconfig.base.json`
- Create: `packages/.gitkeep`

- [ ] **Step 1: Replace root `package.json` with workspaces shell**

Read current `package.json`, then write:

```json
{
  "name": "skill-graveyard-monorepo",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "workspaces": [
    "packages/*"
  ],
  "engines": {
    "node": ">=18"
  },
  "scripts": {
    "typecheck": "npm run typecheck --workspaces --if-present",
    "test": "npm run test --workspaces --if-present",
    "build": "npm run build --workspaces --if-present"
  },
  "devDependencies": {
    "@types/node": "^24.12.2",
    "tsx": "^4.21.0",
    "typescript": "^6.0.3"
  }
}
```

The `repository`, `bugs`, `homepage`, `keywords`, `license`, `description`, runtime `dependencies`, `bin`, `files`, `prepublishOnly`, etc. all move to `packages/skill-graveyard/package.json` in Task 4.

- [ ] **Step 2: Create `tsconfig.base.json` at repo root**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "lib": ["ES2022"],
    "types": ["node"]
  }
}
```

The original root `tsconfig.json` is deleted in Task 4 once skill-graveyard's package-local tsconfig replaces it.

- [ ] **Step 3: Create empty `packages/` dir**

```sh
mkdir -p packages
touch packages/.gitkeep
```

- [ ] **Step 4: Run `npm install` to verify**

```sh
npm install
```

Expected: succeeds, creates `node_modules/` at root. No workspaces yet, so warns "no workspaces found" — that's fine, packages get added in Task 3.

- [ ] **Step 5: Commit**

```sh
git add package.json tsconfig.base.json packages/.gitkeep
git rm tsconfig.json   # original root tsconfig will be replaced by package-local in Task 4
git commit -m "monorepo: bootstrap workspaces root"
```

Note: `package-lock.json` will regenerate; commit it as part of this or the next task. Add it now if `git status` shows it dirty.

---

## Task 3: Move skill-graveyard sources into `packages/skill-graveyard/`

Pure file relocation. No content changes. After this task, the project is **broken** until Task 4 wires the package config — that's expected.

**Files:**
- Move: `src/` → `packages/skill-graveyard/src/`

- [ ] **Step 1: Create the package dir and move sources**

```sh
mkdir -p packages/skill-graveyard
git mv src packages/skill-graveyard/src
```

- [ ] **Step 2: Verify move by listing**

```sh
ls packages/skill-graveyard/src/
```

Expected: all original `*.ts` and `*.test.ts` present (`audit.ts`, `cache.ts`, `cli.ts`, `cost.ts`, `discovery.ts`, `fetcher.ts`, `format.ts`, `known_tools.ts`, `outdated.ts`, `parser.ts`, `paths.ts`, `projects.ts`, `prune.ts`, `source_resolver.ts`, `suggest.ts`, `tokenizer.ts`, plus colocated `*.test.ts`).

- [ ] **Step 3: Don't commit yet** — package is non-functional until Task 4. We commit Tasks 3+4 together to keep the working tree consistent at every commit boundary.

---

## Task 4: Configure skill-graveyard package

**Files:**
- Create: `packages/skill-graveyard/package.json`
- Create: `packages/skill-graveyard/tsconfig.json`

- [ ] **Step 1: Write `packages/skill-graveyard/package.json`**

This is the **publishable** manifest. All publish-relevant fields from the original root `package.json` move here, with paths re-anchored to the package root:

```json
{
  "name": "skill-graveyard",
  "version": "0.7.0",
  "description": "Audit which Claude Code skills you actually use — surface dead installs and hallucinated invocations from your session logs.",
  "type": "module",
  "bin": {
    "skill-graveyard": "dist/cli.js"
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
    "prepublishOnly": "npm -w skill-graveyard run typecheck && npm -w skill-graveyard run test && npm -w skill-graveyard run build",
    "typecheck": "tsc --noEmit",
    "test": "node --import tsx --test src/*.test.ts"
  },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/sfrangulov/skill-graveyard.git",
    "directory": "packages/skill-graveyard"
  },
  "bugs": {
    "url": "https://github.com/sfrangulov/skill-graveyard/issues"
  },
  "homepage": "https://sfrangulov.github.io/skill-graveyard/",
  "keywords": [
    "claude-code",
    "claude",
    "skills",
    "audit",
    "cli",
    "anthropic"
  ],
  "license": "MIT",
  "dependencies": {
    "gpt-tokenizer": "^3.4.0"
  }
}
```

Notes:
- `"version": "0.7.0"` — unchanged from current. Task 11 bumps to `0.8.0` after migration is verified.
- Plugin assets (`.claude-plugin`, `commands`) are **not** in `files` here because they still live at repo root in this phase. The current published tarball already includes them via the existing root `package.json`'s `files` field — but after migration, the root no longer publishes (it's `private: true`). So plugin assets need to be referenced from this package. **Resolution:** see Step 4 below — we keep a relative reference.

- [ ] **Step 2: Reference root-level plugin assets via `files` extras**

The `files` field accepts paths outside `cwd` only via symlinks or special handling. The cleanest fix is to **move plugin assets into the package now** (Plan A scope creep) — but that breaks marketplace path. The next-cleanest is to **list the assets explicitly with relative paths**:

Update the `files` field above to:

```json
"files": [
  "dist",
  "README.md",
  "LICENSE",
  "../../.claude-plugin",
  "../../commands"
]
```

⚠ **Verify with `npm pack --dry-run` before committing.** Older npm versions silently ignore parent-directory paths in `files`. If that happens (no `.claude-plugin/` or `commands/` in tarball listing), fall back to a `prepack` script that copies these into `packages/skill-graveyard/` before pack and removes them after:

```json
"scripts": {
  "prepack": "cp -r ../../.claude-plugin ../../commands .",
  "postpack": "rm -rf .claude-plugin commands"
}
```

(The decision between these two approaches gets recorded in this step's commit message based on `npm pack --dry-run` output.)

- [ ] **Step 3: Write `packages/skill-graveyard/tsconfig.json`**

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

This is the original root `tsconfig.json` with `extends` pointing at the new base.

- [ ] **Step 4: Re-install to register the workspace**

```sh
npm install
```

Expected: `node_modules/skill-graveyard` symlink to `packages/skill-graveyard/`.

- [ ] **Step 5: Run typecheck and tests in the new location**

```sh
npm run typecheck --workspace=skill-graveyard
npm test --workspace=skill-graveyard
```

Expected: typecheck clean. Test count matches the baseline from Task 1 Step 1.

- [ ] **Step 6: Run build, smoke-test the CLI**

```sh
npm run build --workspace=skill-graveyard
node packages/skill-graveyard/dist/cli.js --json --days 1 | head -c 200
```

Expected: same JSON snippet shape as Task 1 Step 2.

- [ ] **Step 7: Verify `npm pack --dry-run` includes plugin assets**

```sh
npm pack --workspace=skill-graveyard --dry-run 2>&1 | grep -E "(\.claude-plugin|commands)"
```

Expected: lines like `npm notice 644  .claude-plugin/plugin.json` and `npm notice 644  commands/audit-skills.md` appear. If absent, switch to the `prepack`/`postpack` approach from Step 2.

- [ ] **Step 8: Commit Tasks 3 + 4 together**

```sh
git add packages/skill-graveyard package-lock.json
git commit -m "monorepo: relocate skill-graveyard into packages/"
```

---

## Task 5: Create `@skill-graveyard/core` package skeleton

Empty package, ready to receive shared modules in Task 6. Must be installable + buildable + publishable as a no-op.

**Files:**
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/src/index.ts`

- [ ] **Step 1: Write `packages/core/package.json`**

```json
{
  "name": "@skill-graveyard/core",
  "version": "0.1.0",
  "description": "Internal building blocks for the skill-graveyard / mcp-graveyard CLIs. No semver-stability promise.",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "files": [
    "dist"
  ],
  "engines": {
    "node": ">=18"
  },
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit",
    "test": "node --import tsx --test src/*.test.ts"
  },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/sfrangulov/skill-graveyard.git",
    "directory": "packages/core"
  },
  "license": "MIT"
}
```

Note: no `dependencies` yet — `gpt-tokenizer` follows `tokenizer.ts` into core in Task 6 (and gets moved out of skill-graveyard's deps).

- [ ] **Step 2: Write `packages/core/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true
  },
  "include": ["src/**/*"],
  "exclude": ["src/**/*.test.ts", "node_modules", "dist"]
}
```

`declaration: true` because consumers (skill-graveyard, future mcp-graveyard) need types from the published JS.

- [ ] **Step 3: Write `packages/core/src/index.ts`**

```ts
// re-exports added in Task 6 as modules move in
export {};
```

- [ ] **Step 4: Re-install + build**

```sh
npm install
npm run build --workspace=@skill-graveyard/core
```

Expected: `packages/core/dist/index.js` and `packages/core/dist/index.d.ts` exist.

- [ ] **Step 5: Commit**

```sh
git add packages/core package-lock.json
git commit -m "core: empty @skill-graveyard/core package"
```

---

## Task 6: Move shared modules from skill-graveyard to core

Modules moving (no signature changes in this task — that's Task 8): `paths.ts`, `tokenizer.ts`, `known_tools.ts`, `discovery.ts`, plus `discovery.test.ts`. **`parser.ts` moves in Task 7** along with its test file (kept separate so the generic-parser refactor in Task 8 sits in its own commit). **`format.ts` does NOT move** — see Architecture note above.

These five files form a clean dependency island: `paths`/`tokenizer`/`known_tools`/`parser` have no local imports; `discovery` only imports `ClaudePaths` from `paths`.

**Files:**
- Move: `packages/skill-graveyard/src/paths.ts` → `packages/core/src/paths.ts`
- Move: `packages/skill-graveyard/src/tokenizer.ts` → `packages/core/src/tokenizer.ts`
- Move: `packages/skill-graveyard/src/known_tools.ts` → `packages/core/src/known_tools.ts`
- Move: `packages/skill-graveyard/src/discovery.ts` → `packages/core/src/discovery.ts`
- Move: `packages/skill-graveyard/src/discovery.test.ts` → `packages/core/src/discovery.test.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/package.json` (add `gpt-tokenizer` dep)
- Modify: `packages/skill-graveyard/package.json` (remove `gpt-tokenizer` dep, add `@skill-graveyard/core` dep)
- Modify: every file in `packages/skill-graveyard/src/` that imports a moved module

- [ ] **Step 1: Move files via `git mv`**

```sh
cd packages/skill-graveyard/src
git mv paths.ts tokenizer.ts known_tools.ts discovery.ts discovery.test.ts ../../../packages/core/src/
cd -
```

- [ ] **Step 2: Update `packages/core/src/index.ts` to re-export**

```ts
export { resolveClaudePaths } from "./paths.js";
export type { ClaudePaths } from "./paths.js";

export { TOKENIZER_NAME, estimateTokens } from "./tokenizer.js";

export { KNOWN_TOOLS, isKnownTool } from "./known_tools.js";

export {
  discoverInstalledSkills,
  discoverProjectScopedSkills,
  findGitRoot,
} from "./discovery.js";
export type { SkillSource, InstalledSkill } from "./discovery.js";
```

These exports are exhaustive (every public name in the moved files). Verified against actual exports of `paths.ts`, `tokenizer.ts`, `known_tools.ts`, `discovery.ts` at the time of plan writing — if the source has drifted since, re-list with `grep -E "^export" packages/core/src/{paths,tokenizer,known_tools,discovery}.ts` and reconcile.

Note: `discoverInstalledSkills`/`discoverProjectScopedSkills` carry "skill" in their names but are file-system walkers parameterised by `ClaudePaths`. mcp-graveyard won't import them — they stay in core for skill-graveyard's sole use, no harm.

- [ ] **Step 3: Move `gpt-tokenizer` from skill-graveyard's deps to core's deps**

Update `packages/skill-graveyard/package.json`:
```json
"dependencies": {
  "@skill-graveyard/core": "^0.1.0"
}
```

Update `packages/core/package.json`:
```json
"dependencies": {
  "gpt-tokenizer": "^3.4.0"
}
```

- [ ] **Step 4: Update imports in `packages/skill-graveyard/src/`**

For each `.ts` file that previously did `from "./paths.js"`, `"./tokenizer.js"`, `"./known_tools.js"`, or `"./discovery.js"`, replace with `from "@skill-graveyard/core"`.

```sh
cd packages/skill-graveyard/src
grep -lE 'from "\./(paths|tokenizer|known_tools|discovery)\.js"' *.ts | while read f; do
  sed -i.bak -E 's|from "\./(paths|tokenizer|known_tools|discovery)\.js"|from "@skill-graveyard/core"|g' "$f"
  rm "$f.bak"
done
cd -
```

⚠ This sed handles single-import-per-line. If any file does `import { x } from "./paths.js"; import { y } from "./tokenizer.js"` on one line — unlikely but possible — fix manually so both pull from `@skill-graveyard/core` (combine into one import). Also: leave `from "./parser.js"` alone for now — parser moves in Task 7.

- [ ] **Step 5: Re-install (creates `node_modules/@skill-graveyard/core` symlink)**

```sh
npm install
```

- [ ] **Step 6: Build core, then typecheck + test skill-graveyard**

```sh
npm run build --workspace=@skill-graveyard/core
npm test --workspace=@skill-graveyard/core
npm run typecheck --workspace=skill-graveyard
npm test --workspace=skill-graveyard
```

Expected: core's tests = original `discovery.test.ts` count (the only one moved that has tests). skill-graveyard's tests = baseline minus the discovery test count. Both pass.

- [ ] **Step 7: Smoke-test CLI**

```sh
npm run build --workspace=skill-graveyard
node packages/skill-graveyard/dist/cli.js --json --days 1 | head -c 200
```

Expected: same JSON snippet shape as Task 1.

- [ ] **Step 8: Commit**

```sh
git add packages package-lock.json
git commit -m "core: extract paths, tokenizer, known_tools, discovery"
```

---

## Task 7: Move parser to core (no API change yet)

Same mechanical pattern as Task 6, but parser is mentioned separately because Task 8 changes its signature and we want the move and the refactor in different commits.

**Files:**
- Move: `packages/skill-graveyard/src/parser.ts` → `packages/core/src/parser.ts`
- Move: `packages/skill-graveyard/src/parser.test.ts` → `packages/core/src/parser.test.ts`
- Modify: `packages/core/src/index.ts`
- Modify: every importer of `parser.ts` in skill-graveyard

- [ ] **Step 1: Move the files**

```sh
cd packages/skill-graveyard/src
git mv parser.ts parser.test.ts ../../../packages/core/src/
cd -
```

- [ ] **Step 2: Append parser exports to `packages/core/src/index.ts`**

```ts
export { findSessionFiles, parseSession } from "./parser.js";
export type { SkillCall } from "./parser.js";
```

(Note: `findSessionFiles` lives in `parser.ts`, not `discovery.ts`. Verified by grep.)

- [ ] **Step 3: Update `packages/skill-graveyard/src/` imports**

```sh
cd packages/skill-graveyard/src
grep -lE 'from "\./parser\.js"' *.ts | while read f; do
  sed -i.bak -E 's|from "\./parser\.js"|from "@skill-graveyard/core"|g' "$f"
  rm "$f.bak"
done
cd -
```

- [ ] **Step 4: Build core, then verify everything**

```sh
npm run build --workspace=@skill-graveyard/core
npm test --workspaces
npm run typecheck --workspaces
```

Expected: all tests pass, typecheck clean across both packages.

- [ ] **Step 5: Commit**

```sh
git add packages
git commit -m "core: move parser into shared package"
```

---

## Task 8: Generalize parser to predicate + builder (TDD)

Current `parseSession` hardcodes `name === "Skill"` and the `SkillCall` shape. Generalize so a future `mcp-graveyard` can pass its own predicate and call builder, without pasting parser logic.

**Files:**
- Modify: `packages/core/src/parser.ts`
- Modify: `packages/core/src/parser.test.ts` (add a new test for the generic API; existing skill tests stay)
- Modify: `packages/core/src/index.ts` (add new exports)
- Modify: `packages/skill-graveyard/src/audit.ts` and any other parser callers (use the new API via a thin `parseSkillSession` adapter)

### Design

```ts
// In packages/core/src/parser.ts

export interface ToolCallBase {
  sessionId: string;
  projectKey: string;
  filepath: string;
  cwd: string | null;
  timestamp: string | null;
  toolUseId: string;
  errored: boolean;
  errorReason: string | null;
}

export interface ToolUseItem {
  type: "tool_use";
  id?: string;
  name?: string;
  input?: unknown;
}

// New generic entry point
export async function parseToolCalls<T extends ToolCallBase>(
  filepath: string,
  projectKey: string,
  predicate: (item: ToolUseItem) => boolean,
  build: (item: ToolUseItem, base: ToolCallBase) => T | null,
): Promise<T[]> {
  // ... existing parser logic, but instead of hard-coding SkillCall construction,
  //     calls `build(item, base)`. Skips when build returns null.
  //     tool_result correlation still happens here, mutating `errored`/`errorReason`
  //     on the returned T objects via the same toolUseId map.
}

// Backward-compat thin adapter; existing callers keep working
export async function parseSession(
  filepath: string,
  projectKey: string,
): Promise<SkillCall[]> {
  return parseToolCalls<SkillCall>(filepath, projectKey,
    (item) => item.type === "tool_use" && item.name === "Skill",
    (item, base) => {
      const input = item.input;
      const skill = isObject(input) && typeof input.skill === "string" ? input.skill : null;
      if (!skill) return null;
      return { ...base, skill };
    },
  );
}
```

Where `SkillCall extends ToolCallBase & { skill: string }`. `isObject` helper stays as it is.

### Steps

- [ ] **Step 1: Write a failing test for the new generic API**

Append to `packages/core/src/parser.test.ts`:

```ts
import { parseToolCalls } from "./parser.js";

interface MockCall extends ToolCallBase {
  rawName: string;
  argA: string | null;
}

test("parseToolCalls applies predicate + builder generically", async () => {
  const fp = makeSession([
    event({
      content: [
        { type: "tool_use", id: "tu_1", name: "MockTool", input: { argA: "value" } },
        { type: "tool_use", id: "tu_2", name: "Skill", input: { skill: "x" } },  // not matched by predicate
      ],
    }),
  ]);

  const calls = await parseToolCalls<MockCall>(
    fp,
    "proj",
    (item) => item.type === "tool_use" && item.name === "MockTool",
    (item, base) => ({
      ...base,
      rawName: typeof item.name === "string" ? item.name : "",
      argA: typeof (item.input as any)?.argA === "string" ? (item.input as any).argA : null,
    }),
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].rawName, "MockTool");
  assert.equal(calls[0].argA, "value");
  assert.equal(calls[0].errored, false);
});

test("parseToolCalls correlates tool_result errors back to the call", async () => {
  const fp = makeSession([
    event({
      content: [
        { type: "tool_use", id: "tu_1", name: "MockTool", input: {} },
      ],
    }),
    event({
      content: [
        {
          type: "tool_result",
          tool_use_id: "tu_1",
          is_error: true,
          content: "InputValidationError: thing",
        },
      ],
    }),
  ]);

  const calls = await parseToolCalls(
    fp,
    "proj",
    (item) => item.type === "tool_use" && item.name === "MockTool",
    (item, base) => ({ ...base, name: "MockTool" } as any),
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].errored, true);
});
```

- [ ] **Step 2: Verify the new tests fail**

```sh
npm test --workspace=@skill-graveyard/core
```

Expected: failure mentioning `parseToolCalls is not a function` (or similar — the export does not yet exist).

- [ ] **Step 3: Refactor `parser.ts`: implement `parseToolCalls<T>` and reduce `parseSession` to a thin adapter**

Replace the body of `packages/core/src/parser.ts` with the structure shown in the Design section above. Keep `SkillCall`, `isObject`, `extractText`, `ERROR_PATTERNS`, `findSessionFiles` (if it's still here — it isn't, it moved to discovery in Task 6) — preserved.

Concretely:
1. Move the stream-reading + tool_use/tool_result correlation logic into the new `parseToolCalls<T>`.
2. Inside that function, the place that previously called `if (item.name === "Skill") { ... push SkillCall ... }` becomes:
   ```ts
   if (predicate(item)) {
     const toolUseId = typeof item.id === "string" ? item.id : "";
     const base: ToolCallBase = {
       sessionId, projectKey, filepath, cwd: lastCwd, timestamp,
       toolUseId, errored: false, errorReason: null,
     };
     const built = build(item as ToolUseItem, base);
     if (!built) continue;
     calls.push(built);
     if (toolUseId) pending.set(toolUseId, built);
   }
   ```
3. The `tool_result` branch keeps doing `pending.get(tid)`, but `pending` now holds `T` instead of `SkillCall`. Mutation of `errored`/`errorReason` works the same way (those fields are on `ToolCallBase`).
4. `parseSession(filepath, projectKey)` keeps its current public shape and now wraps `parseToolCalls<SkillCall>(...)` with a Skill-specific predicate + builder.

- [ ] **Step 4: Verify all tests pass**

```sh
npm test --workspace=@skill-graveyard/core
```

Expected: every test passes (existing skill-flavor tests + new generic tests).

- [ ] **Step 5: Update `packages/core/src/index.ts` to export the new types/function**

Add:

```ts
export { parseSession, parseToolCalls } from "./parser.js";
export type { SkillCall, ToolCallBase, ToolUseItem } from "./parser.js";
```

- [ ] **Step 6: Build core, run skill-graveyard tests to confirm no regression**

```sh
npm run build --workspace=@skill-graveyard/core
npm test --workspace=skill-graveyard
```

Expected: skill-graveyard tests count + outcome matches Task 6 Step 6.

- [ ] **Step 7: Commit**

```sh
git add packages/core/src/parser.ts packages/core/src/parser.test.ts packages/core/src/index.ts
git commit -m "core: generic parseToolCalls<T>; parseSession is a Skill adapter"
```

---

## Task 9: Update CI workflow for matrix-on-package

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Replace workflow body**

```yaml
name: ci

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        package: ["@skill-graveyard/core", "skill-graveyard"]
        node: [20, 22]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
          cache: npm
      - run: npm ci
      - name: Build core (required for skill-graveyard tests/build)
        if: matrix.package != '@skill-graveyard/core'
        run: npm run build --workspace=@skill-graveyard/core
      - run: npm run typecheck --workspace=${{ matrix.package }}
      - run: npm test --workspace=${{ matrix.package }}
      - run: npm run build --workspace=${{ matrix.package }}
```

Why the conditional core-build step: skill-graveyard's typecheck and tests resolve `@skill-graveyard/core` types from `packages/core/dist/`, so core needs to be built first. The conditional `if` skips this when the matrix entry IS core (which is also the build target — we'd be building twice). For core's own row, the `npm run build` at the end is the build.

- [ ] **Step 2: Push branch, verify CI green**

This step runs in CI; locally just push the branch and watch GitHub Actions. Expected: 4 matrix cells (`{core, skill-graveyard} × {20, 22}`), all green.

If they fail: most likely a path-resolution issue (`packages/core/dist` not found when skill-graveyard runs). Re-check the conditional in Step 1.

- [ ] **Step 3: Commit (the workflow change)**

```sh
git add .github/workflows/ci.yml
git commit -m "ci: matrix per package; build core before skill-graveyard"
```

---

## Task 10: Update README + plugin manifest references

The README's "Layout" section in `CLAUDE.md` documents the old `src/` paths. Plugin manifest paths in `.claude-plugin/plugin.json` and `commands/audit-skills.md` may reference internals that no longer exist.

**Files:**
- Modify: `README.md` (small edits if needed)
- Modify: `CLAUDE.md` (Layout section, Tests section, Development section)
- Verify (read-only): `.claude-plugin/plugin.json`, `commands/audit-skills.md`

- [ ] **Step 1: Update CLAUDE.md "Layout" section**

Replace the existing layout block in CLAUDE.md with:

```markdown
## Layout

This is a workspaces monorepo:

- `packages/core/` — `@skill-graveyard/core` (published). Shared parser, format, discovery, paths, tokenizer, known_tools.
- `packages/skill-graveyard/` — published as `skill-graveyard`. CLI, all subcommand implementations.
- `.claude-plugin/`, `commands/` — plugin assets, served from repo root (referenced by `packages/skill-graveyard/package.json` "files").
- `docs/` — Pages site + design specs.

Inside each package:
- `src/cli.ts` (skill-graveyard only) — argument routing
- `src/{audit,prune,suggest,projects,cost,outdated}.ts` — subcommands (skill-graveyard)
- `src/{parser,discovery,paths,tokenizer,known_tools,format}.ts` — primitives (core)
- `src/*.test.ts` — colocated tests; flat under `src/`
```

- [ ] **Step 2: Update CLAUDE.md "Development" section**

Replace command examples to use `--workspace`:

```markdown
## Development

```sh
npm install
npm run build --workspace=@skill-graveyard/core    # build core first
npm run dev --workspace=skill-graveyard -- <subcommand>
npm run typecheck --workspaces
npm test --workspaces
npm run build --workspaces
```
```

- [ ] **Step 3: Update CLAUDE.md "Tests" section path note**

Change `node --import tsx --test src/*.test.ts` reference to be aware that this is per-package now: "each package runs the same test pattern from its own `src/`."

- [ ] **Step 4: Skim `README.md` for outdated paths**

Search for `src/` mentions in README:

```sh
grep -n "src/" README.md
```

If results are user-facing (e.g. "see src/cli.ts"), update to `packages/skill-graveyard/src/cli.ts`. If they're not user-facing, leave alone — README is a marketing surface, internal layout shouldn't be there.

- [ ] **Step 5: Verify plugin manifest still works**

```sh
cat .claude-plugin/plugin.json
cat commands/audit-skills.md | head -20
```

If `commands/audit-skills.md` mentions running scripts via `tsx src/cli.ts` or paths into the old `src/` — update them. Most likely it just calls `npx skill-graveyard ...` via shell, which is path-independent.

- [ ] **Step 6: Commit**

```sh
git add CLAUDE.md README.md
git commit -m "docs: monorepo layout in CLAUDE.md"
```

---

## Task 11: Bump skill-graveyard to 0.8.0

**Files:**
- Modify: `packages/skill-graveyard/package.json`
- Modify: `.claude-plugin/plugin.json` (version field — must stay in lockstep with package.json per existing convention)

- [ ] **Step 1: Bump package.json**

In `packages/skill-graveyard/package.json`, change `"version": "0.7.0"` to `"version": "0.8.0"`.

- [ ] **Step 2: Bump plugin manifest**

In `.claude-plugin/plugin.json`, change `"version": "0.7.0"` to `"version": "0.8.0"`.

- [ ] **Step 3: Confirm lockstep**

```sh
grep '"version"' packages/skill-graveyard/package.json .claude-plugin/plugin.json
```

Expected: both report `"version": "0.8.0"`.

- [ ] **Step 4: Commit**

```sh
git add packages/skill-graveyard/package.json .claude-plugin/plugin.json
git commit -m "skill-graveyard: 0.8.0 (monorepo layout)"
```

---

## Task 12: Final pre-publish verification

End-to-end check that nothing regressed.

**Files:** none modified.

- [ ] **Step 1: Clean install + full pipeline**

```sh
rm -rf node_modules packages/*/node_modules packages/*/dist
npm install
npm run build --workspaces
npm run typecheck --workspaces
npm test --workspaces
```

Expected: all green. Test count matches Task 1 baseline.

- [ ] **Step 2: Pack each package; inspect tarball contents**

```sh
npm pack --workspace=@skill-graveyard/core --dry-run 2>&1 | grep "npm notice"
npm pack --workspace=skill-graveyard --dry-run 2>&1 | grep "npm notice"
```

Expected for `@skill-graveyard/core`: `dist/index.js`, `dist/parser.js`, `dist/discovery.js`, `dist/paths.js`, `dist/tokenizer.js`, `dist/known_tools.js`, plus `.d.ts` siblings, plus `package.json`. **Not** present: `format.js` (it stays in skill-graveyard).

Expected for `skill-graveyard`: `dist/cli.js` (executable), all subcommand `.js` files, `README.md`, `LICENSE`, **AND** `.claude-plugin/plugin.json` + `commands/audit-skills.md` (verifying Task 4 Step 7 worked).

- [ ] **Step 3: Smoke-test installed-form**

```sh
mkdir -p /tmp/sg-smoketest && cd /tmp/sg-smoketest
npm pack --workspace=@skill-graveyard/core --pack-destination .
# (capture the resulting tarball name)
npm pack --workspace=skill-graveyard --pack-destination .
npm init -y >/dev/null
npm install ./skill-graveyard-0.8.0.tgz ./skill-graveyard-core-0.1.0.tgz
./node_modules/.bin/skill-graveyard --json --days 1 | head -c 200
cd -
rm -rf /tmp/sg-smoketest
```

Expected: same JSON snippet shape as Task 1 Step 2. (Adjust tarball filenames if npm normalizes scope differently.)

- [ ] **Step 4: No commit** — verification only.

---

## Out of scope (handled in Plan B)

- Creating `packages/mcp-graveyard/` and the new CLI.
- Adding a second plugin manifest, or moving plugin assets out of repo root into per-package locations.
- Writing the `mcp_parser`, `mcp_config`, audit/prune/projects/suggest subcommands for MCP.
- Updating the docs/Pages site to mention mcp-graveyard.
- Marketplace-side change: registering a second plugin entry under the same repo. (Investigate during Plan B; if marketplace can't host two plugins from one repo, that becomes a constraint to resolve there.)

---

## Self-review checklist (for the implementing agent)

After all tasks:

1. **Test count**: total tests across both workspaces equals baseline from Task 1 Step 1, **plus** the 2 new generic-parser tests added in Task 8.
2. **CLI behavior**: `skill-graveyard --json --days 1` returns the same shape as before migration.
3. **Plugin tarball**: `npm pack --workspace=skill-graveyard --dry-run` lists `.claude-plugin/plugin.json` and `commands/audit-skills.md`.
4. **CI matrix**: `.github/workflows/ci.yml` runs 4 cells (`{@skill-graveyard/core, skill-graveyard} × {20, 22}`), all green.
5. **Versions in lockstep**: `packages/skill-graveyard/package.json` and `.claude-plugin/plugin.json` both at `0.8.0`. `@skill-graveyard/core` at `0.1.0`.
6. **No new runtime deps in skill-graveyard.** It now depends on `@skill-graveyard/core` instead of `gpt-tokenizer`; that package brings `gpt-tokenizer` transitively.

If any of these fail, fix before opening the release PR.
