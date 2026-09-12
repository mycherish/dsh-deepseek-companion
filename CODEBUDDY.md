# CODEBUDDY.md

项目名称：`dsh-deepseek-companion`

项目目标：DeepSeek Web Companion for DSH —— 在 DSH 中提供一个可停靠、可独立窗口打开的
DeepSeek 网页聊天工具，复用用户自己的 `chat.deepseek.com` 登录状态，不消耗 API 余额。

主要技术：TypeScript、Node.js、Cordis、DeepSeek Harness、React（后续）、Playwright（后续）。

开发前必须阅读：

- `AGENTS.md`
- `docs/architecture.md`
- `docs/roadmap.md`

必须遵守：

- 一次只做当前 Phase
- 完成后先验证（typecheck / build / test）
- 不自动 commit
- 不自动 push
- 不实现未要求的功能
