# Slash command routers + skills.sh distribution — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four files (two slash command routers + two SKILL.md files) so both binaries can be invoked from inside Claude Code via `/skill-graveyard:run` / `/mcp-graveyard:run`, AND so the same tools become discoverable through the [skills.sh](https://skills.sh/) Agent Skills registry.

**Architecture:** Pure additions — no source code, no tests, no behavior change. Two distribution channels (npm-via-plugin and skills.sh-via-`npx skills add`) sit side-by-side and don't interact. Existing `audit-skills.md` / `audit-mcp-tools.md` slash commands stay untouched.

**Tech Stack:** Markdown only. No build, no runtime change.

**Spec:** `docs/specs/2026-04-30-slash-and-skills-distribution-design.md`

---

## File structure

| Path | Type | Purpose |
|---|---|---|
| `commands/run.md` | new | skill-graveyard slash router (ships via existing prepack into the npm tarball) |
| `packages/mcp-graveyard/commands/run.md` | new | mcp-graveyard slash router (ships natively, no prepack hack) |
| `skills/skill-graveyard/SKILL.md` | new | skills.sh-discoverable Agent Skill (does NOT ship in any npm tarball) |
| `skills/mcp-graveyard/SKILL.md` | new | skills.sh-discoverable Agent Skill (does NOT ship in any npm tarball) |
| `README.md` | modify | add skills.sh install path next to existing instructions |
| `docs/index.html:713-733` | modify | add 4th install card to skill-graveyard install section |
| `docs/index.html:776-792` | modify | add 4th install card to mcp-graveyard install section |

## Commit strategy

Release-please uses component-scoped commits (`feat(<component>): …`) where the component is defined in `release-please-config.json`. Files at repo root (like `commands/run.md`) are NOT auto-attributed to a package by path — they need a scoped commit to trigger the right version bump.

| Commit | Type | Files | Effect |
|---|---|---|---|
| 1 | `feat(skill-graveyard)` | `commands/run.md` | bumps `skill-graveyard` minor |
| 2 | `feat(mcp-graveyard)` | `packages/mcp-graveyard/commands/run.md` | bumps `mcp-graveyard` minor |
| 3 | `chore` | `skills/skill-graveyard/SKILL.md`, `skills/mcp-graveyard/SKILL.md` | no version bump (correct — skills.sh reads from GitHub repo, not npm) |
| 4 | `docs` | `README.md` | no version bump |
| 5 | `docs` | `docs/index.html` | no version bump |

After merge, release-please opens a Release PR for both plugin packages.

---

## Task 1: Add `commands/run.md` (skill-graveyard slash router)

**Files:**
- Create: `commands/run.md`

- [ ] **Step 1: Write the file**

```markdown
---
description: Run any skill-graveyard subcommand (audit, prune, suggest, projects, cost, outdated)
allowed-tools: Bash(skill-graveyard:*), Bash(npx skill-graveyard:*)
argument-hint: <subcommand> [flags]
---

Run `skill-graveyard $ARGUMENTS` (fall back to `npx skill-graveyard@latest $ARGUMENTS` if the binary isn't on PATH). Print the output verbatim — do not summarize or interpret.
```

- [ ] **Step 2: Verify file was written correctly**

Run: `cat commands/run.md`
Expected: file contents above print to stdout, no diff.

- [ ] **Step 3: Verify it ships in the skill-graveyard tarball**

Run: `npm pack --dry-run --workspace=skill-graveyard 2>&1 | grep 'commands/run.md'`
Expected: line like `npm notice 248B commands/run.md` (size approximate).

The existing `prepack` script copies repo-root `commands/` into the package dir before pack, so this should work without modification.

- [ ] **Step 4: Commit**

```sh
git add commands/run.md
git commit -m "feat(skill-graveyard): add /run slash command router

Pass-through router exposing every subcommand (audit/prune/suggest/projects/
cost/outdated) via /skill-graveyard:run <args>. Empty args defaults to audit
(existing CLI behavior). Existing /audit-skills command (with AI summary)
unchanged."
```

---

## Task 2: Add `packages/mcp-graveyard/commands/run.md` (mcp-graveyard slash router)

