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
  - 18A — 发送图片（composer 选图 → 上传 → 随文本发送）—— **已完成（implemented + 实机验收）**
  - 18B — 历史图片恢复（历史 transcript 中的图片回填，需先解决稳定映射）
  - 状态：**18A 已实现**：8 个核心发送/清理场景已在真实 `companion-test` 实例实机验收通过；**外部页面手动草稿 / 页面外部删除 / 失败卡片 remove 等安全路径由单测覆盖（未完整真机驱动）**；18B（历史图片恢复）**仍为 pending，未实现**（见 `docs/architecture.md` 的 Phase 18 小节）
- Phase 19 — Conversation History（**已在 Phase 08 / 08.1 提前交付**：侧栏列表 + 切换 + 外部导航同步）
- Phase 20 — Browser Recovery（浏览器/页面故障后自动恢复，不需要重启 DSH）
  - 状态：**调查 + 真实故障注入 + 设计提案完成（investigation / design，未实现）**；不做 Proxy / 多账号 / browser pool / 多 page / durable persistence / 自动重发
  - **20A — Browser Lifecycle Recovery**：page close/crash/disconnected 监听 · alive-but-invalid page（A–E 分类，含 bounded composer readiness）· Level 1/3 重建（Level 3 重装 `exposeFunction`）· single-flight · bounded retry（逐步 timeout）· `recovering` 状态 · page/browser epoch stale-event 抑制 · 页重建时 draft invalidation · `recoverTarget` snapshot 且恢复期不改 `currentSession`/`messages` · recovery 自身导航的三层防护（recoveryNavigation suppression + markKnown(actualLocation) + epoch，定稿）· ConnectionStatus 正式新增 `recovering` · 60 s 全局 recovery 预算 · dispose safety · 不自动 resend —— **已实现并验证（complete）**
  - **20B — Session Reconciliation & UX**：恢复成功后 reconcile Host transcript 与服务端历史（读 IndexedDB snapshot（`deepseek-chat`/`history-message`）· **三层 identity strategy：Level 1 existing id / Level 2 parent-anchor binding / Level 3 strict bootstrap** · `deepSeekMessageId` 身份对齐 · 原地 patch 不 destructive replace · bounded stability wait · 服务端已完成的 reply 补回 · 会话删除/not-found 语义 · title refresh） —— **20B1 design finalized / awaiting implementation（未实现）**；20B2（session-not-found / title / UX）待 deleted-session 真机补充。结论见 `docs/architecture.md` 的「Phase 20B — Session Reconciliation & UX（20B1 design finalized）」
  - 实现与验收见 `docs/architecture.md` 的「Browser Recovery（Phase 20 · 20A 已实现并验证）」（§5 健康分类、§7 timeout、§8 epoch、§10 session 策略、§13 测试计划、§15 20A/20B 边界）
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

进行中：**Phase 20B Browser Recovery — Session Reconciliation，调查与设计阶段（investigation / design，未实现）**：真机探测确认 DeepSeek history 数据（`history_messages` API 与前端 IndexedDB `deepseek-chat`/`history-message`）有稳定 `message_id` + `parent_id` + `status` + `fragments`（REQUEST/RESPONSE/THINK/TIP/FILE），且前端 cache 协议为 `REPLACE`（全量）/`MERGE`（增量）；completion request 提供稳定 `parent_message_id` anchor（`parent+1/+2` 仅为 observed behavior，不作 authoritative mapping）；真实 crash 实测证明「completion 已提交后服务端继续完成回复」（commit 后 kill → 服务端 FINISHED；mid-stream kill → WIP → 约 10s FINISHED）；设计已定稿为读 IDB snapshot + 三层 identity strategy + 原地 patch + bounded stability wait + stale 防护（见 `docs/architecture.md` 的 Phase 20B 章节）。**20A 已实现并验证**；18A 已实现；18B（历史图片恢复）仍 pending（20B 已确认不被 18B 阻塞，因 FILE fragment 完整保留图片元数据）。下一阶段：20B 实现（建议先 20B1 安全 reconcile），或先做 18B。

每次只完成一个 Phase，禁止顺手实现下一阶段。
