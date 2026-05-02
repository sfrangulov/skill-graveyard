#!/usr/bin/env node

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

function die(msg: string): never {
  console.error(`memory-graveyard: ${msg}`);
  process.exit(2);
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(USAGE);
    process.exit(0);
  }
  // Subsequent tasks add real subcommand routing here.
  die("not implemented yet — implementation in progress");
}

main().catch((err) => {
  console.error("memory-graveyard:", err instanceof Error ? err.message : err);
  process.exit(1);
});
