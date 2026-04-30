---
description: Run mcp-graveyard to audit MCP server tool usage and surface unused servers
---

Run `npx mcp-graveyard` to surface MCP servers configured in `~/.claude.json` that your Claude Code sessions never actually invoke. Output is a server-first table grouped into ACTIVE / DEAD / HALLUCINATED / MISSING buckets.

For removal candidates, run `npx mcp-graveyard prune` to print the plan, then `npx mcp-graveyard prune --apply` to execute (with automatic backup of removed config).
