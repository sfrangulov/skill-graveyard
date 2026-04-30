# @skill-graveyard/core

Internal building blocks shared between [`skill-graveyard`](https://www.npmjs.com/package/skill-graveyard) and [`mcp-graveyard`](https://www.npmjs.com/package/mcp-graveyard).

> **No semver-stability promise.** This package is published because npm workspaces require shared dependencies to be installable from the registry, not because the API is intended for external consumption. Breaking changes can land in any version. If you depend on it directly, pin exactly.

End users — install one of the CLIs instead:

```sh
npx skill-graveyard      # audit your installed Claude Code skills
npx mcp-graveyard        # audit your configured MCP server tools
```

## What's in it

- **`parseToolCalls<T>(filepath, projectKey, predicate, build)`** — generic streaming JSONL parser for Claude Code session logs. Picks out `tool_use` items matching a caller-supplied predicate, pairs them with their `tool_result`, and returns typed call records. Used by both CLIs to extract their respective tool-call shapes.
- **`parseSession(filepath, projectKey)`** — thin skill-flavored adapter over `parseToolCalls`, kept for backward compatibility with skill-graveyard's pre-monorepo signature.
- **`findSessionFiles(projectsDir, sinceMs)`** — discovers `.jsonl` session files newer than a cutoff mtime.
- **`resolveClaudePaths(claudeDir?)`** — derives the standard Claude Code home layout (`~/.claude/projects/`, `~/.claude/plugins/`, `~/.agents/skills/`, etc.) with optional override.
- **`findGitRoot(start)`, `discoverInstalledSkills(...)`, `discoverProjectScopedSkills(...)`** — discovery primitives for skill-graveyard's audit (not used by mcp-graveyard).
- **`KNOWN_TOOLS`, `isKnownTool(name)`** — case-insensitive set of built-in Claude Code tool names. Used by `mcp-graveyard suggest` to flag tool/server confusion.
- **`estimateTokens(text)`, `TOKENIZER_NAME`** — `cl100k_base` tokenizer wrapper (Anthropic doesn't ship a public Claude tokenizer; this is a 5-15% drift proxy).

## Development

```sh
npm install
npm run build --workspace=@skill-graveyard/core
npm run typecheck --workspace=@skill-graveyard/core
npm test --workspace=@skill-graveyard/core
```

Tests use real `fs` against `os.tmpdir()` fixtures. No mocking. The whole purpose of this package is correctly walking real Claude Code install layouts; mocked filesystem tests would defeat the point.

## Repository

Source lives at <https://github.com/sfrangulov/skill-graveyard> in `packages/core/`. Issues, PRs, and full development docs all live there.

## License

MIT
