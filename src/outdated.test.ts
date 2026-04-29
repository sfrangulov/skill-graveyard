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
