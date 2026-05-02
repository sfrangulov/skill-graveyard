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
