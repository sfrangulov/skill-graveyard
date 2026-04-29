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

### Marketplace JSON shape (verified 2026-04-29 against `claude-plugins-official` and `thedotmack`)

The marketplace JSON is at `<repo>/HEAD/.claude-plugin/marketplace.json` — **not** at the repo root. Fetched via raw GitHub URL.

The marketplace JSON contains a `plugins` array, but the per-plugin entry shape varies wildly:

**Type A — version on entry (e.g. `thedotmack/claude-mem`):**
```json
{ "name": "claude-mem", "version": "11.0.1", "source": "./plugin", ... }
```
A direct version string. Easy compare.

**Type B — pinned via `source.sha` (e.g. `42crunch-api-security-testing` in `claude-plugins-official`):**
```json
{
  "name": "42crunch-api-security-testing",
  "source": { "source": "git-subdir", "url": "...", "path": "...", "ref": "v1.0.1", "sha": "56273e0e..." }
}
```
The marketplace itself records the pinned commit. Compare `source.sha` against installed `gitCommitSha`.

**Type C — `source.url` without sha (e.g. `superpowers`, `figma`):**
```json
{ "name": "superpowers", "source": { "source": "url", "url": "https://github.com/obra/superpowers.git" } }
```
Marketplace tracks upstream HEAD. Compare via `git ls-remote <url>` against installed `gitCommitSha`.

**Type D — string source pointing into the marketplace repo itself (e.g. `frontend-design`):**
```json
{ "name": "frontend-design", "source": "./plugins/frontend-design" }
```
The plugin lives as a subdirectory of the marketplace repo. The plugin's "version" effectively is the marketplace repo's git state. Compare with marketplace repo's HEAD. (Often these have `installed.version === "unknown"`, in which case we always classify as `outdated` with reinstall hint regardless of HEAD.)

`claude-plugins-official` has 170 plugins, most are types B/C/D. `thedotmack` has 1 plugin, type A. Real users see ~50–80% type B/C/D.

## Architecture

Follows the existing convention: subcommands return structured data, `format.ts` prints terminal output. New code lives in dedicated files; shared primitives go to `discovery.ts` if reused.

