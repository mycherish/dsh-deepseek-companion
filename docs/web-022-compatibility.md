# Web 0.2.2-rc.1 兼容计划与验收

日期：2026-11-16。用户已授权按以下步骤实施，当前状态为已发布并完成公开 npm／市场／中英文官网核对；下文此前未发布、待授权及处理中的状态均为历史快照。只适配 macOS 本地 **DSH Web 0.2.2-rc.1**，候选为 `dsh-chat-buddy@0.1.2`；不包含 Desktop、rc.3、Orbis 修复或公开发布。本地候选的版本声明不等于公开兼容承诺。

## 2026-11-16 发布授权与顺序

用户在本地验收和独立复审后明确要求“你先帮我都做了吧，必须我做的给我命令”，授权提交本轮变更、发布已冻结的 npm 0.1.2、更新正式市场索引以及同步中英文产品页。上文和下文“不提交／不发布”描述为此前验收阶段的边界，现由本段授权推进发布；不增加运行功能，不适配 Desktop，也不自动合并 main。

按顺序执行：核对冻结归档与门禁 → 提交并推送兼容分支 → npm 身份确认／发布／下载字节验证 → 基于最新 gh-pages 保留原条目并新增 0.1.2、官方校验后部署 → 仅更新个人网站两份产品 Markdown，Hugo 构建通过后提交并部署 → 核对线上包／索引／中英文页面并归档结果。仅 npm 登录或发布 2FA 需要用户完成；不得读写认证凭据。npm 未实际发布时，不部署市场和网站的已发布 0.1.2 声明。

源码范围为本轮兼容变更及发布记录；市场仅 gh-pages/index.json；网站仅 content/products/deepseek-companion/index.md、index.en.md。沿用现有主题和部署工作流。若发布失败，保留本地候选与准备文件、不部署后续声明；若索引或网站部署失败，保留旧版本条目并按提交回退，不卸载 npm 旧包、不强推。

## 执行步骤

1. **接口核对**：逐项核对当前插件使用的固定版 connection.fetch、会话选择和 layout / slots。源码不确定时先调查，不猜 API。只修改实际受影响的实现。
2. **候选与环境**：先写失败的兼容契约回归，再修改候选版本与精确 engines、市场草案。复用本机 0.2.2-rc.1 CLI，使用全新临时 DSH_HOME / Web profile，通过官方管理器安装本地 tarball；不改全局安装和日常 profile，不执行 allow-version。
3. **无登录烟测**：核对实际宿主版本与加载依赖，验证新包单次加载、API / SSE、Dock / Float / Pop-out 打开关闭和卸载清理。宿主引导只通过正常按钮处理。
4. **针对性真实烟测**：由用户在新隔离窗口手动登录，不复制既有登录目录；一轮文本流式、历史切换、图片、Stop，以及一次断流／恢复检查。不重做旧首版全部异常矩阵，不删除服务端会话。需要更多真实消息时限于明确测试会话。
5. **审核与收尾**：依次执行 AGENTS 门禁，再执行组件 UI 回归；检查候选归档及复用证据，保存脱敏记录，清理本轮进程与临时认证数据。完成后停止等待 Review，不 commit / push / publish，不修改个人网站或线上索引。

任何失败先保存触发条件并定位原因，修复要有 RED→GREEN；无法取得的证据保持待验，不把安装成功当聊天成功，也不将 UI 组件回归当真实宿主矩阵。不会因认证等待继续扩大工作范围。

## 范围与证据复用

- 旧版 `0.1.5-rc.2` / `0.2.1-rc.2` 的正式能力继续保留；未改动的聊天、图片及恢复逻辑复用 FR-4 / FR-5 和更名阶段证据，仅对新宿主受影响路径烟测。
- 保留 API 前缀、内部 ID、登录／上传目录、环境变量、设置键及不自动重发语义。新旧包不支持同 profile 并装。
- 本机 Desktop 与本轮 Web 是独立运行对象；Web 成功不意味着 Desktop 兼容。宿主的 DSH 账号也不等于 DeepSeek 网页登录。
- 回退使用原来兼容的宿主与公开 `0.1.1`；不能在 rc.1 上绕过 engines 回退旧包。不会降级用户全局 DSH。

## 文件范围

候选元数据为 `package.json`、`market/index.draft.json`、`CHANGELOG.md`；测试为 `tests/web-022-compatibility.test.ts`、现有 rename / market / session / UI 回归。仅在新宿主实际失败时修改 `src/index.ts`、`src/client/api.ts`、`src/client/index.ts` 或对应受影响模块。完成后同步 README、architecture、first-release、roadmap 与本文；旧发布记录保持历史原貌。

