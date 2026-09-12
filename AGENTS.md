# AGENTS.md

本文件是 `dsh-deepseek-companion` 的长期工程规范。任何在此仓库中工作的 AI Agent 都必须遵守。

## 开始修改前

1. 先阅读：`README.md`、`AGENTS.md`、`docs/architecture.md`、`docs/roadmap.md`。
2. 每次只完成用户明确指定的一个 Phase。
3. 禁止顺手实现下一阶段功能。
4. 修改代码前先检查 `git status`。

## 每阶段完成后

必须依次执行并确保全部通过：

```sh
pnpm typecheck
pnpm build
pnpm test
git diff --check
git status
git diff
```

## 禁止事项

- 禁止 `git reset --hard`。
- 禁止 `git push --force`。
- 禁止覆盖用户未提交的修改。
- 未经用户明确确认，不得执行 `git commit`。
- 未经用户明确确认，不得执行 `git push`。
- 不要为了让测试通过而删除有效测试。

## 技术原则

- 遇到 DSH API 不确定时先调查官方源码/文档，不允许猜测。
- 新功能必须考虑资源 dispose（Browser、SSE、Timer、Connection 等）。
- 不修改 DSH 源码、不 monkey patch、不使用私有 API。
- 不硬编码用户绝对路径，不读取或打印认证信息。
- 每阶段完成后停止并等待 Review。

## Commit 规范

采用 Conventional Commits：`type(scope): English description / 中文说明`。

允许：`feat`、`fix`、`refactor`、`test`、`docs`、`chore`、`build`。

禁止：`update`、`wip`、`改一下`、`修改代码` 等模糊描述。

一个 Phase 一个原子提交。
