# mcp-graveyard — design

Date: 2026-04-29
Status: draft, awaiting user review before implementation plan

## Implementation phasing

This spec ships in two independent plans, each producing a working release:

1. **Phase 1 — monorepo migration.** Move existing skill-graveyard into workspaces, extract `@skill-graveyard/core`, no user-visible behavior change. Ships `skill-graveyard@0.8.0`.
2. **Phase 2 — mcp-graveyard v1.** New package with `audit` / `prune` / `projects` / `suggest`. Ships `mcp-graveyard@0.1.0`.

Phase 2 depends on Phase 1 landing.

## Goal

Sister tool to `skill-graveyard`, applying the same dual-signal idea to **MCP server tools** instead of skills:

1. **Dead servers** — configured in `~/.claude.json` but Claude never invokes any of their tools → safe to remove.
2. **Hallucinated tool calls** — Claude invokes tool names that fail with `InputValidationError` (typos, wrong server, server removed since session) → surface for awareness.

The motivation is the same as for skills, but the per-unit cost is larger: a single MCP server can advertise 50 tools with full JSON schemas, each adding hundreds of tokens to every API request whether or not Claude calls them. A user who connects `supabase`, `playwright`, `pencil`, and `figma` "just in case" pays for tens of thousands of tokens of unused tool definitions on every turn.

## Scope

**In v1:** `audit`, `prune`, `projects`, `suggest`.

**Deferred:** `cost` (separate design — the question of where to source full tool schemas needs its own brainstorm), `outdated` (boilerplate-heavy, low ROI for v1), built-in tool stats (no actionable signal).

## Architecture: monorepo

The existing `skill-graveyard` repo becomes a workspaces monorepo. Repo name stays `skill-graveyard` (already published, plugin marketplace points at it). Two CLIs publish from inside:

```
skill-graveyard/                          (repo + workspace root)
├── package.json                          { "private": true, "workspaces": ["packages/*"] }
├── tsconfig.json                         (base config with project references)
├── packages/
│   ├── core/                             @skill-graveyard/core — published, minimal public API
│   │   ├── src/
│   │   │   ├── parser.ts                 findSessionFiles + generic parseToolCalls<T>(filepath, projectKey, predicate, build)
│   │   │   ├── discovery.ts              findGitRoot, discoverInstalledSkills, discoverProjectScopedSkills
│   │   │   ├── paths.ts                  claude home resolution (resolveClaudePaths)
│   │   │   ├── tokenizer.ts              cl100k_base wrapper
│   │   │   ├── known_tools.ts            built-in CC tool list
│   │   │   └── index.ts                  re-exports
│   │   └── package.json                  { "version": "0.1.0" }   # published
│   ├── skill-graveyard/                  publishes as skill-graveyard@0.8.0 (monorepo migration bump)
│   │   ├── src/                          existing src/ moved here verbatim, then refactored to import from core
│   │   ├── commands/audit-skills.md
│   │   └── .claude-plugin/plugin.json
│   └── mcp-graveyard/                    publishes as mcp-graveyard@0.1.0
│       ├── src/
│       │   ├── cli.ts
│       │   ├── audit.ts, prune.ts, projects.ts, suggest.ts
│       │   ├── mcp_parser.ts             parser specialization for mcp__ tool calls
│       │   ├── mcp_config.ts             read ~/.claude.json mcpServers
│       │   └── *.test.ts
│       ├── commands/audit-mcp-tools.md
│       └── .claude-plugin/plugin.json
├── docs/                                 single site, serves both packages
└── .github/workflows/ci.yml              matrix: { package, node }
```

### Key decisions

1. **`@skill-graveyard/core` is published.** Reason: npm workspaces without a bundler can't ship a "private" core to end users — `npm i skill-graveyard` would resolve a transitive `@skill-graveyard/core` dep that doesn't exist on the registry. Adding a bundler (tsup/esbuild) just to keep core unpublished is more toolchain than the win is worth. Tradeoff: each core API change requires a publish, but core's surface is small (parser, format, discovery, paths, tokenizer, known_tools) and stable, so bumps are rare. External consumers technically *can* depend on core, but it has no docs and no semver-stability promise — best-effort only.
2. **`parser.ts` is generalised.** Today it hardcodes `name === "Skill"`. Becomes a generic `parseToolCalls<T>(filepath, projectKey, predicate, build)` plus a thin `parseSession` adapter that preserves the existing skill-graveyard signature:
   - skill-graveyard: `predicate = item => item.name === "Skill"`, builder pulls `input.skill`.
   - mcp-graveyard: `predicate = item => item.name?.startsWith("mcp__")`, builder parses `mcp__<server>__<tool>`.

