# Roadmap

## 当前执行顺序：首个市场版本

2026-10-22 重新收敛目标：先完成现有 Web 范围的可靠性、简洁且符合 DSH 风格的 UI / 轻动效和实际市场交付，再扩功能。**[first-release.md](first-release.md) 是首版剩余工作的执行入口**；FR-0 已提交为 `899607f`。2026-10-23 FR-1 已审核、准备提交：本地 bundle 安装 / 升级 / 卸载、缺浏览器提示、索引草案和公开信息已齐备；用户协助下载官方 ZIP 后，通过摘要校验、官方空缓存最小安装及新版 Web 启动 / 登录唤起 / 三窗口 / 退出清理。CDN 大文件自动下载在本环境仍受网络限制，项目索引尚未部署；精确证据见 [market-installation.md](market-installation.md)。FR-1 审核通过，本次按一个原子提交收口，随后进入 FR-2。

1. FR-1：市场与安装准备（官方 bundle 安装、Chromium 前置、真实元数据与索引草案）。
2. FR-2：功能缺口与缺陷收口（删除 / 不确定、图片安全路径、页面故障、恢复旧错误提示）。
3. FR-3：DSH 风格 UI 与轻动效（三窗口、主题 / 字体、输入与状态、键盘、减少动态效果）。
4. FR-4：RC 冻结、最终产物矩阵、代码审核和发布材料。
5. FR-5：明确批准后公开发布与官方 Discover 实装验收。

原 Phase 21–23 延后；首版所需的 Phase 24 UI 工作与 Phase 25 发布回归分别由 FR-3、FR-4 / FR-5 承接。下文的旧“下一步”属于历史记录，不能覆盖当前顺序。各阶段范围、验收标准与进度以首版计划为准。

## 历史 Phase 规划

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
- Phase 21 — Proxy（延后，首版不依赖）
- Phase 22 — Handoff to current DSH Composer（延后，首版不依赖）
- Phase 23 — Task Brief（延后，首版不依赖）
- Phase 24 — UI Polish（首版必要部分纳入 FR-3，其余发布后评估）
- Phase 25 — Regression / Release（首版由 FR-4 / FR-5 承接，后续新增功能另做回归）

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

## 已交付基础与历史进度

已完成：Phase 01–08.2（工程初始化 → Host State / HTTP+SSE → 浏览器与登录 → 基础聊天 / 流式 / Markdown / Deep Think / 搜索 / Stop / New Chat → 历史会话与外部会话同步 → 08.2 状态模型收口）。

当前基础：**Phase 20 Browser Recovery 已完成（20A + 20B1 + 20B2）**。20B1 的 IDB reader、三层 identity、原地 patch、30 s 共享 deadline 与单次前端刷新已完成，真机确认 commit→kill / mid-stream kill 的原地补全。20B2 的删除证据、标题刷新和恢复提示已完成；对不能确认的重定向保留 Host 消息并阻止发送。**Phase 18A 已完成；18B 历史图片恢复已实现并完成 reader 与 Client 界面复验（含图片加载失败后的文件名降级）**。后续采用上方 FR 顺序。`parent_message_id=null` 的极快连续发送与树形/分支 IDB entry 保持 safe-fail，分别作为 anchor identity 与 history branch resolution 的独立后续任务；不回填 20B。

P0 Release Hardening（Web 最小版本）：2026-10-17 已完成 tarball 内容检查、干净 profile 的安装与 Cordis patch 激活、已登录 profile 副本的文本发送 / 历史图片 / 文件名降级 / Chromium 故障恢复烟测，并加入 Prettier / Biome 工程检查门禁。安装步骤、验收边界和检查命令见 [release-hardening.md](release-hardening.md)。此验证不改变 Phase 21–24 的功能范围；Web 最小版回归进展见下文，完整 Phase 25 在后续功能完成后继续验收。

