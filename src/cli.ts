#!/usr/bin/env node
import { runAudit } from "./audit.js";
import { formatJson, formatReport } from "./format.js";

import type { Category } from "./audit.js";

interface ParsedArgs {
  command: "audit" | "help" | "version";
  days: number;
  json: boolean;
  color: boolean;
  filter?: Category;
  claudeDir?: string;
}

const HELP = `skill-graveyard — audit which Claude Code skills you actually use

USAGE
  skill-graveyard [audit] [options]
  skill-graveyard --help
  skill-graveyard --version

OPTIONS
  --days <n>            window in days (default: 30)
  --json                emit machine-readable JSON instead of a table
  --no-color            disable ANSI colors
  --only <category>     filter to one of: active | missing | hallucinated | dead
  --claude-dir <path>   override Claude home directory (default: ~/.claude)

EXAMPLES
  skill-graveyard
  skill-graveyard --days 14
  skill-graveyard --only dead
  skill-graveyard --json | jq '.rows[] | select(.category=="hallucinated")'
`;

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {
    command: "audit",
    days: 30,
    json: false,
    color: process.stdout.isTTY === true,
  };

  const positional = argv.filter((a) => !a.startsWith("-"));
  if (positional[0] === "audit") positional.shift();
  if (positional[0] === "help") args.command = "help";

  for (let i = 0; i < argv.length; i++) {
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
      case "--only": {
        const v = argv[++i];
        if (
          v !== "active" &&
          v !== "dead" &&
          v !== "missing" &&
          v !== "hallucinated"
        ) {
          fatal(`--only must be active|dead|missing|hallucinated, got: ${v}`);
        }
        args.filter = v;
        break;
      }
      case "--claude-dir": {
        const v = argv[++i];
        if (!v) fatal("--claude-dir requires a path");
        args.claudeDir = v;
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
    process.stdout.write("skill-graveyard 0.1.0\n");
    return;
  }

  const report = await runAudit({ days: args.days, claudeDir: args.claudeDir });

  if (args.json) {
    process.stdout.write(formatJson(report) + "\n");
  } else {
    process.stdout.write(formatReport(report, { color: args.color, filter: args.filter }) + "\n");
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
