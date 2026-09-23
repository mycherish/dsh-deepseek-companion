# dsh-deepseek-companion

DeepSeek Web Companion plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH)。

> 当前状态：Developer Preview / Early Development

## 目标

在 DSH 中提供一个可停靠、可独立窗口打开的 DeepSeek 网页聊天工具（Companion），
复用用户自己的 `chat.deepseek.com` 登录状态进行聊天。

## 明确不是

- **不是** DeepSeek API Provider。
- **不是** OpenAI-compatible Gateway。
- **不消耗** DeepSeek API 余额；但仍受 DeepSeek 网页端本身的使用限制与风控约束。

## 当前进度

已完成 **Phase 01–08.2**：插件骨架与注入 → Host State / HTTP+SSE → 常驻浏览器与登录 → 文本聊天（流式、Markdown、Deep Think、智能搜索、引用、Stop、新建会话）→ 历史会话列表 / 切换 / 外部导航同步 → 统一状态模型收口。

进行中：**Phase 18A 图片发送 —— 设计已定稿（design finalized / awaiting implementation），尚未写任何实现代码**。其余 Phase 见 [docs/roadmap.md](docs/roadmap.md)。

> 尚未实现：图片发送、文件附件、浏览器恢复、代理、Task Brief 等 —— 详见路线图，不要再把未实现能力当作业已可用。

## 开发

```sh
pnpm install
pnpm typecheck
pnpm build
pnpm test
```

详见 [docs/roadmap.md](docs/roadmap.md) 与 [docs/architecture.md](docs/architecture.md)。