**Files:**
- Create: `packages/mcp-graveyard/commands/run.md`

- [ ] **Step 1: Write the file**

```markdown
---
description: Run any mcp-graveyard subcommand (audit, prune, suggest, projects)
allowed-tools: Bash(mcp-graveyard:*), Bash(npx mcp-graveyard:*)
argument-hint: <subcommand> [flags]
---

Run `mcp-graveyard $ARGUMENTS` (fall back to `npx mcp-graveyard@latest $ARGUMENTS` if the binary isn't on PATH). Print the output verbatim — do not summarize or interpret.
```

- [ ] **Step 2: Verify file was written correctly**

Run: `cat packages/mcp-graveyard/commands/run.md`
Expected: file contents above print to stdout, no diff.

- [ ] **Step 3: Verify it ships in the mcp-graveyard tarball**

Run: `npm pack --dry-run --workspace=mcp-graveyard 2>&1 | grep 'commands/run.md'`
Expected: line like `npm notice 240B commands/run.md`. mcp-graveyard's `commands/` already lives inside the package, no prepack involved.

- [ ] **Step 4: Commit**

```sh
git add packages/mcp-graveyard/commands/run.md
git commit -m "feat(mcp-graveyard): add /run slash command router

Pass-through router exposing every subcommand (audit/prune/suggest/projects)
via /mcp-graveyard:run <args>. Empty args defaults to audit (existing CLI
behavior). Existing /audit-mcp-tools command unchanged."
```

---

## Task 3: Add `skills/skill-graveyard/SKILL.md` and `skills/mcp-graveyard/SKILL.md` (skills.sh)

**Files:**
- Create: `skills/skill-graveyard/SKILL.md`
- Create: `skills/mcp-graveyard/SKILL.md`

- [ ] **Step 1: Create `skills/skill-graveyard/SKILL.md`**

```markdown
---
name: skill-graveyard
description: Audit which Claude Code skills you actually invoke. Use when the user wants to find dead/unused skills, hallucinated skill invocations, per-project skill stats, or token cost of installed skill metadata. Triggers on "what skills don't I use?", "clean up my skills", "why didn't this skill work?", "audit skills". Runs locally; reads ~/.claude session JSONL logs. No network calls.
---

# skill-graveyard

CLI that audits Claude Code skill usage. Two signals from one parser:

1. **Dead installs** — installed but never invoked → safe to remove.
2. **Hallucinated invocations** — invoked but not installed → typos, external-framework registrations, or model tool/skill confusion.

## How to invoke

Run via `npx skill-graveyard@latest <subcommand> [flags]` — no install needed.

## Subcommands

- `audit` (default) — classify into active / dead / missing / hallucinated. Flags: `--days N`, `--only <bucket>`, `--json`, `--claude-dir <path>`.
- `prune` — print removal commands for dead skills. `--apply` to execute (user/agents only; plugin removals always print only).
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

- [ ] **Step 2: Create `skills/mcp-graveyard/SKILL.md`**

```markdown
---
name: mcp-graveyard
description: Audit which MCP server tools your Claude Code sessions actually invoke. Use when the user wants to find dead MCP servers (configured but never called), hallucinated MCP tool calls, or per-project MCP usage. Triggers on "which MCP servers don't I use?", "clean up MCP config", "remove unused MCP servers", "audit MCP tools". Runs locally; reads ~/.claude session JSONL logs and ~/.claude.json. No network calls.
---

# mcp-graveyard

CLI that audits MCP server tool usage. Server-first table grouped into ACTIVE / DEAD / HALLUCINATED / MISSING buckets.

## How to invoke

Run via `npx mcp-graveyard@latest <subcommand> [flags]` — no install needed.

## Subcommands

- `audit` (default) — classify every server. Flags: `--days N`, `--only <bucket>`, `--tools <server>` (drill-in), `--json`, `--claude-dir <path>`.
- `prune` — print removal plan. `--apply` to execute (with auto-backup of removed config to a timestamped file).
- `suggest` — actionable triage for unused/hallucinated.
- `projects` — per-project breakdown.

## Decision flow