3. **`format.ts` stays in skill-graveyard.** It currently imports types from every subcommand (audit, prune, suggest, cost, outdated, projects); moving it to core would make core depend back on skill-graveyard. mcp-graveyard will get its own `format.ts`. If a real shared subset emerges (color codes, sparkbar primitives), Plan B's first task can be to extract it — but that is reactive, driven by what mcp-graveyard concretely needs, not preemptive.
4. **`outdated`-related code stays in `skill-graveyard`.** `source_resolver`, `fetcher`, `cache` are git/marketplace specific. mcp-graveyard's eventual `outdated` will likely share concepts but not code.
5. **Migration happens in stages, not one commit.** The implementation plan (`2026-04-29-monorepo-migration-plan.md`) breaks it into 12 tasks: workspaces bootstrap, file relocation, core skeleton, module extraction, parser generalisation, CI matrix, version bump, verification. Each task ends in a working commit.

## Data model

### Sources of truth

| What | Source | Note |
|---|---|---|
| Configured servers | `~/.claude.json` → `mcpServers` | "What is declared." Source for prune. |
| Tool invocations | `~/.claude/projects/**/*.jsonl` → `tool_use.name` matching `^mcp__` | What Claude actually called. |
| Errors on tool calls | matching `tool_result` with `is_error: true` or text matching `InputValidationError` | Distinguishes "tool name unknown" (hallucinated) from "tool ran and returned an error" (not interesting). |
| Tools advertised per session | distinct `mcp__*` names appearing in JSONL (including in deferred-tool `<system-reminder>` blocks) | "What was visible to Claude" — useful for the deferred `cost` subcommand. |

**No subprocess to MCP servers.** Everything is local file parsing. Verified empirically: an arbitrary recent JSONL contains 20+ `mcp__claude_ai_Gmail__*` names that were never invoked in that session — they're listed in the deferred-tools system reminder, which gives ground truth for "what was available."

### Tool name parsing

Format: `mcp__<server>__<tool>`. Examples:

- `mcp__pencil__batch_design` → server=`pencil`, tool=`batch_design`
- `mcp__plugin_supabase_supabase__apply_migration` → server=`plugin_supabase_supabase`, tool=`apply_migration`

Rule: between `mcp__` and the **last** `__` is the server segment; the last segment is the tool. Single-`_` is permitted within tool names; `__` (double) is the delimiter.

### Types

```ts
// packages/core/src/parser.ts
export interface ToolCall<TKind extends string = string> {
  kind: TKind;              // "skill" | "mcp"
  name: string;             // raw tool_use.name
  sessionId: string;
  projectKey: string;
  filepath: string;
  cwd: string | null;
  timestamp: string | null;
  toolUseId: string;
  errored: boolean;
  errorReason: string | null;
}

// packages/mcp-graveyard/src/types.ts
export interface McpToolCall extends ToolCall<"mcp"> {
  server: string;
  tool: string;
}

export interface McpServerEntry {
  name: string;
  command: string | null;
  args: string[] | null;
  env: Record<string, string> | null;
  configuredIn: string;     // path to claude.json
}

export interface McpServerSummary {
  name: string;
  configured: boolean;
  toolsAdvertised: number;       // distinct mcp__<this-server>__* names seen
  toolsInvoked: Set<string>;     // tools successfully called
  toolsErrored: Set<string>;     // tools that failed with InputValidationError
  totalCalls: number;
  successfulCalls: number;
  erroredCalls: number;
  bucket: "active" | "dead" | "missing" | "hallucinated";
  lastCallAt: string | null;
}
```

### Four buckets (server-level)

Direct analogue of skill-graveyard:

| Bucket | Condition | Action in `prune` |
|---|---|---|
| **active** | configured ∧ ≥1 successful call | keep |
| **dead** | configured ∧ 0 successful calls in window | `claude mcp remove <server>` (with backup) |
| **missing** | ¬configured ∧ ≥1 successful call in window | info-only: "server removed since session ran" |
| **hallucinated** | ≥1 errored call (`InputValidationError`) | info-only: "Claude is calling unknown tool names" |

Buckets are **not mutually exclusive** at the server level — a server with 5 successful and 2 errored calls is both `active` and `hallucinated`. Same convention as skill-graveyard.

### Out of scope for v1