2026-10-19 Web 回归补充：图片临时 `blob:` 历史恢复修复已提交为 `52cc69f`。Web 最小版验收覆盖干净安装、流式 Markdown、Deep Think、跨窗口 Stop、图片历史、Chromium 恢复与 dispose；浮窗窄屏 2px 溢出已修复。随后完成 **SSE P0 断流恢复**：EOF/error 自动退避重连，首个有效快照前禁用操作，消息与输入保留，dispose 清理；自动测试及两轮真实 DSH Web（含冷启动）复验通过，跨窗口旧快照分叉已闭环。上述修复与验收文档已审核并提交为 `a178b8c`。后续 Host 构建配置已迁移为 `deps.neverBundle`，弃用警告消失，四个产物 SHA-256 不变，tarball 8 文件与 Playwright 外部依赖验证通过；迁移已审核并提交为 `702fe16`。本轮已准备 `0.1.0-preview.1`、Changelog、精确 `engines.dsh` 和本地 tarball 分发/回退说明，待 Review。**下一步：冻结 Web 预览候选，并优先处理新版 Web 兼容，再决定官方 Desktop 适配**。矩阵、边界和剩余项见 [web-regression.md](web-regression.md)，构建验证见 [release-hardening.md](release-hardening.md)。完整 Phase 25 与正式发布批准仍待完成。

2026-10-19 官方版本核查：GitHub 与官方 Desktop 生产 Nightly feed 为 `0.2.1-rc.2`，npm latest 为 `0.2.0-rc.2`；本插件仍只支持已验证的 Web `0.1.5-rc.2`。新版 Session 列表移除 `current`，Desktop 拒绝页面新窗口，需独立适配与实测。全部剩余工作（发布门禁、兼容性、Phase 21–25 和 safe-fail 独立事项）见 [release-preview.md](release-preview.md)。

2026-10-20：preview.1 准备已审核并提交为 `a4b589c`。已完成 **新版 Web 兼容候选（preview.2）**：旧版 `current` / 新版唯一 `retainedBy.mainView` 能力检测、固定新版开发类型、13 项 Client/Controller 回归测试。新旧 Web 干净安装、Dock/Float/Pop-out、Fetch/SSE EOF 重连通过；新版非空 Session 使用官方本地 LLM mock 验证真实 rightbar。总计 667 项自动测试。此次未获准复制既有认证目录，未重跑新版已登录聊天、图片、恢复完整矩阵，不宣称 Desktop 已兼容。**下一步先 Review 本轮，再补新版已登录发布矩阵及升级/回退，之后决定 Desktop 独立验证；Proxy 仍是独立 Phase 21。** 详细范围与剩余工作见 [web-compatibility.md](web-compatibility.md)。

授权后补充验收：在 `companion-test` 浏览器目录的隔离副本中，新版 Web 已通过文本流式 Markdown、Deep Think 折叠、Search、跨窗口 Stop、图片发送/公开会话切换/失败文件名降级、SSE 断流时草稿与消息保留、空闲和流式中 Chromium 恢复。空闲恢复约 4.2 s，首轮流式恢复约 22.5 s，消息 ID 保持，未发生自动重发；原测试 profile 未修改。此次没有新增产品代码。**下一步：Review 当前兼容候选，再验证 preview.1 → preview.2 升级/回退及会话删除等未覆盖边界，随后冻结发布范围；Desktop 和 Proxy 仍单独安排。** 详细证据见 [web-compatibility.md](web-compatibility.md)。

2026-10-22 审核收口：preview.2 的公开 Session 兼容实现、13 项 Client/Controller 回归及验收文档通过审核，完整工程门禁与 667 项自动测试重新通过，本阶段以一个原子提交保存。未重跑已登录真机矩阵、不扩大版本承诺，未执行 tag/push/发布。**下一阶段优先做 preview.1 → preview.2 升级/回退验收**；其余边界和候选冻结要求继续见 [web-compatibility.md](web-compatibility.md)。

2026-10-22 升级/回退验收：固定共同宿主 Web `0.1.5-rc.2`，同一隔离 profile 完成 preview.1 → preview.2 → preview.1。三阶段保持登录，新旧标记历史按服务端 ID 和内容摘要恢复，聊天、Dock/Float/Pop-out、SSE 保留消息与草稿、退出清理全部通过；pageerror/console error 均为 0。无产品代码修改，验收文档已审核，完整工程门禁与 667 项测试重新通过，本阶段以一个原子文档提交保存。该结果不覆盖 DSH 宿主升级/降级，也不允许在新版宿主强跑 preview.1。**下一步：确定最小版发布承诺并补会话删除、图片/外部草稿等剩余边界，随后冻结候选。** 详见 [upgrade-rollback.md](upgrade-rollback.md)。

每次只完成一个 Phase，禁止顺手实现下一阶段。
