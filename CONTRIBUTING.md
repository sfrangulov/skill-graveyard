# Contributing

skill-graveyard is small on purpose. Contributions welcome — bugfixes, edge cases I missed in session-log parsing, new subcommands that fit the audit theme.

If you're new to the repo, look for issues tagged [`good first issue`](https://github.com/sfrangulov/skill-graveyard/labels/good%20first%20issue). Each one is scoped to be shippable in under an hour.

## Dev setup

Requires Node ≥18.

```sh
git clone https://github.com/sfrangulov/skill-graveyard
cd skill-graveyard
npm install
npm run dev -- audit            # run the CLI directly via tsx, no build
npm run dev -- --help
```

There's no separate `dev` server or watch mode — `tsx` runs TypeScript directly, so just re-run `npm run dev -- <args>` after each edit.

## Running tests

```sh
npm run typecheck
npm test
```

Tests use Node's built-in test runner (`node --test`) and run against real `os.tmpdir()` fixtures — no `fs` mocking. The whole point of the tool is correctly walking real Claude Code install layouts; mocked filesystem tests would defeat the purpose.

Test files live colocated under `src/*.test.ts`. New tests should follow the same flat layout (the test glob is `src/*.test.ts`, single `*`, intentional — see `CLAUDE.md` for the gotcha).

## Project layout

- `src/cli.ts` — argument routing only, no business logic
- `src/{audit,prune,suggest,projects,cost}.ts` — one subcommand per file
- `src/{parser,discovery,paths,tokenizer,known_tools}.ts` — shared primitives
- `src/format.ts` — terminal rendering helpers (sparkbars, tables, colors). Subcommands return data, this file prints.
- `commands/audit-skills.md` — Claude Code slash-command entry
- `.claude-plugin/plugin.json` — plugin manifest; version stays in lock-step with `package.json`

## Style notes

- **Strict TypeScript.** `strict` + `noUncheckedIndexedAccess`. Don't loosen these to make code easier — fix the type instead.
- **No emoji in code or commit messages.**
- **Comments only when the *why* is non-obvious** (a hidden constraint, a workaround, a behavior that would surprise a reader). Don't comment what the code does.
- **Commit subjects: short, lowercase, imperative.** `fix audit window edge case`, not `Fixed the audit window edge case`. No `feat:` / `fix:` prefixes.
- **No `Co-Authored-By` lines** unless co-authorship was actually shared.

## Things outside scope

These look like missing features but are intentional. If your PR adds one of these, expect pushback:

- **Auto-removing plugin skills.** `prune` only prints `claude /plugin remove`. Invoking CC slash commands from outside the runtime is fragile and explicitly out of scope.
- **Touching project-scoped skills under `<project>/.claude/skills/`.** These are intentional per-project artifacts; `prune` ignores them.
- **Telemetry / network calls.** README promises "all analysis is local." Don't add a fetch.
- **Replacing `cl100k_base` with a "real" Claude tokenizer.** Anthropic doesn't ship one publicly for Claude 3+; the 5–15% drift from `cl100k_base` is documented and acceptable.

## PRs

- Branch from `main`, not from a tag.
- Keep the diff small. One logical change per PR.
- If your change affects user-facing output, update the README example for the relevant subcommand.
- If your change adds a flag, add a row to the relevant flag table in README.
- CI runs typecheck + tests on Node 20 and 22; both must pass. CI uses `fail-fast`, so if one matrix entry fails the other gets cancelled — check both job logs.

## Questions

Open a [Discussion](https://github.com/sfrangulov/skill-graveyard/discussions) for design questions, an [Issue](https://github.com/sfrangulov/skill-graveyard/issues) for bug reports.
