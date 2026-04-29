# skill-graveyard

Audit which Claude Code skills you actually use. Parses your local session logs and sorts every skill name that appears into one of four buckets:

1. **Active** — installed AND invoked successfully. Keep.
2. **Dead** — installed but zero invocations in the window. Removal candidates.
3. **Missing** — invoked successfully, but no SKILL.md was found in any scanned path. Project-scoped skills, skills registered by an external framework injecting into Claude Code, or skills installed somewhere this tool doesn't yet look.
4. **Hallucinated** — invoked and the runtime returned an error. Mostly Claude confusing tool/command names with skill names; surfaced for telemetry but not directly actionable.

Same parser, multiple signals: it's not just a graveyard, it's an audit of where your skill setup is over- and under-provisioned.

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

Three subcommands. `audit` is the default and is what you usually run.

```sh
skill-graveyard                       # 30-day audit, pretty table
skill-graveyard --days 14             # narrower window
skill-graveyard --only dead           # filter to removal candidates
skill-graveyard --json                # machine-readable

skill-graveyard prune                 # plan: print every command that would disable a dead skill
skill-graveyard prune --apply         # execute the unlinks (plugin removals always print only)

skill-graveyard suggest               # classify hallucinated/missing into actionable buckets
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

## What it reads

- `~/.claude/projects/**/*.jsonl` — session logs (skill invocations and `cwd` per session live in `tool_use` events)
- `~/.claude/plugins/installed_plugins.json` — registered plugins
- `~/.claude/skills/`, `~/.agents/skills/` — user-level skills
- `<plugin-install-path>/skills/` — plugin-bundled skills
- `<cwd-and-ancestors>/.claude/skills/` — project-scoped skills, walking up from each session's cwd to your home directory

Pass `--claude-dir` to override the Claude home location.

## What it does NOT do

- **Does not auto-disable plugin skills.** Plugin removal is a Claude Code slash command (`/plugin remove`) and invoking it from outside the runtime is fragile, so `prune` only prints the command. Run it inside Claude Code yourself.
- **Does not touch project-scoped skills.** Skills under `<project>/.claude/skills/` are intentional per-project artifacts; `prune` ignores them.
- **Does not phone home.** All analysis is local. No telemetry, no network calls.

## License

MIT
