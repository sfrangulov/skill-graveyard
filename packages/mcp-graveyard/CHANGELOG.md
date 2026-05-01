# Changelog

## [0.3.0](https://github.com/sfrangulov/skill-graveyard/compare/mcp-graveyard@v0.2.0...mcp-graveyard@v0.3.0) (2026-05-01)


### ⚠ BREAKING CHANGES

* **plugin distribution removed.** The Claude Code plugin (slash commands `/mcp-graveyard:run` and `/mcp-graveyard:audit-mcp-tools`) is gone. **The npm CLI binary (`npx mcp-graveyard`) and the skills.sh distribution channel are unchanged** — only the slash-command surface is removed. See sister package `skill-graveyard@v0.10.0` for full context.


### Migration

```sh
/plugin uninstall mcp-graveyard@graveyard
npx skills add sfrangulov/skill-graveyard   # installs both skill-graveyard and mcp-graveyard SKILLs
```

Or just keep calling `npx mcp-graveyard` directly.


### Removed

* `commands/run.md` and `commands/audit-mcp-tools.md` (slash command prompts)
* `.claude-plugin/plugin.json` (plugin manifest)


## [0.2.0](https://github.com/sfrangulov/skill-graveyard/compare/mcp-graveyard@v0.1.0...mcp-graveyard@v0.2.0) (2026-04-30)


### Features

* **mcp-graveyard:** add /run slash command router ([21cb9ef](https://github.com/sfrangulov/skill-graveyard/commit/21cb9ef2645c552d38a90839d214a1344bd08c62))
