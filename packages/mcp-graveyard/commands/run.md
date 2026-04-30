---
description: Run any mcp-graveyard subcommand (audit, prune, suggest, projects)
allowed-tools: Bash(mcp-graveyard:*), Bash(npx mcp-graveyard:*)
argument-hint: <subcommand> [flags]
---

Run `mcp-graveyard $ARGUMENTS` (fall back to `npx mcp-graveyard@latest $ARGUMENTS` if the binary isn't on PATH). Print the output verbatim — do not summarize or interpret.
