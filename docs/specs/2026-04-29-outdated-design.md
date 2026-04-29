# `outdated` subcommand — design

**Status:** approved 2026-04-29
**Target version:** 0.7.0

## Summary

A new `outdated` subcommand that reports which installed plugins and git-tracked skills have a newer version available upstream. The first subcommand in skill-graveyard that performs network calls; isolated, opt-in, and clearly documented as the explicit exception to the tool's local-only posture.

## Motivation

Users accumulate skills and plugins over months. Updates are easy to miss because:

- Claude Code does not surface "you have a newer version available" inline.
- Plugin install paths use the version in the directory name (`/plugins/cache/<marketplace>/<plugin>/<version>/`), so stale installs sit alongside any future ones with no visual cue that the older one is no longer current.
- Skills installed via git clone never auto-update.

There's no built-in `claude /plugin outdated` today. This command fills that gap for the install layouts skill-graveyard already understands.

## Goals

1. Report all installed plugins where the marketplace lists a newer version than what's installed locally.
2. Report all git-tracked user/agent skills whose upstream HEAD is ahead of the local commit.
3. Group findings by source (one row per plugin, one row per git repo) — not per skill, since updates happen at the source level.
4. Be inexpensive enough to run as part of a regular hygiene routine, via a TTL-based cache for both marketplace fetches and `git ls-remote` results.
5. Maintain the rest of the tool's local-only contract — `outdated` is the *only* network-touching subcommand and never runs as a side effect of the others.

## Non-goals

1. Executing updates. No `--apply` mode in v1; output is report + commands to copy. Following the same pattern as `prune` for parity and to avoid the dirty-tree / detached-HEAD / fork-without-upstream class of failure modes.
2. Project-scoped skills (`<cwd>/.claude/skills/`). Out of scope per the same precedent as `prune`.
3. Content-drift detection. Comparing local `SKILL.md` body against upstream catches manual edits but is computationally heavy and conceptually fuzzy (intentional local edits are not "outdated"). Defer until requested.
4. Detecting skills installed without a resolvable upstream (manual copy, npm install, etc.). They count as `unknown`.
5. Stale-cache fallback for offline use. If the network is unavailable and the cache has expired, the command hard-fails. A future `--use-stale-cache` flag could relax this.

## Background — existing layouts

```
~/.claude/plugins/installed_plugins.json     # central plugin registry
~/.claude/plugins/known_marketplaces.json    # source URLs per marketplace
~/.claude/plugins/marketplaces/<name>/       # cached marketplace metadata
~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/  # actual install
~/.claude/skills/                            # user-level skills
~/.agents/skills/                            # agent-level skills
```

Each plugin entry in `installed_plugins.json` carries:

```json
{
  "scope": "user",
  "installPath": "...",
  "version": "5.0.7",
  "installedAt": "...",
  "lastUpdated": "...",
  "gitCommitSha": "b7a8f76985..."   // present when installed from git
}
```

Some plugins have `version: "unknown"` because the source `plugin.json` had no version field at install time. These are real and need a separate "outdated" classification.

Each `known_marketplaces.json` entry points at a `github` repo:

```json
{
  "claude-plugins-official": {
    "source": { "source": "github", "repo": "anthropics/claude-plugins-official" },
    "installLocation": "...",
    "lastUpdated": "..."
  }
}
```

The marketplace JSON ships at the root of that repo (typically `marketplace.json` or `.marketplace.json`); fetched via raw GitHub URL. Format includes a list of plugins with their current version, which is what we compare against.

## Architecture

Follows the existing convention: subcommands return structured data, `format.ts` prints terminal output. New code lives in dedicated files; shared primitives go to `discovery.ts` if reused.

