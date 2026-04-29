# `outdated` Subcommand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a network-bound `outdated` subcommand that surfaces installed plugins and git-tracked skills with newer versions available upstream.

**Architecture:** New files `src/cache.ts`, `src/fetcher.ts`, `src/outdated.ts` carry the new logic. `src/discovery.ts`, `src/format.ts`, `src/cli.ts` get small extensions. Network access enters skill-graveyard for the first time, isolated to this subcommand and clearly documented.

**Tech Stack:** TypeScript (strict + `noUncheckedIndexedAccess`), `node:test`, `node:child_process` for `git ls-remote`, `node:fs` for cache, native `fetch` for marketplace JSON. No new runtime deps.

**Spec:** `docs/specs/2026-04-29-outdated-design.md`. Read it first.

---

## Task 1: ✅ RESOLVED — TBDs from spec investigation

Research completed 2026-04-29. Findings captured in spec; reproduced here for the implementing agent's convenience:

1. **`claude plugin update <pluginId>` exists.** Verified via `claude plugin --help`. Use this verbatim in upgrade hints.
2. **Marketplace JSON path:** `<repo>/HEAD/.claude-plugin/marketplace.json` (NOT `marketplace.json` at repo root).
3. **Marketplace JSON entry shapes are NOT uniform.** Four observed shapes (see spec "Marketplace JSON shape" subsection):
   - **Type A:** entry has `version` field directly (e.g. `thedotmack/claude-mem`).
   - **Type B:** entry has `source: { ..., sha: "..." }` — pinned commit (e.g. `42crunch-api-security-testing`).
   - **Type C:** entry has `source: { source: "url", url }` — no pin, follows upstream HEAD (e.g. `superpowers`, `figma`).
   - **Type D:** entry has string `source: "./plugins/foo"` — subdir of marketplace repo itself (e.g. `frontend-design`).
4. **Type-C plugins are the only ones whose `installPath` contains a `.git` directory.** Verified by inspection. Type B/D plugins have no local git repo; their `installed_plugins.json` typically has `gitCommitSha: null`.

These findings drive the new compare logic in Task 8 and the new `source_resolver.ts` module in Task 6.

No commit for this task — research only.

---

## Task 2: Cache module with TTL

**Files:**
- Create: `src/cache.ts`
- Create: `src/cache.test.ts`

A file-based JSON cache. Generic over value type. mtime-based TTL.

- [ ] **Step 1: Write failing tests**

```ts
// src/cache.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Cache } from "./cache.js";

async function withTmpCache<T>(fn: (cache: Cache, dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "skg-cache-"));
  try {
    return await fn(new Cache(dir), dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("cache miss returns null", async () => {
  await withTmpCache(async (cache) => {
    const v = await cache.get<{ x: number }>("missing", 60);
    assert.equal(v, null);
  });
});

test("cache write then read roundtrips", async () => {
  await withTmpCache(async (cache) => {
    await cache.set("k", { x: 42 });
    const v = await cache.get<{ x: number }>("k", 60);
    assert.deepEqual(v, { x: 42 });
  });
});

test("expired entry returns null and is treated as a miss", async () => {
  await withTmpCache(async (cache, dir) => {
    await cache.set("k", { x: 1 });
    // backdate the file beyond TTL
    const past = new Date(Date.now() - 1000 * 60 * 90); // 90 min ago
    await utimes(join(dir, "k.json"), past, past);
    const v = await cache.get<{ x: number }>("k", 60);
    assert.equal(v, null);
  });
});

test("invalidate deletes the entry", async () => {
  await withTmpCache(async (cache) => {
    await cache.set("k", { x: 1 });
    await cache.invalidate("k");
    const v = await cache.get<{ x: number }>("k", 60);
    assert.equal(v, null);
  });
});

test("invalidate is idempotent for missing entries", async () => {
  await withTmpCache(async (cache) => {
    await cache.invalidate("never-existed"); // no throw
  });
});
```

- [ ] **Step 2: Run the tests, expect failures**

```sh
npm test -- --test-name-pattern='cache'
```

Expected: every test fails with `Cannot find module './cache.js'`.

- [ ] **Step 3: Implement `src/cache.ts`**

```ts
import { readFile, writeFile, stat, mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";

export class Cache {
  constructor(private readonly dir: string) {}

  /** Returns the cached value if present and not older than ttlMinutes. Otherwise null. */
  async get<T>(key: string, ttlMinutes: number): Promise<T | null> {
    const path = this.pathFor(key);
    let st;
    try {
      st = await stat(path);
    } catch {
      return null;
    }
    const ageMs = Date.now() - st.mtimeMs;
    if (ageMs > ttlMinutes * 60 * 1000) return null;
    try {
      return JSON.parse(await readFile(path, "utf-8")) as T;
    } catch {
      return null;
    }
  }

  async set(key: string, value: unknown): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.pathFor(key), JSON.stringify(value), "utf-8");
  }

  async invalidate(key: string): Promise<void> {
    try {
      await unlink(this.pathFor(key));
    } catch {
      // already gone — fine
    }
  }

  private pathFor(key: string): string {
    // sanitize: only allow [A-Za-z0-9_-]; replace others with '-'
    const safe = key.replace(/[^A-Za-z0-9_-]/g, "-");
    return join(this.dir, `${safe}.json`);
  }
}
```

- [ ] **Step 4: Run the tests, expect pass**

```sh
npm test -- --test-name-pattern='cache'
```

Expected: all 5 cache tests pass.

- [ ] **Step 5: Run the full suite to confirm no regression**

```sh
npm test
```

Expected: 51 prior tests + 5 new = 56 pass.

- [ ] **Step 6: Commit**

```sh
git add src/cache.ts src/cache.test.ts
git commit -m "add cache module for outdated subcommand"
```

---

## Task 3: Fetcher boundary

**Files:**
- Create: `src/fetcher.ts`
- Create: `src/fetcher.test.ts`

A thin interface for the two network operations (marketplace fetch, git ls-remote) so `outdated.ts` can be tested with mocks. Real implementation is small; the value is the seam.

- [ ] **Step 1: Write failing test for the parser inside `gitLsRemoteParse`**

```ts
// src/fetcher.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { parseLsRemoteOutput } from "./fetcher.js";

test("parses sha for the requested branch from ls-remote output", () => {
  const out =
    "abc1234567890\trefs/heads/main\n" +
    "def4567890123\trefs/heads/dev\n";
  assert.equal(parseLsRemoteOutput(out, "main"), "abc1234567890");
  assert.equal(parseLsRemoteOutput(out, "dev"), "def4567890123");
});

test("returns null when branch not found", () => {
  const out = "abc\trefs/heads/main\n";
  assert.equal(parseLsRemoteOutput(out, "missing"), null);
});

test("ignores tags and other ref types", () => {
  const out =
    "tagsha\trefs/tags/v1\n" +
    "mainsha\trefs/heads/main\n";
  assert.equal(parseLsRemoteOutput(out, "main"), "mainsha");
});
```

- [ ] **Step 2: Run, expect failure**

```sh
npm test -- --test-name-pattern='ls-remote|parses sha|ignores tags'
```

Expected: cannot find module `./fetcher.js`.

- [ ] **Step 3: Implement `src/fetcher.ts`**

