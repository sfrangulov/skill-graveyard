---
description: Run any skill-graveyard subcommand (audit, prune, suggest, projects, cost, outdated)
allowed-tools: Bash(skill-graveyard:*), Bash(npx skill-graveyard:*)
argument-hint: <subcommand> [flags]
---

Run `skill-graveyard $ARGUMENTS` (fall back to `npx skill-graveyard@latest $ARGUMENTS` if the binary isn't on PATH). Print the output verbatim — do not summarize or interpret.
