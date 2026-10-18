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
  - 18B — 历史图片恢复（同一 user `.ds-message` 内的图片结构映射；纯图片消息保留；签名 URL 失效降级）—— **已实现并完成 reader 与 Client 界面复验（图文混合、纯图片、签名 URL 失败后文件名降级）**
  - 状态：**18A 已实现**：8 个核心发送/清理场景已在真实 `companion-test` 实例实机验收通过；**外部页面手动草稿 / 页面外部删除 / 失败卡片 remove 等安全路径由单测覆盖（未完整真机驱动）**；18B 的 reader / Host 有自动测试，真实 Chromium 的 3 个图文历史会话 reader 恢复 1/2/1 张图片，纯图片轮次由自动测试覆盖；2026-10-16 的 Client 复验覆盖 7 个历史图片节点、纯图片消息，以及拦截图片请求后的文件名降级（见 `docs/architecture.md` 的 Phase 18 小节）
- Phase 19 — Conversation History（**已在 Phase 08 / 08.1 提前交付**：侧栏列表 + 切换 + 外部导航同步）
- Phase 20 — Browser Recovery（浏览器/页面故障后自动恢复，不需要重启 DSH）
  - 状态：**20A、20B1、20B2 均已实现并验证**；不做 Proxy / 多账号 / browser pool / 多 page / durable persistence / 自动重发
  - **20A — Browser Lifecycle Recovery**：page close/crash/disconnected 监听 · alive-but-invalid page（A–E 分类，含 bounded composer readiness）· Level 1/3 重建（Level 3 重装 `exposeFunction`）· single-flight · bounded retry（逐步 timeout）· `recovering` 状态 · page/browser epoch stale-event 抑制 · 页重建时 draft invalidation · `recoverTarget` snapshot 且恢复期不改 `currentSession`/`messages` · recovery 自身导航的三层防护（recoveryNavigation suppression + markKnown(actualLocation) + epoch，定稿）· ConnectionStatus 正式新增 `recovering` · 60 s 全局 recovery 预算 · dispose safety · 不自动 resend —— **已实现并验证（complete）**
  - **20B — Session Reconciliation & UX**：恢复成功后 reconcile Host transcript 与服务端历史（读 IndexedDB snapshot（`deepseek-chat`/`history-message`）· **三层 identity strategy：Level 1 existing id / Level 2 parent-anchor binding / Level 3 strict bootstrap** · `deepSeekMessageId` 身份对齐 · 原地 patch 不 destructive replace · bounded stability wait · 服务端已完成的 reply 补回 · 会话删除/not-found 语义 · title refresh） —— **20B1 implemented + validated**（单次 bounded 前端刷新让前端自己重拉 history，B/C 原地补全、A 不变慢）；**20B2 implemented + validated（2026-09-27）**：匹配目标 ID 的前端 history not-found + `/` 重定向 + logged-in 三重证据才清理 Host transcript；不确定结果保留并阻止发送；侧栏标题与恢复提示同步。真实 Chromium 的正常/不存在会话恢复均通过。详见 `docs/architecture.md` 的 Phase 20B 章节。
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

当前：**Phase 20 Browser Recovery 已完成（20A + 20B1 + 20B2）**。20B1 的 IDB reader、三层 identity、原地 patch、30 s 共享 deadline 与单次前端刷新已完成，真机确认 commit→kill / mid-stream kill 的原地补全。20B2 的删除证据、标题刷新和恢复提示已完成；对不能确认的重定向保留 Host 消息并阻止发送。**Phase 18A 已完成；18B 历史图片恢复已实现并完成 reader 与 Client 界面复验（含图片加载失败后的文件名降级）**。后续依次为 21 Proxy、22 Handoff、23 Task Brief、24 UI Polish、25 Regression / Release。`parent_message_id=null` 的极快连续发送与树形/分支 IDB entry 保持 safe-fail，分别作为 anchor identity 与 history branch resolution 的独立后续任务；不回填 20B。

P0 Release Hardening（Web 最小版本）：2026-10-17 已完成 tarball 内容检查、干净 profile 的安装与 Cordis patch 激活、已登录 profile 副本的文本发送 / 历史图片 / 文件名降级 / Chromium 故障恢复烟测，并加入 Prettier / Biome 工程检查门禁。安装步骤、验收边界和检查命令见 [release-hardening.md](release-hardening.md)。这项验证不改变 Phase 21–25 的功能范围；Phase 25 完整 Web 回归仍待执行。

2026-10-19 Web 回归补充：发现“新发图片立即切换历史”时 DeepSeek SPA 仍保留页面临时 `blob:` 地址；已加入仅在此证据出现时的一次有预算前端刷新、签名图片复核与失败保留 Host 的路径。真实 DSH Web 测试轮次已复验 Host 附件和 Client 图片恢复。详情见 [release-hardening.md](release-hardening.md)。Phase 25 全量回归与正式发布批准仍待完成。

每次只完成一个 Phase，禁止顺手实现下一阶段。
