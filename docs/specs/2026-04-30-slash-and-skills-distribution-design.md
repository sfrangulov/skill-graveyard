# slash-command routers + skills.sh distribution — design

Date: 2026-04-30
Status: draft, awaiting user review before implementation plan

## Goal

Make both binaries (`skill-graveyard`, `mcp-graveyard`) invokable from inside a Claude Code session through two complementary surfaces:

1. **Slash command routers** — explicit invocation by a user who has the plugin installed: `/skill-graveyard:run audit --days 14`. Pass-through to the binary.
2. **skills.sh-publishable Agent Skills** — `SKILL.md` files in `skills/<name>/` that the [skills.sh](https://skills.sh/) CLI auto-discovers from the GitHub repo. Once installed via `npx skills add sfrangulov/skill-graveyard`, Claude auto-invokes the skill in any session when the user describes an audit-shaped task.

The two channels are independent and complementary. A user can install neither, one, or both; each on its own gives a working invocation path. Existing `commands/audit-skills.md` and `packages/mcp-graveyard/commands/audit-mcp-tools.md` (auto-audit + AI summary) are untouched — they remain the "smart shortcut" alongside the new explicit router.

## Non-goals

- No AI interpretation in the router commands. The user explicitly chose what to run; print the binary output verbatim.
- No tests for these files — they are static markdown configs with no logic.
- No npm-tarball changes. The skills.sh distribution channel reads the GitHub repo directly; SKILL.md files do not need to ship in the published packages.
- No deletion / replacement of existing slash commands.

## Files added

```
commands/run.md                            # skill-graveyard slash router
packages/mcp-graveyard/commands/run.md     # mcp-graveyard slash router
skills/skill-graveyard/SKILL.md            # skills.sh-discoverable skill
skills/mcp-graveyard/SKILL.md              # skills.sh-discoverable skill
```

## Slash command routers

### `commands/run.md` (skill-graveyard)

```markdown
---
description: Run any skill-graveyard subcommand (audit, prune, suggest, projects, cost, outdated)
allowed-tools: Bash(skill-graveyard:*), Bash(npx skill-graveyard:*)
argument-hint: <subcommand> [flags]
---

Run `skill-graveyard $ARGUMENTS` (fall back to `npx skill-graveyard@latest $ARGUMENTS` if the binary isn't on PATH). Print the output verbatim — do not summarize or interpret.
```

### `packages/mcp-graveyard/commands/run.md`

```markdown
---
description: Run any mcp-graveyard subcommand (audit, prune, suggest, projects)
allowed-tools: Bash(mcp-graveyard:*), Bash(npx mcp-graveyard:*)
argument-hint: <subcommand> [flags]
---

Run `mcp-graveyard $ARGUMENTS` (fall back to `npx mcp-graveyard@latest $ARGUMENTS` if the binary isn't on PATH). Print the output verbatim — do not summarize or interpret.
```

**Empty `$ARGUMENTS` behavior.** Both binaries default to `audit` when no subcommand is passed (existing CLI behavior). So `/skill-graveyard:run` with no args runs an audit. Free bonus, no special handling required.

### Packaging into npm tarballs

- **skill-graveyard.** `commands/` is at repo root; the `prepack`/`postpack` scripts in `packages/skill-graveyard/package.json` already copy it into the package dir at pack time. New `commands/run.md` is picked up automatically.
- **mcp-graveyard.** `commands/` lives inside the package directory — no copy hack. New file is picked up automatically.

## Agent Skills (`SKILL.md`)

### Format and discovery contract

Skills.sh / the `skills` CLI (open source at [vercel-labs/skills](https://github.com/vercel-labs/skills)) discover skills by walking standard directories (`skills/`, `.claude/skills/`, `.agents/skills/`, …) in a GitHub repo. Each skill is a directory containing a `SKILL.md` file. Required frontmatter fields: `name` (lowercase identifier), `description` (the trigger surface — Claude reads this to decide when to auto-invoke).

### `skills/skill-graveyard/SKILL.md`

```markdown
---
name: skill-graveyard
description: Audit which Claude Code skills you actually invoke. Use when the user
  wants to find dead/unused skills, hallucinated skill invocations, per-project skill
  stats, or token cost of installed skill metadata. Triggers on "what skills don't
  I use?", "clean up my skills", "why didn't this skill work?", "audit skills".
  Runs locally; reads ~/.claude session JSONL logs. No network calls.
---

# skill-graveyard

CLI that audits Claude Code skill usage. Two signals from one parser:

1. **Dead installs** — installed but never invoked → safe to remove.
2. **Hallucinated invocations** — invoked but not installed → typos, external-framework
   registrations, or model tool/skill confusion.

## How to invoke

Run via `npx skill-graveyard@latest <subcommand> [flags]` — no install needed.

## Subcommands

- `audit` (default) — classify into active / dead / missing / hallucinated.
  Flags: `--days N`, `--only <bucket>`, `--json`, `--claude-dir <path>`.
- `prune` — print removal commands for dead skills. `--apply` to execute (user/agents
  only; plugin removals always print only).
- `suggest` — triage hallucinated/missing into actionable buckets.
- `projects` — per-project usage breakdown (cwd from sessions).
- `cost` — token cost estimate of installed metadata vs invocations.
- `outdated` — check installed plugins / git skills for upstream updates (network).

## Decision flow

- "are there skills I don't use?" → `npx skill-graveyard@latest`
- "clean up unused skills" → `prune`, then `prune --apply`
- "skill X didn't work" → `suggest` (look for hallucinated/missing entry)
- per-project view → `projects`
- token cost → `cost`
- check updates → `outdated`

After running, print binary output as-is. Do not summarize unless the user asks.
```

### `skills/mcp-graveyard/SKILL.md`

```markdown
---
name: mcp-graveyard
description: Audit which MCP server tools your Claude Code sessions actually invoke.
  Use when the user wants to find dead MCP servers (configured but never called),
  hallucinated MCP tool calls, or per-project MCP usage. Triggers on "which MCP
  servers don't I use?", "clean up MCP config", "remove unused MCP servers",
  "audit MCP tools". Runs locally; reads ~/.claude session JSONL logs and
  ~/.claude.json. No network calls.
---

# mcp-graveyard

CLI that audits MCP server tool usage. Server-first table grouped into
ACTIVE / DEAD / HALLUCINATED / MISSING buckets.

## How to invoke

Run via `npx mcp-graveyard@latest <subcommand> [flags]` — no install needed.

## Subcommands

- `audit` (default) — classify every server.
  Flags: `--days N`, `--only <bucket>`, `--tools <server>` (drill-in), `--json`,
  `--claude-dir <path>`.
- `prune` — print removal plan. `--apply` to execute (with auto-backup of removed
  config to a timestamped file).
- `suggest` — actionable triage for unused/hallucinated.
- `projects` — per-project breakdown.

## Decision flow

- "which MCP servers do I not use?" → `npx mcp-graveyard@latest`
- "clean up MCP config" → `prune`, then `--apply`
- "MCP tool didn't work" → `suggest`
- per-project breakdown → `projects`

After running, print output verbatim. Do not summarize unless the user asks.
```

### Tarball impact

The `skills/` directory at repo root is **not** in any package's `files` array and is **not** copied by any `prepack` script. It exists only in the GitHub repo for skills.sh to read. This is the intended design — the two distribution channels stay decoupled.

## Documentation updates

- `README.md` — add an "Install via skills.sh" subsection alongside the existing "Install as Claude Code plugin" instructions, for both packages.
- `docs/index.html` — add a skills.sh badge / link in the install section. Keep messaging short; the lander already covers two install paths (npm, Claude Code plugin), this becomes a third.

## Release considerations

- Slash command files (`commands/run.md`, `packages/mcp-graveyard/commands/run.md`) → commit with `feat:` prefix. Release-please will open a Release PR with a minor bump for both `skill-graveyard` and `mcp-graveyard`.
- SKILL.md files (`skills/*/SKILL.md`) → commit with `chore:` prefix. They do not ship in any npm tarball, so no version bump needed; CHANGELOG can still mention the new distribution channel as a `chore`.
- Documentation updates → `docs:` prefix per existing repo convention.

The PR can bundle all of this in one or two commits (router-feat, skills-chore, docs-chore). No manual `npm publish` / `git tag` — release-please owns that pipeline.

## Verification before declaring done

1. `npm pack --workspace=skill-graveyard --dry-run` lists `commands/run.md` in the tarball file list.
2. `npm pack --workspace=mcp-graveyard --dry-run` lists `commands/run.md` in the tarball file list.
3. Neither tarball lists anything under `skills/`.
4. Manual smoke test from inside Claude Code: `/skill-graveyard:run --days 7` runs the binary and prints the table.
5. (Manual, deferred to publish time) After release-please ships, `npx skills add sfrangulov/skill-graveyard` should install the skill from the GitHub repo.