| File | Role |
|---|---|
| `src/outdated.ts` | new. Discovery + version compare + assembling the `OutdatedReport`. |
| `src/cache.ts` | new. File-based JSON cache with mtime-based TTL. Used only by `outdated`. |
| `src/fetcher.ts` | new. Thin wrapper over `fetch` and `git ls-remote` so tests can mock at the boundary. |
| `src/format.ts` | extend. `formatOutdatedReport(report, opts)` and `formatJson` reuse. |
| `src/cli.ts` | extend. Routing for `outdated` + new flags `--no-cache`, `--ttl`. |
| `src/discovery.ts` | extend. Helper `findGitRoot(path): string \| null` walks up from a path. |

Files unchanged: `audit.ts`, `cost.ts`, `prune.ts`, `suggest.ts`, `projects.ts`, `parser.ts`, `paths.ts`, `tokenizer.ts`, `known_tools.ts`.

## Data model

```ts
// src/outdated.ts

export type SourceKind = "plugin" | "git";

export type OutdatedStatus = "outdated" | "up-to-date" | "unknown" | "errored";

export interface OutdatedRow {
  kind: SourceKind;
  /** Display name. For plugin: <name>@<marketplace>. For git: short repo path. */
  name: string;
  /** Optional human label for plugin marketplace or git remote URL. */
  source?: string;
  status: OutdatedStatus;
  installedVersion: string;     // semver | sha | "unknown"
  latestVersion: string;        // semver | sha | "unknown"
  /** Skills installed under this source (names only, for affects-line). */
  affectedSkills: string[];
  /** Optional human reason for unknown/errored. */
  reason?: string;
  /** Concrete shell command(s) to upgrade. Multiple lines for remove+install fallback. */
  upgradeHint?: string[];
}

export interface OutdatedReport {
  windowFetchedAt: number;       // ms epoch
  cacheHits: number;             // how many sources served from cache
  rows: OutdatedRow[];
  counters: {
    outdated: number;
    upToDate: number;
    unknown: number;
    errored: number;
  };
}
```

## Data flow

1. **Discover plugins.** Read `installed_plugins.json`. For each entry, capture `(name, scope, version, gitCommitSha, installPath)` and enumerate the SKILL.md files under `installPath` for the affected-skills list.
2. **Map plugins → marketplace.** Read `known_marketplaces.json`. The plugin id is `<name>@<marketplace>`; resolve `marketplace` to its source repo. If marketplace is missing/unrecognized, the plugin's status becomes `unknown` with reason "no registered marketplace".
3. **Discover git skills.** Use existing `discovery.ts` to enumerate user (`~/.claude/skills/`) and agent (`~/.agents/skills/`) skills. For each, walk up from the SKILL.md path looking for a `.git` directory. Skills sharing a git root collapse into a single source row.
4. **Plan fetches.** Build the unique set of:
   - marketplace source repos (typically 1–3 per machine)
   - git remotes (one per resolved repo, typically 5–60)
