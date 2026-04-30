# Resume prompt — Plan B (mcp-graveyard v1)

Transient artifact. Paste the block below into a fresh Claude session to continue. Delete this file after Plan B is in flight.

---

```
Продолжай с Plan B (mcp-graveyard v1).

State:
- Working dir: /Users/sergeifrangulov/projects/skill-graveyard
- Branch: main. Plan A смерджен локально (fast-forward), 17 commits ahead of origin/main, NOT pushed.
- Last commit: 9dcf6ed "docs: bump site + changelog to 0.8.0"
- Ветка monorepo-migration ещё не удалена (на всякий) — можно удалить когда захочешь.

Что landed в Plan A (только что, локально):
- npm workspaces monorepo: packages/core (@skill-graveyard/core@0.1.0, published) + packages/skill-graveyard (skill-graveyard@0.8.0)
- Generic parseToolCalls<T> в core, parseSession — тонкий Skill-адаптер. Plan B Task 4 будет вызывать parseToolCalls<McpToolCall>.
- format.ts остался в skill-graveyard (mcp-graveyard сделает свой)
- Plugin assets (.claude-plugin/, commands/) — на repo root, prepack/postpack копирует в skill-graveyard tarball
- 109 tests pass. CLI behavior без изменений для пользователей.
- Plan A doc для справки: docs/specs/2026-04-29-monorepo-migration-plan.md

Plan B — реализуй:
- Spec (читай первой): docs/specs/2026-04-29-mcp-graveyard-design.md
- Plan (исполняй задача-за-задачей): docs/specs/2026-04-29-mcp-graveyard-plan.md (13 задач: bootstrap → types → mcp_config → mcp_parser → audit → format → cli → prune → projects → suggest → plugin manifest → docs/release)
- Создаст packages/mcp-graveyard/, опубликуется как mcp-graveyard@0.1.0

Workflow: superpowers:subagent-driven-development (тот же что в Plan A — fresh subagent per task + spec/code review).
Branch: создай новую ветку (например mcp-graveyard-v1) от main. Plan A остаётся unpushed; всё это вернётся вместе.
Conventions (см. CLAUDE.md): короткие lowercase imperative commit subjects, без Co-Authored-By, без auto-push, спрашивай перед merge.

Начни с того что прочитай Plan B, создай TaskCreate'ы на 13 задач, и dispatch первого implementer-сабагента.
```
