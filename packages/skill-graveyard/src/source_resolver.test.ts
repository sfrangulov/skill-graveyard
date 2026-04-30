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
    assert.equal(r.branch, "main");
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
  if (r.kind === "sha-pinned-or-ref") {
    assert.equal(r.branch, "main");
  }
});
