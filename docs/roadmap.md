# Roadmap

## v0.1.0 规划

- Phase 01 — 工程初始化
- Phase 02 — DSH Plugin 安装验证
- Phase 03 — Client UI 注入
- Phase 04 — Companion Dock
- Phase 05 — Dock Resize
- Phase 06 — Pop-out Window
- Phase 07 — Host State
- Phase 08 — HTTP/SSE Protocol
- Phase 09 — Playwright Browser Manager
- Phase 10 — Persistent Browser Profile
- Phase 11 — DeepSeek Login
- Phase 12 — Login State
- Phase 13 — Basic Chat
- Phase 14 — Streaming
- Phase 15 — Markdown / Code Block
- Phase 16 — Deep Think
- Phase 17 — Web Search
- Phase 18 — Image（向真实 DeepSeek 会话发送**图片**；不含文件附件、不含 gallery/lightbox）
  - 18A — 发送图片（composer 选图 → 上传 → 随文本发送）
  - 18B — 历史图片恢复（历史 transcript 中的图片回填，需先解决稳定映射）
  - 状态：**18A 设计已定稿（design finalized / awaiting implementation），尚未实现**；18B 仅保留结论（见 `docs/architecture.md` 的 Phase 18 小节）
- Phase 19 — Conversation History（**已在 Phase 08 / 08.1 提前交付**：侧栏列表 + 切换 + 外部导航同步）
- Phase 20 — Browser Recovery
- Phase 21 — Proxy
- Phase 22 — Handoff to current DSH Composer
- Phase 23 — Task Brief
- Phase 24 — UI Polish
- Phase 25 — Regression / Release

## v0.1 明确不做

- DeepSeek Web LLM Provider
- OpenAI-compatible Gateway
- Fake Function Calling
- Agent webchat tools
- Subagents
- Multi-account
- Workspace creation
- pickDirectory
- Headless Server
- Automatic model routing
- DeepSeek Web API reverse proxy

## 当前状态

已完成：Phase 01–08.2（工程初始化 → Host State / HTTP+SSE → 浏览器与登录 → 基础聊天 / 流式 / Markdown / Deep Think / 搜索 / Stop / New Chat → 历史会话与外部会话同步 → 08.2 状态模型收口）。

进行中：**Phase 18A 设计已定稿、等待实现**（真实 DeepSeek 图片能力、上传成功判定、草稿 identity 与发送 commit point 均已实测，方案已写入 `docs/architecture.md`；**尚未写任何实现代码**）。

每次只完成一个 Phase，禁止顺手实现下一阶段。
