# Project Agent Instructions

- 本项目不使用 `@superpowers` 插件；不要启用、调用或依赖该插件的技能、工具或工作流。
- 默认使用中文回复，言简意赅。
- 按需使用 Plan Mode 或 Subagent。

## Agent skills

### Issue tracker

Issues live in GitHub Issues; external PRs are not a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the default five-label triage vocabulary. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context repo: read root `CONTEXT.md` and root `docs/adr/` when present. See `docs/agents/domain.md`.