## 检查命令

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm build
pnpm test
git diff --check
git status
git diff
pnpm test:ui
```

## 进度

- [x] 1. 固定版公开接口核对。
- [x] 2. RED→GREEN、候选、隔离安装与版本核对。
- [x] 3. 无登录宿主加载／请求／三窗口烟测及最终卸载清理。
- [x] 4. 用户手动登录后的针对性烟测。
- [x] 5. 门禁、独立审核、证据整理和清理。

证据放在 Git 忽略的 `dist/release/web-022-20261116/`；不记录凭据、认证 URL、私人会话 ID 或浏览器登录目录。本地原始日志仅限测试期间使用，结束前删除。

## 本轮记录

- 计划范围已独立复审，无阻断项；共享实现如有修改须补受影响的旧版回归。
- 本机官方 CLI 与其实际加载的 connection、session-controller、ui-layout 包均为 `0.2.2-rc.1`。核对安装包公开实现中 Fetch route 注册／dispose、SSE Response、sessions list snapshot、`blank` / `retainedBy` 及 layout 开关；本轮不改 DSH 源码。远端固定 tag 源码请求失败，未以未取得的线上源码作为证据。
- 新增兼容契约先失败（缺少 rc.1），补充精确版本白名单后与市场、品牌契约共 6/6 通过；移除品牌测试中无关的旧版本号断言。
- 全新临时 DSH_HOME 官方安装 `dsh-chat-buddy@0.1.2` 成功，无版本豁免；peer 提示由宿主运行时提供的 Cordis / React 解决，实际加载后未见相应运行错误。
- 未登录阶段 Dock（空白会话 overlay）、Float、Pop-out 及关闭恢复入口通过；状态和 SSE HTTP 200、首帧有效。此项只证明本地路由／事件流接线，状态明确为 `logged_out`，未宣称真实聊天通过。
- 首次用户确认登录后，API 仍为 `logged_out`；检查确认本轮 Chrome for Testing 停在登录页，已置前并请用户在此窗口登录，未修改产品登录逻辑。
- 首轮门禁全部通过，699/699 单元测试、8/8 组件 UI；后续文档更新仍需复核格式与差异。

卸载清理调整到真实烟测后执行，避免提前销毁用户手动登录的测试环境；这是执行顺序的局部调整，不扩大验收范围。

## 新宿主实际结果

| 验收项     | 结果与证据边界                                                                                                                                                                     |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 官方安装   | 全新 DSH_HOME；CLI、connection、session-controller、ui-layout 均为 rc.1；无需 allow-version；`runtime-versions.json`                                                               |
| 三窗口     | Dock 空白会话 overlay、Float、Pop-out 打开／关闭通过，操作期间页面错误 0；`three-window-smoke.json`                                                                                |
| 登录       | 用户在本轮独立 Chrome for Testing 手动完成，Host 确认 `logged_in`；没有复制既有登录目录                                                                                            |
| 文本／流式 | UI Enter 发送，POST 200 完成；Host 一问一答 2 条，assistant `finished`；13 个 SSE 帧，捕获 sending 中的非空增量；`chat-smoke.json`                                                 |
| 图片       | 本地生成的纯绿色 PNG 上传 ready，服务端回复非空，已发送 user 带附件、草稿清空                                                                                                      |
| Stop       | 服务端已开始产生正文时请求停止，返回 stopped=true，Host 发送结束、assistant interrupted、保留部分内容                                                                              |
| 新建／历史 | 清空当前显示后切回本轮测试会话，确认会话身份和消息恢复；不删除远端会话                                                                                                             |
| SSE 断流   | 仅本轮客户端经过临时本地代理，真正销毁 SSE 连接并暂拒重连；断线横幅和禁用发送可见，恢复后自动接入第二条真实流、发送恢复、草稿不丢；无聊天 POST、消息数不变；`reconnect-smoke.json` |
| 官方卸载   | 仅隔离环境：依赖、模块链接与 bundle 条目全部移除；`uninstall-smoke.json`                                                                                                           |
| 旧版回归   | `src`、依赖锁与运行协议均未修改；Host / Client JS 与更名 0.1.1 归档哈希相同，复用既有真实旧版证据并运行现有单测，不重做旧版真实矩阵                                                |

测试驱动修正：第一次文本收尾检查未等待对应聊天 POST 完整结束，曾过早读取到 streaming；复查真实状态已正常 finished。驱动改为先确认本轮 POST 200 完成，再检查终态和独立 SSE 增量。另一轮新浏览器上下文的宿主引导延迟出现，补正常按钮后的等待，不强行穿透遮罩。均未据此修改运行代码。

浏览器 `setOffline(true)` 未切断已有 SSE，不能证明断线；已改用上述临时代理真实断流复验。代理不保存请求头、凭据或正文，结束时关闭所有连接。此项验证显式 EOF／失败后的重连，不宣称解决既有静默半开无心跳边界。

本轮未重跑 Deep Think / Search 真实全矩阵、非空 DSH 主会话 rightbar 真机矩阵、旧版所有异常、Chromium crash/reconcile 全矩阵；它们复用未变运行代码的既有证据，不能将本轮烟测写成全部能力重新验收。Desktop、rc.3、其它平台、公开市场安装仍不在本轮验收内。

## 后续顺序

1. 最终 Review 后由用户授权提交本轮兼容变更；当前不自动 commit。
2. 再由用户授权或手动发布 `dsh-chat-buddy@0.1.2`，保留旧公开版本；发布确切候选归档。
3. npm 可下载后更新正式市场索引，保留旧包／旧版本；部署并核对索引、实际新宿主安装。
4. 更新中英文产品页兼容范围与安装版本；本轮没有修改网站或线上市场。
5. Desktop 另立适配任务；不要从 Web 验收推导 Desktop 兼容。

## 最终门禁、归档与复审

- 最终执行顺序：format:check → lint（101 文件）→ typecheck → build → test（699/699）→ diff --check → status／diff → test:ui（8/8）→ pack，全部通过。之后只补最终结果文档，再复核格式与差异。
- 候选归档：`dist/release/web-022-20261116/dsh-chat-buddy-0.1.2.tgz`，10 个文件，SHA-256 `138e639470b37a125d5d1085d230f2f245305979f613ba70cc969504321feafd`。归档中的四份 lib JS／类型文件与最终构建及更名 0.1.1 归档逐字节相同；详见 `candidate-verification.json`。
- 本地候选初次安装后只更新 README／CHANGELOG 等说明并重打最终包，没有变动运行字节或兼容元数据。最终包仍未上传 npm；草案 publishTimestamp 仍为 0，不部署此草案。
- 独立只读复审覆盖全部未提交差异与脱敏烟测记录：Blocker / High / Medium / Low 均未发现可执行问题；独立契约检查 6/6、diff --check 通过。该复审不代替用户的阶段 Review，也不表示批准公开发布。
- 隔离宿主已停止，专属 Chromium 残留为 0；临时登录目录、运行路径记录、含启动认证 URL 的日志及全部本轮临时日志已删除。保留 `checks.json`、`cleanup.json`、各项脱敏验收 JSON、测试驱动和归档。远端测试会话保留，日常 profile 未动。
- 本轮结论：不需要修改聊天／恢复／窗口运行代码；只提交候选元数据、契约回归和相关文档即可进入发布准备。当前尚未 commit / push / tag / publish，官网与线上市场未改。

## 发布准备补充

兼容提交 `ed4e7d5` 已推送至 `codex/web-022-compat`。npm 登录由用户完成后已确认发布身份为 `caelum-maple`。发布前同步 README 中的主安装命令、精确宿主范围、回退限制和旧名迁移说明，避免 npm 页面继续展示旧包命令和未发布候选提示；CHANGELOG 0.1.2 同步为版本说明。

原验收归档保留不变。发布归档为 `dist/release/web-022-20261116/publish/dsh-chat-buddy-0.1.2.tgz`，SHA-256 `2e0392d8aca910d67037698d8d513dc961d398953c732593e9e71f83cf0694f8`。与原验收归档逐文件比较，仅 README.md / CHANGELOG.md 内容不同，运行文件、package.json、patch 与图标字节完全相同。验证记录为 `publish/verification.json`；不重做未变运行文件的真实聊天矩阵。

个人网站仅两份产品 Markdown 已同步新版本、三项固定 Web 兼容声明及手动登录验收边界；Hugo 0.136.4 extended 构建成功，中英文输出均核对安装版本和宿主范围。npm 发布前未推送网站，也未部署新市场条目。

## 发布受理后的交接状态

- 源码兼容提交 `ed4e7d5`、发布说明提交 `5411362` 已推送至 `codex/web-022-compat`，未合并 main。
- 用户完成本次发布 2FA 后，npm CLI 以 exit 0 返回 `+ dsh-chat-buddy@0.1.2`，同时提示包正在处理。随后两次公开 registry 检查均未取得该版本，不能标记为公开可安装；用户明确要求“不用重试了，给我命令”，本轮停止后续在线核验，不再次 publish。
- 正式市场尚未修改／推送；网站两份 Markdown 已提交为 `e2f4697`，Hugo 构建和中英文产物检查通过，但未推送 master、未部署。
- 后续本地脚本为 Git 忽略目录中的 `dist/release/web-022-20261116/publish/deploy-market.sh`。它从最新 gh-pages 读取基线，核对公开 npm 元数据、归档字节与实际发布时间，通过官方索引校验后才提交／推送新索引；任一核对失败立即退出，不改线上索引。保留旧 Companion 0.1.0 与 Chat Buddy 0.1.1，不强推。脚本已做语法检查，未执行部署；临时脚本仅在当前本地工作区存在。

用户后续按顺序执行，第一步仍为 404 时不要执行后续步骤，也不要重复 npm publish：

```sh
# 1. 确认公开 registry 已能返回 0.1.2
npm view dsh-chat-buddy@0.1.2 version --registry https://registry.npmjs.org/