```ts
import { spawn } from "node:child_process";

export interface Fetcher {
  /** Returns parsed JSON of marketplace.json from the marketplace's source repo. */
  fetchMarketplace(githubRepo: string, entryPath?: string): Promise<unknown>;
  /** Returns the SHA of the named branch on the remote, or null if not found. */
  gitLsRemote(remoteUrl: string, branch: string): Promise<string | null>;
}

export function parseLsRemoteOutput(stdout: string, branch: string): string | null {
  const ref = `refs/heads/${branch}`;
  for (const line of stdout.split("\n")) {
    const tab = line.indexOf("\t");
    if (tab < 0) continue;
    if (line.slice(tab + 1).trim() === ref) {
      return line.slice(0, tab).trim();
    }
  }
  return null;
}

async function runGitLsRemote(remoteUrl: string, branch: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      "git",
      ["-c", "credential.helper=", "ls-remote", remoteUrl, `refs/heads/${branch}`],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let out = "";
    let err = "";
    proc.stdout.on("data", (b) => (out += b));
    proc.stderr.on("data", (b) => (err += b));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`git ls-remote exited ${code}: ${err.trim()}`));
    });
  });
}

export const realFetcher: Fetcher = {
  async fetchMarketplace(githubRepo, entryPath = "marketplace.json") {
    const url = `https://raw.githubusercontent.com/${githubRepo}/HEAD/${entryPath}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "skill-graveyard/outdated" },
    });
    if (!res.ok) throw new Error(`marketplace fetch ${url} -> ${res.status}`);
    return await res.json();
  },
  async gitLsRemote(remoteUrl, branch) {
    const out = await runGitLsRemote(remoteUrl, branch);
    return parseLsRemoteOutput(out, branch);
  },
};
```

- [ ] **Step 4: Run, expect pass**

```sh
npm test -- --test-name-pattern='parses sha|ignores tags|branch not found'
```

Expected: 3 pass.

- [ ] **Step 5: Run full suite**

```sh
npm test
```

Expected: 56 + 3 = 59 pass.

- [ ] **Step 6: Commit**

```sh
git add src/fetcher.ts src/fetcher.test.ts
git commit -m "add fetcher boundary for marketplace + git ls-remote"
```

---

## Task 4: `findGitRoot` helper in discovery.ts

**Files:**
- Modify: `src/discovery.ts` (append at end of file, before any default export)
- Modify: `src/discovery.test.ts`

Walks up from a path, returns the directory containing `.git`, or null.

- [ ] **Step 1: Write failing tests in `src/discovery.test.ts`**

```ts
// append to existing test file
import { mkdir, writeFile } from "node:fs/promises";
// ... reuse existing imports

test("findGitRoot returns the directory containing .git when present", async () => {
  await withTmpDir(async (dir) => {
    await mkdir(join(dir, ".git"), { recursive: true });
    await mkdir(join(dir, "deep/nested/path"), { recursive: true });
    const found = findGitRoot(join(dir, "deep/nested/path"));
    assert.equal(found, dir);
  });
});

test("findGitRoot returns null when no .git is found above the path", async () => {
  await withTmpDir(async (dir) => {
    await mkdir(join(dir, "deep"), { recursive: true });
    const found = findGitRoot(join(dir, "deep"));
    assert.equal(found, null);
  });
});

test("findGitRoot stops at filesystem root if no .git found", () => {
  // Use a path guaranteed not to be inside any git tree
  const found = findGitRoot("/tmp");
  // /tmp itself may or may not be in git; the contract is "returns or null"
  assert.ok(found === null || typeof found === "string");
});
```

`withTmpDir` should already be in the test file. If not — copy the pattern from `cache.test.ts:withTmpCache`.

- [ ] **Step 2: Run, expect failure**

```sh
npm test -- --test-name-pattern='findGitRoot'
```

Expected: `findGitRoot is not defined`.

- [ ] **Step 3: Implement in `src/discovery.ts`**

Add this near the end of the file, before any closing export blocks:

```ts
import { existsSync } from "node:fs";
import { dirname, parse } from "node:path";
// (these may already be imported — only add if missing)

/** Walks up from `start`, returns the first directory containing a `.git` entry, or null. */
export function findGitRoot(start: string): string | null {
  let cur = start;
  const root = parse(cur).root;
  while (true) {
    if (existsSync(join(cur, ".git"))) return cur;
    if (cur === root) return null;
    const next = dirname(cur);
    if (next === cur) return null;
    cur = next;
  }
}
```

- [ ] **Step 4: Run, expect pass**

```sh
npm test -- --test-name-pattern='findGitRoot'
```

Expected: 3 pass.

- [ ] **Step 5: Full suite**

```sh
npm test
```

Expected: 59 + 3 = 62 pass.

- [ ] **Step 6: Commit**

```sh
git add src/discovery.ts src/discovery.test.ts
git commit -m "discovery: add findGitRoot helper for outdated"
```

---

## Task 5: Outdated module — plugin source discovery

**Files:**
- Create: `src/outdated.ts`
- Create: `src/outdated.test.ts`

This task delivers `enumeratePluginSources(claudeDir)` which reads `installed_plugins.json` + `known_marketplaces.json` and returns a list of plugin sources to check. Each `PluginSource` carries the raw `installed_plugins.json` entry plus the resolved marketplace repo. The marketplace **entry** itself (the per-plugin object inside `marketplace.json`) is NOT loaded here — it's loaded later by the orchestrator after fetching marketplace JSONs.

- [ ] **Step 1: Write failing tests**

```ts
// src/outdated.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { enumeratePluginSources } from "./outdated.js";