5. **Network phase, with cache.**
   - For each unique marketplace source: try cache (`~/.cache/skill-graveyard/outdated/marketplace-<slug>.json`). If fresh, use it. Else fetch raw `marketplace.json` from `https://raw.githubusercontent.com/<repo>/HEAD/marketplace.json` (or the marketplace's documented entry path), persist to cache.
   - For each unique git remote: try cache (`gitremote-<sha256(repo:branch)>.json`). If fresh, use it. Else `git -c credential.helper= ls-remote <remote> <branch>`, parse first column as SHA, persist `{sha, branch, fetchedAt}`.
   - Fetches run in parallel with a small concurrency cap (e.g. 4) to be polite.
6. **Compare.**
   - Plugin: if `installed.version === "unknown"` → `outdated` with reason "installed without version metadata; reinstall to refresh". Otherwise semver compare via `gpt-tokenizer`-style minimal compare (no new dep — write a tiny `compareSemver` helper since we only need three integers).
   - Git: compare installed SHA (`gitCommitSha` if present, else `git -C <installPath> rev-parse HEAD`) to upstream SHA. If equal → up-to-date. Else compute `git -C <path> rev-list --count <local>..<remote>` for the "N commits behind" line; cap at "many" if expensive.
7. **Assemble rows.** Group by source. Status assigned per the table in [Error handling](#error-handling). Build `upgradeHint` per kind.
8. **Return** `OutdatedReport`. Caller (cli.ts) hands to `formatOutdatedReport` or `formatJson`.

## CLI surface

```
skill-graveyard outdated [options]

OPTIONS
  --no-cache            force re-fetch all sources (cache entries are deleted)
  --ttl <minutes>       cache TTL override (default: 60)
  --json                machine-readable output
  --claude-dir <path>   override Claude home directory
```

`--json` emits the `OutdatedReport` shape verbatim. `--no-cache` and `--ttl` are mutually compatible: `--no-cache --ttl 0` is equivalent.

## Output (terminal)

When findings exist:

```
────────────────────────────────────────────────────────────
 skill-graveyard outdated
 5 outdated · 12 up-to-date · 4 unknown · 0 errored
────────────────────────────────────────────────────────────

PLUGINS (3 outdated)
  superpowers              5.0.7 → 5.1.2          plugin:superpowers
    affects 18 skills (brainstorming, writing-plans, …)
    claude /plugin update superpowers@claude-plugins-official

  claude-mem               unknown → 2.3.0        plugin:claude-mem
    installed without version metadata; reinstall to refresh
    claude /plugin remove claude-mem@thedotmack && \
      claude /plugin install claude-mem@thedotmack

GIT-TRACKED (2 outdated)
  ~/.agents/skills/foo     abc1234 → def5678  (3 commits behind, main)
    affects 1 skill (foo)
    git -C ~/.agents/skills/foo pull --ff-only

cached 12m ago · --no-cache to refresh
```

When everything's current:

```
────────────────────────────────────────────────────────────
 skill-graveyard outdated
 0 outdated · 19 up-to-date · 4 unknown · 0 errored
────────────────────────────────────────────────────────────
all current.

cached 12m ago · --no-cache to refresh
```

Color usage matches existing conventions: `outdated` rows yellow, `errored` red, `unknown` dim, source labels dim.

## Cache

- Path: `~/.cache/skill-graveyard/outdated/`
- Files:
  - `marketplace-<slug>.json` — verbatim copy of fetched marketplace JSON
  - `gitremote-<sha256(repo:branch)>.json` — `{ sha: string, branch: string, fetchedAt: number }`
- Invalidation:
  - Implicit: file mtime + TTL-minutes < now → expired, refetch
  - Explicit: `--no-cache` deletes existing cache entries before the fetch phase
- TTL default: 60 minutes. Configurable via `--ttl <minutes>`.
- Directory is created on first write (idempotent).
- The cache is never read by other subcommands. It exists only for `outdated`.

## Error handling

| Case | Behavior | Counter |
|---|---|---|
| Marketplace fetch fails (network/404/rate-limit) | All plugins from that marketplace become `errored` with reason = fetch error message. | `errored` |
| `git ls-remote` fails (network/auth/no-such-remote) | That git source becomes `errored`. | `errored` |
| Plugin not in any registered marketplace | `unknown`, reason = "no registered marketplace". | `unknown` |
| Plugin `version: "unknown"` AND found in marketplace | `outdated`, with explicit "reinstall to refresh metadata" hint. | `outdated` |
| Skill outside any git tree | `unknown`, reason = "not in a git tree". | `unknown` |
| Skill in a git tree but no upstream branch (detached HEAD, no tracking branch) | `unknown`, reason = "no upstream branch". | `unknown` |
| Network entirely unavailable AND no usable cache | Hard fail with stderr message: `outdated requires network access; no usable cache (use --ttl to widen, or check connectivity)`. Exit 1. | n/a |
| Network unavailable BUT cache fresh | Use cache, normal report, footer still shows "cached Xm ago". | normal counters |
| Marketplace JSON malformed | That marketplace's plugins → `errored`. | `errored` |
| `installed_plugins.json` missing or unparseable | Hard fail with stderr message: `cannot read installed_plugins.json`. | n/a |

## Testing

Existing test pattern (Node's built-in runner against real `os.tmpdir()` fixtures, no `fs` mocking). Network and git-ls-remote calls are mocked at the **fetcher boundary** so tests never hit real GitHub.

| Test surface | Strategy |
|---|---|
| Cache TTL logic | Unit test with mocked file mtime via fs.utimes. |
| Marketplace JSON parsing | Fixture-based — synthetic marketplace.json, walk through compare logic. |
| Output formatting | Snapshot-style: assemble a known `OutdatedReport`, format, assert lines. |
| Network code paths | Inject a mock fetcher that returns canned responses; test cache-hit / cache-miss / fetch-fail branches. |
| Git ls-remote parsing | Unit test parsing `<sha>\trefs/heads/<branch>` line format. |
| `--no-cache` behavior | Cache hit available, but `--no-cache` should bypass and refetch. |
| Detached HEAD / no upstream | Set up a tmpdir with `git init`, no remote, assert `unknown` row. |
| Real-world manual validation | Run against my own `~/.claude/` before merging. |

## Documentation impact

### README

- New row in the subcommand table:
  > `skill-graveyard outdated` — list installed plugins / git-tracked skills with newer versions available upstream
- New section dedicated to `outdated`, mirroring the existing per-subcommand sections.
- "What it does NOT do" — replace "Does not phone home. All analysis is local." with:
  > Performs network calls only when `outdated` is invoked. The other four subcommands remain entirely local — no telemetry, no fetches.
- "What it reads" — append:
  > Network (only when `outdated` runs): raw `marketplace.json` from each registered marketplace's GitHub repo + `git ls-remote` for each git-tracked skill source. All fetches are cached locally with a configurable TTL.

### docs/index.html

Same disclaimer adjustment in the "what it does not do" / "what it reads" sections of the lander.

### CHANGELOG.md

0.7.0 entry: Added `outdated` subcommand.

## Versioning

Feature add → minor bump → **0.7.0**.

## Out of scope (v1)

| Item | Reason punted | Path back |
|---|---|---|
| `--apply` mode | Dirty tree / detached HEAD / mid-pull failure modes are nontrivial to handle safely. | Add when a real user request lands and we have evidence of need. |
| Project-scoped skills | Same precedent as `prune`. | Re-evaluate together with `prune --include-project`. |
| Stale-cache fallback for offline | First user who flies on a plane and is annoyed will request it. | `--use-stale-cache` flag, opt-in. |
| Manual-install detection | No upstream signal. | Could heuristically check `~/.claude/skills/<name>/.git` and treat absence + no marketplace as "manual" with an explicit row. |
| Content-drift detection | Comparing SKILL.md body to upstream is heavy and conceptually noisy. | Separate `drift` subcommand if demand exists. |
| `outdated --json` schema versioning | Internal use only in v1. | Version the schema when first external consumer appears. |

## Open questions / TBDs

1. **CC plugin update command.** Need to verify whether `claude /plugin update <name>@<marketplace>` actually exists. If it doesn't, the upgrade hint becomes the `remove && install` pair (uglier, but rings true). Resolve at implementation time by inspecting CC's plugin help output or asking a current CC version directly.
2. **Marketplace JSON entry path.** The default assumed path is `marketplace.json` at repo root, but some marketplaces use `.marketplace.json` or other names. Confirm by inspecting the two marketplaces in use (`anthropics/claude-plugins-official`, `thedotmack/claude-mem`) and document any divergence.
3. **Concurrency cap.** 4 parallel fetches feels right for ~60 git remotes; revisit if rate limits show up against GitHub during real testing.
4. **`gitCommitSha` reliability.** Some installed_plugins entries have it, some don't. For those without, falling back to `git -C <installPath> rev-parse HEAD` is fine — but verify the install paths actually contain a `.git` directory in those cases.
