# mcp-graveyard

[![npm version](https://img.shields.io/npm/v/mcp-graveyard.svg)](https://www.npmjs.com/package/mcp-graveyard)
[![license](https://img.shields.io/npm/l/mcp-graveyard.svg)](LICENSE)
[![node](https://img.shields.io/node/v/mcp-graveyard.svg)](package.json)

Audit which MCP server tools your Claude Code sessions actually invoke. Parses your local session logs and cross-references the servers configured in `~/.claude.json` to surface two signals from one parser:

1. **Dead servers** — configured in `~/.claude.json` but Claude never invokes any of their tools → safe to remove.
2. **Hallucinated tool calls** — Claude invokes tool names that fail with `InputValidationError` (typos, wrong server, server removed since session) → surface for awareness.

Same four-bucket model as `skill-graveyard` (active / dead / missing / hallucinated), applied to MCP servers instead of skills.

## Why this exists

A single MCP server can advertise 50 tools with full JSON schemas, each adding hundreds of tokens to every API request whether or not Claude calls them. A user who connects `supabase`, `playwright`, `pencil`, and `figma` "just in case" pays for tens of thousands of tokens of unused tool definitions on every turn. After parsing 30 days of sessions, many of those servers had never been called once. This tool surfaces the gap — and flags a second signal: Claude regularly calls tool names that don't exist on the connected server, resulting in `InputValidationError` responses.

## Install

```sh
npx mcp-graveyard
```

Or globally:

```sh
npm i -g mcp-graveyard
mcp-graveyard
```

Or as a Claude Code Agent Skill (auto-discovered by Claude in any session, via [skills.sh](https://skills.sh/)):

```sh
npx skills add sfrangulov/skill-graveyard
```

The skills.sh install adds a `SKILL.md` to your Claude Code skills directory; Claude picks it up automatically when you ask MCP-shaped questions ("which MCP servers don't I use?", "clean up MCP config") and runs the same `npx mcp-graveyard` binary under the hood. The same command also installs the sister `skill-graveyard` skill from this repo. Compatible with the npm install — they don't conflict.

Requires Node 18+.

## Usage

Four subcommands. `audit` is the default and is what you usually run.

```sh
mcp-graveyard                         # 30-day audit, pretty table
mcp-graveyard --days 14               # narrower window
mcp-graveyard --only dead             # filter to removal candidates
mcp-graveyard --json                  # machine-readable

mcp-graveyard prune                   # plan: print every claude mcp remove command for dead servers
mcp-graveyard prune --apply           # execute removals (backup is automatic)

mcp-graveyard suggest                 # classify hallucinated/missing into actionable buckets
mcp-graveyard projects                # break down server usage per project (from session cwds)
```

### `audit`

Sorts every configured server into four buckets and lists per-tool usage for active servers. Filter to one bucket with `--only active|dead|missing|hallucinated`.

```
mcp-graveyard — 30 days · 8 servers configured · 143 calls · 112 succeeded · 31 errored

ACTIVE (3)
  plugin_supabase_supabase     47 tools, 5 invoked, 89 calls  last 2026-04-28
  plugin_playwright_playwright  3 tools, 3 invoked, 34 calls  last 2026-04-27
  plugin_claude-mem_mcp-search  4 tools, 4 invoked, 12 calls  last 2026-04-29

DEAD (3)
  pencil                     0 tools, 0 invoked, 0 calls  —
  plugin_figma_figma         0 tools, 0 invoked, 0 calls  —
  claude_ai_Gmail            0 tools, 0 invoked, 0 calls  —

HALLUCINATED (1)
  plugin_supabase_supabase  0 tools, 0 invoked, 2 calls  last 2026-04-22

MISSING (1)
  old-analytics-server  1 tools, 1 invoked, 3 calls  last 2026-04-16

→ run: mcp-graveyard prune  to clear DEAD servers
```

`tools` = distinct `mcp__<server>__*` names seen in the window. `invoked` = how many of those got at least one successful call.

Pipe to `jq` for custom queries:

```sh
mcp-graveyard --json | jq '.rows[] | select(.category=="dead") | .server'
```

### `prune`

Reads the audit and emits a removal plan. Dry-run by default:

```
mcp-graveyard prune — plan: 3 servers to remove (0 successful calls in 30 days)

  pencil                                    claude mcp remove pencil
  plugin_figma_figma                        claude mcp remove plugin_figma_figma
  claude_ai_Gmail                           claude mcp remove claude_ai_Gmail

re-run with --apply to execute (backup is automatic)
```

With `--apply`, `prune` first writes a backup of all servers being removed to `~/.claude/mcp-graveyard-backup/<ISO-timestamp>.json` (mode 0o600), then runs `claude mcp remove <server>` for each. If the backup write fails, it bails before removing anything. If an individual removal fails it prints the error and continues with the rest.

`--only <server-name>` restricts to a single named server.

### `suggest`

Classifies the `MISSING` and `HALLUCINATED` rows into actionable buckets:

- **TYPO** — server name is within Levenshtein distance 2 of a configured server. Worth reviewing the call sites.
- **REMOVED SERVER** — server name that was once configured but no longer is; Claude may be recalling it from older context.
- **TOOL/SERVER CONFUSION** — Claude called a built-in CC tool name as an MCP server (e.g. `mcp__Bash__execute`). Known model failure mode; not actionable on your side.
- **UNCLASSIFIED** — no pattern matched. Manual review.

### `projects`

Groups every server invocation by the `cwd` recorded in your session logs. Surfaces servers that are configured globally but only called in one project (a signal to consider moving them to `<project>/.mcp.json`).

```
~/projects/client-analytics  17 ses, 39 calls, 2 servers
    plugin_supabase_supabase    31×
    plugin_claude-mem_mcp-search 8×

~/projects/clientco/web-platform  2 ses, 2 calls, 1 server
  ✗ plugin_supabase_supabase  2× (2 hallucinated)
```

`✗` marks servers with hallucinated tool names (input validation errors). The `(N hallucinated)` tag distinguishes these from runtime errors, which are filtered out at parse time.

## What it reads

- `~/.claude.json` (`mcpServers`) — source of configured servers; target for `prune --apply`
- `~/.claude/projects/**/*.jsonl` — session logs (tool invocations with `cwd` and timestamps)

Pass `--claude-dir` to override the Claude home location.

## What it does NOT do

- **Does not subprocess to MCP servers.** All analysis is local file parsing; no servers are started.
- **Does not parse `<project>/.mcp.json`.** Per-project MCP configs are intentional per-project artifacts; they are out of scope for v1.
- **Does not phone home.** No telemetry, no network calls anywhere in the runtime.
- **Does not have a `restore` subcommand.** Backup files are written on `prune --apply` — restoring is a manual operation using the backup JSON.

## Backup format note

`prune --apply` writes a backup at `~/.claude/mcp-graveyard-backup/<ISO>.json` with mode `0o600` (owner-only read/write). The backup mirrors the `mcpServers` block of `~/.claude.json` for each removed server, including `env` values — which may contain API keys. Clean up old backups yourself. There is no `restore` subcommand in v1; to re-add a server, run `claude mcp add <name> <command> [args...]` using the values in the backup.

## Companion tool: skill-graveyard

The same dual-signal audit for Claude Code **skills** (SKILL.md installs) rather than MCP servers:

```sh
npx skill-graveyard
```

Six subcommands including `cost` (token cost of skill metadata) and `outdated` (upstream version check). See [packages/skill-graveyard](../skill-graveyard/) or [npm](https://www.npmjs.com/package/skill-graveyard).

## Companion tools

- [`skill-graveyard`](https://www.npmjs.com/package/skill-graveyard) — same pattern for Claude Code skills (SKILL.md installs).
- [`memory-graveyard`](https://www.npmjs.com/package/memory-graveyard) — same pattern for per-project `MEMORY.md` entries.

## License

MIT