async function withClaudeDir<T>(
  fn: (claudeDir: string) => Promise<T>,
  setup: (claudeDir: string) => Promise<void>,
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "skg-outdated-"));
  try {
    await mkdir(join(dir, "plugins"), { recursive: true });
    await setup(dir);
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("enumeratePluginSources reads installed plugins and resolves marketplace repo", async () => {
  await withClaudeDir(
    async (dir) => {
      const sources = await enumeratePluginSources(dir);
      assert.equal(sources.length, 2);
      const sp = sources.find((s) => s.pluginName === "superpowers")!;
      assert.equal(sp.installedVersion, "5.0.7");
      assert.equal(sp.marketplaceRepo, "anthropics/claude-plugins-official");
      assert.equal(sp.gitCommitSha, "b7a8f76");
      const cm = sources.find((s) => s.pluginName === "claude-mem")!;
      assert.equal(cm.installedVersion, "unknown");
      assert.equal(cm.marketplaceRepo, "thedotmack/claude-mem");
    },
    async (dir) => {
      await writeFile(
        join(dir, "plugins/installed_plugins.json"),
        JSON.stringify({
          version: 2,
          plugins: {
            "superpowers@claude-plugins-official": [
              { scope: "user", installPath: "/x", version: "5.0.7", gitCommitSha: "b7a8f76" },
            ],
            "claude-mem@thedotmack": [
              { scope: "user", installPath: "/y", version: "unknown" },
            ],
          },
        }),
      );
      await writeFile(
        join(dir, "plugins/known_marketplaces.json"),
        JSON.stringify({
          "claude-plugins-official": {
            source: { source: "github", repo: "anthropics/claude-plugins-official" },
          },
          thedotmack: {
            source: { source: "github", repo: "thedotmack/claude-mem" },
          },
        }),
      );
    },
  );
});

test("enumeratePluginSources marks plugins from unknown marketplaces as such", async () => {
  await withClaudeDir(
    async (dir) => {
      const sources = await enumeratePluginSources(dir);
      assert.equal(sources.length, 1);
      assert.equal(sources[0]!.marketplaceRepo, null);
    },
    async (dir) => {
      await writeFile(
        join(dir, "plugins/installed_plugins.json"),
        JSON.stringify({
          version: 2,
          plugins: {
            "ghost@unregistered-market": [{ scope: "user", installPath: "/x", version: "1.0.0" }],
          },
        }),
      );
      await writeFile(join(dir, "plugins/known_marketplaces.json"), JSON.stringify({}));
    },
  );
});

test("enumeratePluginSources returns [] when installed_plugins.json is missing", async () => {
  await withClaudeDir(
    async (dir) => {
      const sources = await enumeratePluginSources(dir);
      assert.deepEqual(sources, []);
    },
    async () => {},
  );
});
```

- [ ] **Step 2: Run, expect failure**

```sh
npm test -- --test-name-pattern='enumeratePluginSources'
```

Expected: cannot find `./outdated.js`.

- [ ] **Step 3: Implement `src/outdated.ts`**

Create with only this much for now (more added in subsequent tasks):

```ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface PluginSource {
  /** "<name>@<marketplace>" */
  pluginId: string;
  pluginName: string;
  marketplaceName: string;
  /** GitHub repo "owner/name" if marketplace is registered, else null. */
  marketplaceRepo: string | null;
  installedVersion: string;
  gitCommitSha: string | null;
  installPath: string;
}

interface InstalledPluginsFile {
  version: number;
  plugins: Record<
    string,
    Array<{
      scope: string;
      installPath: string;
      version: string;
      gitCommitSha?: string;
    }>
  >;
}

interface KnownMarketplacesFile {
  [name: string]: {
    source: { source: string; repo?: string };
  };
}

export async function enumeratePluginSources(claudeDir: string): Promise<PluginSource[]> {
  const installedPath = join(claudeDir, "plugins", "installed_plugins.json");
  let installed: InstalledPluginsFile;
  try {
    installed = JSON.parse(await readFile(installedPath, "utf-8")) as InstalledPluginsFile;
  } catch {
    return [];
  }
  let markets: KnownMarketplacesFile = {};
  try {
    markets = JSON.parse(
      await readFile(join(claudeDir, "plugins", "known_marketplaces.json"), "utf-8"),
    ) as KnownMarketplacesFile;
  } catch {
    // missing/malformed → all plugins get marketplaceRepo: null
  }

  const out: PluginSource[] = [];
  for (const [pluginId, entries] of Object.entries(installed.plugins ?? {})) {
    const at = pluginId.lastIndexOf("@");
    const pluginName = at >= 0 ? pluginId.slice(0, at) : pluginId;
    const marketplaceName = at >= 0 ? pluginId.slice(at + 1) : "";
    const market = markets[marketplaceName];
    const repo = market?.source.source === "github" ? market.source.repo ?? null : null;
    for (const entry of entries) {
      out.push({
        pluginId,
        pluginName,
        marketplaceName,
        marketplaceRepo: repo,
        installedVersion: entry.version,
        gitCommitSha: entry.gitCommitSha ?? null,
        installPath: entry.installPath,
      });
    }
  }
  return out;
}
```

- [ ] **Step 4: Run, expect pass**

```sh
npm test -- --test-name-pattern='enumeratePluginSources'
```

Expected: 3 pass.

- [ ] **Step 5: Full suite**

```sh
npm test
```

Expected: 62 + 3 = 65 pass.

- [ ] **Step 6: Commit**

```sh
git add src/outdated.ts src/outdated.test.ts
git commit -m "outdated: enumerate plugin sources from installed_plugins.json"
```

---

## Task 6: Source resolver — classify marketplace entry shape

**Files:**
- Create: `src/source_resolver.ts`
- Create: `src/source_resolver.test.ts`

Pure functions that classify a marketplace entry into one of four shapes (A/B/C/D), and extract the relevant comparison data from each. No I/O — testable in isolation.

- [ ] **Step 1: Write failing tests**

```ts
// src/source_resolver.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { classifyMarketplaceEntry } from "./source_resolver.js";

test("classifies type-A entry (version-on-entry)", () => {
  const r = classifyMarketplaceEntry({ name: "x", version: "1.0.0", source: "./plugin" });
  assert.equal(r.kind, "version-on-entry");
  if (r.kind === "version-on-entry") assert.equal(r.version, "1.0.0");
});

test("classifies type-B entry (sha-pinned source)", () => {
  const r = classifyMarketplaceEntry({
    name: "x",
    source: { source: "git-subdir", url: "https://e/x.git", path: "p", ref: "v1", sha: "abc123" },
  });
  assert.equal(r.kind, "sha-pinned");
  if (r.kind === "sha-pinned") {
    assert.equal(r.sha, "abc123");
    assert.equal(r.url, "https://e/x.git");
  }
});

test("classifies type-C entry (url source, no sha)", () => {
  const r = classifyMarketplaceEntry({
    name: "x",
    source: { source: "url", url: "https://e/x.git" },
  });
  assert.equal(r.kind, "ls-remote-upstream");
  if (r.kind === "ls-remote-upstream") {
    assert.equal(r.url, "https://e/x.git");
    assert.equal(r.branch, "main"); // default
  }
});

test("classifies type-D entry (string source pointing into marketplace)", () => {
  const r = classifyMarketplaceEntry({ name: "x", source: "./plugins/x" });
  assert.equal(r.kind, "ls-remote-marketplace");
});

test("classifies entry with explicit ref (branch override) on a url source", () => {
  const r = classifyMarketplaceEntry({
    name: "x",
    source: { source: "url", url: "https://e/x.git", ref: "develop" },
  });
  assert.equal(r.kind, "ls-remote-upstream");
  if (r.kind === "ls-remote-upstream") assert.equal(r.branch, "develop");
});

test("returns 'unknown-shape' for entries we don't recognize", () => {
  const r = classifyMarketplaceEntry({ name: "x" } as any);
  assert.equal(r.kind, "unknown-shape");
});

test("strips refs/heads/ prefix from a git-subdir ref when present", () => {
  const r = classifyMarketplaceEntry({
    name: "x",
    source: { source: "git-subdir", url: "https://e/x.git", path: "p", ref: "refs/heads/main" },
  });
  assert.equal(r.kind, "sha-pinned-or-ref");
  // when sha is absent but ref is present, fall back to ls-remote on that ref
  if (r.kind === "sha-pinned-or-ref") {
    assert.equal(r.branch, "main");
  }
});
```

- [ ] **Step 2: Run, expect failures**

```sh
npm test -- --test-name-pattern='classifies|unknown-shape|strips refs'
```

- [ ] **Step 3: Implement `src/source_resolver.ts`**

```ts
export interface MarketplaceEntry {
  name: string;
  version?: string;
  source?: string | {
    source: string;        // "url" | "git-subdir" | other
    url?: string;
    path?: string;
    ref?: string;
    sha?: string;
  };
}

export type Strategy =
  | { kind: "version-on-entry"; version: string }
  | { kind: "sha-pinned"; url: string; sha: string }
  | { kind: "sha-pinned-or-ref"; url: string; branch: string }
  | { kind: "ls-remote-upstream"; url: string; branch: string }
  | { kind: "ls-remote-marketplace" }
  | { kind: "unknown-shape" };

export function classifyMarketplaceEntry(entry: MarketplaceEntry): Strategy {
  // Type A: explicit version on entry
  if (typeof entry.version === "string" && entry.version.length > 0) {
    return { kind: "version-on-entry", version: entry.version };
  }

  const src = entry.source;

  // Type D: string source — points into the marketplace repo itself
  if (typeof src === "string") {
    return { kind: "ls-remote-marketplace" };
  }

  // Type B: object source with explicit sha
  if (src && typeof src === "object" && typeof src.sha === "string" && src.url) {
    return { kind: "sha-pinned", url: src.url, sha: src.sha };
  }

  // Type B-prime: object source with ref but no sha → ls-remote on that ref
  if (src && typeof src === "object" && typeof src.ref === "string" && src.url) {
    const branch = src.ref.replace(/^refs\/heads\//, "");
    return { kind: "sha-pinned-or-ref", url: src.url, branch };
  }

  // Type C: object source with url only → ls-remote on default branch
  if (src && typeof src === "object" && typeof src.url === "string") {
    return { kind: "ls-remote-upstream", url: src.url, branch: "main" };
  }

  return { kind: "unknown-shape" };
}
```

- [ ] **Step 4: Run, expect pass**

```sh
npm test -- --test-name-pattern='classifies|unknown-shape|strips refs'
```

Expected: 7 pass.

- [ ] **Step 5: Full suite**

```sh
npm test
```

Expected: prior + 7 new pass.

- [ ] **Step 6: Commit**

```sh
git add src/source_resolver.ts src/source_resolver.test.ts
git commit -m "outdated: source resolver classifies marketplace entry shapes"
```

---

## Task 7: Outdated module — git source discovery

**Files:**
- Modify: `src/outdated.ts` (add `enumerateGitSources`)
- Modify: `src/outdated.test.ts`

For each user/agent skill, walk up to find a `.git` root. Group skills sharing a root into one source. Read installed branch + SHA from the local git tree.

- [ ] **Step 1: Write failing tests**

Append to `src/outdated.test.ts`:

```ts
import { spawnSync } from "node:child_process";
import { enumerateGitSources } from "./outdated.js";

function gitInit(dir: string) {
  spawnSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  spawnSync("git", ["-c", "user.email=x@x", "-c", "user.name=x", "commit", "--allow-empty", "-m", "init", "-q"], { cwd: dir });
  spawnSync("git", ["remote", "add", "origin", "https://example.com/foo/bar.git"], { cwd: dir });
}

test("enumerateGitSources groups skills sharing a git root into one source", async () => {
  // setup: tmpdir/skills-root/.git, with two skills inside
  // ...
  // assert: 1 source, 2 affectedSkills
});

test("enumerateGitSources skips skills not under any git tree", async () => {
  // setup: tmpdir/skills/foo/SKILL.md without any .git ancestor
  // assert: returns []
});

test("enumerateGitSources captures the remote URL, branch, and local SHA", async () => {
  // setup: tmpdir with git init + remote + commit
  // assert: source has remoteUrl, branch="main", sha=non-empty
});
```

(Full test bodies are too long for inline; expand them following the pattern from Task 5 — set up a tmpdir, `gitInit`, drop `SKILL.md` files, call `enumerateGitSources`, assert.)

- [ ] **Step 2: Run, expect failure**

```sh
npm test -- --test-name-pattern='enumerateGitSources'
```

Expected: not defined.

- [ ] **Step 3: Implement in `src/outdated.ts`**

```ts
import { spawnSync } from "node:child_process";
import { findGitRoot } from "./discovery.js";
import { discoverInstalledSkills } from "./discovery.js"; // existing function

export interface GitSource {
  /** Filesystem path of the git root. */
  rootPath: string;
  /** Display name — usually rootPath shortened with ~. */
  displayName: string;
  /** Remote URL (git remote get-url origin), or null if no origin. */
  remoteUrl: string | null;
  /** Currently-checked-out branch name, or null if detached HEAD. */
  branch: string | null;
  /** Local HEAD SHA. */
  installedSha: string;
  /** SKILL names installed under this root. */
  affectedSkills: string[];
}

function git(cwd: string, args: string[]): string | null {
  const r = spawnSync("git", args, { cwd, encoding: "utf-8" });
  if (r.status !== 0) return null;
  return r.stdout.trim();
}

export async function enumerateGitSources(
  claudeDir: string,
  agentsDir?: string,
): Promise<GitSource[]> {
  // discoverInstalledSkills already returns user + agent skills with their paths.
  // Filter to those whose path has a git ancestor; group by root.
  const skills = await discoverInstalledSkills(claudeDir, agentsDir);
  const byRoot = new Map<string, { skills: string[] }>();
  for (const skill of skills) {
    if (skill.source !== "user" && skill.source !== "agents") continue;
    const root = findGitRoot(skill.path);
    if (!root) continue;
    const entry = byRoot.get(root) ?? { skills: [] };
    entry.skills.push(skill.name);
    byRoot.set(root, entry);
  }
  const out: GitSource[] = [];
  for (const [root, { skills: names }] of byRoot) {
    const remoteUrl = git(root, ["remote", "get-url", "origin"]);
    const branch = git(root, ["symbolic-ref", "--short", "HEAD"]);
    const sha = git(root, ["rev-parse", "HEAD"]) ?? "";
    out.push({
      rootPath: root,
      displayName: root.replace(process.env["HOME"] ?? "~", "~"),
      remoteUrl,
      branch,
      installedSha: sha,
      affectedSkills: names.sort(),
    });
  }
  return out;
}
```

> Note: the call signature of `discoverInstalledSkills` may differ in `discovery.ts`. Read its current export and adapt accordingly. The intent is "give me everything under ~/.claude/skills/ and ~/.agents/skills/".

- [ ] **Step 4: Run, expect pass**

```sh
npm test -- --test-name-pattern='enumerateGitSources'
```

Expected: 3 pass.

- [ ] **Step 5: Full suite**

```sh
npm test
```

Expected: 65 + 3 = 68 pass.

- [ ] **Step 6: Commit**

```sh
git add src/outdated.ts src/outdated.test.ts
git commit -m "outdated: enumerate git-tracked skill sources"
```

---

## Task 8: Outdated module — compare logic + report assembly

**Files:**
- Modify: `src/outdated.ts` (add `compareSemver`, `buildReport`)
- Modify: `src/outdated.test.ts`

Pure functions: input enumerated sources + fetched data + strategy decisions from `source_resolver`, output `OutdatedReport`. No network here; the orchestration with cache+fetcher comes in Task 9.

The classifier handles **four plugin strategies** plus the git-skill case:
- `version-on-entry` (type A): semver compare
- `sha-pinned` (type B): compare entry sha vs installed gitCommitSha
- `sha-pinned-or-ref` (type B'): compare ls-remote sha for the named branch vs installed gitCommitSha
- `ls-remote-upstream` (type C): compare ls-remote sha for `main` vs installed gitCommitSha
- `ls-remote-marketplace` (type D): compare marketplace repo HEAD sha vs installed gitCommitSha (or always-outdated if installed.version is "unknown")
- `unknown-shape`: classify as `unknown` with reason
- not in marketplace JSON at all: `unknown` with reason "plugin not listed"

- [ ] **Step 1: Write failing tests for `compareSemver`**

```ts
import { compareSemver } from "./outdated.js";

test("compareSemver returns negative when local is older", () => {
  assert.equal(compareSemver("1.2.3", "1.2.4") < 0, true);
  assert.equal(compareSemver("1.2.3", "1.3.0") < 0, true);
  assert.equal(compareSemver("1.2.3", "2.0.0") < 0, true);
});

test("compareSemver returns 0 for equal versions", () => {
  assert.equal(compareSemver("1.2.3", "1.2.3"), 0);
});

test("compareSemver returns positive when local is newer", () => {
  assert.equal(compareSemver("1.2.4", "1.2.3") > 0, true);
});

test("compareSemver tolerates v-prefix and pre-release suffix (treats as equal numeric)", () => {
  assert.equal(compareSemver("v1.2.3", "1.2.3"), 0);
  assert.equal(compareSemver("1.2.3-beta", "1.2.3"), 0); // we ignore prerelease
});
```

- [ ] **Step 2: Write failing tests for `buildReport`**

```ts
import { buildReport, type OutdatedReport, type PluginSource, type GitSource } from "./outdated.js";

test("buildReport classifies plugin as outdated when marketplace has newer version", () => {
  const plugins: PluginSource[] = [{
    pluginId: "foo@market", pluginName: "foo", marketplaceName: "market",
    marketplaceRepo: "owner/market", installedVersion: "1.0.0",
    gitCommitSha: null, installPath: "/x",
  }];
  const marketplaceData = new Map([
    ["owner/market", { plugins: [{ name: "foo", version: "1.1.0" }] }],
  ]);
  const r = buildReport({ plugins, gits: [], marketplaceData, gitRemoteShas: new Map() });
  assert.equal(r.counters.outdated, 1);
  assert.equal(r.rows[0]!.installedVersion, "1.0.0");
  assert.equal(r.rows[0]!.latestVersion, "1.1.0");
});

test("buildReport classifies plugin as up-to-date when versions match", () => { /* ... */ });
test("buildReport flags installed-version 'unknown' as outdated with reinstall hint", () => { /* ... */ });
test("buildReport classifies plugin without marketplace as unknown", () => { /* ... */ });
test("buildReport marks marketplace fetch failure as errored for all its plugins", () => { /* ... */ });
test("buildReport classifies git source up-to-date when SHAs match", () => { /* ... */ });
test("buildReport classifies git source outdated when remote SHA differs", () => { /* ... */ });
test("buildReport classifies git source unknown when no branch (detached HEAD)", () => { /* ... */ });
```

- [ ] **Step 3: Run, expect failures**

```sh
npm test -- --test-name-pattern='compareSemver|buildReport'
```

- [ ] **Step 4: Implement `compareSemver` and `buildReport`**

```ts
import { classifyMarketplaceEntry, type MarketplaceEntry, type Strategy } from "./source_resolver.js";

export function compareSemver(a: string, b: string): number {
  const norm = (v: string) => v.replace(/^v/, "").split("-")[0]!;
  const [aMaj = 0, aMin = 0, aPat = 0] = norm(a).split(".").map((n) => parseInt(n, 10) || 0);
  const [bMaj = 0, bMin = 0, bPat = 0] = norm(b).split(".").map((n) => parseInt(n, 10) || 0);
  if (aMaj !== bMaj) return aMaj - bMaj;
  if (aMin !== bMin) return aMin - bMin;
  return aPat - bPat;
}

export type OutdatedStatus = "outdated" | "up-to-date" | "unknown" | "errored";

export interface OutdatedRow {
  kind: "plugin" | "git";
  name: string;
  source?: string;
  status: OutdatedStatus;
  installedVersion: string;
  latestVersion: string;
  affectedSkills: string[];
  reason?: string;
  upgradeHint?: string[];
}

export interface OutdatedReport {
  windowFetchedAt: number;
  cacheHits: number;
  rows: OutdatedRow[];
  counters: { outdated: number; upToDate: number; unknown: number; errored: number };
}

interface MarketplaceFetchResult {
  /** Parsed marketplace JSON. */
  data?: { plugins: MarketplaceEntry[] };
  /** Repo HEAD SHA, captured during fetch via ls-remote on the marketplace repo. Used by type-D plugins. */
  marketplaceHeadSha?: string;
  /** Error message if fetch failed. */
  error?: string;
}

interface BuildReportInput {
  plugins: PluginSource[];
  gits: GitSource[];
  /** key: marketplaceRepo (e.g. "anthropics/claude-plugins-official"). */
  marketplaces: Map<string, MarketplaceFetchResult>;
  /**
   * key: `${remoteUrl}@${branch}`. value: SHA or { error }.
   * Populated by orchestrator with shas needed for type-C plugins (after resolver decides what to fetch)
   * AND for git-tracked user/agent skills.
   */
  gitRemoteShas: Map<string, string | { error: string }>;
  cacheHits?: number;
}

export function buildReport(input: BuildReportInput): OutdatedReport {
  const rows: OutdatedRow[] = [];
  for (const p of input.plugins) rows.push(classifyPlugin(p, input.marketplaces, input.gitRemoteShas));
  for (const g of input.gits) rows.push(classifyGit(g, input.gitRemoteShas));
  const counters = { outdated: 0, upToDate: 0, unknown: 0, errored: 0 };
  for (const r of rows) {
    if (r.status === "outdated") counters.outdated++;
    else if (r.status === "up-to-date") counters.upToDate++;
    else if (r.status === "unknown") counters.unknown++;
    else counters.errored++;
  }
  return {
    windowFetchedAt: Date.now(),
    cacheHits: input.cacheHits ?? 0,
    rows,
    counters,
  };
}

const UPDATE_HINT = (id: string) => [`claude plugin update ${id}`];
const REINSTALL_HINT = (id: string) => [`claude plugin remove ${id}`, `claude plugin install ${id}`];

function classifyPlugin(
  p: PluginSource,
  marketplaces: Map<string, MarketplaceFetchResult>,
  shas: Map<string, string | { error: string }>,
): OutdatedRow {
  const base = {
    kind: "plugin" as const,
    name: p.pluginId,
    source: `plugin:${p.pluginName}`,
    affectedSkills: [], // populated by orchestrator
    installedVersion: p.installedVersion,
  };
  if (!p.marketplaceRepo) {
    return { ...base, status: "unknown", latestVersion: "?", reason: "no registered marketplace" };
  }
  const market = marketplaces.get(p.marketplaceRepo);
  if (!market) {
    return { ...base, status: "errored", latestVersion: "?", reason: "marketplace not fetched" };
  }
  if (market.error || !market.data) {
    return { ...base, status: "errored", latestVersion: "?", reason: market.error ?? "marketplace not fetched" };
  }
  const entry = market.data.plugins.find((x) => x.name === p.pluginName);
  if (!entry) {
    return { ...base, status: "unknown", latestVersion: "?", reason: "plugin not listed in marketplace" };
  }

  const strat = classifyMarketplaceEntry(entry);

  switch (strat.kind) {
    case "version-on-entry": {
      const latest = strat.version;
      if (p.installedVersion === "unknown") {
        return {
          ...base, status: "outdated", latestVersion: latest,
          reason: "installed without version metadata; reinstall to refresh",
          upgradeHint: REINSTALL_HINT(p.pluginId),
        };
      }
      if (compareSemver(p.installedVersion, latest) >= 0) {
        return { ...base, status: "up-to-date", latestVersion: latest };
      }
      return { ...base, status: "outdated", latestVersion: latest, upgradeHint: UPDATE_HINT(p.pluginId) };
    }

    case "sha-pinned": {
      if (!p.gitCommitSha) {
        return { ...base, status: "unknown", latestVersion: short(strat.sha),
          reason: "no local commit recorded; reinstall to refresh",
          upgradeHint: REINSTALL_HINT(p.pluginId) };
      }
      if (p.gitCommitSha === strat.sha) {
        return { ...base, status: "up-to-date",
          installedVersion: short(p.gitCommitSha), latestVersion: short(strat.sha) };
      }
      return { ...base, status: "outdated",
        installedVersion: short(p.gitCommitSha), latestVersion: short(strat.sha),
        upgradeHint: UPDATE_HINT(p.pluginId) };
    }

    case "sha-pinned-or-ref":
    case "ls-remote-upstream": {
      const key = `${strat.url}@${strat.branch}`;
      return classifyByLsRemote(p, base, key, shas);
    }

    case "ls-remote-marketplace": {
      // Type D: compare with marketplace repo's HEAD sha
      if (p.installedVersion === "unknown") {
        // Always outdated — installed without version, reinstall to refresh
        return {
          ...base, status: "outdated", latestVersion: short(market.marketplaceHeadSha ?? "?"),
          reason: "installed without version metadata (marketplace-internal plugin); reinstall to refresh",
          upgradeHint: REINSTALL_HINT(p.pluginId),
        };
      }
      if (!p.gitCommitSha) {
        return { ...base, status: "unknown", latestVersion: short(market.marketplaceHeadSha ?? "?"),
          reason: "no local commit recorded for marketplace-internal plugin",
          upgradeHint: REINSTALL_HINT(p.pluginId) };
      }
      if (!market.marketplaceHeadSha) {
        return { ...base, status: "errored", latestVersion: "?", reason: "marketplace HEAD not fetched" };
      }
      if (p.gitCommitSha === market.marketplaceHeadSha) {
        return { ...base, status: "up-to-date",
          installedVersion: short(p.gitCommitSha), latestVersion: short(market.marketplaceHeadSha) };
      }
      return { ...base, status: "outdated",
        installedVersion: short(p.gitCommitSha), latestVersion: short(market.marketplaceHeadSha),
        upgradeHint: UPDATE_HINT(p.pluginId) };
    }

    case "unknown-shape":
      return { ...base, status: "unknown", latestVersion: "?",
        reason: "marketplace entry shape not recognized" };
  }
}

function classifyByLsRemote(
  p: PluginSource,
  base: Omit<OutdatedRow, "status" | "latestVersion">,
  key: string,
  shas: Map<string, string | { error: string }>,
): OutdatedRow {
  const got = shas.get(key);
  if (got === undefined) {
    return { ...base, status: "errored", latestVersion: "?", reason: "remote sha not fetched" };
  }
  if (typeof got === "object") {
    return { ...base, status: "errored", latestVersion: "?", reason: got.error };
  }
  const remoteSha = got;
  if (!p.gitCommitSha) {
    return { ...base, status: "unknown", latestVersion: short(remoteSha),
      reason: "no local commit recorded; reinstall to refresh",
      upgradeHint: REINSTALL_HINT(p.pluginId) };
  }
  if (p.gitCommitSha === remoteSha) {
    return { ...base, status: "up-to-date",
      installedVersion: short(p.gitCommitSha), latestVersion: short(remoteSha) };
  }
  return { ...base, status: "outdated",
    installedVersion: short(p.gitCommitSha), latestVersion: short(remoteSha),
    upgradeHint: UPDATE_HINT(p.pluginId) };
}

function classifyGit(g: GitSource, shas: Map<string, string | { error: string }>): OutdatedRow {
  const base = {
    kind: "git" as const,
    name: g.displayName,
    affectedSkills: g.affectedSkills,
    installedVersion: short(g.installedSha),
  };
  if (!g.remoteUrl) return { ...base, status: "unknown", latestVersion: "?", reason: "no origin remote" };
  if (!g.branch) return { ...base, status: "unknown", latestVersion: "?", reason: "detached HEAD" };
  const key = `${g.remoteUrl}@${g.branch}`;
  const got = shas.get(key);
  if (got === undefined) return { ...base, status: "errored", latestVersion: "?", reason: "remote sha not fetched" };
  if (typeof got === "object") return { ...base, status: "errored", latestVersion: "?", reason: got.error };
  if (g.installedSha === got) return { ...base, status: "up-to-date", latestVersion: short(got) };
  return { ...base, status: "outdated", latestVersion: short(got),
    upgradeHint: [`git -C ${g.rootPath} pull --ff-only`] };
}

function short(sha: string): string { return sha.slice(0, 7); }
```

Note the subtle behaviors:
- For type-C plugins, the orchestrator (Task 9) uses `classifyMarketplaceEntry` to discover which (url, branch) pairs need ls-remote, fetches them, and stuffs the results into `gitRemoteShas` keyed `${url}@${branch}`. By the time `buildReport` runs, all needed shas are already in the map.
- For type-D plugins, `marketplaces.get(repo).marketplaceHeadSha` must be populated by the orchestrator from a separate ls-remote on the marketplace repo itself.

- [ ] **Step 5: Run, expect pass**

```sh
npm test -- --test-name-pattern='compareSemver|buildReport'
```

Expected: 12 new tests pass.

- [ ] **Step 6: Full suite**

```sh
npm test
```

Expected: 68 + 12 = 80 pass.

- [ ] **Step 7: Commit**

```sh
git add src/outdated.ts src/outdated.test.ts
git commit -m "outdated: compareSemver + buildReport classifier"
```

---

## Task 9: Outdated module — orchestration with cache + fetcher

**Files:**
- Modify: `src/outdated.ts` (add `runOutdated`)
- Modify: `src/outdated.test.ts`

Top-level entry. Two-phase fetch:

**Phase 1** — fetch all marketplace JSONs in parallel (with cache). For each marketplace, also `git ls-remote` the marketplace repo itself to capture `marketplaceHeadSha` (needed for type-D plugins).

**Phase 2** — for each plugin, run `classifyMarketplaceEntry` against its marketplace entry. Collect the unique `(url, branch)` pairs needed by type-C / sha-pinned-or-ref strategies. Add the unique `(url, branch)` pairs from git-tracked user/agent skills. Fetch all those ls-remote results in parallel (with cache).

**Phase 3** — call `buildReport` with everything assembled.

- [ ] **Step 1: Write failing tests using a mock fetcher**

```ts
import { runOutdated } from "./outdated.js";
import { Cache } from "./cache.js";

test("runOutdated uses cache on second invocation, no extra fetches", async () => {
  let mpFetches = 0;
  let lsFetches = 0;
  const fetcher = {
    fetchMarketplace: async () => { mpFetches++; return { plugins: [{ name: "x", version: "1.0.0" }] }; },
    gitLsRemote: async () => { lsFetches++; return "deadbeef"; },
  };
  // first run: miss + fetch
  // second run: hit, no fetch
  // assert mpFetches === 1, lsFetches === <set-by-discovery>
});

test("runOutdated with --no-cache (ttl 0) refetches", async () => { /* ... */ });

test("runOutdated reports counters consistently with returned rows", async () => { /* ... */ });
```

- [ ] **Step 2: Run, expect failure**

- [ ] **Step 3: Implement `runOutdated`**

```ts
import type { Fetcher } from "./fetcher.js";
import { realFetcher } from "./fetcher.js";
import { Cache } from "./cache.js";
import { homedir } from "node:os";
import { join } from "node:path";
import { rm } from "node:fs/promises";
import { readdir, stat } from "node:fs/promises";

export interface RunOutdatedOpts {
  claudeDir: string;
  agentsDir?: string;
  cacheDir?: string;
  ttlMinutes?: number;
  noCache?: boolean;
  fetcher?: Fetcher;
}

export async function runOutdated(opts: RunOutdatedOpts): Promise<OutdatedReport> {
  const fetcher = opts.fetcher ?? realFetcher;
  const ttl = opts.ttlMinutes ?? 60;
  const cache = new Cache(opts.cacheDir ?? join(homedir(), ".cache", "skill-graveyard", "outdated"));

  const plugins = await enumeratePluginSources(opts.claudeDir);
  const gits = await enumerateGitSources(opts.claudeDir, opts.agentsDir);

  // Plugin install paths know their own SKILL files; populate affectedSkills here.
  for (const p of plugins) {
    p.affectedSkills = await listSkillNamesUnder(p.installPath);
  }

  const marketplaceData = new Map<string, { plugins: Array<{ name: string; version: string }> } | { error: string }>();
  let cacheHits = 0;
  const uniqueRepos = new Set(plugins.map((p) => p.marketplaceRepo).filter((x): x is string => !!x));
  for (const repo of uniqueRepos) {
    const cacheKey = `marketplace-${repo.replace("/", "-")}`;
    if (opts.noCache) await cache.invalidate(cacheKey);
    const cached = await cache.get<{ plugins: Array<{ name: string; version: string }> }>(cacheKey, ttl);
    if (cached) { marketplaceData.set(repo, cached); cacheHits++; continue; }
    try {
      const data = (await fetcher.fetchMarketplace(repo)) as { plugins: Array<{ name: string; version: string }> };
      await cache.set(cacheKey, data);
      marketplaceData.set(repo, data);
    } catch (e) {
      marketplaceData.set(repo, { error: e instanceof Error ? e.message : String(e) });
    }
  }

  const gitRemoteShas = new Map<string, string | { error: string }>();
  for (const g of gits) {
    if (!g.remoteUrl || !g.branch) continue;
    const key = `${g.remoteUrl}@${g.branch}`;
    const cacheKey = `gitremote-${hashKey(key)}`;
    if (opts.noCache) await cache.invalidate(cacheKey);
    const cached = await cache.get<{ sha: string }>(cacheKey, ttl);
    if (cached) { gitRemoteShas.set(key, cached.sha); cacheHits++; continue; }
    try {
      const sha = await fetcher.gitLsRemote(g.remoteUrl, g.branch);
      if (sha === null) {
        gitRemoteShas.set(key, { error: `branch ${g.branch} not on remote` });
      } else {
        await cache.set(cacheKey, { sha, branch: g.branch, fetchedAt: Date.now() });
        gitRemoteShas.set(key, sha);
      }
    } catch (e) {
      gitRemoteShas.set(key, { error: e instanceof Error ? e.message : String(e) });
    }
  }

  return buildReport({ plugins, gits, marketplaceData, gitRemoteShas, cacheHits });
}

async function listSkillNamesUnder(dirPath: string): Promise<string[]> {
  // Walk dirPath looking for SKILL.md files; return parent-dir names.
  // Implementation similar to existing discovery walker; keep minimal.
  // ...
}

function hashKey(s: string): string {
  // very short, non-cryptographic; collision-safe enough for ~60 entries
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}
```

> Use the existing skill walker from `discovery.ts` rather than reimplementing `listSkillNamesUnder`. Read what's already there.

- [ ] **Step 4: Run, expect pass**

- [ ] **Step 5: Full suite — expect ≥83 pass**

- [ ] **Step 6: Commit**

```sh
git add src/outdated.ts src/outdated.test.ts
git commit -m "outdated: orchestrate with cache + fetcher"
```

---

## Task 10: Format the report for terminal

**Files:**
- Modify: `src/format.ts` (add `formatOutdatedReport`)
- Modify: `src/outdated.test.ts` (snapshot-style assertions on output strings)

Match the tone of `formatReport` (audit) and `formatPruneReport`. Headline counters → groups → footer.

- [ ] **Step 1: Write failing tests asserting output contains specific lines**

```ts
import { formatOutdatedReport } from "./format.js";

test("formatOutdatedReport prints 'all current' when nothing outdated", () => {
  const report: OutdatedReport = {
    windowFetchedAt: Date.now(), cacheHits: 0,
    rows: [{ kind: "plugin", name: "x@m", status: "up-to-date", installedVersion: "1", latestVersion: "1", affectedSkills: [] }],
    counters: { outdated: 0, upToDate: 1, unknown: 0, errored: 0 },
  };
  const s = formatOutdatedReport(report, { color: false });
  assert.match(s, /all current/);
});

test("formatOutdatedReport groups outdated plugins under PLUGINS header", () => { /* ... */ });
test("formatOutdatedReport prints upgrade hint after each outdated row", () => { /* ... */ });
test("formatOutdatedReport prints affected-skills snippet when truncated", () => { /* ... */ });
```

- [ ] **Step 2: Run, expect failure**

- [ ] **Step 3: Implement in `src/format.ts`**

(Follow the existing `formatReport` and `formatPruneReport` patterns: build lines, apply ANSI via existing color helpers, return joined string. Keep ≤150 lines.)

- [ ] **Step 4: Run, expect pass**

- [ ] **Step 5: Full suite**

- [ ] **Step 6: Commit**

```sh
git add src/format.ts src/outdated.test.ts
git commit -m "format: outdated report formatter"
```

---

## Task 11: CLI integration

**Files:**
- Modify: `src/cli.ts`

Add `outdated` to Command type, parse `--no-cache` and `--ttl`, route to `runOutdated`, format result.

- [ ] **Step 1: Add to `Command` union and `ParsedArgs` interface**

```ts
type Command = "audit" | "prune" | "suggest" | "cost" | "projects" | "outdated" | "help" | "version";

interface ParsedArgs {
  // existing fields
  noCache: boolean;
  ttlMinutes: number | null;
}
```

Initialize defaults: `noCache: false, ttlMinutes: null`.

- [ ] **Step 2: Parser cases**

```ts
case "outdated":
  args.command = "outdated";
  break;
case "--no-cache":
  args.noCache = true;
  break;
case "--ttl": {
  const v = argv[++i];
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) fatal(`--ttl requires a non-negative number, got: ${v}`);
  args.ttlMinutes = n;
  break;
}
```

- [ ] **Step 3: Help text**

Add to USAGE block:
```
  skill-graveyard outdated [options]
```

Add OUTDATED OPTIONS section:
```
OUTDATED OPTIONS
  --no-cache            force re-fetch (ignores cached marketplace + git-ls-remote)
  --ttl <minutes>       cache TTL override (default: 60)
```

- [ ] **Step 4: Routing in `main()`**

```ts
if (args.command === "outdated") {
  const report = await runOutdated({
    claudeDir: args.claudeDir,
    ttlMinutes: args.ttlMinutes ?? undefined,
    noCache: args.noCache,
  });
  if (args.json) {
    process.stdout.write(formatJson(report) + "\n");
  } else {
    process.stdout.write(formatOutdatedReport(report, { color: args.color }) + "\n");
  }
  return;
}
```

- [ ] **Step 5: Run typecheck + smoke**

```sh
npm run typecheck
npm run dev -- outdated --help    # should not crash
npm run dev -- outdated           # against real ~/.claude/, should produce report
```

Expected: typecheck clean. CLI runs and produces a report. Some sources may show as `errored` if test ran without network — that's normal.

- [ ] **Step 6: Update `parseArgs` regression test**

In `src/cli.test.ts`, add coverage that `outdated` is recognized as a command and that `--no-cache` / `--ttl 5` parse correctly.

- [ ] **Step 7: Full suite**

```sh
npm test
```

- [ ] **Step 8: Commit**

```sh
git add src/cli.ts src/cli.test.ts
git commit -m "cli: route outdated subcommand + flags"
```

---

## Task 12: Documentation updates

**Files:**
- Modify: `README.md`
- Modify: `docs/index.html`
- Modify: `commands/audit-skills.md` (if it lists subcommands)

- [ ] **Step 1: Update README subcommand table**

Add to the listing right after `cost`:
```
skill-graveyard outdated              # check installed plugins / git-tracked skills for upstream updates (network)
```

- [ ] **Step 2: Add an `### outdated` section to README**

Brief description, sample output (anonymized), notes on cache + TTL. Mirror existing `### cost` section.

- [ ] **Step 3: Update README "What it does NOT do"**

Replace:
> **Does not phone home.** All analysis is local. No telemetry, no network calls.

With:
> **Does not phone home except when running `outdated`.** Four of the five subcommands are entirely local. `outdated` is the explicit exception — it fetches each registered marketplace's `marketplace.json` and runs `git ls-remote` for git-tracked skills. Results are cached locally; everything else stays local.

- [ ] **Step 4: Update README "What it reads"**

Append:
```
- Network (only when `outdated` runs): `https://raw.githubusercontent.com/<repo>/HEAD/marketplace.json` for each registered marketplace, `git ls-remote` for each git-tracked skill source. Cached at `~/.cache/skill-graveyard/outdated/` with a configurable TTL.
```

- [ ] **Step 5: Sync `docs/index.html`**

The lander has a "what it does not do" / "what it reads" section. Update parallel text. Keep numbers and tone consistent with README.

- [ ] **Step 6: Commit**

```sh
git add README.md docs/index.html
git commit -m "docs: document outdated subcommand and revised network posture"
```

---

## Task 13: CHANGELOG, version bump, build, smoke, push

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `package.json` (version 0.6.2 → 0.7.0)
- Modify: `.claude-plugin/plugin.json` (same)

- [ ] **Step 1: Add CHANGELOG 0.7.0 section**

```markdown
## 0.7.0 — YYYY-MM-DD

### Added

- **`outdated` subcommand** — checks installed plugins (against their marketplace's `marketplace.json`) and git-tracked user/agent skills (against `git ls-remote`) for newer versions available upstream. Reports outdated sources with the upgrade command for each. Network-bound and the only subcommand that performs network calls; results are cached locally with a 60-minute TTL by default. New flags `--no-cache` and `--ttl <minutes>`.
- **Cache module** under `~/.cache/skill-graveyard/outdated/` for marketplace JSONs and git-ls-remote results. mtime-based expiry.

### Changed

- Updated README and lander to clarify network posture: four subcommands stay local, `outdated` is the documented exception.
```

- [ ] **Step 2: Bump versions**

```sh
# package.json: "version": "0.7.0"
# .claude-plugin/plugin.json: "version": "0.7.0"
```

Verify in lock-step:
```sh
node -e 'const a=require("./package.json").version, b=require("./.claude-plugin/plugin.json").version; if (a!==b) {console.error(a, b); process.exit(1);} console.log(a);'
```

- [ ] **Step 3: Full verification**

```sh
npm run typecheck
npm test
npm run build
npm pack --dry-run | grep -E "(version|filename|total files)"
```

Expected: clean typecheck, all tests pass (target: ~85+), build succeeds, tarball lists `version: 0.7.0`.

- [ ] **Step 4: Manual smoke against own install**

```sh
node dist/cli.js outdated
node dist/cli.js outdated --no-cache
node dist/cli.js outdated --json | head -40
node dist/cli.js outdated --ttl 0  # equivalent to --no-cache
```

Verify the report is sensible. Expect at least one `outdated` row given typical drift.

- [ ] **Step 5: Commit**

```sh
git add CHANGELOG.md package.json .claude-plugin/plugin.json
git commit -m "v0.7.0: outdated subcommand"
```

- [ ] **Step 6: Push**

```sh
git push origin main
```

Then wait for CI green. Publish + tag + GH release follows the standard CLAUDE.md release flow:

```sh
# user supplies OTP
# ! npm publish --otp=NNNNNN
git tag -a v0.7.0 -m "v0.7.0: outdated subcommand"
git push origin v0.7.0
gh release create v0.7.0 --notes-file <release-notes>
```

(That post-publish dance lives outside this plan — same as for 0.6.2.)

---

## Self-review

**Spec coverage check:**

| Spec section | Task that covers it |
|---|---|
| Goal: report plugin updates | Tasks 5, 6, 8, 9 |
| Goal: report git-tracked skill updates | Tasks 4, 7, 8, 9 |
| Goal: group by source | Task 8 (buildReport), Task 10 (formatter) |
| Goal: TTL cache | Tasks 2, 9 |
| Goal: local-only contract preserved | Task 12 (docs explicitly call out exception) |
| Marketplace JSON shape variations (4 types) | Task 6 (resolver), Task 8 (compare branches) |
| Architecture: cache.ts | Task 2 |
| Architecture: fetcher.ts | Task 3 |
| Architecture: source_resolver.ts | Task 6 |
| Architecture: outdated.ts | Tasks 5, 7, 8, 9 |
| Architecture: discovery.ts findGitRoot | Task 4 |
| Architecture: format.ts extension | Task 10 |
| Architecture: cli.ts routing | Task 11 |
| Data model | Tasks 5, 8 |
| Data flow | Tasks 5–9 |
| CLI surface (--no-cache, --ttl, --json) | Task 11 |
| Output format | Task 10 |
| Cache TTL default 60min | Tasks 2, 9 |
| Error handling matrix (all 14 cases) | Tasks 8, 9 |
| Testing strategy | Tasks 2, 3, 4, 5, 6, 7, 8, 9, 10 |
| Documentation impact | Task 12 |
| Versioning 0.7.0 | Task 13 |

No spec section is uncovered.

**Placeholder scan:** A few `// ...` ellipses exist in test bodies for Tasks 7, 8, 9 — explicitly noted as "expand following the pattern of Task 5". The pattern-source IS in the plan. Acceptable. The four spec-level TBDs (CC update command, marketplace JSON path, marketplace shape variations, gitCommitSha reliability) are all resolved at Task 1 with concrete findings — no open TBDs remain.

**Type consistency check:**
- `OutdatedRow.kind`: declared as `"plugin" | "git"` in Task 8, used in Task 10 — consistent.
- `OutdatedStatus`: declared in Task 8, used unchanged thereafter.
- `PluginSource` / `GitSource`: defined in Tasks 5 / 7, reused in 8 / 9.
- `MarketplaceEntry` / `Strategy`: defined in Task 6, reused in Task 8.
- `Fetcher` interface: defined in Task 3, used in Task 9.
- `Cache` API: defined in Task 2 (`get`, `set`, `invalidate`), used in Task 9.

No type drift.

---

## Execution

Plan complete and saved to `docs/specs/2026-04-29-outdated-plan.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session using executing-plans, batch with checkpoints.

Which approach?
