# Web 预览版本准备与兼容性核查

> **2026-10-20 更新**：下面的 `preview.1` 调查与验收作为历史记录保留，已提交为 `a4b589c`。当前候选为 `0.1.0-preview.2`，适配 Web `0.2.1-rc.2` 并保留 `0.1.5-rc.2`；今天 npm latest 也已更新为 `0.2.1-rc.2`。用户随后授权测试 profile 副本，新版已登录核心矩阵也已通过；新旧 Web 验证与剩余矩阵缺口见 [web-compatibility.md](web-compatibility.md)。官方 Desktop 未纳入本轮。2026-10-22 兼容阶段已提交为 `8c24a4c`，随后在共同宿主 `0.1.5-rc.2` 上完成插件升级/回退验收，见 [upgrade-rollback.md](upgrade-rollback.md)。尚未发布。

核查日期：2026-10-19。候选：`0.1.0-preview.1`。本轮范围为发布元数据、Changelog、安装/回退说明、功能与兼容性盘点；不实现新版 DSH 或 Desktop 适配。当前是待 Review 的本地候选，不是发布批准。

## 支持基线与分发

| 项目        | 本预览范围                                                                      |
| ----------- | ------------------------------------------------------------------------------- |
| 系统        | macOS；Windows/Linux 未验收                                                     |
| DSH         | Web `0.1.5-rc.2`；首次启动完成官方引导即可，模型配置可选 Configure later        |
| Node / pnpm | 实测 `22.20.0` / `10.26.0`                                                      |
| 浏览器      | Playwright `1.62.0` 的匹配 Chromium；目标机器须有浏览器文件                     |
| 包          | `dsh-deepseek-companion-0.1.0-preview.1.tgz`，输出到 Git 忽略的 `dist/release/` |
| 分发方式    | 本地构建 tarball 供人工预览安装；不执行 npm publish、上传、push 或 tag          |

`engines.dsh` 精确声明 `0.1.5-rc.2`，避免新 DSH 误将无版本约束理解为支持。官方新版 App boot 优先用此字段检查插件；这份声明只描述已验证范围，不证明旧版 DSH 实现同样的检查。源码依赖版本不在本轮升级。