- "which MCP servers do I not use?" → `npx mcp-graveyard@latest`
- "clean up MCP config" → `prune`, then `--apply`
- "MCP tool didn't work" → `suggest`
- per-project breakdown → `projects`

After running, print output verbatim. Do not summarize unless the user asks.
```

- [ ] **Step 3: Verify both files were written**

Run: `ls -la skills/*/SKILL.md && head -2 skills/skill-graveyard/SKILL.md skills/mcp-graveyard/SKILL.md`
Expected: both files exist; both start with `---` and a `name:` line.

- [ ] **Step 4: Verify SKILL.md does NOT ship in either npm tarball**

Run: `npm pack --dry-run --workspace=skill-graveyard 2>&1 | grep -i skill.md || echo "OK: no SKILL.md in tarball"`
Expected: `OK: no SKILL.md in tarball`

Run: `npm pack --dry-run --workspace=mcp-graveyard 2>&1 | grep -i skill.md || echo "OK: no SKILL.md in tarball"`
Expected: `OK: no SKILL.md in tarball`

(Both `package.json` `files:` arrays only list `dist`, `README.md`, `LICENSE`, `.claude-plugin`, `commands` — `skills/` at repo root is invisible to either pack.)

- [ ] **Step 5: Commit**

```sh
git add skills/
git commit -m "chore: add skills.sh-discoverable SKILL.md files

Two SKILL.md files (skill-graveyard, mcp-graveyard) under skills/ for the
[skills.sh](https://skills.sh/) Agent Skills registry. Installable via
'npx skills add sfrangulov/skill-graveyard'. Independent of the npm/plugin
distribution — neither file ships in any npm tarball."
```

---

## Task 4: Update `README.md` to document skills.sh install path

**Files:**
- Modify: `README.md` (skill-graveyard install section, after line 57)

- [ ] **Step 1: Replace the existing Install section**

Find this block (lines 44-57):

```markdown
## Install

\`\`\`sh
npx skill-graveyard
\`\`\`

Or globally:

\`\`\`sh
npm i -g skill-graveyard
skill-graveyard
\`\`\`

Requires Node 18+.
```

Replace with:

```markdown
## Install

\`\`\`sh
npx skill-graveyard
\`\`\`

Or globally:

\`\`\`sh
npm i -g skill-graveyard
skill-graveyard
\`\`\`

Or as a Claude Code skill (auto-discovered by Claude in any session, via [skills.sh](https://skills.sh/)):

\`\`\`sh
npx skills add sfrangulov/skill-graveyard
\`\`\`

The skills.sh install adds a SKILL.md to your Claude Code skills directory; Claude will pick it up automatically when you ask audit-shaped questions ("which skills don't I use?", "clean up my skills"). Compatible with the npm install — they don't conflict.

Requires Node 18+.
```

- [ ] **Step 2: Verify the diff**

Run: `git diff README.md`
Expected: only the Install section changes; everything before/after stays identical.

- [ ] **Step 3: Commit**

```sh
git add README.md
git commit -m "docs: document skills.sh install path in README"
```

---

## Task 5: Update `docs/index.html` install sections (add 4th install card to both)

**Files:**
- Modify: `docs/index.html:713-733` (skill-graveyard install section, change `Three ways in.` to `Four ways in.` and add new card)
- Modify: `docs/index.html:776-792` (mcp-graveyard install section, add same kind of card)

- [ ] **Step 1: Update skill-graveyard install section heading and add 4th card**

Locate lines 713-733. Change `<h2>Three ways in.</h2>` → `<h2>Four ways in.</h2>`, then insert a new `<div class="path">` card after the existing `claude code plugin` card (after line 732, before `</div>` on line 733):

```html
      <div class="path">
        <span class="label">skills.sh</span>
        <p class="desc">Install as an Agent Skill — Claude auto-discovers it in any session.</p>
        <div class="cmdblock"><span class="prompt">$</span><span class="cmd">npx skills add sfrangulov/skill-graveyard</span><button data-copy="npx skills add sfrangulov/skill-graveyard" type="button">copy</button></div>
      </div>
```

- [ ] **Step 2: Update mcp-graveyard install section (add 4th card)**

The mcp-graveyard install block (line 776-792) currently lists 3 cards but has no `<h2>` count to change (it's under the `companion` section without a "Three ways in." heading). Just add the 4th card after the `claude code plugin` card (after line 791, before `</div>` on line 792):

```html
      <div class="path">
        <span class="label">skills.sh</span>
        <p class="desc">Install as an Agent Skill — Claude auto-discovers it in any session.</p>
        <div class="cmdblock"><span class="prompt">$</span><span class="cmd">npx skills add sfrangulov/skill-graveyard</span><button data-copy="npx skills add sfrangulov/skill-graveyard" type="button">copy</button></div>
      </div>
```

(Same `npx skills add sfrangulov/skill-graveyard` URL — skills.sh discovers BOTH `skills/skill-graveyard/` and `skills/mcp-graveyard/` from the single GitHub repo. The CLI installs both skills together; we don't need a separate add command per skill.)

- [ ] **Step 3: Verify the diff**

Run: `git diff docs/index.html`
Expected: two new `<div class="path">` blocks added, plus the `Three ways in.` → `Four ways in.` change in the skill-graveyard section. No CSS or JS changes — the `.install` grid auto-flows extra cards.

- [ ] **Step 4: Visual smoke test (skip if not browsing)**

Open `docs/index.html` in a browser, scroll to the install section. Confirm both install grids show 4 cards laid out cleanly (the `.install .path` CSS uses `grid-template-columns:160px 1fr`, no hard-coded card count anywhere — should auto-expand).

- [ ] **Step 5: Commit**

```sh
git add docs/index.html
git commit -m "docs(site): add skills.sh install card to install sections

Adds a fourth install path under both skill-graveyard and mcp-graveyard
install grids. Single 'npx skills add sfrangulov/skill-graveyard' command
installs both skills since they live in the same GitHub repo."
```

---

## Task 6: Final verification

- [ ] **Step 1: Confirm git log shows all five commits**

Run: `git log --oneline -6`
Expected (top to bottom):

```
<sha> docs(site): add skills.sh install card to install sections
<sha> docs: document skills.sh install path in README
<sha> chore: add skills.sh-discoverable SKILL.md files
<sha> feat(mcp-graveyard): add /run slash command router
<sha> feat(skill-graveyard): add /run slash command router
<sha> docs: rewrite release section for release-please flow  (← previous tip)
```

- [ ] **Step 2: Confirm working tree is clean**

Run: `git status`
Expected: `nothing to commit, working tree clean`.

- [ ] **Step 3: Run typecheck + tests to confirm no incidental breakage**

Run: `npm run typecheck && npm test`
Expected: both pass for all three workspaces. (Pure markdown additions cannot break TS, but this is the cheap smoke test before opening a PR.)

- [ ] **Step 4: Final tarball spot-check**

Run:
```sh
npm pack --dry-run --workspace=skill-graveyard 2>&1 | grep -E 'commands/(audit-skills|run)\.md'
npm pack --dry-run --workspace=mcp-graveyard 2>&1 | grep -E 'commands/(audit-mcp-tools|run)\.md'
```

Expected: skill-graveyard tarball lists both `commands/audit-skills.md` AND `commands/run.md`; mcp-graveyard tarball lists both `commands/audit-mcp-tools.md` AND `commands/run.md`.

- [ ] **Step 5: Stop here — DO NOT push**

Per CLAUDE.md repo conventions ("Don't push automatically after committing. Wait for explicit confirmation."), leave the commits local. Hand off to user with a one-line summary of what landed and what's next (push → release-please opens Release PR → merge → npm publish).

## Out of scope (deferred)

These are NOT part of this plan, even though they are adjacent:

- Wiring up `npx skills add sfrangulov/skill-graveyard` in CI for end-to-end smoke testing. The skills.sh CLI is third-party; we trust its discovery works as documented.
- Submitting to skills.sh leaderboard manually. The registry auto-discovers any GitHub repo on first install; no PR or submission form involved.
- Renaming existing `audit-skills.md` / `audit-mcp-tools.md` for consistency with the new `run` naming. Out of scope, would be a breaking change for current users.
- Adding tests for SKILL.md frontmatter validity. They are static configs; if skills.sh rejects them at install, we fix forward.