# 2. 在插件仓库运行，自动完成核验和市场部署
bash dist/release/web-022-20261116/publish/deploy-market.sh

# 3. 仅在上一步成功后推送已提交的中英文产品页
# 在个人 Hugo 网站仓库运行
git push origin master
```

等待各自 GitHub Pages 部署成功后，再核对公开市场包含 Chat Buddy 0.1.2 和旧版本，且中英文产品页安装命令为 `dsh-chat-buddy@0.1.2`。当前未作这些线上通过声明；已受理的 npm 发布结果和公开下载可见性分开记录。剩余操作均由用户执行，本轮不再重试。

## 2026-11-16 发布完成与线上核对

用户执行交接命令后，本轮已完成 npm、正式市场与中英文产品页发布，无需再次 publish 或重新部署。

| 项目         | 最终结果                                                                                                              |
| ------------ | --------------------------------------------------------------------------------------------------------------------- |
| npm          | `dsh-chat-buddy@0.1.2` 已公开可下载，latest 为 0.1.2；用户运行的发布校验脚本已下载并逐字节比对冻结发布归档            |
| 发布归档     | SHA-256 `2e0392d8aca910d67037698d8d513dc961d398953c732593e9e71f83cf0694f8`；实际 npm publishTimestamp 为 `1794810456` |
| 正式市场     | gh-pages 提交 `666d64d`，线上 index.json HTTP 200；Chat Buddy 版本为 0.1.2 / 0.1.1，旧 Companion 0.1.0 保留           |
| 兼容声明     | `0.1.5-rc.2                                                                                                           |     | 0.2.1-rc.2 |     | 0.2.2-rc.1`，限 macOS 本地 Web；Desktop 未兼容 |
| 市场 Pages   | [部署成功](https://github.com/mycherish/dsh-deepseek-companion/actions/runs/43817324846)，对应 666d64d                |
| 网站         | master 提交 `e2f4697` 已推送，[部署成功](https://github.com/mycherish/mycherish.github.io/actions/runs/43817332222)   |
| 中英文产品页 | 两页 HTTP 200，均已显示安装 `dsh-chat-buddy@0.1.2` 和 Web 0.2.2-rc.1 兼容范围                                         |
| 源码         | 兼容提交及发布说明／交接记录均已推送 codex/web-022-compat；未自动合并 main                                            |

线上地址：[正式市场索引](https://mycherish.github.io/dsh-deepseek-companion/index.json)、[中文产品页](https://mycherish.github.io/products/deepseek-companion/)、[英文产品页](https://mycherish.github.io/en/products/deepseek-companion/)。核对使用实际公开响应及对应提交的 Pages 工作流，不将 git push 输出单独当成部署成功。

新宿主的运行验收仍以本篇既有隔离测试为准：本轮公开发布只核对归档、索引与网站，不操作日常 profile，也不将其写成新一轮 Discover 界面／真实聊天验收。此前临时环境清理结果保持不变，发布脚本的临时市场 worktree 已正常移除。

后续必要工作：审阅并归并兼容分支至 main（未执行）；用户在日常 Web 0.2.2-rc.1 停止宿主后安装 0.1.2 并反馈实际使用；收集可复现缺陷。Desktop、其它宿主版本与功能扩展继续独立立项，不阻塞本次已完成发布。
