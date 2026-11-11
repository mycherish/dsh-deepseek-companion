# Web Release Hardening 验收记录

初始验收：2026-10-17。目标：验证 tarball 可在 DSH Web 中安装、加载和运行最小聊天链路。2026-10-19 已继续执行 Web 最小版回归，范围与发布阻塞见 [web-regression.md](web-regression.md)。

## 安装路径

1. 初始验收在 `pnpm build` 后用 `pnpm pack` 生成 `dsh-deepseek-companion-0.0.1.tgz`；当前预览候选安装说明见 [README](../README.md#web-插件安装预览)。
2. 在从 DSH 官方 Web 模板新建的临时 profile 中，使用 `pnpm add <tarball>` 安装。仅安装包时插件不会进入 Cordis 树。
3. 应用包内 `cordis.patch.yml` 后启动 DSH Web，插件加载成功。将其中的 `insert` 项合并进临时 profile 的 `cordis.patch.yml` 后，不传命令行 `--patch` 再次启动也加载成功。安装命令见 [README](../README.md#web-插件安装预览)。

安装时 pnpm 报告 `@deepseek-ai/cordis`、`react`、`react-dom` peer dependency 缺失；干净 profile 中实际加载和注入均成功。发布前仍应在目标 DSH 版本上重复安装检查。

## 烟测结果

| 场景                | 结果                                                                                                                                               |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| tarball 内容        | 仅包含 Host/Client 的 JS 与类型声明、patch、package.json、README、LICENSE                                                                          |
| 干净 profile        | 打包插件加载，DSH Web 显示“DS快速聊天”；无登录态时状态为 `login_required / logged_out`，显示登录入口，页面无运行时错误                             |
| 已登录 profile 副本 | Companion 状态为 `online / logged_in`；通过 UI 发送一条标记测试消息，得到一条已完成的 user 消息与一条已完成的 assistant 回复                       |
| 历史图片            | UI 切换到图片测试会话后，Host 有 10 条消息、7 个附件；Client 的 7 个历史图片节点均加载成功                                                         |
| 图片请求失败        | 拦截 `/api/file` 请求后，Client 保留 7 个文件名标签，图片节点与破图均为 0                                                                          |
| Chromium 故障       | 仅终止临时 profile 的唯一 Chromium 主进程；未刷新的 DSH Web 观察到 `recovering → online`，恢复后仍已登录，原会话、10 条消息 ID 和 7 个附件保持一致 |

验收使用本机 macOS、DSH Web、Playwright Chromium 与临时 profile。已登录场景使用测试 profile 的隔离副本；干净安装场景使用新建 profile。脚本只输出状态、数量和加载结果，不输出 token、cookie、签名 URL 或会话正文；用于目视核对的临时历史截图已随 profile 副本清理。原始 profile 未修改。

文本发送烟测在测试账号的 DeepSeek 服务端留下了一条以 `P0 release smoke 2026-10-17` 开头的测试会话；本轮未删除该会话。

## 工程检查门禁

已加入锁定版本的 Prettier（源码、测试、配置与 Markdown 格式检查）和 Biome（源码、测试 lint）。开发与提交前依次运行 `pnpm format:check`、`pnpm lint`、`pnpm typecheck`、`pnpm build`、`pnpm test`。`pnpm format` 用于修复格式。

首次接入时统一整理了现有文件的格式。Biome 保留推荐规则；对项目中有意采用的非空断言、页面内临时属性访问、用于触发滚动的 React effect 依赖、拖拽分隔元素、赋值式循环和控制字符过滤正则设置了例外。后续 Web 最小版回归矩阵见 [web-regression.md](web-regression.md)。

## 2026-10-19 Web 回归补充

在已登录测试 profile 的隔离副本中，Dock / 浮窗 / 独立窗口切换、Deep Think / Search 开关、文本发送与历史恢复均通过，页面无控制台错误。新发图片立即执行“新建聊天 → 历史会话”时发现一个缺口：DeepSeek SPA 缓存中的已发送图片仍是 `blob:` 页面临时地址，历史 reader 正确拒绝将其当作可跨页面展示的附件，但 Host 因此只恢复文本。独立新加载同一会话时，DeepSeek 页面提供带 `file_id` 和 `state` 的签名图片地址。

修复后，只有历史读取遇到已发送消息中的 `blob:` 图片才让 DeepSeek 前端执行一次有预算的页面刷新；随后重新读取，并要求同一会话、同一 user 消息中的图片数量均得到签名地址验证。刷新失败、会话变化或图片仍不可验证时，切换失败并保留原 Host transcript，不伪造附件。原始复现场景用新图片轮次复验两次：切换均为 HTTP 200，耗时约 4 s，Host 附件 1 个、Client 图片节点 1 个且加载成功，控制台错误 0 个。针对 `blob:` 检测、Host 归一化和刷新后附件对应关系增加自动测试。

本次测试使用真实 DeepSeek 测试账号，留下多个以 `P25 Web regression` 开头的测试轮次，未删除。测试只输出状态、计数和耗时，不输出认证信息、签名 URL、会话 ID 或会话正文。此补充不代表 Phase 25 全量验收完成。

## 当前发布状态

Web 最小版验收矩阵已执行，包含干净安装、流式 Markdown、reasoning、跨窗口 Stop、浮窗窄屏、图片历史、失败降级、Chromium 恢复和 dispose。浮窗 2px 溢出已修复。随后已完成 **SSE 断流恢复 P0**：重连前保留消息与输入并禁用操作，新快照恢复后 Dock 与独立窗口重新一致；EOF、请求失败与 dispose 的两轮真实 Web 复验通过，无聊天自动重发。上述代码与验收文档已审核并提交为 `a178b8c`；构建配置迁移已提交为 `702fe16`。当前 `0.1.0-preview.1` 元数据、Changelog 与预览说明待 Review，尚未发布。实测结果和剩余项见 [web-regression.md](web-regression.md) 与 [release-preview.md](release-preview.md)。

## 2026-10-19 构建配置迁移

Host 的 `tsdown.config.ts` 将已弃用的 `external: ['playwright']` 替换为 `deps.neverBundle: ['playwright']`。依据当前安装的 tsdown `0.23.0` 实现，旧字段原本就被转换为 `neverBundle`；本轮不升级依赖或修改客户端构建方式。

迁移前后四个产物（Host/Client JS 与类型声明）的 SHA-256 完全一致，构建不再出现 `external` 弃用警告。`pnpm pack --dry-run --json` 与实际 tarball 检查通过：仍只有预期的 8 个文件；包内产物与本地构建一致，Host 保留 `playwright` 外部导入，运行依赖仍锁定为 `1.62.0`，Client 保持 Web ModuleLoader 包装。Host 可导入且导出 `apply/name/inject`，两个 JS 文件均通过语法检查；未在 Node 中执行仅供浏览器使用的 Client。完整格式、lint、类型检查、构建与 654 项测试通过。

本轮以产物字节一致和包边界检查验证配置迁移，没有重跑真实 Web 矩阵；运行时证据仍以此前验收为准。临时检查最初误断言 Host 应有默认导出，核对源码后改为校验实际命名导出，未因此修改产品代码。迁移与记录已审核并提交为 `702fe16`。

## 2026-10-19 预览版本准备

已准备 `0.1.0-preview.1` 元数据与 Changelog，支持基线明确限定为 DSH Web `0.1.5-rc.2`，分发方式为人工安装本地 tarball。新增 Changelog 后预期包内容为 9 个文件；此前配置迁移的 8 文件检查是旧候选的历史结果。安装、回退、功能矩阵、官方最新版核查和完整剩余工作统一见 [release-preview.md](release-preview.md)。本轮不升级运行依赖、不改变聊天实现，不执行发布操作。

预览候选已在全新临时 DSH_HOME 中完成安装、正常首次引导（Continue → Configure later，无需填写模型密钥）、打开 Companion 未登录界面、卸载及基础 Web 重启复验；Host 为 `login_required / logged_out`，消息 0、页面错误 0，退出后隔离 Chromium 主进程 0。完整检查与 654 项测试通过；最终文案和元数据归档检查通过。本轮不包含已登录聊天矩阵的重跑，仍待 Review 与发布批准。

## 2026-10-20 新版 Web 兼容候选

preview.1 准备已提交为 `a4b589c`。本轮 preview.2 完成新旧公开 Session 结构适配，六个 DSH 类型依赖更新至固定 `0.2.1-rc.2`，增加 13 项 Client/Controller 回归测试，总计 667。两个 Web 版本的干净安装、未登录 Dock/Float/Pop-out、Fetch 与 SSE EOF 重连已通过，新版非空 Session 的 rightbar 已通过官方本地 mock 验证。全新 profile 未使用已有认证目录，尚未重跑新版已登录聊天/图片/恢复完整矩阵。安装向导差异、全部验收边界和后续发布门禁见 [web-compatibility.md](web-compatibility.md)。

### 用户授权后的已登录复验

用户明确允许复制 `companion-test` 浏览器 profile 后，使用临时副本完成新版已登录核心矩阵：Markdown/流式、Deep Think、Search、跨窗口 Stop、图片上传发送/历史显示/文件名降级、SSE 重连保留消息与草稿，以及空闲/流式中终止 Chromium 后恢复。原 profile 不变，不读取或打印认证信息；本轮无需进一步修改产品代码。详细计数、故障注入边界、测试会话与剩余项见 [web-compatibility.md](web-compatibility.md#用户授权后的已登录补充验收)。

### 2026-10-22 审核收口

兼容实现、测试与上述证据完成审核，本阶段以一个原子提交保存。完整格式/lint/类型/构建/667 项测试、diff 与最终包边界检查重新通过；本次不重跑已登录真机矩阵、不创建版本节点或发布。下一阶段优先做 preview.1 → preview.2 的升级与回退验收，未覆盖场景仍按兼容记录保留。

## 2026-10-22 升级/回退验收

在共同宿主 Web `0.1.5-rc.2` 上，同一隔离 profile 与一次授权复制的浏览器目录完成 preview.1 → preview.2 → preview.1。三次启动均保持登录，旧历史身份和内容一致；每阶段新聊天、窗口、SSE 重连与资源退出通过，页面和控制台错误均为 0。共 3 个短测试轮次，无自动重发。源 profile 不变，副本和备份已清理；无需产品代码变更。范围、具体计数与复用步骤见 [upgrade-rollback.md](upgrade-rollback.md)。此结果不覆盖宿主升级/降级。验收文档已与三阶段计数核对并完成审核，本阶段以一个原子文档提交保存；提交前完整工程门禁与 667 项测试重新通过，本次审核不重复真实聊天验收。

## 范围边界

### 2026-10-22 FR-1 安装路径补充

首版计划已提交为 `899607f`。新旧固定 Web 均已通过官方 bundle 的干净安装 / 自动激活、已有匹配 Chromium 的登录入口与三窗口、卸载 / 重启和退出清理；旧版宿主补做官方命令的 preview.1 → preview.2 切换。新增缺浏览器提示、随包图标和官方索引校验，包内容更新为 10 文件，运行依赖不变。源码仓库及个人 Pages 已确认；2026-10-23 用户确认 npm 登录用户名为 `caelum-maple`，包与草案作者字段已同步。同日用户协助取得官方 Chromium ZIP，经摘要 / CRC / 版本校验后，官方 CLI 在新空缓存安装完整 Chromium 和 FFmpeg；新版 Web 的启动、登录网页唤起、三窗口与退出清理通过，页面 / 控制台错误及 Chromium 残留均为 0。CDN 大文件自动下载的网络限制单独保留，项目索引未部署。FR-1 已提交 `d837971`。步骤、免费资源创建与精确边界见 [market-installation.md](market-installation.md)，进度以 [first-release.md](first-release.md) 为准。

### 既有验收范围

- 本轮只验证 Web；Windows、Linux、DSH Desktop 和多账号不在验收范围内。
- 干净 profile 只验证安装、注入和未登录态；发送及恢复使用已登录的隔离副本。
- 此记录不等同于 Phase 25 的完整回归或正式发布批准。

## 2026-11-03 FR-2 旧请求错误竞态修正

上轮进入 `recovering` 时清空本地错误的实现尚未闭环：旧 HTTP 请求可在恢复开始或结束后才返回失败，并重新写回提示；恢复开始也不足以证明请求已经恢复。因此首版清单撤回了该项完成勾选，等待真机复验。

本轮 Host 的发送失败响应新增本轮 `assistantMessageId` 与 `instanceId`，Client 保留错误身份并读取同一 Host 的同一条 assistant 状态。只有 `finished` / `interrupted` 才解除该错误；已解除的错误从本地状态移除，后续切换历史不会重新出现。HTTP 与状态推送任意先到都采用同一判断；恢复失败、其它消息完成、身份无法确认、旧协议和普通操作错误保留原原因。不使用错误文本匹配或延时隐藏。

自动测试串联真实 Host 发送失败、HTTP 响应解析与状态存储的原地 reconcile，覆盖错误先到及恢复结果先到、恢复失败、实例 / 消息身份不匹配、旧响应和非 JSON / 空响应。已观察到 HTTP 错误丢失消息身份的断言失败，再补实现通过。此轮没有重跑已登录浏览器故障注入，不将自动测试结果视为新版 / 旧版真机通过；完整 FR-2 仍进行中。

本轮最终检查：格式、lint、类型、Host / Client 构建、678 项自动测试及 `git diff --check` 全部通过。审核了 Host 错误响应到 Client 展示的身份链路及旧响应降级，未发现本次变更中的其它可执行问题；渲染界面及真实页面故障后的效果仍待真机复验。尚独立复审在修复后只读复核（无 Blocker）：修正 `architecture.md` 中"卡片显示 `error` 文案"的旧口径，并为浏览器回归补上 `title` 接线断言、为单测补空串 / 残留 `error` 分支；复审后 696 / 696、8 / 8 与各工程门禁重跑通过，`lib` 两文件仍与 RC-C 归档逐字节相同。未提交或发布。

## 2026-11-03 FR-2 已登录恢复提示真机复验

本补充更新上节的待验收状态，本轮没有改动产品代码。使用同一个实际归档安装到新旧独立临时 `DSH_HOME`，并依用户既有授权复制 `companion-test` 浏览器目录；源目录不变，不读取或输出认证内容。Browser plugin not available，使用仓库 Playwright `1.62.0`，Chromium `151.0.7922.34`，macOS、Node `22.20.0`，视口 `1440 × 900`。宿主页标题均为 DeepSeek Harness，实际打开 Companion 输入区，无空白 / 框架错误覆盖层。

候选为 `0.1.0-preview.2`，归档 SHA-256 为 `4e74b385785d0eb7fc728dc29b875b79a743294415bed4afbdebca4deae0afc2`。归档、状态计数与截图保存在 Git 忽略的 `dist/release/fr2-20261103/`，不包含登录 profile、认证信息或真实会话 ID。

步骤：正常完成宿主引导，通过 Companion UI 发送约 350–400 字短回复请求；观察流式正文后只终止当前隔离 profile 的唯一 Chromium 主进程。Playwright 拦截并真实转发该次 Companion chat POST，在拿到原 Host HTTP 500 后暂缓交付，等待真实 Host 恢复结束，再放行该响应。未修改响应正文、Host 状态、IDB 或 DeepSeek history 请求。

| 场景                           | 恢复耗时 | Host 最终结果                                                                                | 迟到错误交付后的界面                                 | chat POST / pageerror |
| ------------------------------ | -------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------- | --------------------- |
| 新版 `0.2.1-rc.2` 首次四段文本 | 4534 ms  | online；原消息 ID 保持，reconcile 因 `assistant content diverged` 跳过，assistant 保持 error | 原错误保留 1 条，未误报完成                          | 1 / 0                 |
| 新版 `0.2.1-rc.2` 单段纯文本   | 23841 ms | online；同一 assistant 原地 finished，消息 ID 保持                                           | 迟到 HTTP 500 携带匹配的消息 / 实例身份，旧错误 0 条 | 1 / 0                 |
| 旧版 `0.1.5-rc.2` 单段纯文本   | 4147 ms  | online；同一 assistant 原地 finished，消息 ID 保持                                           | 迟到 HTTP 500 携带匹配身份，旧错误 0 条              | 1 / 0                 |

三次运行均观察到 recovering，每次仅发起一次 chat POST；控制台各有 1 条错误，记录于主动故障和 HTTP 500 运行中，未将 console error 数记为 0。成功分支的截图已目视核对：正文和输入区可见，无过期 Target-closed 提示。首次正文不匹配的运行不能算作补全成功，也不能被后两次成功覆盖；它证明身份 / 内容无法严格确认时继续保留原消息和错误。未扩大 strict matching 或历史分支解析范围。

旧版环境准备边界：重新安装 CLI 时，其内部 `^0.1.5-rc.2` 依赖解析到了 rc.3；默认 live profile 在打印启动 URL 后因 `user patch-layer watching requires the Cordis HMR service` 退出，未计为通过。在临时工具目录固定官方 rc.2 的 DSH 内部依赖后，live HMR 仍出现同一错误。根据该版官方 profile manifest 的公开配置，改用 `patchReload=startup` 后完成上述回归；不修改 DSH 源码，不将结果外推为默认 live HMR 或所有新安装环境通过。早期测试定位器按可见文本猜按钮名称，以及旧版尚未完成 Configure later 引导时曾等待超时，修正为实际 aria-label 并正常完成引导后才执行聊天；这些等待尝试未发聊天。

两版 DSH 正常停止后，本轮 profile 关联的 Chromium 残留为 0。临时登录副本、运行目录及含本地启动凭证的原始日志已清理，仅保留上述无认证证据。测试账号服务端保留 3 个 FR2 标记轮次，本轮未删除。当前仅关闭恢复提示这一项，FR-2 的删除 / 不确定、纯图片与草稿冲突、页面 close / crash / 失效分类及 Search 来源仍按首版清单继续。

## 2026-11-04 FR-2 会话恢复与不确定状态门控

本轮范围是 FR-2 第一项的代码缺口与针对性验收，未进入 FR-3。审查发现：`session_unverified` 只禁用了发送 / 图片按钮，Enter 仍进入发送函数、清空草稿并发出 POST；在线时打开的文件选择器在状态变为不确定后仍可上传。Host 虽拒绝聊天，附件新增与 Deep Think / Search handler 却未检查不确定状态，等待 readiness 的请求可继续写页面。

修复：发送与选图共享函数增加不确定状态判定，选择器回调复用禁用规则，FileReader 结束后读取最新共享状态；Host 的 add / toggle 在创建资源与调用页面前返回 409。显式 remove 保留清理用途，验证完成后原操作可重试。未修改身份算法、删除证据条件、deadline 或自动重发规则。新增 5 项自动回归，覆盖文本 / 纯图片门控、Host 零页面调用 / 零资源创建、确认后的重试及不确定状态下的显式移除；Client 两项实际渲染回归先 RED（均发出 1 次 POST，Enter 丢失草稿），同场景修复后 GREEN。

环境：macOS、Node `22.20.0`、Playwright `1.62.0` / Chromium `151.0.7922.34`，主要宿主 Web `0.2.1-rc.2`、视口 `1440 × 900`。Browser plugin not available，使用仓库 Playwright。候选 `0.1.0-preview.2` 经官方 bundle 命令装到临时 `DSH_HOME`；实际归档 SHA-256 为 `5c3ce3944614534400af9fa6fd8c5641f96084c223d6a0e87dbc527a03a477ad`。归档、截图和不含身份值的结果保存在 Git 忽略的 `dist/release/fr2-session-20261104/`。此次代码变化使此前归档摘要不再代表本轮产物。

| 验证层级 / 场景                     | 操作与结果                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 已安装主宿主：正常恢复              | UI 发起 1 个短测试轮次，完成后终止本轮 profile 唯一 Chromium；3662 ms 后 online，原会话及 2 条消息 ID 保持，notice=null，chat POST 共 1 次、pageerror=0。                                                                                                                                                                                                       |
| 已安装主宿主：真实删除              | 在另一隔离浏览器中按精确会话链接与测试消息标记确认本轮会话；用户明确授权后通过官方菜单和确认框删除。原 Host 尚保留会话与消息，composer 有 1 个实际上传 ready 草稿；随后终止原 Chromium，4237 ms 后 online / session_deleted，当前会话置空、消息与草稿均为 0。Dock / Float / Pop-out 删除提示一致，恢复过程 chat POST=0、pageerror=0；点击新建聊天后提示解除。   |
| Browser / settlement 集成：证据不足 | 使用现有 `onDiagnostics` 测试钩子将恢复目标文档受控重定向到根页，不返回 history 证据；运行真实 Browser recovery 与判定器，对种入的合成 Host transcript 得到 logged_in / location=empty / history=unknown / verdict=uncertain。实际 store 保留消息与会话，真实 chat handler 返回 409、页面发送次数为 0。此项为独立集成测试，不冒充已安装主宿主的整条恢复回调链。 |
| 已安装主宿主 Client：受控 SSE       | 只将真实共享快照中的 recoveryNotice 改为 session_unverified，通过持续 SSE fixture 交付给真实界面；Host 状态未改。三个界面均保留消息 / 提示 / 输入；Enter 的 chat POST=0；文件选择器跨状态、FileReader 读取期间跨状态的附件 POST 均为 0。所有聊天 / 附件写请求均拦截，不向 DeepSeek 误发。                                                                       |
| 自动 Host 回归                      | 不确定时附件 add、Deep Think / Search 返回409，不调用页面、不创建文件、不改状态；清除经确认的标记后重试成功。remove 仍清掉目标 state / record / 实际临时文件，保留不确定提示。                                                                                                                                                                                  |

删除前自动审批曾以不可逆远端删除且缺少具体授权为由拒绝操作；用户随后明确允许删除该唯一测试会话，才执行确认。没有删除其它会话。测试脚本最初误用 `/a/<id>`、以及未将文件输入定位在 Companion 区域，分别在身份检查 / 定位器严格模式处停止；修正为仓库既有 `/a/chat/s/<id>` 规则及精确区域后通过，不将这些尝试写成产品通过或缺陷。

上述分层验证完成时，首版第一项仍未完成：当时缺少真实主宿主中证据不足分支的完整端到端链路。该缺口由下节的后续复验关闭。其余纯图片 / 外部草稿冲突、页面 close / crash / 失效分类、Search 来源和总审核仍在 FR-2 清单中。官方 Desktop 未在本轮测试。

本轮最终工程门禁：`pnpm format:check`、`pnpm lint`、`pnpm typecheck`、`pnpm build`、`pnpm test`（683/683）及 `git diff --check` 均通过，受测归档的四个运行产物与最终构建逐字节一致。Client / Host 交叉代码审核未发现其它可执行问题。本轮临时登录副本和原始启动凭证日志已清理，正常停止后所属 Chromium 残留为 0。当前未提交或发布。

### 旧版共有界面回归

同一受测归档在独立 Web `0.1.5-rc.2`（官方 DSH 内部依赖固定 rc.2，公开 `patchReload=startup`）完成相同两个 Client 故障快照场景。最终复跑对齐 Node `22.20.0`、Playwright `1.62.0` / Chromium `151.0.7922.34`、`1440 × 900`；Companion 正常打开，Enter 的 chat POST=0、草稿保留、发送按钮禁用，跨状态选图的 attachment POST=0。console error / warning、pageerror 和框架错误覆盖层均为 0。此处明确使用合成 SSE 的 logged_in / online / unverified 快照，仅证明旧版真实渲染的 Client 门控，不声明真实站点登录或恢复链路；未复制认证 profile，也未发送真实消息。旧版首次引导再次出现 Configure later 时正常关闭后重跑，等待引导的尝试不计产品失败。`legacy-guard-counts.json` 和 `legacy-*.png` 与其余证据存放在同一忽略目录。此前 Node `25.8.1` 探索结果由上述 Node 22 最终复跑取代。

### 已安装主宿主：证据不足完整恢复链路

FR-1 已审核并提交为 `d837971`，FR-2 继续留在工作区，按阶段完成后再提交。本次只补第一项缺失的端到端证据，没有修改产品代码，也没有进入 FR-3。环境、归档及 SHA-256 与上节相同；再次通过官方 bundle 安装至独立 `DSH_HOME`，使用已授权测试 profile 的隔离副本。

通过真实界面发送一个短测试轮次并等待完成，核对专用测试标记后，终止本轮 profile 唯一 Chromium 主进程。恢复中，在目标文档已加载时，通过 Chromium 自带公开 AppleScript 窗口接口将该标签页正常导航到根页；没有修改 Host 状态 / 回调、SSE、IDB 或 history 响应，也没有读取认证信息。此故障注入验证的是**实际页面偏离目标、没有明确 not-found 证据**的完整不确定恢复链路，不声明 history 一定为 unknown。

实际已安装 Host 的恢复回调记录 `recovery location/history inconclusive; preserving Host transcript`；最终 online / logged_in / session_unverified，页面在根页。原会话对象（含标题）与两条完整消息逐项相等，正文、思考、状态和身份均保留，sending / stopping 为 false。Enter 未发出聊天请求且草稿保留；直接调用真实 Host 的聊天、附件新增、Deep Think、Search 均返回 409，消息和 composer 不变。Dock / Float / Pop-out 均显示保留记录提示及原消息；Pop-out 的 Enter 也保留草稿。显式新建聊天后 notice 解除、消息归零。

成功运行沿用同一测试会话，未再次发送聊天；聊天 POST 共 1 次，为明确测试 Host 拒绝的请求，自动重发为 0，主界面 pageerror=0。故障至三窗口门控检查和截图保存共 4247 ms，此计时包含验收动作，不作为纯恢复耗时。无认证结果与三窗口截图保存在 Git 忽略的 `dist/release/fr2-uncertain-20261104/`；原包保存在上节目录。

测试脚本曾因首次启动向导遮罩、Chromium 原生窗口尚未就绪而提前停止；等待实际向导 / 窗口就绪后继续。另一次已到达不确定状态，但脚本误读不存在的 `chat.stopping` 而停止；改为公开 `composer.stopping`，确认同一测试会话后整条复跑通过。上述均为验收脚本问题，未通过修改产品实现迁就测试。

会话三路径现在均有主要 Web 的实际宿主证据；此前分层测试与旧版 Client 门控证据继续保留其原有边界。下一项是纯图片 / 历史、外部网页草稿或删图冲突、失败附件 remove；之后仍需页面故障分类、Search 来源与 FR-2 总审核。官方 Desktop 未测试。

本次复验后完整门禁再次通过：format:check、lint、typecheck、build、683/683 自动测试及 diff 检查；受测包四个运行产物与新构建逐字节一致。审核当前 FR-2 diff 未发现新增可执行问题，剩余验收项继续开放。隔离 Host 正常停止后所属 Chromium 为 0；临时运行目录、登录副本及原始启动日志已清理，源 profile 与用户下载的 ZIP 保留。服务端本次专用短测试会话保留，未执行远端删除、push、tag 或发布。

## 2026-11-06 FR-2 图片安全验收

按首版计划仅完成 FR-2 的图片剩余项，没有新增功能或修改产品代码。macOS、Node `22.20.0`、Playwright `1.62.0` / Chromium `151.0.7922.34`、主要 DSH Web `0.2.1-rc.2`，Companion 视口 `1440 × 900`。沿用实际归档 `0.1.0-preview.2`，SHA-256 为 `5c3ce3944614534400af9fa6fd8c5641f96084c223d6a0e87dbc527a03a477ad`，通过官方 bundle 命令安装至新的隔离 `DSH_HOME`，测试 profile 仍用已授权的独立副本。Browser plugin not available，Companion 使用仓库 Playwright 驱动，DeepSeek 外部页面使用 CUA 原生 UI；未修改 Host / SSE / IDB / 认证内容，未直接调用站点上传或 history API。

| 场景               | 操作与结果                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 纯图片发送         | Companion 选取本轮生成的 240 × 160 PNG，Host ready；输入为空，关闭思考 / 搜索后点击发送。真实回复 finished，user 正文为空且仅有 1 个已验证附件，2 条消息，composer 为空。                                                                                                                                                                                                                                                                         |
| 立即切回历史       | 新建聊天后按本轮确切 ID 调用插件公开 switch 路由；仍为原会话，纯图片 user 消息未丢，附件恢复可验证历史 URL，Client 图片加载完成且像素宽度大于 0。聊天 POST 增量 0。不将该接口验证扩大为重复标题下的历史菜单定位验收。                                                                                                                                                                                                                             |
| 外部图片与文字草稿 | 在真实 DeepSeek 页用原生文件选择器加入另一张图片并输入本轮文字草稿，Host 没有对应附件。Companion 发送返回 409，Host chat / composer 与发送前逐项相等、消息为 0；原生页面仍保留外部文字和图片，未发送出去。                                                                                                                                                                                                                                        |
| 页面删掉托管图     | Companion 上传正常图片至 ready，再在真实网页中移除卡片。Companion 发送返回 409，原 Host ready 草稿和消息不变。此时单独移除因页面找不到目标卡片而返回 409，保留状态；这是既有安全拒绝规则，显式新建聊天后 Host 草稿清空。                                                                                                                                                                                                                          |
| 失败附件精准移除   | DevTools 的 Request conditions 仅阻断 `*://chat.deepseek.com/api/v0/file/upload_file*`；实际命中 1 个请求，页面显示上传失败，Host 在 10 s 上传等待结束后标记 error，临时字节文件为 0。撤销规则并关闭阻断后再上传一张正常图，得到 error + ready 两卡。UI 禁用发送，真实 Host 发送返回 409。Companion 点击移除失败卡片后，页面失败卡消失；另一张正常图的页面卡、完整 Host 条目及唯一临时文件保留。最后显式移除剩余草稿，Host 草稿和临时文件均为 0。 |

全程只有 1 个真实聊天轮次，chat POST 共 4 次：1 次纯图片成功、外部新增与页面删图各 1 次 409、失败草稿直接门控检查 1 次 409；没有自动重发。attachment POST 共 9 次，包含 5 次新增和 4 次移除，其中页面卡已不存在的一次移除返回 409。主界面 pageerror=0，4 条控制台资源错误对应上述 3 次聊天 409 与 1 次移除 409，不报告成“控制台无错误”。DeepSeek DevTools 阻断规则已删除、总开关已恢复关闭，没有留下全局网络设置。

最初验证使用损坏 PNG，但站点仍受理并返回 ready，因此没有把它计作失败卡片证据；该草稿已显式移除，失败验收改用上表的上传请求阻断。测试脚本曾因文件输入未限定 Companion、选图发生在新建聊天按钮尚未恢复，以及相同文件未清空输入而停止；更正定位、等待与输入后通过，均未调整产品实现。DeepSeek 根页的“新建聊天”会保留外部未提交草稿；外部冲突场景结束后正常刷新根页清理本轮未提交测试内容，不宣称新建聊天能删除站点外部草稿。

无认证 JSON 与 Companion 截图保存在 Git 忽略的 `dist/release/fr2-images-20261106/`；没有保存真实会话 ID、签名图片地址或启动凭证。本轮未改共有运行代码，未重跑旧版相同矩阵；旧版最终图片与变更共有路径仍由 FR-4 冻结包回归确认。其余 FR-2 下一项是页面 close / crash / 失效分类，之后是 Search 来源及阶段总审核。官方 Desktop 未测试，FR-2 尚未整体完成。

本轮 formatter / lint / typecheck / build / 683 项自动测试及 diff 检查全部通过；受测包四个运行产物与最终构建逐字节一致。按附件身份、发送前拒绝、失败与移除资源生命周期审核，未发现本项需要修改的可执行问题。正常停止隔离 Host 后所属 Chromium 为 0，临时 profile 副本与含本地启动凭证的原始日志已清理，源 profile 保留；本轮纯图片服务端会话保留，未做远端删除、提交或发布。

## 2026-11-06 FR-2 页面故障复验：待修复记录

已安装主宿主复验中，页面 close 与 renderer crash 分别约 2135 / 2026 ms 恢复，同一 Chromium 主进程和原消息保持，close 还清理了真实 ready 图片草稿与临时文件。`about:blank` 场景发现阻塞：主文档离开站点后，load 登录探测发布 error，Client 隐藏聊天 / 历史入口，单靠下一次操作的 readiness 无法自愈。本项仍未通过，不能因前两种故障成功而勾选。

本项修复计划沿用现有 FR-2 范围：先针对实际 Browser 生命周期接线补 RED 回归，覆盖主页面失效、iframe / 正常会话 / 登录导航不误恢复、旧页面迟到探测及 dispose；再在主文档跨 origin 时触发已有 single-flight recovery，探测结果增加 page epoch / dispose 检查。保留既有总预算、reconcile、身份与无自动重发规则。最终用新归档在已安装主宿主重新复验三种故障，核对包摘要、工程门禁和清理后，才能关闭此项。此计划与首版目标一致，不增加轮询或修改 DSH。

### 修复与当前阻塞

已完成 RED→GREEN：直接构建真实 `src/host/browser.ts` 并仅替换 Playwright 边界，原实现的 3 种失效导航与迟到探测隔离断言失败，修复后通过。最终新增 7 项测试覆盖 about:blank、其它 origin、站点名称前缀伪装域名、iframe / 正常会话 / 登录导航、恢复自身的初始空白页面、旧页面迟到探测、dispose 后结果，以及当前页面真实错误保留。测试不依赖已有 lib、浏览器缓存或认证 profile，临时构建目录在结束后删除。

实现只修改 `src/host/browser.ts`：精确 URL origin 判定用于健康探测与主 frame；非恢复期间的失效主文档主动调用现有 recovery，专用 reason 为 page-invalid；`runDetect` 捕获当次 page / epoch，过期和 dispose 后不发布探测结果。没有增加轮询、独立重试循环或重发，也没有改动共享恢复 / reconcile deadline。首版阶段与顺序保持不变。

新归档为 `0.1.0-preview.2`，SHA-256 `9f162c3fdc33b704bd51b40209c6f8262c4bd2943d6284f6da27d7ff2cea23b9`，保存在忽略目录 `dist/release/fr2-pages-20261106/`，四个运行产物与新构建相同，已通过官方 bundle 在隔离主宿主安装并核对已安装 Host 字节。仅恢复同一本轮专用会话，没有再次发送聊天。准备注入时 CUA 返回 Mac 已锁屏且无法自动解锁；已请求用户手动解锁。**新包 close / crash / 失效页的完整真机复验尚未完成，FR-2 此项继续不勾选**。本节开头 2135 / 2026 ms 属于修改前的旧归档 `5c3ce394…`，不能替代新包证据。

旧归档的失效页测试脚本最初等待历史按钮 / 响应超时并退出；检查真实 Host 和新开 Client 后确认是 offline / error 且只剩检测失败，属于产品缺陷而非简单改定位器。首次关注浏览器时使用 browser/show 会导航登录页并回到根页，随后已按本轮精确 ID 切回同一测试会话，再记录故障基线；没有操作其它历史会话。renderer crash 使用 Chromium 自带的 [公开调试 URL](https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/public/common/chrome_debug_urls.h)，没有调用 DSH 私有 API。

独立只读审核未发现本轮可执行问题，最终 7/7 生命周期测试通过。format:check、lint、typecheck、build、690/690 自动测试和 diff 检查均通过。旧版工具准备在临时目录进行，未升级全局 CLI；新包在旧版实际宿主中的共有恢复路径尚待复验。当前进度是“缺陷已修复，实际产物验收受锁屏阻塞”，不进入 Search 或 FR-3，也未提交、push、tag 或发布。

等待解锁期间已正常停止本轮 Host / Client 驱动，所属 Chromium 残留为 0；两个临时运行 / 工具目录、授权登录副本、私有会话定位文件和原始启动日志已清理，源 profile 与本轮远端测试会话保留。修改前截图与脱敏结果置于新候选目录内的 `before-fix/`，新包状态文件明确为 pending，避免把旧包结果混为修复后的通过证据。

## 2026-11-07 FR-2 新包页面故障验收闭环

用户确认解锁后，继续此前未完成的新包矩阵。实际归档仍为 `0.1.0-preview.2`、SHA-256 `9f162c3fdc33b704bd51b40209c6f8262c4bd2943d6284f6da27d7ff2cea23b9`，没有为复验修改产品代码。macOS、Node 22.20.0、Playwright 1.62.0 / Chromium 151.0.7922.34，Companion 视口 1440 × 900。Browser plugin not available：使用仓库 Playwright 观察真实 Host / Client / SSE，CUA 原生 UI 触发故障。新旧宿主均通过官方 bundle 安装相同归档；旧版内部 DSH 包及所需 peer 依声明固定 rc.2，Cordis 4.0.2，公开 profile 配置 patchReload=startup，全局 CLI 未升级。

先从插件公开列表中确认唯一“页面验收”候选，再按精确 ID 切换并核对本轮消息标记；没有猜测重复标题，也没有新增聊天。失效页直接从地址栏进入 about:blank，不调用 readiness 路由、不点击历史或发送，观察主动恢复。crash 使用 Chromium 公开 chrome://crash/；close 先保留一个空白标签页，仅关闭原 DeepSeek 页，明确区分页面重建与浏览器退出。

| 故障           | Web 0.2.1-rc.2 | Web 0.1.5-rc.2 | 共同结果                             |
| -------------- | -------------- | -------------- | ------------------------------------ |
| about:blank    | 4063 ms        | 1589 ms        | 自动 recovering → online / logged_in |
| renderer crash | 3369 ms        | 2834 ms        | 自动重建当前页面                     |
| page close     | 1277 ms        | 2371 ms        | 浏览器保持运行，页面重建             |

时长来自真实 SSE 首次 recovering 到随后 online 快照。每一项均逐项断言原会话 ID、消息 ID / 角色 / 内容 / 状态 / 附件等保持，允许补入已有设计的 deepSeekMessageId；同一浏览器主进程、notice=null，本地文字草稿保留。新旧运行段 Companion chat POST 均为 0，pageerror=0；没有自动重发、读取认证内容、修改 IDB / SSE / Host 快照或调用 DSH 私有 API。截图用于确认原消息及可用输入区，无框架错误覆盖层；本次未专门统计 console error，不能写作控制台 0 错误。

脱敏结果与截图分别保存在忽略目录 `dist/release/fr2-pages-20261106/primary-20261107/`、`legacy-20261107/`；before-fix 仍仅代表旧包。最初主宿主脚本因首次向导遮罩未关闭而停止，补足正常引导等待后运行；旧版 CUA 恢复操作后曾输入不完整地址，核对地址栏并精确设置为 chrome://crash/ 后才执行，不将未执行的注入算作通过。

页面故障这一项现已关闭；其余 FR-2 仍需 Search 正文 / 真实来源验证与阶段总审核，完成阶段后再按一个原子提交处理。未进入 FR-3、未提交或发布。

最终检查重新通过：format:check、lint、typecheck、build、690/690 测试与 diff 检查；四个运行产物与受测归档逐字节相同。已有独立生命周期代码 Review 继续有效，本轮未修改产品代码；核对了新旧六项断言和文档口径，未发现本项新增可执行问题。新旧隔离 Host / Client 正常退出后，本轮 Chromium 残留为 0；两个临时目录、登录副本及原始启动日志已删除，源 profile 和远端专用会话保留。

## 2026-11-07 FR-2 Search 正文与来源验收

本轮只补 FR-2 Search 项，没有修改产品代码或扩展引用解析。主要宿主 Web 0.2.1-rc.2，macOS / Node 22.20.0 / Playwright 1.62.0 / Chromium 151.0.7922.34，视口 1440 × 900；Browser plugin not available，使用仓库 Playwright 驱动真实 Companion，CUA 核对真实网页。归档仍为 0.1.0-preview.2、SHA-256 `9f162c3fdc33b704bd51b40209c6f8262c4bd2943d6284f6da27d7ff2cea23b9`，通过官方 bundle 安装至临时 DSH_HOME，登录 profile 使用已授权的独立副本。

通过插件公开开关路由确认 Deep Think=false / Search=true，再经真实 UI 发送 1 个 80 字内的 Python 官方 pathlib 文档搜索请求。页面显示“搜索到 12 个网页”，回复完成；等待既有 8 s 引用水合预算结束后记录状态，不为验收改 timeout。

- 原生网页点击实际引用 [9] 后打开 `https://docs.python.org/zh-cn/3.14/library/pathlib.html`，页面标题为 Python 官方 pathlib 文档；Host 返回 marker=9 的相同 URL，Client 两个 [9] anchor 及正文自带链接均精确指向该 URL。没有按编号、域名或位置另行猜 URL。
- 同一真实回答包含 [citation:4]，Host 没有对应 citation。Client 保留原正文和普通 [4]，对应 anchor=0，内部 [citation:*] 语法不暴露；Host 正文在只读复核前后逐字一致。
- 页面实际存在 [4] 引用，不能把本项写成站点没有给出来源，也不能宣称所有结构化引用已恢复。本轮没有逐项追溯其跳过条件；这是首版已约定的结构化 best-effort 未映射边界，保持安全降级。提升映射覆盖率须独立调查，不能为了成功率放松严格映射。

实际聊天 POST=1，pageerror=0，未自动重发。只读复核没有新增聊天；本轮未专门统计 console error，不报告成控制台 0 错误。截图确认正文、[4] 普通文本与 [9] 链接，没有空白或框架覆盖层。47/47 引用解析与 Client remark 针对性测试通过，覆盖缺失 / 非法 / 不明确链接返回空、普通编号降级、正文与代码保留。既有实现本轮无需改动，旧版实际 Search 未重跑；FR-4 仍对最终产物执行两版核心矩阵。

脱敏结果和两张 Client 截图保存在忽略目录 `dist/release/fr2-search-20261107/`，不含认证目录、会话 ID 或签名图片 URL。Search 项关闭后，FR-2 只剩阶段总审核；当前未提交或发布。

本轮完整 format:check / lint / typecheck / build / 690 项测试及 diff 检查通过，受测四个运行产物与新构建一致。审核引用严格映射与 Client 未映射编号降级，未发现本项新增可执行问题。正常停止后本轮 Chromium 为 0；临时运行目录、登录副本和原始日志已清理，源 profile 与专用远端搜索会话保留。

## 2026-11-07 FR-2 阶段总审核

审查基线为 `d837971` 到当前 worktree，覆盖全部产品 / 测试 diff 及 4 个新增未追踪文件（错误生命周期模块及 3 个测试文件），没有将 HEAD~1 的 FR-1 改动混入。按 review 与 requesting-code-review 工作流完成调用链检查和独立只读审查，未发现可执行问题，本轮不需要新增产品修复。

核对结果：旧请求错误只由匹配 Host 实例与 assistant 的完成 / 中断证据解除；Client 键盘 / 选图与 Host 附件 / 开关门控保持一致，显式移除继续按精确身份确认。主 frame 失效沿用已有 single-flight、恢复自身导航 suppression 和 epoch；过期登录探测与 dispose 后回调不发布状态。reconcile 仍使用同一 30 s deadline、最多一次前端刷新，malformed / no-entry 不刷新；Browser Recovery 的 60 s 重试预算与 reconcile 语义保持分离。没有引入聊天自动重发或 destructive transcript replace。附件按记录消费 / 清理，SSE abort、reader 与重试 timer dispose 的所有权未改变。

完整 format:check、lint、typecheck、build、690/690 自动测试与 diff 检查重新通过；独立审查另外执行错误、聊天响应、Browser 生命周期、附件及两个开关的 89/89 针对性测试。实际候选 `9f162c3f…` 四个运行产物与本轮新构建逐字节相等，重新读取两版页面恢复六项和 Search 正负断言结果，计数与记录一致。没有重新制造已通过的聊天、删除或故障场景。

审核结论：FR-2 的清单完成，状态为已审核、待原子提交；本轮没有 commit / push / tag / 发布。阶段证据涉及不同归档，按变更影响复用；不能写成所有矩阵均在同一个最终发布包上通过。Browser 共有路径的最新改动已在两版实际宿主验证，纯图片 / 外部冲突 / Search 最新实际记录以主要宿主为准；三窗口 UI、主题、键盘与动画的完整验收在 FR-3，最终包两版核心矩阵在 FR-4。Search 未映射编号、parent=null / 分支历史 safe-fail、旧版 startup 配置以及 Desktop 未支持等既定边界继续保留。

下一步先保存 FR-2 原子提交，再进入 FR-3：根据实际截图审核 DSH 风格 UI / 轻动效方案，批准范围后实现。不能把阶段 Review 通过当作市场已发布或最终 RC 验收通过。

### FR-2 原子提交收口

用户选择继续下一步后，本次按既定顺序保存已审核 FR-2 的一个原子提交，提交前重新运行全部工程门禁，范围仅为本阶段产品、测试及进度文档。不推送、不打 tag、不发布。FR-3 仍未开始，下一步先做实际截图与 UI / 轻动效方案审核；不将提交视为最终包发布矩阵通过。

## 2026-11-08 FR-3 界面与轻动效收口

用户批准方案后，完成三窗口共享样式 / SVG 控件、Pop-out 实时主题与字体字号继承、输入区层级、120–160 ms 轻动效和 reduced-motion。补中文组合输入保护、历史菜单 ownerDocument / 方向键 / 加载中 Esc 焦点、阅读历史不抢滚动及底层错误提示收口；Host 恢复和写门控协议未变，运行依赖未变。

主宿主 `0.2.1-rc.2` 验证官方浅 / 深 / 系统、正文 / 代码字体与字号、三窗口、拖动 / resize、390 × 700、键盘焦点与组合事件；兼容宿主 `0.1.5-rc.2` 验证其主题 / 正文字号及缺失能力回退。同一归档 SHA-256 为 `a2e73859398e833d33b45278641d1b3552fc18b015211e3ab3966a553c4ba23f`，四个已安装运行产物均核对当前构建。真实聊天 POST 增量 0，pageerror 与控制台 error / warning 均为 0。另通过 Chromium 公开设置验证 150% 原生缩放下三窗口输入和布局。

695 / 695 自动测试、8 / 8 本地协议浏览器检查及全部工程门禁通过；独立 Review 的两项 Medium（方向键抢焦点、状态样式层叠）和慢历史响应下 Esc 焦点问题均已 RED→GREEN。截图、精确环境、旧版固定 peer 图、失败尝试与验收边界见 [FR-3 记录](fr3-ui-design.md)。操作系统真实输入法与最终包聊天 / 故障矩阵留在 FR-4，未将受控状态或只读历史视为真实故障复验。本阶段待 Review、未提交或发布。

### 2026-11-09 FR-3 提交前审核

用户明确授权审核并提交。复核 `f55a76a` 后全部 FR-3 代码 / 测试 / 文档及新增文件，未发现新的可执行问题，无新增产品修复。完整工程门禁、695 / 695 自动测试、8 / 8 本地协议浏览器检查再次通过；四个当前构建产物与上述实际受测归档逐字节一致，沿用既有安装包真机证据，本轮未重跑远端聊天或故障注入。

本次以一个原子提交保存 FR-3，不执行 push、tag 或发布，不进入 FR-4。真实中文输入法人工验收、最终冻结包完整矩阵与市场实装仍按首版计划继续。

## 2026-11-10 FR-4 已开始（未完成）

本地版本与市场草案同步 `0.1.0`，官方 latest 已为 `0.2.2-rc.1`，公开接口调查后继续限定 `0.1.5-rc.2 || 0.2.1-rc.2`；不在本阶段扩兼容或更新全局 CLI。已跑新旧 RC-A 实际核心 / 图片 / SSE / 空闲恢复、主基线流式原地回填、两版外观 / 窄屏 / 原生缩放，并精确核对主基线来源 URL。完整工程门禁及 695 自动测试、8 本地协议 UI 检查通过。

用户说明改为稳定文案后生成 RC-B，仅 README / Changelog 与 A 不同，已核对其它八项相同并通过独立安装 / 卸载和静态升级 / 回退登记；实际矩阵按归档记录，不冒充 RC-B 已全部通过。原生中文输入法已获人工确认，唯一测试会话由用户手动删除，完整删除恢复未计为通过；两版 RC-B → preview.2 → RC-B 的逐段真实启动、登录保留与历史恢复已通过，六次启动均无新增聊天、pageerror=0，停机后专属 Chromium 为 0。剩余故障 / 冲突、完整卸载 / 重启及临时目录清理尚未关闭。具体摘要、计数、失败尝试和交接见 [FR-4 候选记录](fr4-release-candidate.md)，拟公开内容见 [发布审阅单](fr4-publish-review.md)。当前不提交或发布。

## FR-4 最终包页面故障补验

RC-B 在两版固定 Web 的 about:blank、renderer crash、page close 六项均通过，约 1.5–3.2 s 恢复；逐项比较原会话和消息字段、本地文字草稿，无自动重发，chat POST=0 / pageerror=0。正常停止驱动与 Host 后专属 Chromium 为 0，未改产品代码。精确归档、时长、方法和未验边界见 [FR-4 候选记录](fr4-release-candidate.md)。完整 FR-4 未关闭，未提交或发布。

## FR-4 最终包外部草稿冲突补验

RC-B 在两版固定 Web 均通过外部图片 / 文字草稿安全拒绝，以及外部刷新导致托管卡丢失后 send / remove 拒绝、显式 new 清理。每版经公开接口主动发送尝试 2 次均 409，前端无额外 chat POST，Host 消息未增加，pageerror=0；正常停止后专属 Chromium 为 0。未改产品代码，精确边界见 [候选记录](fr4-release-candidate.md)。官方 Desktop 仅做只读安装与兼容调查，当前未支持，见 [分析](desktop-compatibility.md)。

## FR-4 RC2 真实删除恢复补验

用户另行明确批准 `FR4_DELETE_20261110_RC2` 后，Agent 仅删除这一条一问一答测试会话。主基线 RC-B 的原 Host 两消息 / 一 ready 附件基线在远端删除后仍保留，终止所属 Chromium 后实际恢复至 session_deleted，会话 / 消息 / Host 附件清空；三窗口提示及显式 new 解除提示通过，无自动重发。首次驱动误要求清空本地未发送文字，核对既有保留设计后纠正测试假设，未改产品代码；分段观察和缺失计时不掩盖，见 [FR-4 记录](fr4-release-candidate.md)。不确定恢复两次注入未命中，仍待最终包验收；本轮未扩展旧版独立实删声明。测试实例已停止，专属 Chromium 为 0，未提交或发布。

## FR-4 最终包不确定恢复与写门控补验

RC-B `0.1.0`（SHA-256 `16a25c92…`）在主基线 Web `0.2.1-rc.2` 的**已安装宿主**中完成此前未命中的证据不足分支：只 SIGKILL 隔离测试 profile 的唯一 Chromium 主进程，并在恢复用新浏览器进程加载回目标会话后被真实导航到站点根页，结算读到 `location=empty`、history 无明确证据 → `session_unverified`（kill 到结算 6448 ms，一次命中）。原会话与两条消息逐项保留，注入前本地文字草稿保留；Dock / Pop-out 的 Enter 均未发请求且文字不丢；三窗口提示一致。直接请求真实 Host 的 chat、附件新增、Deep Think、Search 四条写接口均返回 409 `recovered session is unverified`，状态与开关不变，前端写请求与自动重发均为 0；显式历史切换后提示解除、转录恢复且真实发送成功，显式新建后提示保持解除、消息归零。

方法边界需保留：恢复期间所有导航型公开路由都会在 `ensureReady()` 处等待单飞恢复 promise，因此没有 HTTP 注入面；本会话 AppleEvents 被系统拒绝，改用公开辅助功能 API 读地址栏 / 置前窗口 / 写入地址栏，未改 Host 快照、SSE、IDB、恢复回调或站点历史响应。一次失败尝试把视图切换放在 Enter 门控之前，DSH 各视图各自持有 composer 文字导致误判；复核确认 Enter 本身不清空草稿后只调整验收顺序，未改产品实现。旧版 `0.1.5-rc.2` 未重跑真实不确定链路。精确摘要、断言表、失败记录与截图位置见 [FR-4 候选记录](fr4-release-candidate.md)。当前未提交或发布。

## FR-4 最终包浏览器前置、卸载 / 重启与清理补验

RC-B `0.1.0`（SHA-256 `16a25c92…`）在两版固定宿主完成安装 / 退出矩阵，未改产品代码。空缓存用独立的 `PLAYWRIGHT_BROWSERS_PATH`（空临时目录，不动用户共享缓存）验证：主基线为 `offline / browserReady=false`，Dock 显示 Chromium 安装指引，零 Chromium 进程、pageerror=0；前置完成后 `online / browserReady=true`、输入区可用。全新 profile 当前被站点直接授予匿名会话，`browser/show` 导航到 `/sign_in` 又被回跳根页，因此本轮没有观察到首次登录入口——按站点行为边界记录，不写成通过或缺陷，入口证据仍由 FR-1 承载，实际登录凭据输入未执行。

两版均执行官方 `plugin --profile web remove` → 重启：插件目录与 bundle 登记移除，Dock 入口消失、Companion 路由 404、日志无插件加载、未启动 Chromium；再装回同一归档后入口 / 路由恢复、日志单次加载、连接回到 `online`。卸载未删除 `DSH_HOME`、`.credentials.yaml`（SHA 相同）、sessions、cordis 配置、其它 bundle 与两个浏览器登录副本；插件上传目录保留且为空。停止后宿主 0、专属 Chromium 0。工具侧需要 `npm_config_store_dir` 指回原 pnpm store（本会话沙箱导致 store 漂移），且 tarball 需绝对路径；这两条是环境说明，不是产品结论。完整结果见 [FR-4 记录](fr4-release-candidate.md) 与 `dist/release/fr4-20261110/install-exit.json`。当前未提交或发布。

## FR-4 证据覆盖复核

新增 [最终产物证据覆盖复核](fr4-evidence-coverage.md)：先按归档运行文件（`lib/index.js` / `lib/client.js`）与 RC-B 的逐字节关系分类，再逐矩阵项说明复用依据。RC-A（`84b92175…`）与 FR-3 `final-ui`（`a2e738…`）运行文件与 RC-B 完全相同，可直接复用；FR-2 图片 / 会话归档（`5c3ce394…`）Host 与 Client 均不同，只在受影响源码未变且有补充证据时复用。本轮在最终包补验**两张真实 ready 卡精准移除一张**（另一张条目、页面卡与临时文件保留）。仍未验：站点真实拒绝上传产生的 error 卡、网页真实点击删卡在最终包上的复跑（宿主未暴露网页内容 AX 树）、旧版真实删除 / 不确定链路。未改产品代码，未提交或发布。

## FR-4 终审缺陷修复与 RC-C 重冻

用户协助的真实失败上传卡验收在 RC-B 上暴露真实缺陷：失败卡把 Host 传来的内部原因原文（实际是 Playwright 的 `page.waitForResponse: Timeout 10000ms exceeded…`）直接显示在用户文案里，违反 FR-3 已勾选的「用户文案不直接堆叠 Playwright 堆栈」。定位为 `src/client/attachment-ui.ts` 的 `attachmentStatusText()`；最小修复为固定展示「失败，请重试」，原始原因改由新增纯函数 `attachmentCardTitle()` 放进卡片 tooltip，Host 协议、写门控与状态结构均未改。先补 RED 单测与浏览器回归（发布含 `waitForResponse` 的失败卡，断言界面无该文本、出现「失败，请重试」）；修复后 696 / 696 自动测试与 8 / 8 浏览器检查通过，`lib/index.js` 哈希不变、`lib/client.js` 变更。

重新冻结为 RC-C（SHA-256 `2cf6a441…`，十文件包，与 RC-B 只差 `lib/client.js`），并在 RC-C 重跑受影响矩阵：真实不确定恢复、两张 ready 卡精准移除、真实失败上传卡（修复后文案）、网页真实删卡、两版卸载 → 重启 → 重装，全部通过。受影响的附件 / UI 证据现与最终归档一致；不受该差异影响的项按"受影响源码未变"复用 RC-A / RC-B 证据。用户已删除 DevTools 阻断规则，测试宿主停止、专属 Chromium 0、含启动凭证日志 0；收尾时先留档脱敏清单（`temp-runtime-cleanup.json`）再销毁整个临时验收环境（含带登录态的浏览器 profile），删除后核对无其它 `dsh-fr4-*` scratch 根。未提交或发布。

## 2026-11-11 支持范围风险补证与决策

同一 RC-C 的旧版真实删除 / 不确定恢复与四个写接口门控补验通过，清理临时根后所属 Chromium 为 0。空 profile 登录入口再次无法观察，用户明确接受站点行为边界、不宣称入口实测通过。支持范围与风险决策项已关闭，证据和限制见 [候选记录末节](fr4-release-candidate.md)；未改产品代码、未提交或发布。

## 2026-11-11 FR-4 最后 Review 与文档收口

统一当前候选为 RC-C，更新首版阶段清单、发布审阅单与交接入口；旧版补证和用户接受的首登入口边界已纳入，旧时间点的记录保留为历史，不再作为当前未完成指令。最后 Review 未发现新增可执行问题，FR-4 本地验收完成、待明确提交授权，未提交 / push / tag / publish，未部署索引或执行 Discover 市场实装。后续 FR-5 仍需公开发布当天版本复核、账号权限和具体目标批准。
