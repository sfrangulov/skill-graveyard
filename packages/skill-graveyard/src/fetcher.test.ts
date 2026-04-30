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
