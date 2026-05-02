# memory-graveyard — design

Date: 2026-05-02
Status: draft, awaiting user review before implementation plan

## Goal

Third sister tool to `skill-graveyard` and `mcp-graveyard`, applying the same dual-signal idea to **file-based persistent memory** (the `MEMORY.md` index + `memory/*.md` entry files pattern that loads into the system prompt at session start):

1. **Dead memory entries** — present on disk, never read by Claude in subsequent sessions → safe to remove.
2. **Hallucinated reads** — Claude follows a pointer from `MEMORY.md` to an entry file that doesn't exist → broken pointers with confirmed cost.

Same parser, multiple signals: it's not just a graveyard, it's an audit of where the user's memory layout is over- and under-provisioned.

The motivation differs from skills/MCP in one important way: `MEMORY.md` is loaded into **every** session's system prompt, with a hard truncation cutoff (commonly 200 lines). Entries below the cutoff are invisible to Claude until explicitly asked for. memory-graveyard's `lint` surfaces this directly — a unique signal neither sister tool has.

## Scope

**In v1:** `audit`, `lint`, `prune`, `projects`.

**Deferred to v2:**
- `suggest` — classify hallucinated/missing into TYPO/etc. The per-entry Read signal is sparse (1–2 reads per entry vs 50+ skill calls), so classification mass won't accumulate. Revisit when corpus is bigger.
- `cost` — folded into `lint` check #4 (index size). No separate command.
- `outdated` — folded into `lint` check #5 (stale dated entries). No separate command.
- `lint --fix` — auto-remove broken pointers. Conservative default for v1: print, exit non-zero, let user act.
- Frontmatter / type-structure validation — depends on a canonical auto-memory spec, which is not zero-cost to commit to. Spec-agnostic in v1.

## Architecture

memory-graveyard is the fourth package in the existing monorepo, mirroring `mcp-graveyard`'s shape. No structural changes to `core` or sister packages — only additive.

```
skill-graveyard/                          (repo + workspace root, unchanged)
├── packages/
│   ├── core/                             @skill-graveyard/core — minor additive change only
│   ├── skill-graveyard/                  unchanged
│   ├── mcp-graveyard/                    unchanged
│   └── memory-graveyard/                 NEW — publishes as memory-graveyard@0.1.0
│       ├── src/
│       │   ├── cli.ts                    arg routing
│       │   ├── audit.ts                  4-bucket per-project view
│       │   ├── lint.ts                   5 static checks
│       │   ├── prune.ts                  --apply with backup
│       │   ├── projects.ts               cross-project breakdown
│       │   ├── format.ts                 terminal rendering
│       │   ├── index_parser.ts           parse MEMORY.md pointer list
│       │   ├── entry_scanner.ts          frontmatter + body scan for memory/*.md
│       │   ├── memory_parser.ts          predicate/builder for parseToolCalls<MemoryRead>
│       │   ├── types.ts
│       │   └── *.test.ts
│       ├── README.md                     ships own README (mcp-graveyard pattern, no prepack hack)
│       └── package.json                  bin: dist/cli.js  (no ./ prefix — same gotcha)
├── skills/
│   ├── skill-graveyard/SKILL.md          unchanged
│   ├── mcp-graveyard/SKILL.md            unchanged
│   └── memory-graveyard/SKILL.md         NEW — skills.sh manifest
├── docs/
│   └── index.html                        adds third companion section
└── .github/workflows/
    ├── ci.yml                            matrix expands to 4 packages × 2 Node = 8 cells
    └── release-please.yml                adds publish step for memory-graveyard
```

### What's reused from `@skill-graveyard/core`

- **`parseToolCalls<T>`** — generic JSONL stream introduced for mcp-graveyard. memory-graveyard supplies its own predicate (`name === "Read"` and `file_path` matches a memory dir) and builder (`MemoryRead`). This is the textbook reuse case core was generalised for.
- **`paths.ts`** — `~/.claude/projects/*` walking is identical.
- **`tokenizer.ts`** — `cl100k_base` for `lint` check #4 (index size). Same 5–15% drift disclaimer as `skill-graveyard cost`.
- **`discovery.ts`** — extended (additively) with `discoverMemoryDirs(): string[]`. Returns absolute paths to every `memory/` subdirectory under `~/.claude/projects/*/`. Existing `discoverInstalledSkills` and friends are untouched.

