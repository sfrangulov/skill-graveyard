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

```sh
skill-graveyard                       # 30-day audit, pretty table
skill-graveyard --days 14             # narrower window
skill-graveyard --only dead           # show only removal candidates
skill-graveyard --only missing        # show only resolved-but-undiscovered skills
skill-graveyard --only hallucinated   # show only Claude-side mistakes
skill-graveyard --json                # machine-readable
```

Pipe to `jq` for filtering:

```sh
skill-graveyard --json | jq '.rows[] | select(.category=="missing") | .invokeName'
```

## What it reads

- `~/.claude/projects/**/*.jsonl` — session logs (skill invocations and `cwd` per session live in `tool_use` events)
- `~/.claude/plugins/installed_plugins.json` — registered plugins
- `~/.claude/skills/`, `~/.agents/skills/` — user-level skills
- `<plugin-install-path>/skills/` — plugin-bundled skills
- `<cwd-and-ancestors>/.claude/skills/` — project-scoped skills, walking up from each session's cwd to your home directory

Pass `--claude-dir` to override the Claude home location.

## What it does NOT do

- **Does not auto-disable anything.** Removal mechanism varies per source (symlinks, plugin marketplaces, settings.json) and false-positive risk on rarely-used-but-critical skills (security audits, deployment helpers) is high. Report-only by design.
- **Does not phone home.** All analysis is local.

## License

MIT