安装命令见 [README](../README.md#web-插件安装预览)。在已初始化且停机的测试 profile 操作；安装前备份 `package.json`、`pnpm-lock.yaml`、`cordis.patch.yml`，保留备份位置。不要把用户正在使用的 profile 当作干净测试环境，也不要拷贝认证信息到分发包。

全新 `DSH_HOME` 首次启动有官方引导，会临时遮挡 Companion 入口：先在 **Internal Testing Notice** 中点击 **Continue**，再在模型设置中选择 **Configure later**。本轮已正常走通这条公开 UI 流程，未填入 API Key、未复用用户凭据，随后 Companion 登录入口可正常打开。早期仅凭遮罩推断“必须配置模型”不准确；向导可正常延期配置，不需要绕过或禁用官方插件。

跨机器接收 tarball 时，在目标机器运行 `npx playwright@1.62.0 install chromium` 安装匹配浏览器；仓库内可使用已锁定依赖的 `pnpm exec playwright install chromium`。安装到目标 profile 后应用包内 patch，启动并验证插件注入、登录入口、文本发送、Stop、历史、图片失败降级和退出清理。

### 回退

preview.1 仅声明支持 Web `0.1.5-rc.2`；回退旧插件前必须满足该宿主约束。已验收的是同一旧宿主中的插件包替换，未验收 DSH 宿主降级或跨版本数据迁移。

1. 停止测试 DSH，保留原 profile、浏览器目录和安装前备份。
2. 若回到旧插件，重新安装保存的旧 tarball，再用原来的 patch 启动；本轮没有修改 Host API 或浏览器数据格式。
3. 若停用插件，仅移除该 profile patch 中 `deepseek-companion` 对应的插入项/覆盖项，保留其它配置，再在该 profile 中执行 `pnpm remove dsh-deepseek-companion`。若使用命令行 `--patch`，下次启动去掉此插件的 `--patch`。
4. 重新启动确认其它 DSH 功能正常。不要删除整个 patch 或浏览器目录。以上步骤不撤回 DeepSeek 服务端已经发送的消息；不恢复 Host 的内存中未保存状态。

## 当前功能

| 功能        | 当前实现与验证边界                                                                                               |
| ----------- | ---------------------------------------------------------------------------------------------------------------- |
| UI          | Dock、页面内 Float、独立 Pop-out；拖拽/缩放、overlay 宽度记忆、Host 状态跨界面同步；窄屏边框修复                 |
| 登录        | 插件自己的 persistent Chromium profile 保存 DeepSeek 网页登录；不读取或复用 DSH 账号 token                       |
| 聊天        | 文本与流式输出、Markdown/代码块、Deep Think 思考折叠、Search 开关、Stop、新建会话                                |
| 搜索来源    | 可验证映射才显示链接；否则 best-effort 降级；本轮真实搜索未取得可验证结构化 URL                                  |
| 图片        | PNG/JPEG/WebP/GIF，随文本或纯图片发送，附件归属校验；历史图片展示，失效显示文件名；草稿卡片无像素缩略图          |
| 历史        | DeepSeek 会话列表、切换、外部导航同步；不盲猜图片所属消息                                                        |
| 浏览器恢复  | 页面/Chromium 故障后恢复登录与会话，恢复期间禁用操作；单次有共享 deadline 的刷新与严格 identity 原地回填，不重发 |
| 会话恢复 UX | 明确删除证据才清理；不确定则保留消息并阻止发送；恢复后刷新可验证标题                                             |
| SSE 恢复    | EOF/error/首快照超时后退避重连；保留消息和输入，新有效快照前禁用操作，dispose 清理；无静默连接心跳               |
| 工程与安装  | 格式/lint/类型/构建/自动测试门禁、tarball 内容检查、隔离 profile 安装及真实 Web 回归                             |

实现证据：`src/client/index.ts`、`ChatView.tsx`、`popout.ts`、`state-stream.ts`；`src/host/browser.ts`、`sessions.ts`、`reconcile.ts`、附件事务相关模块。真实运行结果见 [web-regression.md](web-regression.md) 与 [architecture.md](architecture.md)，历史验收不等同于本轮重跑。

## 官方最新版核查

“最新版”须区分渠道：截至核查日，官方 GitHub 最新发布标签为 **`dsh-v0.2.1-rc.2`**；npm `@deepseek-ai/dsh/latest` 返回 **`0.2.0-rc.2`**。官方生产 Desktop 的 mac-arm64 与 win-x64 Nightly feed 均返回 **`0.2.1-rc.2`**。这些均是预览/候选版本；没有将社区 Desktop 的版本混入结果。未下载、启动或修改用户的 Desktop 应用。

| 目标                        | 当前结论                           | 依据                                                                                                                                              |
| --------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web `0.1.5-rc.2`            | 支持，仅已验收的 macOS 组合        | 当前依赖、654 项自动测试与既有真实 Web 矩阵                                                                                                       |
| Web npm latest `0.2.0-rc.2` | 不在本候选支持范围，需要适配与实测 | 当前 UI 读 `ctx.sessions.list.getSnapshot().current`，此版本 `SessionListState` 已无 `current`                                                    |
| Web GitHub `0.2.1-rc.2`     | 不在本候选支持范围，需要适配与实测 | 同样移除了列表的 `current`；布局和 Fetch route 核心接口仍在，不能据此推断完整运行通过                                                             |
| 官方 Desktop `0.2.1-rc.2`   | 当前不完整兼容，未支持             | 共享新版 Web 的接口变化；Electron 拒绝创建页面新窗口，当前 `about:blank` Pop-out 无法照搬；还需独立 profile 安装、协议/SSE 与 Playwright 运行验证 |

### 已定位的差异

- **当前 DSH Session 选择**：本插件 `currentSessionBlank()` 从旧列表的 `current` 取 DSH Session；两个新版本的 `SessionListState` 只有 `ids/byId/phase/projectionsBySession`。直接使用现有构建时会走 unknown → overlay，无法按当前 Session 正确选择 rightbar；若把类型依赖直接升级，此字段也不再通过类型检查。需要调查新版公开的当前 Session 接口并做小范围兼容适配。
- **Desktop Pop-out**：官方 `apps/desktop/src/main.ts` 的 `createWindow()` 设置 `setWindowOpenHandler()`，HTTP(S) 转系统浏览器，最终一律 `action: 'deny'`；本插件创建 `about:blank` 后在 opener 中挂载 React 的实现不能完整工作。后续优先通过公开能力检测隐藏/禁用独立窗口入口并保留 Dock/Float，再决定是否有官方公开窗口接口；不能 monkey patch Electron 或使用私有 IPC。
- **Desktop 安装与传输**：官方应用是共享 Web UI 的 Electron 壳，主文档为 `dsh-app://app/`；自定义协议转发到认证 Host，Desktop 的执行依赖和激活配置位于自己的 `profiles/desktop`。`dsh.client.platform: web` 不能单独证明“不加载 Desktop”，因为官方 renderer 也使用该声明；同样不能据此证明已兼容。HTTP/SSE、自定义 origin、Playwright 路径及退出清理仍须真机验证。
- **账号语义**：官方 DSH 账号 provider 文档说明的是 Platform grant、余额及默认 `api.deepseek.com` 的模型/文件认证；本插件使用自己的 `chat.deepseek.com` 浏览器登录。根据两条实现链路，官方账号已登录不能作为本插件网页登录已就绪的证据，也不能据此认定官方已经提供本插件这种网页历史聊天面板。

### 官方来源（固定版本）

- [GitHub Releases](https://github.com/deepseek-ai/deepseek-harness/releases)，[0.2.1-rc.2 发布](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-rc.2)，[npm latest 元数据](https://registry.npmjs.org/@deepseek-ai/dsh/latest)。
- [Desktop 文档](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.2/apps/desktop/README.md)、[窗口策略源码](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.2/apps/desktop/src/main.ts)、[生产 feed 规则](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.2/apps/desktop/publishing/README.md)；实际读取的 [mac-arm64 feed](https://download.deepseek.com/dsh-desk/feeds/mac-arm64/nightly-mac.yml) 与 [win-x64 feed](https://download.deepseek.com/dsh-desk/feeds/win-x64/nightly.yml)。
- Session 列表类型：[0.2.0-rc.2](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.2/packages/api/session-controller/src/client/sessions/service.ts)、[0.2.1-rc.2](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.2/packages/api/session-controller/src/client/sessions/service.ts)。
- [App boot 的 engines.dsh 规则](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.2/packages/boot/app-boot/README.md#profiles)、[账号 provider](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.2/packages/credentials/deepseek-account-platform/README.md)。

## 本轮验证

- 格式、lint、类型检查、Host/Client 构建、654 项自动测试和 `git diff --check` 全部通过。四个运行产物的 SHA-256 与 `a178b8c` 后的已验收构建一致。
- 预览 tarball 仅有 9 个预期文件：4 个 JS/类型文件、patch、package.json、README、LICENSE、CHANGELOG。版本、`engines.dsh`、Playwright 外部依赖及 Web ModuleLoader 包装检查通过。pnpm 打包时移除开发用 `packageManager` 字段，其余 manifest 字段保留。
- 使用全新临时 DSH_HOME 与官方 Web profile，离线缓存安装同版本候选，正常完成 Continue → Configure later → 打开 Companion。Host 为 `login_required / logged_out`、消息 0，页面 `pageerror` 为 0；未登录 DeepSeek，也未发送聊天。
- 停机卸载候选、去掉此插件的命令行 patch 后重新启动，基础 Web 返回 HTTP 200、Companion 路由返回 404；退出后隔离 Chromium 主进程为 0。临时 profile 与进程均清理，原 profile 和 Desktop 未修改。
- Browser plugin 不可用，使用项目已有 Playwright；已目视核对最终 Companion 未登录界面。早期脚本的启动判定、CLI 参数顺序和页面内异步轮询断言曾失败；最终以正常 UI 操作和浏览器会话的直接 HTTP 检查复验，不将脚本失败作为产品缺陷修复。本轮没有重跑已登录聊天/恢复的完整矩阵，也没有实测新版 DSH 或 Desktop。
- 候选及 `.sha256` 校验文件位于 `dist/release/`，被 Git 忽略。最终归档只同步了本轮确认的首次引导文案，运行代码与安装 manifest 未改变。

## 全部已知后续工作

### P0：关闭本次 Web 预览准备

- [x] SSE/浮窗修复及验收记录审核提交：`a178b8c`。
- [x] 构建弃用配置迁移审核提交：`702fe16`。
- [x] 准备预览版本号、精确支持基线、Changelog、本地分发与回退说明。
- [x] Review 并提交 preview.1 预览准备：`a4b589c`；候选元数据变更不等于已发布。
- [x] 同版本预览候选在全新目标 profile 上完成安装、正常首次引导、未登录界面与卸载重启复验；最终归档完成内容检查。
- [x] 官方 Web 模板加 Companion 的既有安装场景完成 preview.1 → preview.2 → preview.1 升级/回退（共同宿主 `0.1.5-rc.2`）；不外推复杂自定义 profile 或宿主迁移。
- [x] Review 升级/回退验收文档并以一个原子文档提交保存。
- [ ] 补齐承诺场景后冻结候选。
- [ ] 确定发布承诺：Search 可点击来源、外部图片草稿安全路径、active-stream crash、session-deleted 等本轮未全部重跑；对承诺覆盖的场景补做目标版本真机验证，并更新矩阵。
- [ ] 用户批准后创建版本节点、push、上传 tarball/正式发布；这些动作未在本轮执行。

### P1：当前优先的兼容性工作

1. 新版 Web 适配已完成候选实现：公开主视图识别、旧版能力检测、新旧安装/UI/Fetch/SSE 与新版真实 rightbar 已验证；范围固定 `0.1.5-rc.2` / `0.2.1-rc.2`，不声明支持 `0.2.0-rc.2`。用户授权后新版已登录核心聊天/图片/恢复矩阵已通过；共同宿主中的插件升级/回退也已通过；下一步补会话删除等未覆盖边界，见 [web-compatibility.md](web-compatibility.md)。
2. 官方 Desktop 最小验证：先确定 Pop-out 的公开降级方案，再在隔离 Desktop profile 中测试 Dock/Float、登录、聊天、SSE、图片、Chromium 与应用退出清理；不读取或复用 DSH token，不先承诺原生独立窗口。
3. 每次 DSH/DeepSeek 网页更新后的兼容回归与支持矩阵维护；Windows/Linux 需要各自验收后才纳入支持范围。

### 后续功能路线图（独立 Phase）

- Phase 21：Proxy 配置与浏览器启动/恢复链路的统一应用、测试及资源清理。
- Phase 22：将内容 Handoff 到当前 DSH Composer，遵循公开接口并保留用户草稿。
- Phase 23：Task Brief。
- Phase 24：UI Polish。
- Phase 25：上述新增功能完成后的完整 Regression / Release；当前最小版回归不提前代表这些功能已验收。

### 已知边界与独立候选事项

- `parent_message_id=null` 的极快连续发送：anchor identity 独立设计与验证。
- 树形/分支历史：history branch resolution 独立设计；当前继续 safe-fail。
- 静默半开 SSE 的主动探测、Host 消息持久化、文档附件：按需求另立范围，不作为本轮已交付能力。
- 当前计划明确不做：网页 LLM Provider、API Gateway、伪 Function Calling、Agent webchat tools、多账号、浏览器池和自动重发；这些不是发布前待补功能。

各轮完成后按 `AGENTS.md` 停止等待 Review；后续兼容层的实现与验收以对应记录为准，不顺手实现 Phase 21。
