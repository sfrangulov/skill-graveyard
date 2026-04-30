import test from "node:test";
import assert from "node:assert/strict";
import { classify, type SuggestRow } from "./suggest.js";

const configured = ["supabase", "playwright", "pencil"];

test("typo within distance 2 → TYPO", () => {
  const result = classify("supbase", configured);
  assert.equal(result.category, "TYPO");
  assert.equal(result.match, "supabase");
});

test("name matches built-in tool → TOOL_CONFUSION", () => {
  const result = classify("Bash", configured);
  assert.equal(result.category, "TOOL_CONFUSION");
});

test("no match → UNCLASSIFIED", () => {
  const result = classify("zzz_nonsense", configured);
  assert.equal(result.category, "UNCLASSIFIED");
});

test("exact match to configured doesn't count (caller filters those out)", () => {
  const result = classify("supabase", configured);
  // distance 0 still counts as TYPO under our logic; caller must filter out exact matches before classifying.
  assert.equal(result.category, "TYPO");
});
