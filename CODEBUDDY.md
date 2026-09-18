# CODEBUDDY.md

项目名称：`dsh-deepseek-companion`

项目目标：DeepSeek Web Companion for DSH —— 在 DSH 中提供一个可停靠、可独立窗口打开的
DeepSeek 网页聊天工具，复用用户自己的 `chat.deepseek.com` 登录状态，不消耗 API 余额。

主要技术：TypeScript、Node.js、Cordis、DeepSeek Harness、React（后续）、Playwright（后续）。

开发前必须阅读：

- `AGENTS.md`
- `docs/architecture.md`
- `docs/roadmap.md`

项目级技能：

- `.codebuddy/skills/dsh-plugin-development/SKILL.md`
  开发 DSH Plugin / Client / Slots / Layout 相关功能时，应使用该 Skill（固化了已源码验证的 DSH 0.1.5-rc.2 插件开发知识）。

必须遵守：

- 一次只做当前 Phase
- 完成后先验证（typecheck / build / test）
- 不自动 commit
- 不自动 push
- 不实现未要求的功能
