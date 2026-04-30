import test from "node:test";
import assert from "node:assert/strict";
import { computeProjects } from "./projects.js";
import type { SkillCall } from "@skill-graveyard/core";

function call(opts: Partial<SkillCall> & { skill: string; sessionId: string; cwd?: string | null }): SkillCall {
  return {
    skill: opts.skill,
    sessionId: opts.sessionId,
    projectKey: opts.projectKey ?? "-Users-foo-projects-bar",
    filepath: opts.filepath ?? "/tmp/x.jsonl",
    cwd: opts.cwd === undefined ? "/Users/foo/projects/bar" : opts.cwd,
    timestamp: opts.timestamp ?? "2026-04-29T00:00:00Z",
    toolUseId: opts.toolUseId ?? "tu-1",
    errored: opts.errored ?? false,
    errorReason: opts.errorReason ?? null,
  };
}

test("groups calls by cwd and counts unique sessions", () => {
  const calls: SkillCall[] = [
    call({ skill: "foo", sessionId: "s1", cwd: "/a" }),
    call({ skill: "foo", sessionId: "s1", cwd: "/a" }),
    call({ skill: "bar", sessionId: "s2", cwd: "/a" }),
    call({ skill: "foo", sessionId: "s3", cwd: "/b" }),
  ];
  const installed = new Set(["foo", "bar"]);
  const r = computeProjects(calls, installed, 30);

  assert.equal(r.totalProjects, 2);
  assert.equal(r.totalSkillCalls, 4);

  const a = r.projects.find((p) => p.displayPath === "/a");
  const b = r.projects.find((p) => p.displayPath === "/b");
  assert.ok(a && b);
  assert.equal(a.sessions, 2);
  assert.equal(a.totalCalls, 3);
  assert.equal(a.uniqueSkills, 2);
  assert.equal(b.sessions, 1);
  assert.equal(b.totalCalls, 1);
});

test("sorts projects by total calls descending", () => {
  const calls: SkillCall[] = [
    call({ skill: "x", sessionId: "s1", cwd: "/quiet" }),
    call({ skill: "x", sessionId: "s2", cwd: "/busy" }),
    call({ skill: "x", sessionId: "s3", cwd: "/busy" }),
    call({ skill: "x", sessionId: "s4", cwd: "/busy" }),
  ];
  const r = computeProjects(calls, new Set(["x"]), 30);
  assert.equal(r.projects[0]?.displayPath, "/busy");
  assert.equal(r.projects[1]?.displayPath, "/quiet");
});

test("marks not-installed skills correctly", () => {
  const calls: SkillCall[] = [
    call({ skill: "real-skill", sessionId: "s1" }),
    call({ skill: "ghost", sessionId: "s1", errored: true }),
  ];
  const r = computeProjects(calls, new Set(["real-skill"]), 30);
  const p = r.projects[0];
  assert.ok(p);
  const ghost = p.skills.find((s) => s.invokeName === "ghost");
  const real = p.skills.find((s) => s.invokeName === "real-skill");
  assert.equal(ghost?.installed, false);
  assert.equal(ghost?.errored, 1);
  assert.equal(real?.installed, true);
  assert.equal(real?.errored, 0);
});

test("falls back to decoded projectKey when cwd is null", () => {
  const calls: SkillCall[] = [
    call({
      skill: "x",
      sessionId: "s1",
      cwd: null,
      projectKey: "-Users-foo-projects-bar",
    }),
  ];
  const r = computeProjects(calls, new Set(), 30);
  assert.equal(r.projects[0]?.displayPath, "/Users/foo/projects/bar");
});

test("sorts skills within a project by call count descending", () => {
  const calls: SkillCall[] = [
    call({ skill: "rare", sessionId: "s1" }),
    call({ skill: "common", sessionId: "s1" }),
    call({ skill: "common", sessionId: "s1" }),
    call({ skill: "common", sessionId: "s1" }),
    call({ skill: "medium", sessionId: "s1" }),
    call({ skill: "medium", sessionId: "s1" }),
  ];
  const r = computeProjects(calls, new Set(), 30);
  const skills = r.projects[0]?.skills.map((s) => s.invokeName);
  assert.deepEqual(skills, ["common", "medium", "rare"]);
});

test("totalErrored counts errored calls per project", () => {
  const calls: SkillCall[] = [
    call({ skill: "x", sessionId: "s1", errored: false }),
    call({ skill: "y", sessionId: "s1", errored: true }),
    call({ skill: "y", sessionId: "s1", errored: true }),
  ];
  const r = computeProjects(calls, new Set(), 30);
  assert.equal(r.projects[0]?.totalErrored, 2);
});

test("empty calls produce empty report", () => {
  const r = computeProjects([], new Set(), 30);
  assert.equal(r.totalProjects, 0);
  assert.equal(r.totalSessions, 0);
  assert.equal(r.totalSkillCalls, 0);
  assert.deepEqual(r.projects, []);
});
