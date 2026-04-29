#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runAudit, type Category } from "./audit.js";
import { runCost } from "./cost.js";
import {
  formatCostReport,
  formatJson,
  formatProjectsReport,
  formatPruneReport,
  formatReport,
  formatSuggestReport,
} from "./format.js";
import { runPrune, type PruneSourceFilter } from "./prune.js";
import { runProjects } from "./projects.js";
import { runSuggest } from "./suggest.js";

// Read version at runtime so --version stays in sync with package.json.
// Hardcoding it bit us between 0.6.0 and 0.6.1.
const PKG_VERSION: string = (
  JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf-8"),
  ) as { version: string }
).version;

type Command =
  | "audit"
  | "prune"
  | "suggest"
  | "cost"
  | "projects"
  | "help"
  | "version";

interface ParsedArgs {
  command: Command;
  days: number;
  json: boolean;
  color: boolean;
  claudeDir?: string;
  auditFilter?: Category;
  pruneApply: boolean;
  pruneOnly?: PruneSourceFilter;
}

const HELP = `skill-graveyard — audit Claude Code skills you actually use

USAGE
  skill-graveyard [audit] [options]
  skill-graveyard prune [options]
  skill-graveyard suggest [options]
  skill-graveyard projects [options]
  skill-graveyard cost [options]
  skill-graveyard --help | --version

COMMANDS
  audit      (default) classify every skill into active | dead | missing | hallucinated
  prune      generate (and optionally execute) removal commands for dead skills
  suggest    classify hallucinated/missing into actionable buckets
  projects   show skill usage broken down per project (cwd from sessions)
  cost       estimate token cost of installed skill metadata vs invocations

COMMON OPTIONS
  --days <n>            window in days (default: 30)
  --json                emit machine-readable JSON instead of a table
  --no-color            disable ANSI colors
  --claude-dir <path>   override Claude home directory (default: ~/.claude)

AUDIT OPTIONS
  --only <category>     filter to one of: active | missing | hallucinated | dead

PRUNE OPTIONS
  --apply               execute unlinks for user/agents skills (plugin removals always print only)
  --only <kind>         filter to one of: user | agents | plugin

EXAMPLES
  skill-graveyard
  skill-graveyard --days 14
  skill-graveyard prune
  skill-graveyard prune --apply
  skill-graveyard suggest
  skill-graveyard --json | jq '.rows[] | select(.category=="dead") | .invokeName'
`;

export function parseArgs(argv: string[]): ParsedArgs {
  // https://no-color.org/ — any non-empty NO_COLOR env var disables ANSI output.
  // Explicit --color still overrides further down in the parser.
  const noColorEnv = (process.env.NO_COLOR ?? "") !== "";

  const args: ParsedArgs = {
    command: "audit",
    days: 30,
    json: false,
    color: process.stdout.isTTY === true && !noColorEnv,
    pruneApply: false,
  };

  let i = 0;
  if (argv[0] && !argv[0].startsWith("-")) {
    const cmd = argv[0];
    if (
      cmd === "audit" ||
      cmd === "prune" ||
      cmd === "suggest" ||
      cmd === "cost" ||
      cmd === "projects" ||
      cmd === "help"
    ) {
      args.command = cmd;
      i = 1;
    }
  }

  for (; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "-h":
      case "--help":
        args.command = "help";
        break;
      case "-v":
      case "--version":
        args.command = "version";
        break;
      case "--days": {
        const v = argv[++i];
        const n = Number(v);
        if (!Number.isFinite(n) || n <= 0) fatal(`--days requires a positive number, got: ${v}`);
        args.days = n;
        break;
      }
      case "--json":
        args.json = true;
        args.color = false;
        break;
      case "--no-color":
        args.color = false;
        break;
      case "--color":
        args.color = true;
        break;
      case "--claude-dir": {
        const v = argv[++i];
        if (!v) fatal("--claude-dir requires a path");
        args.claudeDir = v;
        break;
      }
      case "--apply":
        args.pruneApply = true;
        break;
      case "--only": {
        const v = argv[++i];
        if (!v) fatal("--only requires a value");
        if (args.command === "audit") {
          if (v !== "active" && v !== "dead" && v !== "missing" && v !== "hallucinated") {
            fatal(`audit --only must be active|dead|missing|hallucinated, got: ${v}`);
          }
          args.auditFilter = v;
        } else if (args.command === "prune") {
          if (v !== "user" && v !== "agents" && v !== "plugin") {
            fatal(`prune --only must be user|agents|plugin, got: ${v}`);
          }
          args.pruneOnly = v;
        } else {
          fatal(`--only is not valid for the ${args.command} command`);
        }
        break;
      }
      default:
        if (a?.startsWith("-")) fatal(`unknown flag: ${a}`);
    }
  }
  return args;
}

function fatal(msg: string): never {
  process.stderr.write(`error: ${msg}\n`);
  process.exit(2);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.command === "help") {
    process.stdout.write(HELP);
    return;
  }
  if (args.command === "version") {
    process.stdout.write(`skill-graveyard ${PKG_VERSION}\n`);
    return;
  }

  if (args.command === "audit") {
    const report = await runAudit({ days: args.days, claudeDir: args.claudeDir });
    if (args.json) {
      process.stdout.write(formatJson(report) + "\n");
    } else {
      process.stdout.write(
        formatReport(report, { color: args.color, filter: args.auditFilter }) + "\n",
      );
    }
    return;
  }

  if (args.command === "prune") {
    const report = await runPrune({
      days: args.days,
      apply: args.pruneApply,
      only: args.pruneOnly,
      claudeDir: args.claudeDir,
    });
    if (args.json) {
      process.stdout.write(formatJson(report) + "\n");
    } else {
      process.stdout.write(formatPruneReport(report, { color: args.color }) + "\n");
    }
    const anyFailed = report.applied.some((e) => e.status === "failed");
    if (anyFailed) process.exit(1);
    return;
  }

  if (args.command === "suggest") {
    const report = await runSuggest({ days: args.days, claudeDir: args.claudeDir });
    if (args.json) {
      process.stdout.write(formatJson(report) + "\n");
    } else {
      process.stdout.write(formatSuggestReport(report, { color: args.color }) + "\n");
    }
    return;
  }

  if (args.command === "cost") {
    const report = await runCost({ days: args.days, claudeDir: args.claudeDir });
    if (args.json) {
      process.stdout.write(formatJson(report) + "\n");
    } else {
      process.stdout.write(formatCostReport(report, { color: args.color }) + "\n");
    }
    return;
  }

  if (args.command === "projects") {
    const report = await runProjects({ days: args.days, claudeDir: args.claudeDir });
    if (args.json) {
      process.stdout.write(formatJson(report) + "\n");
    } else {
      process.stdout.write(formatProjectsReport(report, { color: args.color }) + "\n");
    }
    return;
  }
}

// Only run when invoked as the entry point. The naive comparison
// `process.argv[1] === fileURLToPath(import.meta.url)` is wrong whenever any
// symlink sits between the user-facing path and the real file: the npx/global
// bin shim is always a symlink to dist/cli.js, and macOS /tmp resolves through
// /private/tmp. realpathSync canonicalizes both sides so they actually match.
// 0.6.2 shipped the naive form and produced 0 bytes of output via npx — that's
// what this is fixing.
function isEntryPoint(): boolean {
  if (!process.argv[1]) return false;
  try {
    return (
      realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
    );
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  main().catch((err: unknown) => {
    process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
