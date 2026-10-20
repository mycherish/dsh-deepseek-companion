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

## 范围边界

- 本轮只验证 Web；Windows、Linux、DSH Desktop 和多账号不在验收范围内。
- 干净 profile 只验证安装、注入和未登录态；发送及恢复使用已登录的隔离副本。
- 此记录不等同于 Phase 25 的完整回归或正式发布批准。
