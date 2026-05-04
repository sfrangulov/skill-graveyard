#!/usr/bin/env node
import { runAudit } from "./audit.js";
import { runLint } from "./lint.js";
import {
  formatAuditReportSections,
  formatAuditJson,
  formatLintReport,
  formatLintJson,
  formatPruneReport,
  formatApplyResult,
  formatProjectsReport,
} from "./format.js";
import { planPrune, applyPrune } from "./prune.js";
import { runProjects } from "./projects.js";
import type { Bucket } from "./types.js";
import { shouldAnimate, Spinner, streamSections } from "@skill-graveyard/core";

const VALID_BUCKETS: Bucket[] = ["active", "dead", "missing", "hallucinated"];

interface Args {
  subcommand: "audit" | "lint" | "prune" | "projects";
  days: number;
  json: boolean;
  only: Bucket | undefined;
  claudeDir: string | undefined;
  project: string | undefined;
  apply: boolean;
  include: { orphans: boolean; brokenPointers: boolean };
  exclude: Set<string>;
  truncationCutoff: number;
  staleDays: number;
  coldDays: number;
  noAnimate: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    subcommand: "audit",
    days: 30,
    json: false,
    only: undefined,
    claudeDir: undefined,
    project: undefined,
    apply: false,
    include: { orphans: false, brokenPointers: false },
    exclude: new Set(),
    truncationCutoff: 200,
    staleDays: 30,
    coldDays: 90,
    noAnimate: false,
  };
  let i = 0;
  if (argv[i] && !argv[i]!.startsWith("--") && !argv[i]!.startsWith("-")) {
    const sub = argv[i] as Args["subcommand"];
    if (sub !== "audit" && sub !== "lint" && sub !== "prune" && sub !== "projects") {
      die(`unknown subcommand: ${argv[i]}`);
    }
    args.subcommand = sub;
    i++;
  }
  for (; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--json") args.json = true;
    else if (a === "--apply") args.apply = true;
    else if (a === "--days") args.days = Number(argv[++i]);
    else if (a === "--only") {
      const v = argv[++i] as Bucket;
      if (!VALID_BUCKETS.includes(v)) die(`--only must be one of ${VALID_BUCKETS.join("|")}`);
      args.only = v;
    } else if (a === "--claude-dir") args.claudeDir = argv[++i];
    else if (a === "--project") args.project = argv[++i];
    else if (a === "--include") {
      const v = argv[++i]!;
      for (const item of v.split(",")) {
        if (item === "orphans") args.include.orphans = true;
        else if (item === "broken-pointers") args.include.brokenPointers = true;
        else die(`--include unknown value: ${item}`);
      }
    } else if (a === "--exclude") args.exclude.add(argv[++i]!);
    else if (a === "--truncation-cutoff") args.truncationCutoff = Number(argv[++i]);
    else if (a === "--stale-days") args.staleDays = Number(argv[++i]);
    else if (a === "--cold-days") args.coldDays = Number(argv[++i]);
    else if (a === "--no-animate") args.noAnimate = true;
    else if (a === "--help" || a === "-h") usage();
    else die(`unknown flag: ${a}`);
  }
  return args;
}

const USAGE = `memory-graveyard — audit MEMORY.md entry usage

Usage:
  memory-graveyard [audit] [--days N] [--only active|dead|missing|hallucinated]
                          [--json] [--project <path>] [--claude-dir <path>]
  memory-graveyard lint [--truncation-cutoff N] [--stale-days N] [--json]
                        [--project <path>] [--claude-dir <path>]
  memory-graveyard prune [--apply] [--include orphans|broken-pointers]
                         [--exclude <basename>] [--days N] [--json]
                         [--project <path>] [--claude-dir <path>]
  memory-graveyard projects [--cold-days N] [--json] [--claude-dir <path>]
`;

function usage(): never {
  console.log(USAGE);
  process.exit(0);
}

function die(msg: string): never {
  console.error(`memory-graveyard: ${msg}`);
  process.exit(2);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  // Hide the parsing latency with a spinner on stderr; TTY-only, opt-out via
  // --no-animate / NO_ANIMATE=1 / --json. Wraps every subcommand uniformly.
  const spinner = new Spinner();
  const wantAnimate = !args.json && shouldAnimate(process.stdout, args.noAnimate);
  if (wantAnimate) spinner.start("scanning sessions…");
  try {
  if (args.subcommand === "audit") {
    const report = await runAudit({
      claudeDir: args.claudeDir,
      windowDays: args.days,
      only: args.only,
      projectKey: args.project,
    });
    spinner.stop();
    if (args.json) {
      console.log(formatAuditJson(report));
      return;
    }
    const sections = formatAuditReportSections(report, {
      color: process.stdout.isTTY ?? false,
    });
    await streamSections(sections, { animate: wantAnimate });
    return;
  }
  if (args.subcommand === "lint") {
    const report = await runLint({
      claudeDir: args.claudeDir,
      projectKey: args.project,
      truncationCutoff: args.truncationCutoff,
      staleDays: args.staleDays,
    });
    spinner.stop();
    if (args.json) {
      console.log(formatLintJson(report));
    } else {
      console.log(formatLintReport(report, { color: process.stdout.isTTY ?? false }));
    }
    if (!report.summary.ok) process.exit(1);
    return;
  }
  if (args.subcommand === "prune") {
    const audit = await runAudit({
      claudeDir: args.claudeDir,
      windowDays: args.days,
      projectKey: args.project,
    });
    const lint = await runLint({
      claudeDir: args.claudeDir,
      projectKey: args.project,
      truncationCutoff: args.truncationCutoff,
      staleDays: args.staleDays,
    });
    const plan = planPrune(audit, lint, { include: args.include, exclude: args.exclude });
    spinner.stop();
    if (args.json) {
      console.log(JSON.stringify({ plan, applied: args.apply }, null, 2));
    } else {
      console.log(formatPruneReport(plan, { apply: args.apply, color: process.stdout.isTTY ?? false }));
    }
    if (!args.apply) return;
    const result = await applyPrune(audit.memoryDir, plan);
    if (!args.json) console.log(formatApplyResult(result, { color: process.stdout.isTTY ?? false }));
    if (result.failed.length > 0) process.exit(1);
    return;
  }
  if (args.subcommand === "projects") {
    const stats = await runProjects({
      claudeDir: args.claudeDir,
      windowDays: args.days,
      coldDays: args.coldDays,
    });
    spinner.stop();
    if (args.json) {
      console.log(JSON.stringify(stats, null, 2));
    } else {
      console.log(formatProjectsReport(stats, { color: process.stdout.isTTY ?? false }));
    }
    return;
  }
  die(`subcommand "${args.subcommand}" not yet implemented`);
  } finally {
    spinner.stop();
  }
}

main().catch((err) => {
  console.error("memory-graveyard:", err instanceof Error ? err.message : err);
  process.exit(1);
});
