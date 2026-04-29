import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { enumeratePluginSources, enumerateGitSources } from "./outdated.js";

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

function gitInit(dir: string) {
  spawnSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  spawnSync(
    "git",
    ["-c", "user.email=x@x", "-c", "user.name=x", "commit", "--allow-empty", "-m", "init", "-q"],
    { cwd: dir },
  );
  spawnSync("git", ["remote", "add", "origin", "https://example.com/foo/bar.git"], { cwd: dir });
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

test("enumerateGitSources groups skills sharing a git root into one source", async () => {
  const dir = await mkdtemp(join(tmpdir(), "skg-git-"));
  try {
    const claudeDir = join(dir, ".claude");
    await mkdir(join(claudeDir, "skills", "foo"), { recursive: true });
    await mkdir(join(claudeDir, "skills", "bar"), { recursive: true });
    await writeFile(join(claudeDir, "skills", "foo", "SKILL.md"), "---\nname: foo\n---\n");
    await writeFile(join(claudeDir, "skills", "bar", "SKILL.md"), "---\nname: bar\n---\n");
    gitInit(claudeDir);

    const sources = await enumerateGitSources(claudeDir);
    assert.equal(sources.length, 1);
    assert.deepEqual(sources[0]!.affectedSkills, ["bar", "foo"]);
    assert.equal(sources[0]!.rootPath, claudeDir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("enumerateGitSources skips skills not under any git tree", async () => {
  const dir = await mkdtemp(join(tmpdir(), "skg-git-"));
  try {
    const claudeDir = join(dir, ".claude");
    await mkdir(join(claudeDir, "skills", "foo"), { recursive: true });
    await writeFile(join(claudeDir, "skills", "foo", "SKILL.md"), "---\nname: foo\n---\n");
    // No git init — skill is not under any git tree.
    const sources = await enumerateGitSources(claudeDir);
    assert.deepEqual(sources, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("enumerateGitSources captures remote URL, branch, and local SHA", async () => {
  const dir = await mkdtemp(join(tmpdir(), "skg-git-"));
  try {
    const claudeDir = join(dir, ".claude");
    await mkdir(join(claudeDir, "skills", "foo"), { recursive: true });
    await writeFile(join(claudeDir, "skills", "foo", "SKILL.md"), "---\nname: foo\n---\n");
    gitInit(claudeDir);

    const sources = await enumerateGitSources(claudeDir);
    assert.equal(sources.length, 1);
    const s = sources[0]!;
    assert.equal(s.remoteUrl, "https://example.com/foo/bar.git");
    assert.equal(s.branch, "main");
    assert.match(s.installedSha, /^[0-9a-f]{40}$/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
