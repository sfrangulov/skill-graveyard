# CLAUDE.md

A CLI that audits which Claude Code skills the user actually invokes. It parses local session JSONL logs and cross-references the skill installs on disk to surface two signals from one parser:

1. **Dead installs** — skills present on disk, never invoked → safe to remove.
2. **Hallucinated invocations** — skills invoked that aren't installed → external-framework registrations, model tool/skill confusion, or typos.

The four user-facing buckets (active / dead / missing / hallucinated) and their definitions are documented in `README.md` and are a stable contract.

## This repo is public

No secrets, no proprietary client names, no real session data ever lands in `docs/` or `README.md`. Sample CLI output on the live site uses anonymized project names (e.g. `client-analytics`, `clientco/web-platform`) — keep that pattern when refreshing screenshots. If you spot a real-looking name slipping in, mask it before pushing.

## Layout

This is an npm workspaces monorepo:

- `packages/core/` — `@skill-graveyard/core` (published). Shared parser, discovery, paths, tokenizer, known_tools. Generic `parseToolCalls<T>` lets sister CLIs reuse the JSONL stream.
- `packages/skill-graveyard/` — published as `skill-graveyard`. CLI, all subcommand implementations (`audit`, `prune`, `suggest`, `projects`, `cost`, `outdated`), `format.ts`.
- `packages/mcp-graveyard/` — published as `mcp-graveyard`. CLI for auditing MCP server tool usage. Mirrors skill-graveyard's bucket model (active/dead/missing/hallucinated) but for MCP servers. Plugin assets (`.claude-plugin/`, `commands/`) live INSIDE the package — no prepack/postpack copy hack.
- `.claude-plugin/`, `commands/` — plugin assets at repo root. Pulled into the `skill-graveyard` tarball at pack time via `prepack`/`postpack` scripts in `packages/skill-graveyard/package.json` (which copy them into the package dir before pack and remove them after).
- `docs/` — Pages site (`docs/index.html`) and design specs (`docs/specs/`).

Inside each package:
- `src/cli.ts` (skill-graveyard only) — argument routing; no business logic.
- `src/{audit,prune,suggest,projects,cost,outdated}.ts` — one subcommand per file (skill-graveyard).
- `src/{parser,discovery,paths,tokenizer,known_tools}.ts` — primitives (core).
- `src/format.ts` (skill-graveyard) — every terminal rendering helper (sparkbars, tables, colors). Subcommands return data; this file prints.
- `src/*.test.ts` — colocated; flat under each package's `src/`.

## Development

```sh
npm install
npm run build --workspace=@skill-graveyard/core   # build core first; skill-graveyard depends on its dist
npm run dev --workspace=skill-graveyard -- <subcommand>   # tsx, no build step
npm run typecheck    # both workspaces (delegates via --workspaces --if-present)
npm test             # both workspaces
npm run build        # both workspaces
```

Node ≥18. Runtime deps: `gpt-tokenizer` (in `@skill-graveyard/core`). `skill-graveyard` itself only depends on `@skill-graveyard/core` at runtime.

### Tests

Each package runs the same `node --import tsx --test src/*.test.ts` pattern. Single `*`, **unquoted**, shell-expanded — do not change to `'src/**/*.test.ts'`: bash on Ubuntu CI doesn't expand `**` without `globstar`, and `node --test` on Node 20 won't expand a literal glob either. Both failure modes have happened. If tests ever need subdirectories within a package, switch the test runner — don't paper over the glob.

Tests use real `fs` against `os.tmpdir()` fixtures. No `fs` mocking. The whole purpose of this tool is correctly walking real Claude Code install layouts; mocked filesystem tests would defeat the point.

### Intentional non-features

These look like missing features. Verify with the user before "fixing":

- `prune` never executes `/plugin remove`. It prints the command for the user to run inside Claude Code. Invoking CC slash commands from outside the runtime is fragile and is explicitly out of scope.
- `prune` ignores project-scoped skills (`<project>/.claude/skills/`). Per-project artifacts are intentional.
- No telemetry. No network calls anywhere in the runtime. `README.md` promises "all analysis is local" — keep it true.
- The `cost` subcommand uses `cl100k_base` BPE as a proxy for Claude's tokenizer (Anthropic doesn't publish one for Claude 3+). User-facing output must keep the 5–15% drift disclaimer.

## Release

### npm publish

Two packages publish independently. Order: when both need releasing, **publish `@skill-graveyard/core` first**, then `skill-graveyard` (so its `^0.1.0` core dep resolves on the registry).

1. Bump `version` in lock-step within each package: `packages/<name>/package.json` and (for `skill-graveyard`) `.claude-plugin/plugin.json` must match.
2. `npm pack --workspace=<name> --dry-run` first. For `skill-graveyard`, confirm the tarball contains `dist/`, `README.md`, `LICENSE`, `.claude-plugin/`, `commands/`. The `prepack` script handles the parent-dir asset copy; if `npm pack` errors mid-way, `postpack` does NOT run — manually clean with `rm -rf packages/skill-graveyard/{.claude-plugin,commands,README.md,LICENSE}` if `git status` is dirty.
3. `bin` path in `packages/skill-graveyard/package.json` must be `dist/cli.js` — **no `./` prefix**. With `./`, npm strips the entire `bin` entry from the published tarball with only a warning. `npm pkg fix` will normalize this.
4. `npm publish --workspace=<name>` runs that workspace's `prepublishOnly` automatically. Requires an OTP from an authenticator app — ask the user to run `! npm publish --workspace=<name> --otp=NNNNNN` so the result lands in the conversation.
5. After publish: `git tag -a <name>@vX.Y.Z`, push the tag, then `gh release create <name>@vX.Y.Z` with release notes (skill-graveyard only — core releases are internal-facing, no GitHub release).

### Docs site

The Pages site (<https://sfrangulov.github.io/skill-graveyard/>) deploys automatically from `main` branch, path `/docs`. Any push touching `docs/` triggers `pages-build-deployment`. Live URL is referenced from `README.md`, the `homepage` field in `package.json`, and `homepage` in `.claude-plugin/plugin.json` — change all three together if the URL ever moves.

### CI

`.github/workflows/ci.yml` runs `typecheck`, `test`, `build` per workspace via a 6-cell matrix: `{@skill-graveyard/core, skill-graveyard, mcp-graveyard} × {Node 20, Node 22}`. **`fail-fast: false`** — one cell's failure does not cancel the others. Before skill-graveyard's typecheck/test/build runs, a conditional step builds `@skill-graveyard/core` first (skill-graveyard imports types from `packages/core/dist/`).

## Conventions

- Commit subjects are short, lowercase, imperative ("fix ci test glob", not "Fixed the CI test glob"). No conventional-commits prefix. No `Co-Authored-By` line unless the user asks for one.
- Don't push automatically after committing. Wait for explicit confirmation.
- Don't run destructive git operations (force-push, hard reset, branch delete) without confirmation.
- `.claude/` at the repo root is local Claude Code state. It's untracked and intentionally not in `.gitignore` — leave it alone.
