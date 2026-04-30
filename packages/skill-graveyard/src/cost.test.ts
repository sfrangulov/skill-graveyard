import test from "node:test";
import assert from "node:assert/strict";
import { estimateTokens, TOKENIZER_NAME, parseDescription } from "./cost.js";

test("estimateTokens returns 0 for empty string", () => {
  assert.equal(estimateTokens(""), 0);
});

test("estimateTokens returns positive integer for non-empty text", () => {
  const n = estimateTokens("hello world");
  assert.ok(Number.isInteger(n));
  assert.ok(n >= 1);
});

test("estimateTokens uses real BPE, not chars/4", () => {
  const n = estimateTokens("a".repeat(100));
  assert.notEqual(n, 25);
  assert.ok(n >= 1 && n < 25);
});

test("estimateTokens counts a known phrase predictably", () => {
  assert.equal(estimateTokens("hello world"), 2);
  assert.equal(estimateTokens("the quick brown fox"), 4);
});

test("estimateTokens deterministic for same input", () => {
  const a = estimateTokens("the quick brown fox jumps over the lazy dog");
  const b = estimateTokens("the quick brown fox jumps over the lazy dog");
  assert.equal(a, b);
});

test("TOKENIZER_NAME exposes encoding identity", () => {
  assert.equal(TOKENIZER_NAME, "cl100k_base");
});

test("parseDescription handles plain single-line", () => {
  const md = `---
name: foo
description: A simple description on one line
---
body
`;
  assert.equal(
    parseDescription(md),
    "A simple description on one line",
  );
});

test("parseDescription handles single-quoted multi-line", () => {
  const md = `---
name: foo
description: 'Line one of description.
Line two continues here.
Line three closes the quote.'
---
body
`;
  const result = parseDescription(md);
  assert.match(result, /Line one of description\./);
  assert.match(result, /Line three closes the quote\.$/);
});

test("parseDescription handles double-quoted single-line", () => {
  const md = `---
name: foo
description: "Quoted in double quotes"
---
`;
  assert.equal(parseDescription(md), "Quoted in double quotes");
});

test("parseDescription returns empty string when no description field", () => {
  const md = `---
name: foo
metadata:
  internal: true
---
body
`;
  assert.equal(parseDescription(md), "");
});

test("parseDescription returns empty string when no frontmatter", () => {
  const md = `# Hello

just a plain markdown file.
`;
  assert.equal(parseDescription(md), "");
});

test("parseDescription stops at next frontmatter field", () => {
  const md = `---
name: foo
description: First line description.
metadata:
  key: value
---
`;
  assert.equal(parseDescription(md), "First line description.");
});
