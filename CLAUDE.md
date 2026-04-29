# CLAUDE.md

A CLI that audits which Claude Code skills the user actually invokes. It parses local session JSONL logs and cross-references the skill installs on disk to surface two signals from one parser:

1. **Dead installs** — skills present on disk, never invoked → safe to remove.
2. **Hallucinated invocations** — skills invoked that aren't installed → external-framework registrations, model tool/skill confusion, or typos.

The four user-facing buckets (active / dead / missing / hallucinated) and their definitions are documented in `README.md` and are a stable contract.

## This repo is public

No secrets, no proprietary client names, no real session data ever lands in `docs/` or `README.md`. Sample CLI output on the live site uses anonymized project names (e.g. `client-analytics`, `clientco/web-platform`) — keep that pattern when refreshing screenshots. If you spot a real-looking name slipping in, mask it before pushing.

## Layout

- `src/cli.ts` — argument routing; no business logic
- `src/{audit,prune,suggest,projects,cost}.ts` — one subcommand per file
- `src/{parser,discovery,paths,tokenizer,known_tools}.ts` — shared primitives reused across subcommands
- `src/format.ts` — every terminal rendering helper (sparkbars, tables, colors). Subcommands return data, this file prints
- `src/*.test.ts` — colocated; **must stay flat under `src/`** (see Tests below)
- `commands/audit-skills.md` — slash-command entry shipped with both the npm package and the Claude Code plugin
- `.claude-plugin/plugin.json` — Claude Code plugin manifest; its `version` must match `package.json`
- `docs/index.html` — single hand-written HTML page; the GitHub Pages source
- `docs/specs/` — design notes, not user-facing

## Development

```sh
npm install
npm run dev -- <subcommand>   # tsx, no build step
npm run typecheck             # tsc --noEmit (strict + noUncheckedIndexedAccess)
npm test                      # node --test, see below
npm run build                 # tsc → dist/, postbuild chmod +x cli.js
```

Node ≥18. Single runtime dep: `gpt-tokenizer`. Everything else is devDependencies.

### Tests

Tests run on Node's built-in test runner. The script is `node --import tsx --test src/*.test.ts` — single `*`, **unquoted**, shell-expanded. Do not change to `'src/**/*.test.ts'`: bash on Ubuntu CI doesn't expand `**` without `globstar`, and `node --test` on Node 20 won't expand a literal glob either. Both failure modes have happened. If tests ever need subdirectories, switch the test runner — don't paper over the glob.

Tests use real `fs` against `os.tmpdir()` fixtures. No `fs` mocking. The whole purpose of this tool is correctly walking real Claude Code install layouts; mocked filesystem tests would defeat the point.

### Intentional non-features

These look like missing features. Verify with the user before "fixing":

- `prune` never executes `/plugin remove`. It prints the command for the user to run inside Claude Code. Invoking CC slash commands from outside the runtime is fragile and is explicitly out of scope.
- `prune` ignores project-scoped skills (`<project>/.claude/skills/`). Per-project artifacts are intentional.
- No telemetry. No network calls anywhere in the runtime. `README.md` promises "all analysis is local" — keep it true.
- The `cost` subcommand uses `cl100k_base` BPE as a proxy for Claude's tokenizer (Anthropic doesn't publish one for Claude 3+). User-facing output must keep the 5–15% drift disclaimer.

## Release

### npm publish

1. Bump `version` in **both** `package.json` and `.claude-plugin/plugin.json`. They must stay in lock-step.
2. Run `npm pack --dry-run` first. Confirm the tarball contains `dist/`, `README.md`, `LICENSE`, `.claude-plugin/`, `commands/` — and check for warnings. npm has silently stripped fields before.
3. The `bin` path must be `dist/cli.js` — **no `./` prefix**. With `./`, npm strips the entire `bin` entry from the published tarball with only a warning. `npm pkg fix` will normalize this.
4. `npm publish` runs `prepublishOnly` (typecheck + test + build) automatically. It also requires an OTP from an authenticator app, which Claude cannot supply. From a Claude session, ask the user to run `! npm publish --otp=NNNNNN` so the result lands back in the conversation.
5. After publish: `git tag -a vX.Y.Z`, push the tag, then `gh release create vX.Y.Z` with release notes.

### Docs site

The Pages site (<https://sfrangulov.github.io/skill-graveyard/>) deploys automatically from `main` branch, path `/docs`. Any push touching `docs/` triggers `pages-build-deployment`. Live URL is referenced from `README.md`, the `homepage` field in `package.json`, and `homepage` in `.claude-plugin/plugin.json` — change all three together if the URL ever moves.

### CI

`.github/workflows/ci.yml` runs `typecheck`, `test`, `build` on Node 20 and 22 with `fail-fast` (default). One matrix entry failing cancels the other, so when debugging a CI failure check both job logs even if only one is marked failed.

## Conventions

- Commit subjects are short, lowercase, imperative ("fix ci test glob", not "Fixed the CI test glob"). No conventional-commits prefix. No `Co-Authored-By` line unless the user asks for one.
- Don't push automatically after committing. Wait for explicit confirmation.
- Don't run destructive git operations (force-push, hard reset, branch delete) without confirmation.
- `.claude/` at the repo root is local Claude Code state. It's untracked and intentionally not in `.gitignore` — leave it alone.
