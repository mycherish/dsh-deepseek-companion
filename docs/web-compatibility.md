# 新版 DSH Web 兼容候选

> **2026-10-22 执行入口**：后续按 [首版执行计划](first-release.md) 推进。本文是兼容事实与真机证据记录；历史“下一步”以首版 FR 阶段顺序为准。

日期：2026-10-20。候选：`0.1.0-preview.2`，兼容改动已审核、未发布。上轮 preview.1 准备已提交为 `a4b589c`。本轮仅适配公开 Session 结构和验证 Web，不实现 Desktop、Proxy 或其它后续 Phase。

## 固定版本与实现

当天官方 npm latest 已从上轮记录的 `0.2.0-rc.2` 更新为 **`0.2.1-rc.2`**，与 GitHub 发布标签一致。本轮只验证 Web `0.1.5-rc.2` 与 `0.2.1-rc.2`，`engines.dsh` 精确声明这两个版本，不推断其它版本兼容。

旧版公开 `sessions.list.getSnapshot().current` 在新版 `SessionListState` 中已删除。新版公开的 `SessionSummary.retainedBy` 包含主视图保留者 `mainView`，官方 ui-session 自身也据此发布主视图。适配器只读取这些公开列表字段：

1. 存在旧版 `current` 字段时，以它为准；显式未选中不复用其它条目。
2. 新版只接受唯一具有正数且有限的 `retainedBy.mainView` 的条目。
3. 仅 `blank === false` 使用 rightbar；未知、歧义、无主视图或读取异常使用 overlay。
4. 仍在打开时决定 Surface，打开期间不切换；关闭后重新打开才重新判断。

实现位于 `src/client/session-surface.ts` 与 `src/client/index.ts`。不访问 ui-session 私有 `current`，不改 DSH 源码、数据库或认证状态。六个 DSH 开发类型包固定为 `0.2.1-rc.2`，开发 Cordis 为 `^4.0.5`；运行 peer 保留 `^4.0.2`。Host 逻辑、HTTP/SSE 协议与 Playwright 运行版本不变。

### 官方来源

