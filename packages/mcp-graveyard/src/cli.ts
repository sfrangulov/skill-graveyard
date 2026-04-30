#!/usr/bin/env node
import { dirname, join } from "node:path";
import { runAudit } from "./audit.js";
import { formatAuditReport, formatAuditJson, formatDrillDown, formatPruneReport } from "./format.js";
import { planPrune, applyPrune, writePruneBackup, ensureClaudeCliAvailable } from "./prune.js";
import { readMcpServers } from "./mcp_config.js";
import type { McpBucket } from "./types.js";

const VALID_BUCKETS: McpBucket[] = ["active", "dead", "missing", "hallucinated"];

interface Args {
  subcommand: "audit" | "prune" | "projects" | "suggest";
  days: number;
  json: boolean;
  only: McpBucket | undefined;
  tools: string | undefined;
  claudeDir: string | undefined;
  apply: boolean;       // for prune
  pruneOnly: string | undefined;  // server-name filter for prune
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    subcommand: "audit",
    days: 30,
    json: false,
    only: undefined,
    tools: undefined,
    claudeDir: undefined,
    apply: false,
    pruneOnly: undefined,
  };
  let i = 0;
  if (argv[i] && !argv[i]!.startsWith("--")) {
    const sub = argv[i] as Args["subcommand"];
    if (sub !== "audit" && sub !== "prune" && sub !== "projects" && sub !== "suggest") {
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
    else if (a === "--only" && args.subcommand === "audit") {
      const v = argv[++i] as McpBucket;
      if (!VALID_BUCKETS.includes(v)) die(`--only must be one of ${VALID_BUCKETS.join("|")}`);
      args.only = v;
    } else if (a === "--only" && args.subcommand === "prune") {
      args.pruneOnly = argv[++i];
    } else if (a === "--tools") args.tools = argv[++i];
    else if (a === "--claude-dir") args.claudeDir = argv[++i];
    else if (a === "--help" || a === "-h") usage();
    else die(`unknown flag: ${a}`);
  }
  return args;
}

function usage(): never {
  console.log(`mcp-graveyard — audit MCP server tool usage

Usage:
  mcp-graveyard [audit] [--days N] [--only ACTIVE|DEAD|MISSING|HALLUCINATED]
                       [--tools <server>] [--json] [--claude-dir <path>]
  mcp-graveyard prune [--apply] [--only <server>] [--claude-dir <path>]
  mcp-graveyard projects [--days N] [--claude-dir <path>]
  mcp-graveyard suggest [--days N] [--claude-dir <path>]
`);
  process.exit(0);
}

function die(msg: string): never {
  console.error(`mcp-graveyard: ${msg}`);
  process.exit(2);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.subcommand === "prune") {
    const report = await runAudit({
      claudeDir: args.claudeDir,
      windowDays: args.days,
    });
    const plan = planPrune(report.rows, args.pruneOnly);
    if (!args.apply) {
      console.log(formatPruneReport(plan, args.days, { color: process.stdout.isTTY ?? false }));
      return;
    }
    ensureClaudeCliAvailable();
    const claudeJsonPath = join(dirname(report.claudeDir), ".claude.json");
    const allEntries = await readMcpServers(claudeJsonPath);
    const entries = plan
      .map((p) => allEntries.find((e) => e.name === p.server))
      .filter((e): e is NonNullable<typeof e> => e !== undefined);
    const backupPath = await writePruneBackup(report.claudeDir, entries, args.days);
    console.log(`backup: ${backupPath}`);
    const result = applyPrune(plan);
    console.log(`removed: ${result.removed.length}/${plan.length}`);
    if (result.failed.length > 0) {
      console.log(`failed:`);
      for (const f of result.failed) console.log(`  ${f.server}: ${f.error}`);
      process.exit(1);
    }
    return;
  }
  if (args.subcommand !== "audit") {
    die(`subcommand "${args.subcommand}" not implemented yet`);
  }
  const report = await runAudit({
    claudeDir: args.claudeDir,
    windowDays: args.days,
    only: args.only,
  });
  if (args.json) {
    console.log(formatAuditJson(report));
    return;
  }
  if (args.tools) {
    const summary = report.rows.find((r) => r.name === args.tools);
    if (!summary) die(`server "${args.tools}" not found`);
    console.log(formatDrillDown(args.tools, summary, { color: process.stdout.isTTY ?? false }));
    return;
  }
  console.log(formatAuditReport(report, { color: process.stdout.isTTY ?? false }));
}

main().catch((err) => {
  console.error("mcp-graveyard:", err instanceof Error ? err.message : err);
  process.exit(1);
});