- Per-tool buckets in primary output (server-first design — agreed).
- `<project>/.mcp.json` parsing (per-project artefacts, like `<project>/.claude/skills/`).
- Subprocess to MCP servers.

## Subcommands

### `audit` (default)

Server-first table. Default window 30 days.

```
mcp-graveyard — 30 days · 12 servers configured · 187 calls · 142 succeeded · 45 errored

ACTIVE (4)
  server                                tools   invoked   calls    last
  plugin_supabase_supabase              47      6         89       2026-04-28
  plugin_playwright_playwright          25      3         34       2026-04-27
  pencil                                14      2         18       2026-04-25
  plugin_claude-mem_mcp-search          7       4         12       2026-04-29

DEAD (6) — candidates for removal
  server                                tools   invoked   calls    config
  plugin_figma_figma                    9       0         0        ~/.claude.json
  claude_ai_Gmail                       10      0         0        ~/.claude.json
  ...

HALLUCINATED (2)
  server                                errors  example
  plugin_supabase_supabase              2       mcp__supabase__list_tables_extra (InputValidationError)

MISSING (1) — invoked successfully but no longer configured
  server                                calls   first        last
  old-server                            3       2026-04-15   2026-04-16

→ run: mcp-graveyard prune  to clear DEAD servers
```

Columns: `tools` = distinct `mcp__<server>__*` names seen in window. `invoked` = how many of them got at least one successful call. `calls` = total invocations.

### `audit --tools <server>` (drill-down)

```
plugin_supabase_supabase — 47 tools · 6 invoked · 89 calls

INVOKED (6)
  apply_migration              23
  list_tables                  19
  ...

DEAD TOOLS (41)
  create_branch
  delete_branch
  ...
```

