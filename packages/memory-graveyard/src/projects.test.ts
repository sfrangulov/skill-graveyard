import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, utimes, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runProjects } from "./projects.js";

test("runProjects emits one summary per memory dir, marks cold ones", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "mg-proj-"));
  try {
    const projectsDir = join(tmp, "claude", "projects");
    const fresh = join(projectsDir, "-fresh", "memory");
    const cold = join(projectsDir, "-cold", "memory");
    await mkdir(fresh, { recursive: true });
    await mkdir(cold, { recursive: true });
    await writeFile(join(fresh, "MEMORY.md"), "# x\n");
    await writeFile(join(fresh, "a.md"), "body");
    await writeFile(join(cold, "MEMORY.md"), "# x\n");
    await writeFile(join(cold, "b.md"), "body");
    const oldDate = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000);
    await utimes(join(cold, "MEMORY.md"), oldDate, oldDate);
    await utimes(join(cold, "b.md"), oldDate, oldDate);

    const stats = await runProjects({ claudeDir: join(tmp, "claude"), windowDays: 30, coldDays: 90 });
    const byKey = new Map(stats.map((s) => [s.projectKey, s]));
    assert.equal(byKey.get("-cold")!.cold, true);
    assert.equal(byKey.get("-fresh")!.cold, false);
    assert.equal(byKey.get("-cold")!.entryCount, 1);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
