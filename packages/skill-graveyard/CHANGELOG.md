# Changelog

## [0.11.0](https://github.com/sfrangulov/skill-graveyard/compare/skill-graveyard@v0.10.0...skill-graveyard@v0.11.0) (2026-05-04)


### Features

* **skill-graveyard:** animate audit with spinner and section reveal ([f9df149](https://github.com/sfrangulov/skill-graveyard/commit/f9df149e5c3d24769e865d7dcecbf0e4e47603c9))

## [0.10.0](https://github.com/sfrangulov/skill-graveyard/compare/skill-graveyard@v0.9.0...skill-graveyard@v0.10.0) (2026-05-01)


### ⚠ BREAKING CHANGES

* **plugin distribution removed.** The Claude Code plugin (slash commands `/skill-graveyard:run` and `/skill-graveyard:audit-skills`) and the marketplace at `.claude-plugin/marketplace.json` are gone. The plugin layout repeatedly collided with skills.sh-bundled SKILLs in the `/skill-graveyard:` namespace and the autocomplete UX never landed cleanly. **The npm CLI binary (`npx skill-graveyard`) and the skills.sh distribution channel are unchanged** — only the slash-command surface is removed.


### Migration

If you previously installed the Claude Code plugin:

```sh
/plugin uninstall skill-graveyard@graveyard
/plugin marketplace remove graveyard
```

Then either keep using `npx skill-graveyard` directly, or install the auto-discovered Agent Skill:

```sh
npx skills add sfrangulov/skill-graveyard
```

The skills.sh install gives Claude the same audit capabilities — Claude auto-invokes the skill when you ask audit-shaped questions in any session ("which skills don't I use?", "clean up my skills"). No slash commands needed.


### Removed

* `commands/run.md` and `commands/audit-skills.md` (slash command prompts)
* Root `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`
* `prepack`/`postpack` scripts that copied `.claude-plugin/` and `commands/` into the npm tarball
* "INSIDE CLAUDE CODE" plugin-install hint in `--help` (replaced with a one-line skills.sh hint)


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
