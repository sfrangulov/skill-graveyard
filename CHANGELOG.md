# Changelog

All notable changes to skill-graveyard. Format loosely follows [Keep a Changelog](https://keepachangelog.com/).

## 0.6.0 — 2026-04-29

First public release. Distributed via npm and as a Claude Code plugin.

### Added

- **`projects` subcommand** — breaks down skill invocations by the `cwd` recorded in session logs. Surfaces which projects use which skills heavily, which projects pull in hallucinated names, and which skills are project-scoped vs. globally used.
- **Honest tokenization** — `cost` now uses the `cl100k_base` BPE tokenizer (via `gpt-tokenizer`) instead of `chars / 4`. The 5–15% drift from Claude's real tokenizer is documented in user-facing output; `chars / 4` could be off by ~30%.
- **Claude Code plugin manifest** — `.claude-plugin/plugin.json` and `commands/audit-skills.md` ship in the npm package, so the same install also registers as a CC plugin.
- **GitHub Pages site** — [sfrangulov.github.io/skill-graveyard](https://sfrangulov.github.io/skill-graveyard/) with live CLI output and copy-pasteable commands.

### Fixed

- `bin` path normalized to `dist/cli.js` (no `./` prefix). With the prefix, npm silently strips the `bin` entry from published tarballs and the global install is broken.
- `postbuild` now runs `chmod +x dist/cli.js` so the published binary is actually executable.
- CI test glob: `node --test src/*.test.ts` (single `*`, unquoted). The `'src/**/*.test.ts'` form silently matches nothing on Ubuntu CI.

## 0.5.0 — 2026-04-28

### Added

- **`cost` subcommand** — estimates how many tokens of skill-metadata get loaded into every session, broken down by skill and ranked by waste (description size × sessions where skill was never invoked). Also surfaces hook injections.

## 0.4.0 — 2026-04-27

### Added

- Dashboard layout, grouped lists, sparkbar trend visuals.

### Fixed

- Adaptive column width for the ACTIVE table; column header was being truncated.

## 0.3.0 — 2026-04-26

### Added

- **Plugin rollup** — when every skill of a plugin is dead, audit groups them under a single removable plugin entry.
- **`prune` subcommand** — emits a source-aware removal plan; `--apply` executes user/agents unlinks. Plugin removals are always print-only (the user must run `/plugin remove` inside Claude Code).
- **`suggest` subcommand** — classifies missing/hallucinated invocations into actionable buckets (external framework, tool/skill confusion, likely typo, unclassified).

## 0.2.0 — 2026-04-25

Initial public-ish version. Audit only, four-bucket model.
