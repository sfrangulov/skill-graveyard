---
description: Audit Claude Code skill usage — what's active, dead, missing, hallucinated
allowed-tools: Bash(npx skill-graveyard:*), Bash(skill-graveyard:*)
argument-hint: [--days N] [--only active|dead|missing|hallucinated]
---

Run `skill-graveyard $ARGUMENTS` (fall back to `npx skill-graveyard@latest $ARGUMENTS` if the binary isn't on PATH).

Then summarize the four buckets:
- **Active** — keep
- **Dead** — candidates to remove with `skill-graveyard prune`
- **Missing** — likely project-scoped or registered by an external framework
- **Hallucinated** — model errors invoking non-existent skills

If there are dead skills or hallucinations, suggest a concrete next action (e.g., `skill-graveyard prune --apply`, or `skill-graveyard suggest` for hallucination triage).
