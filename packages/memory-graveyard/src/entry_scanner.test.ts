import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanEntryFiles, parseFrontmatter, readEntryBody } from "./entry_scanner.js";

test("parseFrontmatter extracts name/description/type", () => {
  const fm = parseFrontmatter(`---
name: project_foo
description: Some text
type: project
---

Body here.
`);
  assert.deepEqual(fm, { name: "project_foo", description: "Some text", type: "project" });
});

test("parseFrontmatter returns null on missing block", () => {
  assert.equal(parseFrontmatter("just a body, no fm\n"), null);
});

test("scanEntryFiles enumerates *.md and skips MEMORY.md", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "mg-entry-"));
  try {
    await writeFile(join(tmp, "MEMORY.md"), "");
    await writeFile(
      join(tmp, "project_foo.md"),
      "---\nname: foo\ndescription: x\ntype: project\n---\nbody\n",
    );
    await writeFile(join(tmp, "feedback_bar.md"), "no frontmatter here\n");
    const entries = await scanEntryFiles(tmp);
    const sorted = entries.map((e) => e.basename).sort();
    assert.deepEqual(sorted, ["feedback_bar.md", "project_foo.md"]);
    const foo = entries.find((e) => e.basename === "project_foo.md")!;
    assert.equal(foo.frontmatter?.type, "project");
    const bar = entries.find((e) => e.basename === "feedback_bar.md")!;
    assert.equal(bar.frontmatter, null);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("readEntryBody returns full file content", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "mg-body-"));
  try {
    await writeFile(join(tmp, "x.md"), "---\nname: x\n---\nbody line one\nbody line two\n");
    const body = await readEntryBody(join(tmp, "x.md"));
    assert.match(body, /body line one/);
    assert.match(body, /body line two/);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