| File | Role |
|---|---|
| `src/outdated.ts` | new. Discovery + version compare + assembling the `OutdatedReport`. |
| `src/source_resolver.ts` | new. Decides which compare strategy applies per plugin based on its marketplace entry shape (types A/B/C/D). Pure functions, easily testable. |
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
   - marketplace source repos (typically 1–3 per machine) — fetched from `<repo>/HEAD/.claude-plugin/marketplace.json`
   - upstream git remotes for type-C plugins (typically 0–10) — discovered after marketplace fetch resolves their `source.url`
   - git remotes for git-tracked user/agent skills (typically 0–20)
   - the marketplace repos themselves, when type-D plugins are present (so we can ls-remote the marketplace's HEAD)
5. **Network phase, with cache.**
   - For each unique marketplace source: try cache (`~/.cache/skill-graveyard/outdated/marketplace-<slug>.json`). If fresh, use it. Else fetch raw JSON from `https://raw.githubusercontent.com/<repo>/HEAD/.claude-plugin/marketplace.json`, persist to cache.
   - For each unique git remote (whether discovered from a type-C plugin's `source.url`, a type-D plugin's marketplace repo, or a user/agent skill's git root): try cache (`gitremote-<short-hash>.json`). If fresh, use it. Else `git -c credential.helper= ls-remote <remote> refs/heads/<branch>`, parse first column as SHA, persist `{sha, branch, fetchedAt}`.
   - Fetches run in parallel with a small concurrency cap (e.g. 4).
6. **Resolve compare strategy per plugin** (in `source_resolver.ts`). For each installed plugin, look up its entry in the fetched marketplace JSON, then choose a strategy by entry shape:

   | Entry shape | Strategy | "Latest" comes from |
   |---|---|---|
   | Has `version` field at the entry root (type A) | **semver** | `entry.version` |
   | Has object `source` with `sha` field (type B) | **sha-pin** | `entry.source.sha` |
   | Has object `source` with `url` and no `sha` (type C) | **ls-remote-upstream** | `git ls-remote <entry.source.url> refs/heads/main` (or whatever branch the source object names; default `main`) |
   | Has string `source` (type D) | **ls-remote-marketplace** | `git ls-remote <marketplace-repo> refs/heads/main` |
   | Plugin not present in marketplace JSON | `unknown` with reason "plugin not listed in marketplace" | n/a |

7. **Compare.**
   - **Semver** (type A): if installed.version === "unknown" → `outdated` with reinstall hint. Else `compareSemver(installed.version, entry.version)`.
   - **Sha-pin** (type B): if installed.gitCommitSha === entry.source.sha → `up-to-date`. Else `outdated`. Display short shas. If installed.gitCommitSha is null → `unknown` with reason "no local commit recorded".
   - **Ls-remote-upstream** (type C): compare installed.gitCommitSha (or `git -C installPath rev-parse HEAD` if missing) against the fetched ls-remote sha.
   - **Ls-remote-marketplace** (type D): compare installed.gitCommitSha (if recorded) against the marketplace's HEAD sha. If installed.version === "unknown" → always `outdated` with reinstall hint regardless of sha (matches existing convention from spec). If installed.gitCommitSha is null and version is "unknown" → `outdated` reinstall.
   - **Git skills** (user/agent): same as before — compare installed SHA against upstream HEAD. If `installed === remote` → up-to-date; else `outdated` with `git pull --ff-only` hint.

8. **Assemble rows.** Group by source. Status assigned per the table in [Error handling](#error-handling). Build `upgradeHint` per kind:
   - Plugin (any type): `claude plugin update <pluginId>` (verified to exist in current CC).
   - Plugin with installed.version === "unknown": `claude plugin remove <pluginId>` then `claude plugin install <pluginId>` (reinstall to surface real version).
   - Git skill: `git -C <rootPath> pull --ff-only`.

9. **Return** `OutdatedReport`. Caller (cli.ts) hands to `formatOutdatedReport` or `formatJson`.

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
| `git ls-remote` fails for a type-C plugin's `source.url` | That plugin becomes `errored`. | `errored` |
| `git ls-remote` fails for a type-D plugin's marketplace repo | All type-D plugins from that marketplace become `errored`. | `errored` |
| `git ls-remote` fails for a user/agent git source | That git source becomes `errored`. | `errored` |
| Plugin not in any registered marketplace | `unknown`, reason = "no registered marketplace". | `unknown` |
| Plugin not present in the fetched marketplace JSON | `unknown`, reason = "plugin not listed in marketplace". | `unknown` |
| Plugin `version: "unknown"` AND found in marketplace (type A) | `outdated`, reason "installed without version metadata; reinstall to refresh". | `outdated` |
| Plugin (type B/C/D) with no local `gitCommitSha` | `unknown`, reason "no local commit recorded; reinstall to refresh". | `unknown` |
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

1. ✅ **Resolved 2026-04-29.** `claude plugin update <pluginId>` exists (`claude plugin --help` lists it explicitly). Upgrade hint stays as `claude plugin update <pluginId>`. Note: it's `claude plugin <command>` from the CLI, or `/plugin <command>` from inside CC — the user may run either.
2. ✅ **Resolved 2026-04-29.** Marketplace JSON path is `<repo>/HEAD/.claude-plugin/marketplace.json` for both `claude-plugins-official` and `thedotmack`. Spec updated.
3. ✅ **Resolved 2026-04-29.** Marketplace JSON entry shapes are not uniform — see "Marketplace JSON shape" subsection in Background. Compare logic now branches over four shape types (A/B/C/D). New `source_resolver.ts` module captures this.
4. **Concurrency cap.** 4 parallel fetches feels right for typical user (~3 marketplaces + ~10 type-C upstreams + ~20 user/agent git remotes). Revisit if rate limits show up against GitHub during real testing.
5. **`gitCommitSha` reliability.** Verified 2026-04-29: only plugins from `source: { source: "url" }` (type C) actually create a `.git` inside their installPath. Type B/D plugins typically have `gitCommitSha: null` in `installed_plugins.json`. For these without a recorded sha, the only signal we can compare against is the marketplace's pinned sha (type B) or the marketplace HEAD (type D) — but we can't verify "what's installed locally" without an authoritative local sha. Fall through to `unknown` with a clear reason rather than guessing.
6. **`installed.version` "unknown" for type C/D plugins.** Most type-D plugins (`frontend-design`, `context7`) have `installed.version === "unknown"`. Spec keeps existing convention: always classify as `outdated` with reinstall hint, regardless of sha comparison. Reinstalling refreshes the version metadata. This means a freshly-installed type-D plugin still reports as `outdated` — minor false positive, but the reinstall is the right action regardless.
