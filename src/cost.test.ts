import test from "node:test";
import assert from "node:assert/strict";
import { CHARS_PER_TOKEN, estimateTokens, parseDescription } from "./cost.js";

test("estimateTokens uses chars/4 ceiling", () => {
  assert.equal(estimateTokens(""), 0);
  assert.equal(estimateTokens("abc"), 1);
  assert.equal(estimateTokens("abcd"), 1);
  assert.equal(estimateTokens("abcde"), 2);
  assert.equal(estimateTokens("a".repeat(100)), 25);
  assert.equal(CHARS_PER_TOKEN, 4);
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