### What's NOT reused (lives in `packages/memory-graveyard/`)

- **`index_parser.ts`** — parses `MEMORY.md`. Format: free-text intro, then bullet list of `- [Title](file.md) — one-line hook`. Regex: `^- \[([^\]]+)\]\(([^)]+\.md)\)(.*)$` per line. Returns `Pointer[] = [{ line, title, target, hook }]`. Lines that don't match are preserved as `intro`/`other` for round-tripping in `prune --apply`.
- **`entry_scanner.ts`** — for each `memory/*.md` (excluding `MEMORY.md` itself): read first ~50 lines to extract frontmatter (`---\nname: ...\ndescription: ...\ntype: ...\n---`). Tolerant: missing frontmatter → entry is recorded with `frontmatter: null`. Body is read on demand (only `lint` check #5 needs it).
- **`memory_parser.ts`** — `parseToolCalls<MemoryRead>` specialization. Predicate: `item.name === "Read" && item.input?.file_path?.startsWith(memoryDir)`. Builder records `{ filePath, sessionId, timestamp, errored, errorReason }`.

## Data model

### Sources of truth

| What | Source | Note |
|---|---|---|
| Memory dirs across user | walk `~/.claude/projects/*/memory/` | Per-project; skill-graveyard's cross-project model does not apply. |
| Indexed entries (per project) | parse `<memory-dir>/MEMORY.md` | The "what is declared" set. Source for prune. |
| On-disk entry files | `readdirSync(<memory-dir>)` filter `*.md`, exclude `MEMORY.md` | The "what is on disk" set. |
| Read invocations | `<project>/*.jsonl` → `tool_use.name === "Read"` matching memory paths | What Claude actually opened, with success/error status. |

**No subprocess. No network calls.** Everything is local file parsing. Same offline contract as sister tools.

### Read events: success vs error

The Read tool either succeeds (file exists, content returned) or returns an error result (typically file not found). The bucket model depends on this distinction, so `memory_parser.ts` must capture both:

- Successful Read on `memory/<X>.md` → contributes to **active** counter for `<X>.md`.
- Errored Read on `memory/<Y>.md` (file not found) → contributes to **hallucinated** counter for `<Y>.md`. The pointer in `MEMORY.md` led somewhere broken, and Claude paid the round-trip.

`mcp-graveyard`'s parser already extracts `errored` and `errorReason` for any tool call; memory-graveyard inherits the same field via `parseToolCalls<T>`.

### Types

```ts
// packages/memory-graveyard/src/types.ts
import type { ToolCall } from "@skill-graveyard/core";

export interface MemoryRead extends ToolCall<"memory"> {
  filePath: string;          // /Users/.../memory/feedback_X.md
  memoryFile: string;        // feedback_X.md  (basename)
  memoryDir: string;         // /Users/.../memory/
}

export interface Pointer {
  line: number;
  title: string;
  target: string;            // feedback_X.md  (relative to memory dir)
  hook: string;              // text after " — "
  visible: boolean;          // line <= truncationCutoff
}

export interface EntryFile {
  basename: string;
  path: string;
  exists: boolean;
  frontmatter: { name?: string; description?: string; type?: string } | null;
  bytes: number;
  mtime: string;
}

export interface EntryReport {
  basename: string;
  inIndex: boolean;
  fileExists: boolean;
  pointer: Pointer | null;
  entry: EntryFile | null;
  reads: MemoryRead[];           // successful
  errors: MemoryRead[];          // failed
  bucket: "active" | "dead" | "missing" | "hallucinated";
  lastReadAt: string | null;
}

export interface ProjectMemorySummary {
  projectKey: string;            // encoded cwd
  cwd: string | null;            // decoded best-effort
  memoryDir: string;
  entryCount: number;
  totalBytes: number;
  lastReadAt: string | null;
  daysSinceTouch: number;        // max of mtimes vs today
}
```

### Four buckets (entry-level)

Direct analogue of skill-graveyard / mcp-graveyard, with Read events as the "invocation" signal:

| Bucket | Condition | Action in `prune` |
|---|---|---|
| **active** | in `memory/` ∧ in `MEMORY.md` ∧ ≥1 successful Read in window | keep |
| **dead** | in `memory/` ∧ in `MEMORY.md` ∧ 0 successful Reads in window | remove file + remove pointer line (with backup) |
| **missing** | in `memory/` ∧ NOT in `MEMORY.md` ∧ ≥1 successful Read in window | info-only: orphan file Claude found anyway, candidate for re-indexing |
| **hallucinated** | NOT in `memory/` ∧ in `MEMORY.md` ∧ ≥1 errored Read in window | remove pointer line (no file to delete) — broken pointer with confirmed cost |

Edge cases:
- **Orphan file, never read** → not in any bucket; surfaced by `lint` check #2 as static finding.
- **Broken pointer, never followed** → not in any bucket; surfaced by `lint` check #1 as static finding.
- **In `memory/` ∧ NOT in `MEMORY.md` ∧ 0 reads** → static-only orphan, lint #2.
- An entry can have both successful and errored reads (e.g., file existed earlier, deleted between sessions). Successful reads dominate: it's `active`. The errored reads are surfaced informationally in `audit --json`.

### Out of scope for v1

- **Per-line bucket assignment within `MEMORY.md`** — bucket is per entry file, not per pointer line. If two pointers resolve to the same target (degenerate index), the first wins for bucket purposes; `lint` check #9 (deferred) would catch the duplication.
- **Reads of `MEMORY.md` itself** — the index is always loaded into the system prompt; explicit Reads of it are noise (debugging the index, recall flows). Excluded from all bucket math.
- **Cross-project entry correlation** — same `feedback_release_flow.md` filename in three projects is three independent entries. Cross-project rollups happen only in the `projects` subcommand, summary level only.

## Subcommands

### `audit` (default)

Per-project, current cwd. Window: 30 days default. Output: 4-bucket grouped table.

```
memory-graveyard — 30 days · 12 entries indexed · 14 on disk · 47 reads · 41 successful · 6 errored

ACTIVE (3)
  entry                            reads   errors   last         line
  feedback_release_flow.md         18      0        2026-05-02   12
  project_skill_graveyard.md       9       0        2026-04-30   10
  feedback_subagent_models.md      4       0        2026-04-29   11

DEAD (7) — candidates for removal
  entry                            reads   errors   last         line
  feedback_legacy_buildchain.md    0       0        —            45
  project_old_migration.md         0       0        —            72
  ...

HALLUCINATED (1)
  entry                            reads   errors   last         line
  feedback_doesnotexist.md         0       2        2026-04-15   34
                                                    (file missing — pointer at line 34)

MISSING (1) — orphan files Claude found anyway
  entry                            reads   errors   last
  scratch_notes.md                 3       0        2026-04-22

→ run: memory-graveyard prune  to clear DEAD entries and broken pointers
```

Columns: `reads` = successful Reads in window, `errors` = errored Reads, `last` = most recent Read of either kind, `line` = pointer's line number in `MEMORY.md` (so user can grep). Sparkbar over the window in non-`--json` output.

### Filters & options

- `--days N` — window (default 30).
- `--only active|dead|missing|hallucinated` — single bucket.
- `--json` — machine-readable.
- `--project <path>` — override cwd autodetection (testability + scripting).
- `--claude-dir <path>` — override `~/.claude` (testability).

### `--json` shape

Mirrors skill-graveyard convention (`rows[]` + `summary`):

```jsonc
{
  "generatedAt": "2026-05-02T13:24:00Z",
  "windowDays": 30,
  "projectKey": "-Users-sergeifrangulov-projects-skill-graveyard",
  "memoryDir": "/Users/.../memory",
  "summary": {
    "indexedEntries": 12,
    "onDiskEntries": 14,
    "totalReads": 47,
    "successfulReads": 41,
    "erroredReads": 6
  },
  "rows": [
    {
      "entry": "feedback_release_flow.md",
      "category": "active",
      "inIndex": true,
      "fileExists": true,
      "pointerLine": 12,
      "successfulReads": 18,
      "erroredReads": 0,
      "lastReadAt": "2026-05-02T11:18:33Z"
    }
  ]
}
```

### `lint`

All five v1 checks run together; each section reports findings independently. Exit code is `1` if **any** check finds an issue, `0` otherwise. `--json` switches to structured output.

Flags:
- `--truncation-cutoff N` — override 200-line default for check #3.
- `--stale-days N` — override 30-day default for check #5.
- `--project <path>` — operate on a specific project's MEMORY.md.
- `--json` — structured output.

Each check details:

#### #1 — Broken pointers

For every `Pointer` parsed from `MEMORY.md`, check `fs.existsSync(memoryDir + "/" + pointer.target)`. Report misses as `{ line, title, target }`.

```
Broken pointers (2):
  line 34   feedback_doesnotexist.md         — referenced as "Feedback: never wrote this"
  line 56   project_renamed_yesterday.md     — referenced as "Project: ..."
```

#### #2 — Orphan files

`readdirSync(memoryDir).filter(f => f.endsWith(".md") && f !== "MEMORY.md") \ pointers.map(p => p.target)`. Report as basenames + size.

```
Orphan files (1) — present on disk, missing from MEMORY.md:
  scratch_notes.md   1.2 KB
```

#### #3 — Truncation budget

```ts
const lines = readFileSync(MEMORY_MD).split("\n");
const cutoff = flags["--truncation-cutoff"] ?? 200;
const visible = pointers.filter(p => p.line <= cutoff).length;
const cutOff  = pointers.length - visible;
```

```
Truncation budget — cutoff: 200 lines
  Total entries:        47
  Visible to Claude:    31
  Cut off (lines 201+): 16

  Below the cutoff (sample):
    line 203   feedback_X.md       "Feedback: ..."
    line 215   project_Y.md        "Project: ..."
    ...
```

If `cutOff > 0`, this check fails. Reordering `MEMORY.md` is the user's fix; `lint --fix` (v2) will be the automated solution, ranking by recency × frequency from `audit` data.

#### #4 — Index size

`tokenizer.cl100k_base(memoryMd).length`. Report tokens; flag if > 5000 (loose budget heuristic — `MEMORY.md` doubling 5KB is the symptom of unindexed sprawl).

```
Index size — 2,847 tokens (cl100k_base; 5–15% drift vs Claude tokenizer)
  Status: OK (< 5000 tokens)
```

#### #5 — Stale dated entries

For entries with `type: project` only, regex over body for `\b20\d{2}-\d{2}-\d{2}\b`. If `max(found_dates) < (today - --stale-days)`, flag. Entries without frontmatter, or with any other type (`feedback`/`user`/`reference`), are skipped — those types are intentionally durable per the auto-memory pattern. If frontmatter is missing entirely, the entry is silently skipped (the spec-agnostic stance from v1 means we don't infer type from filename).

```
Stale project entries (1) — last referenced date older than 30 days:
  project_old_migration.md   last date 2026-03-05 (58 days ago)
```

Rationale: project-type memory has high decay (per auto-memory spec which explicitly converts relative dates to absolute for this reason). User-type (role/preferences) and feedback-type (durable lessons) shouldn't trigger.

### `prune`

Default: dry-run plan. Lists what would be removed and shows the diff for `MEMORY.md` line edits.

```
memory-graveyard prune — plan
  7 entry files to delete (dead, 0 reads in 30 days)
  1 pointer line to remove (hallucinated, line 34)

  Files:
    /Users/.../memory/feedback_legacy_buildchain.md
    /Users/.../memory/project_old_migration.md
    ...

  MEMORY.md edits:
    - line 34   - [Feedback: never wrote this](feedback_doesnotexist.md)
    - line 45   - [Feedback: legacy buildchain](feedback_legacy_buildchain.md)
    ...

re-run with --apply to execute (backup is automatic)
```

By default, prune targets two groups: **dead** entries (file delete + pointer line removal) and **hallucinated** pointers (pointer line removal only — there's no file to delete). Both have confirmed cost: dead entries waste disk and index slots; hallucinated pointers waste an actual Read round-trip every time Claude follows them.

`--include` adds optional groups (off by default because they lack runtime evidence):

- `--include orphans` — also delete on-disk orphan files (lint #2: file in `memory/`, not in index, never Read).
- `--include broken-pointers` — also remove pointer lines for broken pointers without errored Reads (lint #1: declared in index, file missing, but never followed).

`--exclude <basename>` — opt out specific entries from the plan.

### `prune --apply`

Order:

1. **Snapshot.** Create backup directory `<memoryDir>/.graveyard-backup/<ISO-timestamp>/`. Mode `0o700`. Inside:
   - Copy original `MEMORY.md` → `MEMORY.md`.
   - Copy each entry file slated for deletion → same basename.
   - Write `manifest.json` describing the operation (timestamp, deleted basenames, removed pointer lines, restore hint).
2. **If snapshot fails (disk full, permission)** — bail. Nothing else runs.
3. **Apply MEMORY.md edits.** Read file; remove flagged pointer lines; write atomically (temp + rename).
4. **Delete entry files** sequentially via `fs.unlinkSync`. If one delete fails, log and continue. Final summary: `Removed 6/7 files, 1 failed (see above)`.

Idempotent: if `MEMORY.md` no longer contains a pointer that was in the plan (someone edited concurrently), the line removal silently no-ops.

#### Backup directory structure

```
.graveyard-backup/
└── 2026-05-02T13-31-42Z/
    ├── MEMORY.md                          (original, byte-identical)
    ├── feedback_legacy_buildchain.md      (deleted file, byte-identical)
    ├── project_old_migration.md
    ├── ...
    └── manifest.json
```

`manifest.json`:

```jsonc
{
  "removedAt": "2026-05-02T13:31:42.123Z",
  "memoryDir": "/Users/.../memory",
  "windowDays": 30,
  "deletedFiles": ["feedback_legacy_buildchain.md", "project_old_migration.md"],
  "removedPointerLines": [
    { "line": 34, "title": "Feedback: never wrote this", "target": "feedback_doesnotexist.md" }
  ],
  "restoreHint": "cp -i .graveyard-backup/<timestamp>/MEMORY.md ./MEMORY.md && cp -i .graveyard-backup/<timestamp>/*.md ."
}
```

Restore is manual in v1. No `restore` subcommand. README documents the one-liner.

⚠ Memory entries can contain user notes and project context but are not expected to contain secrets (the auto-memory spec explicitly excludes secrets). Backup permissions are still `0o600` for files, `0o700` for the directory, defense in depth.

### `projects`

Cross-project breakdown. Walks every `~/.claude/projects/*/memory/`. Surfaces:
- Total entries / size per project.
- `daysSinceTouch` (max mtime among entries).
- Cold projects: candidates for whole-directory deletion.

```
~/projects/skill-graveyard          14 entries · 4.2 KB · last touched 2026-05-02
~/projects/api-server                8 entries · 2.1 KB · last touched 2026-04-12  (20 days ago)
~/projects/old-prototype             3 entries · 0.9 KB · last touched 2025-11-04  (~6 months ago) ✗ COLD

→ memory dirs untouched > 90 days are listed last with ✗
```

Implementation: 80% reuse of skill-graveyard's `projects.ts` walking pattern; only the per-project tally function is new.

### Filters & options

- `--cold-days N` — threshold for the `✗ COLD` marker (default 90).
- `--json` — structured output, includes per-project `EntryReport[]` if `--details` is passed.

## Testing

Convention unchanged from sister packages:

- Real `fs` against `os.tmpdir()` fixtures. No fs mocking.
- Tests colocated flat under `src/`, run via `node --import tsx --test src/*.test.ts` (single `*`, unquoted — same gotcha documented in CLAUDE.md).
- Per-package `npm test` works; workspace root `npm test` continues to delegate via `--workspaces --if-present`.
- Shared JSONL fixtures may live in `packages/core/test-fixtures/sessions/` if they're useful for parser-level tests; memory-specific fixtures (with `memory/` dirs and `MEMORY.md` indexes) live in `packages/memory-graveyard/test-fixtures/`.

Test cases worth calling out (these are the ones that break refactors):

- `audit` correctly distinguishes successful from errored Reads when both target the same path within one session.
- `lint` truncation cutoff is configurable and reported numbers match the `--json` output exactly.
- `prune --apply` snapshot directory exists with correct mode before any destructive operation.
- `prune --apply` is idempotent across concurrent index edits (line removal is no-op if the line is gone).
- `index_parser` round-trips: parse `MEMORY.md` → remove a line → write → re-parse, no semantic drift in unrelated lines.
- `memory_parser` predicate excludes Reads of `MEMORY.md` itself from bucket math.

## CI

`.github/workflows/ci.yml` matrix expands to 4 packages × 2 Node versions = 8 cells:

```yaml
strategy:
  fail-fast: false
  matrix:
    package: ["@skill-graveyard/core", "skill-graveyard", "mcp-graveyard", "memory-graveyard"]
    node: [20, 22]
```

Pre-test step (already present for skill-graveyard / mcp-graveyard) builds `@skill-graveyard/core` first when the matrix cell is one of the consumers — extended to include memory-graveyard.

`fail-fast: false` retained — same reasoning as today.

## Release

memory-graveyard releases through release-please along with the rest of the monorepo. **No manual `npm publish`, `git tag`, or `gh release create`** — same contract as the existing three packages.

### `release-please-config.json` change

Add a fourth entry:

```jsonc
"packages/memory-graveyard": {
  "package-name": "memory-graveyard",
  "component": "memory-graveyard"
}
```

### `.release-please-manifest.json` change

Add baseline:

```jsonc
"packages/memory-graveyard": "0.1.0"
```

The first commit landing memory-graveyard's source can be `feat: introduce memory-graveyard package` — release-please will open a PR proposing `memory-graveyard@0.1.0` (initial release, derived from baseline).

### `.github/workflows/release-please.yml` change

Add a publish step for memory-graveyard, conditional on the release-please outputs reporting it released. Mirror the existing skill-graveyard / mcp-graveyard publish jobs.

### Version policy

- memory-graveyard starts at `0.1.0`. No coordinated bump with other packages on first release.
- If memory-graveyard ever needs a `core` API change (e.g., a new helper in `discovery.ts`), publish core first, then memory-graveyard with the bumped `@skill-graveyard/core` dep range. release-please handles this when the order of merged PRs is right.

### `bin` path gotcha

`packages/memory-graveyard/package.json` must declare `"bin": { "memory-graveyard": "dist/cli.js" }` — **no `./` prefix** — otherwise npm strips the bin entry from the published tarball with only a warning. `npm pkg fix` normalises this; CI does not catch the regression. Same gotcha documented in CLAUDE.md.

## Documentation touch list

Single PR touches all of the following so the repo doesn't ship inconsistent state:

- `README.md` (root) — add a third companion section after mcp-graveyard. Same visual rhythm: one-sentence intro, code block, subcommand list. Anonymized sample output.
- `packages/memory-graveyard/README.md` — new, full README mirroring `packages/mcp-graveyard/README.md` structure (ships own README, no prepack hack).
- `packages/skill-graveyard/README.md` and `packages/mcp-graveyard/README.md` — if they list companions, add a memory-graveyard line.
- `CLAUDE.md`:
  - **Layout**: add `packages/memory-graveyard/` and `skills/memory-graveyard/SKILL.md` entries.
  - **Intentional non-features**: add explicit note that `prune --apply` executes for memory-graveyard (and mcp-graveyard), but `skill-graveyard prune` only prints — divergence is intentional, rationale recorded so a future reader doesn't "fix" it.
  - **Release**: matrix is now 8 cells.
- `docs/index.html` — add memory-graveyard companion section in the same style as mcp-graveyard's section. Sample CLI output uses anonymized project names per the public-repo contract. Update the `<title>` / `<meta description>` only if the umbrella framing changes (it doesn't — single-product framing remains, with companion sections).
- `skills/memory-graveyard/SKILL.md` — new, mirrors `skills/mcp-graveyard/SKILL.md`. Description triggers on `audit MEMORY.md`, `dead memory entries`, `broken memory pointers`, `memory hygiene`, `unused memory`. Listed in the parent skills.sh manifest.

## Non-goals (deliberate, mirror sister-tool conventions)

- **No telemetry, no network calls.** All analysis is local. Same wording as `README.md` for skill-graveyard.
- **No Claude Code plugin / slash commands.** Removed for the line in commit `b99926b`; memory-graveyard stays out of `.claude-plugin/`. skills.sh is the only Claude Code distribution channel.
- **No `<project>/.claude/memory/` parsing** (project-scoped memory dirs, if they exist). The project-scoped pattern is intentionally out of scope here, matching skill-graveyard's exclusion of `<project>/.claude/skills/`.
- **`prune --apply` does not edit `CLAUDE.md` or any global config.** Touch limited to one project's `memory/` directory.
- **`lint` does not auto-fix.** v1 prints findings + non-zero exit code. `lint --fix` (v2) will gain the rerank-by-recency operation for truncation budget.
- **No frontmatter / type-structure validation in v1** (lint checks #6, #8 from brainstorm). Spec-agnostic stance: no commitment to a canonical auto-memory specification until adoption signal warrants it.
- **No `suggest` command in v1.** Hallucinated/missing classification needs more signal density than per-project memory traffic provides.
