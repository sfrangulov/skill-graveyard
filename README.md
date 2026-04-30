# skill-graveyard

[![npm version](https://img.shields.io/npm/v/skill-graveyard.svg)](https://www.npmjs.com/package/skill-graveyard)
[![npm downloads](https://img.shields.io/npm/dm/skill-graveyard.svg)](https://www.npmjs.com/package/skill-graveyard)
[![license](https://img.shields.io/npm/l/skill-graveyard.svg)](LICENSE)
[![node](https://img.shields.io/node/v/skill-graveyard.svg)](package.json)

Docs & demo: <https://sfrangulov.github.io/skill-graveyard/> · built by [@sfrangulov](https://github.com/sfrangulov)

[![demo](docs/demo.gif)](https://asciinema.org/a/JFgkjIF1emExXjQe)

Audit which Claude Code skills you actually use. Parses your local session logs and sorts every skill name that appears into one of four buckets:

1. **Active** — installed AND invoked successfully. Keep.
2. **Dead** — installed but zero invocations in the window. Removal candidates.
3. **Missing** — invoked successfully, but no SKILL.md was found in any scanned path. Project-scoped skills, skills registered by an external framework injecting into Claude Code, or skills installed somewhere this tool doesn't yet look.
4. **Hallucinated** — invoked and the runtime returned an error. Mostly Claude confusing tool/command names with skill names; surfaced for telemetry but not directly actionable.

Same parser, multiple signals: it's not just a graveyard, it's an audit of where your skill setup is over- and under-provisioned.

### Companion tool: mcp-graveyard

The same dual-signal idea applied to MCP server tools: which configured servers
does Claude actually invoke, and which tool names is it hallucinating?

```sh
npx mcp-graveyard
```

Server-first audit, `prune` with automatic backup, and `projects` /
`suggest` for finer signals. See [packages/mcp-graveyard](packages/mcp-graveyard/).

## Why this exists

I had 65 skills installed across user, plugin, and agent paths. After parsing 30 days of my own session logs, I found Claude had actually invoked 14 of them. The other 51 were still loading their `description` strings into every API request — about 500K skill-metadata tokens over the window covering skills that were never called once. I built this so I could see the gap, and to surface a second signal I didn't expect: Claude regularly invokes built-in tool names (`Bash`, `Read`, `Edit`) as if they were skills, which the runtime then errors on. Same parser, both answers.

## Install

```sh
npx skill-graveyard
```

Or globally:

```sh
npm i -g skill-graveyard
skill-graveyard
```

Requires Node 18+.

## Usage

Six subcommands. `audit` is the default and is what you usually run.

```sh
skill-graveyard                       # 30-day audit, pretty table
skill-graveyard --days 14             # narrower window
skill-graveyard --only dead           # filter to removal candidates
skill-graveyard --json                # machine-readable

skill-graveyard prune                 # plan: print every command that would disable a dead skill
skill-graveyard prune --apply         # execute the unlinks (plugin removals always print only)

skill-graveyard suggest               # classify hallucinated/missing into actionable buckets
skill-graveyard projects              # break down skill usage per project (from session cwds)
skill-graveyard cost                  # estimate token cost of installed skill metadata
skill-graveyard outdated              # check installed plugins / git-tracked skills for upstream updates (network)
```

### `audit`

Sorts every skill name that appears in your sessions into four buckets, plus rolls up plugin groups where every skill is dead. Filter to one bucket with `--only active|dead|missing|hallucinated`.

Pipe to `jq` for custom queries:

```sh
skill-graveyard --json | jq '.rows[] | select(.category=="dead") | .invokeName'
```

### `prune`

Reads the audit and emits a removal plan, source-aware:

| source | dry-run output | with `--apply` |
|---|---|---|
| `user` (symlink in `~/.claude/skills/`) | `unlink <path>` | executes |
| `agents` (symlink in `~/.agents/skills/`) | `unlink <path>` | executes |
| `plugin` (every skill of the plugin is dead) | `claude /plugin remove <name>@<scope>` | prints only — run inside Claude Code |
| `plugin` (partially dead) | nothing | nothing |
| `project` (`<cwd>/.claude/skills/`) | nothing — out of scope | nothing |

`--apply` only executes unlinks (fully reversible: re-creating the symlink restores the skill). Plugin removals are always print-only because invoking `/plugin remove` from outside Claude Code is fragile. `--only user|agents|plugin` narrows the scope.

### `suggest`

Classifies the `MISSING` and `HALLUCINATED` rows into actionable buckets:

- **EXTERNAL FRAMEWORK** — skill is invoked from `~/.<framework>/...` cwd and resolves successfully, so it's registered by another framework Claude Code runs inside (paperclip, custom orchestrators, etc.). Recommendation: document these in your `CLAUDE.md` so future Claude knows the names are valid.
- **TOOL/SKILL CONFUSION** — Claude invoked a built-in CC tool name (`Bash`, `Read`, `Write`, `Edit`, etc.) as a skill. Known model failure mode, not actionable on your side.
- **LIKELY TYPO** — invoke name is within Levenshtein distance 2 of an installed skill. Worth reviewing the call sites.
- **UNCLASSIFIED** — no pattern matched. Manual review.

### `projects`

Groups every skill invocation by the `cwd` recorded in your session logs. Surfaces which projects use which skills heavily, which projects pull in hallucinated names, and which skills are project-scoped vs. globally used.

```
~/projects/api-server  17 ses, 39 calls, 6 skills
    superpowers:brainstorming                  13×
    superpowers:writing-plans                  11×
  ? update-config                               2×

~/projects/dotfiles  2 ses, 2 calls, 2 skills
    frontend-design                  1×
    superpowers:brainstorming        1×
```

`✗` marks errored (hallucinated) calls; `?` marks invoked names that aren't installed but didn't error (likely external-framework skills).

### `cost`

Estimates how many tokens your skill metadata consumes per session vs. how many of those tokens cover skills Claude actually invokes. Each installed skill's `description` field (from `SKILL.md` frontmatter) is loaded into the `Skill` tool definition on every API request, even if the skill is never invoked.

```
TOP WASTERS  desc tokens × sessions where never invoked
  playwright-best-practices    user           246 t × 0/159   39.1K
  ai-sdk                        user           151 t × 0/159   24.0K
  ...
```

Also surfaces hook injections (text auto-added to every session by `SessionStart` hooks) — these can dwarf skill metadata costs.

Token counts use the `cl100k_base` BPE tokenizer (a proxy for Claude's tokenizer, which Anthropic doesn't ship publicly for Claude 3+). Expect 5–15% drift from the real tokenizer. Anthropic prompt caching reduces dollar cost significantly, but loaded tokens still consume your context window and rate-limit budget.

### `outdated`

Checks installed plugins and git-tracked user/agent skills against their upstream sources, prints what's behind, and gives the exact command to update each. Network-bound — the only subcommand that calls out. Results are cached at `~/.cache/skill-graveyard/outdated/` with a 60-minute TTL by default.

```
skill-graveyard outdated — checked just now (3 cache hits)
plan: 12 plugins, 1 skill repo · 2 outdated · 9 up-to-date · 2 unknown

OUTDATED (2)
  plugins (1)
    superpowers@claude-plugins-official  b7a8f76 → 6efe32c
      → claude plugin update superpowers@claude-plugins-official
      affects: brainstorming, executing-plans, writing-plans (and 11 more)
  skill repos (1)
    ~/projects/my-skills  abc1234 → def5678
      → git -C ~/projects/my-skills pull --ff-only
      affects: foo, bar
```

For each plugin it follows the marketplace's `marketplace.json` to pick the right comparison: explicit version, pinned commit SHA, or upstream HEAD via `git ls-remote`. Plugins installed without a recorded version (`installedVersion: "unknown"`) are flagged with a reinstall hint instead of an update one — Claude Code's plugin manager records SHAs only on fresh installs.

```sh
skill-graveyard outdated --no-cache       # force refetch
skill-graveyard outdated --ttl 0          # equivalent: zero TTL = always miss
skill-graveyard outdated --ttl 1440       # cache for 24h
skill-graveyard outdated --json | jq '.rows[] | select(.status=="outdated")'
```

## What it reads

- `~/.claude/projects/**/*.jsonl` — session logs (skill invocations and `cwd` per session live in `tool_use` events)
- `~/.claude/plugins/installed_plugins.json` — registered plugins
- `~/.claude/plugins/known_marketplaces.json` — marketplace → repo mapping (for `outdated`)
- `~/.claude/skills/`, `~/.agents/skills/` — user-level skills
- `<plugin-install-path>/skills/` — plugin-bundled skills
- `<cwd-and-ancestors>/.claude/skills/` — project-scoped skills, walking up from each session's cwd to your home directory
- Network — only when `outdated` runs: `https://raw.githubusercontent.com/<repo>/HEAD/.claude-plugin/marketplace.json` for each registered marketplace, plus `git ls-remote` against marketplace and skill-repo origins. Results cached at `~/.cache/skill-graveyard/outdated/`.

Pass `--claude-dir` to override the Claude home location.

## What it does NOT do

- **Does not auto-disable plugin skills.** Plugin removal is a Claude Code slash command (`/plugin remove`) and invoking it from outside the runtime is fragile, so `prune` only prints the command. Run it inside Claude Code yourself.
- **Does not touch project-scoped skills.** Skills under `<project>/.claude/skills/` are intentional per-project artifacts; `prune` ignores them.
- **Does not phone home except when running `outdated`.** Five of the six subcommands are entirely local. `outdated` is the explicit exception — it fetches each registered marketplace's `marketplace.json` and runs `git ls-remote` against marketplace and skill-repo origins. Results are cached locally; everything else stays local.

## License

MIT
