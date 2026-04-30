# Changelog

## [0.9.0](https://github.com/sfrangulov/skill-graveyard/compare/skill-graveyard@v0.8.1...skill-graveyard@v0.9.0) (2026-04-30)


### Features

* **skill-graveyard:** add `/run` slash command router (`commands/run.md`) — pass-through to any subcommand via `/skill-graveyard:run <args>` ([866857c](https://github.com/sfrangulov/skill-graveyard/commit/866857c))
* **skill-graveyard:** document `/run` slash command and skills.sh in `--help` output ([3859480](https://github.com/sfrangulov/skill-graveyard/commit/3859480))


### Distribution

Now also installable as an Agent Skill via [skills.sh](https://skills.sh/):

```sh
npx skills add sfrangulov/skill-graveyard
```

(Same command also installs the sister `mcp-graveyard` skill.)


### Notes

This release was tagged manually because release-please's `extra-files` config used a `../../.claude-plugin/plugin.json` path that release-please-action v4 rejects ("illegal pathing characters"). The broken `extra-files` entry has been removed from `release-please-config.json` in this release; from now on the root `.claude-plugin/plugin.json` version must be bumped manually alongside the package version. A durable fix (moving `.claude-plugin/` and `commands/` from repo root into `packages/skill-graveyard/`) is deferred to a follow-up.