Information signal only (per-tool disable isn't supported by Claude Code).

### Filters & options

- `--only active|dead|missing|hallucinated` — single bucket
- `--days N` — window (default 30)
- `--json` — machine-readable
- `--claude-dir <path>` — override `~/.claude` (testability)

### `--json` shape

Preserves skill-graveyard convention (`rows[]` + `summary`):

```jsonc
{
  "generatedAt": "2026-04-29T13:24:00Z",
  "windowDays": 30,
  "claudeDir": "/Users/.../.claude",
  "summary": {
    "configuredServers": 12,
    "totalCalls": 187,
    "successfulCalls": 142,
    "erroredCalls": 45
  },
  "rows": [
    {
      "server": "plugin_figma_figma",
      "category": "dead",
      "configured": true,
      "configuredIn": "/Users/.../.claude.json",
      "toolsAdvertised": 9,
      "toolsInvoked": 0,
      "totalCalls": 0,
      "successfulCalls": 0,
      "erroredCalls": 0,
      "lastCallAt": null
    }
  ]
}
```

### `prune` (default — plan)

```
mcp-graveyard prune — plan: 6 servers to remove (0 successful calls in 30 days)

  plugin_figma_figma                    claude mcp remove plugin_figma_figma
  claude_ai_Gmail                       claude mcp remove claude_ai_Gmail
  ...

re-run with --apply to execute (backup is automatic)
```

Pure print. No fs/process.

### `prune --apply`

Order:

1. **Snapshot what will be removed.** For each dead server, read its block from `~/.claude.json` (full object: `command`, `args`, `env`).
2. **Write backup BEFORE first removal.** `~/.claude/mcp-graveyard-backup/<ISO-timestamp>.json`. Atomic via temp+rename. If backup write fails — bail, remove nothing.
3. **Sequential `claude mcp remove <server>`** via `child_process.spawnSync` with `{ stdio: 'inherit' }`. One at a time. If a `remove` fails non-zero — print error, **continue with the next** (one broken server should not block the rest). End with summary: `Removed 5/6, 1 failed (see above)`.
4. **Pre-flight**: `claude` in PATH. If not — bail with "claude CLI not in PATH; install Claude Code or run prune without --apply".

#### Backup format

```jsonc
{
  "removedAt": "2026-04-29T13:31:42.123Z",
  "claudeDir": "/Users/.../.claude",
  "windowDays": 30,
  "servers": {
    "plugin_figma_figma": {
      "command": "npx",
      "args": ["-y", "@figma/mcp-server"],
      "env": { "FIGMA_TOKEN": "..." }
    }
    // ...one entry per removed server, mirroring the original mcpServers block exactly
  },
  "restoreHint": "claude mcp add <name> <command> [args...] (consult JSON above for args/env)"
}
```

Backup mirrors the `mcpServers` block exactly. Restore is a manual operation in v1 (no `restore` subcommand).

⚠ **Secrets**: env often contains API keys. Backup is written with `mode: 0o600` (owner-only). README documents this and tells users to clean up backups themselves.

### `prune --only <server-name>`

Filter to a specific server name (exact match, no glob). Targeted cleanup instead of batch.

### `projects`

Re-aggregates the same call data by `cwd`. Surfaces servers that are configured globally but only used in one project (signal: move to `<project>/.mcp.json`).

```
~/projects/api-server  17 ses, 39 calls, 3 servers
    plugin_supabase_supabase                  31×
    plugin_claude-mem_mcp-search               7×
    pencil                                     1×

~/projects/landing  2 ses, 2 calls, 1 server
  ✗ plugin_supabase_supabase                  2× (errored)
```

`✗` marks errored calls. Implementation: 90% reuse of skill-graveyard's `projects.ts` logic.

### `suggest`

Classifies missing/hallucinated entries:

- **TYPO** — server name within Levenshtein distance 2 of a configured server (`mcp__supbase__list_tables` ≈ `supabase`).
- **REMOVED SERVER** — server name that was once in `claude.json` (heuristic: appears in older sessions but not current config) — likely Claude remembering name from older context.
- **TOOL/SERVER CONFUSION** — Claude calls e.g. `mcp__Bash__execute` (built-in CC tool name as MCP server). Known model failure mode.
- **UNCLASSIFIED** — manual review.

## Testing, CI, release

### Tests

- Conventions unchanged: real `fs` against `os.tmpdir()` fixtures, no fs-mocking, tests colocated flat under `src/`.
- Per-package `npm test` = `node --import tsx --test src/*.test.ts` (single `*`, unquoted — same gotcha as documented in current CLAUDE.md). Workspace root `npm test` = `npm test --workspaces`.
- Shared JSONL fixtures live in `packages/core/test-fixtures/sessions/`. Real tool names are kept (not secrets); fixture `cwd` paths are anonymized to `/tmp/fake-project-N`.

### CI

`.github/workflows/ci.yml` — single workflow, **matrix on package**:

```yaml
strategy:
  fail-fast: false        # deliberately false: failure in one package shouldn't cancel the other
  matrix:
    package: [skill-graveyard, mcp-graveyard]
    node: [20, 22]
```

Steps run `typecheck`, `test`, `build` per workspace.

This deviates from current CI (which uses default `fail-fast: true`) — explicit choice given matrix-on-package.

### Versioning

- **Lockstep within a package**: `packages/<name>/package.json` and `packages/<name>/.claude-plugin/plugin.json` versions must match (same rule as today). Core has no plugin manifest, so its version is standalone.
- **Independent across packages**: `skill-graveyard` jumps to `0.8.0` (monorepo migration bump). `mcp-graveyard` starts at `0.1.0`. `@skill-graveyard/core` starts at `0.1.0` and bumps independently when its API changes.
- **Publish order matters**: when both `core` and a CLI need to release, publish `core` first, bump CLI's `@skill-graveyard/core` dep range, then publish CLI.

### Release flow per package

```sh
# core (only when its API changed)
npm pack --workspace=@skill-graveyard/core --dry-run
npm publish --workspace=@skill-graveyard/core --otp=NNNNNN
git tag -a core@v0.1.0

# then CLI
npm pack --workspace=mcp-graveyard --dry-run
npm publish --workspace=mcp-graveyard --otp=NNNNNN     # OTP from user
git tag -a mcp-graveyard@v0.1.0
gh release create mcp-graveyard@v0.1.0 ...
```

Tags get `<package>@v` prefix to disambiguate. `core@v...` is internal-facing (no GitHub release).

### Slash command + plugin

- `packages/mcp-graveyard/commands/audit-mcp-tools.md` — slash entry.
- `packages/mcp-graveyard/.claude-plugin/plugin.json` — separate plugin manifest.
- Marketplace registration: same GitHub repo, two plugin entries with different paths. Existing `.claude-plugin/plugin.json` at repo root will be replaced by per-package manifests; marketplace entries get updated together with the monorepo migration commit.

## Non-goals (deliberate)

- **No subprocess to MCP servers** for any subcommand in v1.
- **No `<project>/.mcp.json` parsing** in v1.
- **No automatic restore subcommand.** Backups exist; restoring is manual.
- **No telemetry, no network calls** outside what's already in `skill-graveyard` (`outdated`). mcp-graveyard v1 is fully offline.
