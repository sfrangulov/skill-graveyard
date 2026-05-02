import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMemoryIndex } from "./index_parser.js";

const SAMPLE = `# Memory Index

Some intro text.

- [Project: foo](project_foo.md) — TS CLI scope and contracts
- [Feedback: testing](feedback_testing.md) — never mock the database
- [User: role](user_role.md)
- malformed line that should be ignored
- [Reference: linear](reference_linear.md) — see project FOO

Footer.
`;

test("parseMemoryIndex extracts pointers with line numbers", () => {
  const pointers = parseMemoryIndex(SAMPLE, 200);
  assert.equal(pointers.length, 4);
  assert.deepEqual(
    pointers.map((p) => p.target),
    ["project_foo.md", "feedback_testing.md", "user_role.md", "reference_linear.md"],
  );
  assert.equal(pointers[0]!.line, 5);
  assert.equal(pointers[0]!.title, "Project: foo");
  assert.equal(pointers[0]!.hook, "TS CLI scope and contracts");
  assert.equal(pointers[2]!.hook, "");
  assert.equal(pointers[0]!.visible, true);
});

test("parseMemoryIndex marks pointers below cutoff as not visible", () => {
  const lines = ["# Memory Index", ""];
  for (let i = 0; i < 250; i++) {
    lines.push(`- [Entry ${i}](entry_${i}.md) — note ${i}`);
  }
  const pointers = parseMemoryIndex(lines.join("\n"), 200);
  const visibleCount = pointers.filter((p) => p.visible).length;
  const hiddenCount = pointers.filter((p) => !p.visible).length;
  assert.equal(visibleCount + hiddenCount, 250);
  assert.equal(visibleCount, 198); // lines 3..200 are pointers, 200-3+1 = 198
  assert.equal(hiddenCount, 52);
});

test("parseMemoryIndex returns [] on empty input", () => {
  assert.deepEqual(parseMemoryIndex("", 200), []);
});