- [npm latest 元数据](https://registry.npmjs.org/@deepseek-ai/dsh/latest)、[固定 GitHub 发布](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-rc.2)。
- [新版 Session 列表公开接口](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.2/packages/api/session-controller/src/client/sessions/service.ts)、[SessionSummary 契约](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.2/packages/api/session-controller/src/client/contract/sessions.ts)。
- [ui-session 的 mainView 声明与主视图发布](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.2/packages/client/ui-session/src/client/index.ts)。
- [官方本地 LLM mock 文档](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.2/packages/test-support/llm-mock-server/README.md)。

## 自动验证与代码审核

新增 `tests/dock-session-compat.test.ts`，在独立临时目录构建真实 Client，经其 ModuleLoader 导出调用实际插件与 DockController；只替换 Host 公共边界，不依赖已有 `lib/`，结束清理临时构建。13 个场景覆盖旧/新版非空与空 Session、后台条目顺序、释放的主视图、非法保留数量、非主视图、歧义、旧版显式 absence、未知 blank、打开期间固定 Surface、重新打开与读取异常，以及关闭时的槽位注销。

已观察 RED→GREEN：旧实现面对新版非空主视图错误选择 overlay；适配后选择 rightbar。最终格式、lint、类型、构建、**667/667** 自动测试与 `git diff --check` 全部通过。按公开 API、版本边界、失败降级和资源清理检查，未发现可执行代码问题；下述未覆盖边界与升级/回退仍是发布前验收事项。

## 真实 Web 验证

环境：macOS、Node `22.20.0`、pnpm `10.26.0`、Playwright `1.62.0` 匹配 Chromium。新版 CLI 精确安装到独立临时工具目录，未升级全局 CLI；两版均使用各自全新 `DSH_HOME` 和浏览器目录，通过打包候选与公开 `--patch` 激活。Browser plugin 不可用，使用仓库 Playwright。

| 项目                                    | Web 0.1.5-rc.2                                         | Web 0.2.1-rc.2                                                       |
| --------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------- |
| 本地 tarball 安装与插件注入             | 通过                                                   | 通过                                                                 |
| 正常首次引导                            | Continue → Configure later                             | Get started 可按 Escape 或右上角关闭                                 |
| 无 DeepSeek 登录时的 Host               | login_required / logged_out，browserReady=true，消息 0 | 同左                                                                 |
| 空白宿主 Session 的 Dock                | overlay 可打开                                         | overlay 可打开                                                       |
| 页面内 Float / 独立 Pop-out / 返回 Dock | 通过，登录状态一致                                     | 通过，登录状态一致                                                   |
| Host Fetch 与 SSE EOF 重连              | 通过；Float 首连接返回有效快照后 EOF，随后重新连接     | 同左                                                                 |
| 聊天自动重发检查                        | 0 次 Companion chat POST                               | 0 次 Companion chat POST                                             |
| 非空宿主 Session 的真实 rightbar        | 本轮由 Controller 回归覆盖，未再跑真实非空会话         | 通过官方本地 mock 创建真实宿主会话；独立右列、原对话缩窄，非 overlay |
| 页面 pageerror                          | 0                                                      | 0                                                                    |
| 退出后本轮临时 Chromium / DSH 残留      | 0                                                      | 0                                                                    |

新版非空场景使用官方 `@deepseek-ai/dsh-llm-mock-server@0.2.1-rc.2`，按官方文档设置本地 `DEEPSEEK_BASE_URL` 与无效测试 key，通过正常 DSH Composer 发送固定测试文本并得到本地回复，随后打开 Companion 并目视确认 rightbar。它验证的是 **DSH Session 与布局**；Companion 此时仍未登录，不能充当真实 DeepSeek 网页聊天验收。测试没有使用真实模型密钥，也没有向 DeepSeek 聊天服务发送测试轮次。

SSE 验证使用浏览器请求拦截让一次有效状态快照后正常 EOF，之后放行真实 Host 流；观察到重连及跨界面更新，整个流程 Companion chat POST 为 0。没有改 Host 状态或注入假 Session。

早期脚本先于旧版启动 URL 就绪导航、误等待未登录窗口中的聊天输入框，分别出现导航/定位超时；修正等待和界面断言后通过，未据此修改产品代码。新版向导通过正常 Escape 关闭，没有强制穿透遮罩。

本轮复制既有测试浏览器目录的操作被自动审批拒绝，原因是其中可能包含认证 Cookie/登录状态；实际验证改用全新未登录目录，未复制、读取或打印已有认证数据。临时运行目录、页面截图及进程已清理。用户随后明确回复“允许复制测试 profile 并复验聊天”，补充验收如下；此前拒绝不再是当前阻塞。

## 用户授权后的已登录补充验收

使用同一 `preview.2` 代码与固定 Web `0.2.1-rc.2`。按用户明确授权，将 `companion-test` 的浏览器 profile 作为不透明目录复制到临时环境，过滤 Singleton 锁；不读取或打印 Cookie/token，不修改源 profile。正常完成宿主首次引导，多个冷启动均为 `online / logged_in`。界面视口 `1440 × 900`，使用仓库 Playwright，已目视核对聊天、图片降级、SSE 重连提示；页面身份为 DeepSeek Harness，无框架错误覆盖层。

| 检查                 | 结果                                                                                                                               |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 文本与流式 Markdown  | 观察到多个回复长度；最终 2 条 finished 消息，标题 1、列表项 2、代码块 1                                                            |
| Deep Think           | 开关真实生效，最终 reasoning 115 字符；思考过程可折叠/展开                                                                         |
| Search               | 开关真实生效，搜索回复完成，587 字符；正文含来源链接，但本轮未验证结构化 citation URL 的成功映射，继续 best-effort                 |
| 独立窗口与 Stop      | 同步已有消息；Dock 发起普通短篇回复，独立窗口点击停止；两边恢复发送，Host sending/stopping 均归零，回复 interrupted，保留 118 字符 |
| 图片                 | 真实上传 160×160 PNG，draft ready；发送后 Host 有 1 个已验证附件，回复完成                                                         |
| 历史图片             | 使用公开 sessions/switch 接口定位本轮会话并验证消息标记，Client 有 1 张加载成功的历史图片                                          |
| 图片失败降级         | 仅中断 Client 图片资源请求，实际拦截 1 次；图片节点 0，文件名标签 1，无破图                                                        |
| 空闲 Chromium 故障   | 只终止临时 profile 唯一 Chromium 主进程；4233 ms 后回到 online，仍 logged_in，会话/2 条消息 ID/1 个附件保持一致，恢复期间操作禁用  |
| 流式中 Chromium 故障 | 发送中正文已出现后终止临时 Chromium；首轮 22519 ms 恢复，原 2 条消息 ID 保持，最终 finished，正文 698 字符；没有自动重发           |
| 已登录 SSE EOF       | 首条有效快照后 EOF，第二条流暂挂；提示重连、操作禁用；放行后原消息 ID、输入草稿保留，chat POST 增量 0                              |
| 页面异常             | 所有运行段 pageerror 均为 0；无故障运行段 console error 为 0，故障资源错误另见下文                                                 |

历史选择的首版脚本因标题重复而拒绝继续，没有猜测会话。复验改用插件公开的会话列表和切换接口，并核对本轮标记文本才接受结果；这是 Host 路由及 Client 历史渲染验证，不把它写成已通过重复标题下的 UI 选项定位。图片失败首版按旧 URL 路径拦截未命中，图片正常加载，未计为降级通过；改按 Client 图片资源类型中断后才取得上述通过结果。页面重载后的官方引导也通过正常 UI 关闭。

Stop 原计划的 2000 行长回复被自动审批认为成本过高而拒绝；实际改用约 500 字普通回复完成停止验证，没有执行被拒绝请求。恢复测试使用约 400 字短篇回复。

### 故障诊断与清理

补充捕获的 2 条控制台资源错误分别为：主动中断图片请求产生的 `net::ERR_FAILED`，以及主动终止 Chromium 后原聊天请求返回的 HTTP 500。截图与 Host 最终状态显示回复已经恢复为 finished；两条均有对应的故障注入来源，不是未处理的页面异常。当前 UI 仍保留上一请求的 “Target page, context or browser has been closed” 错误说明，恢复完成不会自动清掉这条旧请求错误；这属于现有 UX 边界，后续可独立优化。

诊断重复运行曾在“HTTP 刚读到 recovering → 立即查询 UI 是否禁用”的跨通道断言上失败；这两个观测点不能保证同一时刻，随后快照已经回到 online、回复 finished。该重复运行不计为恢复期间禁用通过的证据；禁用验收沿用前一完整运行的实际观察，另有 SSE 暂挂场景的可控禁用检查。代码中 UI 的 `recovering` 与 `pageBusy` 来自同一渲染状态，检查期间没有改产品行为。

总共通过 UI 发起 7 个标记测试轮次，对应 7 次 Companion chat POST；多个冷启动分别计数核对，没有自动重发。标记以 `P1 Web compatibility 2026-10-20` 开头，测试会话保留在 DeepSeek 测试账号服务端，未删除。所有运行段 pageerror 为 0。源 profile 未修改，测试副本与 DSH/Chromium 进程已清理；只在仓库外保留本轮标记数据的截图供 Review，不保存认证信息、签名 URL 或会话 ID 到验收文档。

### 剩余边界

- 没有在本轮删除远端会话，session-deleted 的新版真机路径未复验；旧版实测与自动测试仍是其现有证据。
- 未覆盖纯图片发送、外部页面草稿安全路径、所有页面关闭/crash 分类；本轮覆盖图片+文本及 Chromium 空闲/流式终止，不能替代这些场景。
- 此处没有升级/回退验收，不代表正式发布批准；Desktop、Windows/Linux 仍未验证。

## 包与支持边界

最终 tarball 与 SHA-256 位于 Git 忽略的 `dist/release/`。预期仍为 9 文件：Host/Client JS 与类型声明、patch、package.json、README、LICENSE、CHANGELOG；包内产物与本地构建一致，Host 的 Playwright 外部导入、Client Web ModuleLoader 包装和精确版本声明已检查。

这是两个固定 **Web 运行时**的兼容候选，不代表新版全部用户场景已验收。新版已登录核心矩阵见上节，旧版历史完整结果仍见 web-regression；两者未覆盖的边界不外推。官方 Desktop、自定义协议、Windows/Linux、`0.2.0-rc.2` 未在本轮验证，也未声明支持。

## 2026-10-22 提交审核

本阶段审核旧/新版 Session 选择、未知/歧义降级、Dock 生命周期、依赖与分发边界以及验收记录，未发现可执行问题。重新运行格式、lint、类型、Host/Client 构建、667 项自动测试、diff 检查与包内容/语法检查；既有真机结果沿用上文明确记录的固定版本，本次没有重新启动登录浏览器或发送聊天，不扩大版本承诺。

当前兼容实现、测试与文档以一个原子提交收口。源码和安装包仍标记为未发布候选，升级/回退与未覆盖边界继续保留；Git 提交不代表创建 tag、push 或发布。

## 2026-10-22 插件升级与回退补充

兼容阶段已提交为 `8c24a4c`。随后固定共同宿主 Web `0.1.5-rc.2`，在同一隔离 profile 中完成 preview.1 → preview.2 → preview.1；登录、旧历史身份/内容、新聊天、窗口、SSE 和退出清理均通过，没有产品代码变更。详细结果与边界见 [upgrade-rollback.md](upgrade-rollback.md)。本补充不覆盖宿主版本迁移；上文历史验收中的“未覆盖升级/回退”以本节更新为准。

## 首版剩余验收的归属

兼容候选已提交为 `8c24a4c`，升级 / 回退记录已提交为 `cc3c01f`，不把提交当作发布批准。以下缺口交给 [first-release.md](first-release.md) 的相应阶段，不另起一套执行顺序：

- FR-1：本地 tarball / 手工 patch 验收衔接官方 bundle 安装与 Chromium 前置；准备真实市场元数据及索引草案。
- FR-2：补新版 session-deleted、纯图片 / 外部草稿与页面级故障分类，处理恢复后旧错误提示，继续标明 Search 来源的验证边界。
- FR-3：三窗口主题 / 字体、键盘、状态与轻动效的真实 UI 验收。
- FR-4 / FR-5：最终产物、固定版本承诺、代码审核、发布批准和真实市场安装闭环。

插件升级 / 回退只覆盖官方模板加 Companion 的共同宿主 `0.1.5-rc.2`；复杂自定义 profile 与 DSH 宿主迁移未验收，后续若承诺须独立验证。已有证据按变更影响复用，不能用旧包的结果替代最终包受影响的场景。

### 首版之外

- 官方 Desktop：先决定 Pop-out 公开能力降级，再验证独立 Desktop profile 安装、Dock/Float、协议/Fetch/SSE、登录、聊天、图片和退出清理；不能因 Web 通过便推断 Desktop 兼容。
- Windows/Linux 和后续 DSH/DeepSeek 网页更新：逐个维护真实支持矩阵。
- Phase 21 Proxy、22 Handoff（公开 Composer 接口、保留草稿）、23 Task Brief 独立评估；首版必要 UI 与发布回归已纳入 FR-3 / FR-4。
- Anchor identity（极快连续发送时 parent=null）与树形 history branch resolution：分别设计，当前保持 safe-fail。
- 静默半开 SSE 探测、Host 消息持久化、文档附件：按需求另立任务。
- 网页 Provider、Gateway、伪 Function Calling、Agent webchat tools、多账号、浏览器池和自动重发仍不在当前计划。

本记录不修改历史测试结果，也不代表 Desktop 或公开市场已验收；各 FR 阶段完成后在对应章节补充新证据。

## 2026-11-03 FR-2 错误生命周期进度

既有故障运行记录的旧请求错误已补身份绑定：发送失败响应携带本轮 assistant 与 Host 实例身份，只有相同消息确认完成 / 中断才解除；支持迟到 HTTP 错误。自动回归与已知验收边界见 [release-hardening.md](release-hardening.md#2026-11-03-fr-2-旧请求错误竞态修正)。本轮未重跑真实 Web 聊天或故障注入，不能据此将前述真机缺口标记通过。

### 同日真机复验结果

恢复提示这一项现已完成新旧固定 Web 的针对性复验：单段纯文本流式中终止隔离 Chromium，分别约 23.8 s / 4.1 s 恢复，原消息 ID 不变，assistant finished；待恢复后交付旧 HTTP 500，界面无旧错误，每次 chat POST 为 1。新版另一次正文不匹配的恢复保持 error 与原提示，未误报完成。旧版采用官方公开 `patchReload=startup`，默认 live HMR 启动失败不计为通过。确切候选摘要、步骤、控制台计数、截图与清理结果见 [真机复验记录](release-hardening.md#2026-11-03-fr-2-已登录恢复提示真机复验)。此前“未重跑”指上节实现轮次；本补充不覆盖 FR-2 其它尚未验收项。

## 2026-11-04 会话安全门控补充

FR-2 修复了不确定会话的 Enter / 跨状态选图绕过，以及 Host 附件新增与开关遗漏门控。主要 Web `0.2.1-rc.2` 的正常恢复和用户授权后的真实测试会话删除清理通过；证据不足先完成 Browser / Host / Client 分层复验，随后补齐已安装主宿主的真实故障 → 页面偏离目标 → 实际回调 → 共享状态 / 三窗口链路：保留原会话与完整消息，聊天 / 附件新增 / 开关返回 409，新建聊天解除限制。后者使用 Chromium 原生公开窗口导航制造证据不足，不替换 Host 快照或回调，不宣称 history=unknown；首版会话三路径这一项已完成。候选摘要、RED→GREEN、验收层级与剩余项见 [本轮验收记录](release-hardening.md#2026-11-04-fr-2-会话恢复与不确定状态门控)。

旧版 `0.1.5-rc.2` 在 Node 22 与公开 startup 配置下补做相同 Client 合成 SSE 回归：Enter 与跨状态选图均零 POST，草稿保留，页面 / 控制台无错误。此项仅覆盖本轮门控变更，不将合成状态写成真实登录或旧版完整恢复通过。

## 2026-11-06 图片安全补验

主要固定 Web 宿主的已安装候选通过纯图片发送、立即切回历史的图片加载、外部网页图片 / 文字草稿冲突、页面删除托管图片，以及网络阻断后的失败卡精准移除。冲突返回 409 且不新增消息，失败卡移除保留另一张正常草稿，最后附件 / 临时文件归零；1 个实际聊天轮次，无自动重发。本轮没有产品代码变化，旧版同类矩阵未重跑，不能扩大为 FR-4 冻结包或官方 Desktop 验收通过。确切产物、故障注入、计数与安全拒绝边界见 [图片安全验收](release-hardening.md#2026-11-06-fr-2-图片安全验收)。

## 2026-11-06 页面故障修复进度：未完成验收

主宿主旧候选的页面 close / renderer crash 保持同一浏览器进程和消息，分别约 2135 / 2026 ms 恢复；about:blank 则使 Host offline / error、Client 仅显示“检测失败”，暴露主动恢复入口缺口。已修复主 frame 失效导航主动恢复，以及旧页面 / dispose 后登录探测隔离，实际 Browser 接线 7 项回归与完整 690 项测试通过。新归档已安装准备复验，Mac 锁屏阻塞 CUA，不能把旧包前两项或自动测试扩大成新包真机通过。详细状态见 [页面故障记录](release-hardening.md#2026-11-06-fr-2-页面故障复验待修复记录)。旧版共有路径的新包实际宿主复验也仍待完成；本轮未进入 Search 或 FR-3。

## 2026-11-07 页面故障验收完成

解锁后同一修复归档在 Web `0.2.1-rc.2` 与 `0.1.5-rc.2`（公开 patchReload=startup）完成实际安装包的 about:blank / renderer crash / page close 复验。三种故障均恢复 online / logged_in，原会话、消息身份与内容、本地文字草稿保留，浏览器主进程不变、聊天 POST 为 0、pageerror 为 0。上节的锁屏阻塞已解除；本次不代表 Desktop 或 FR-4 最终冻结包通过。确切时序与归档见 [新包复验](release-hardening.md#2026-11-07-fr-2-新包页面故障验收闭环)。

## 2026-11-07 Search 来源验收

主要 Web 的同一修复候选完成 1 次短搜索回答，页面显示搜索到 12 个网页；引用 [9] 从原生网页打开 Python 官方 pathlib 文档，与 Host citation URL 及 Client 两个 [9] 链接逐字相同。同回答的 [4] 未结构化映射，正文保留，Client 为普通 [4]、无对应 anchor，也不暴露内部 citation 语法。页面本身存在 [4]，此处属于插件尽力恢复的未映射边界，不能写成站点未给 URL。未修改映射规则或增加抓取 API；本轮没有重跑旧版 Search，FR-4 最终包仍需按矩阵验收。精确步骤与检查见 [Search 记录](release-hardening.md#2026-11-07-fr-2-search-正文与来源验收)。

## 2026-11-07 FR-2 总审核结论

FR-2 清单与独立代码审核已完成，完整 690 项测试通过，本次以一个原子提交收口。此前各节是分阶段证据，不等于 FR-4 最终发布包矩阵；保持两个固定 Web、旧版公开 startup 配置和 Desktop 未支持的范围。下一阶段按首版计划先审核 FR-3 UI / 轻动效方案。
