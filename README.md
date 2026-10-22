# dsh-deepseek-companion

DeepSeek Web Companion plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH)。

> 当前候选：`0.1.0-preview.2`（兼容改动已审核，未发布）。macOS 上已验证 DSH Web `0.1.5-rc.2` 与 `0.2.1-rc.2` 的安装、界面与 SSE；新版已登录文本、Deep Think/Search、跨窗口 Stop、图片历史、SSE 和 Chromium 恢复核心矩阵已通过；插件升级/回退已在共同宿主 `0.1.5-rc.2` 验收，会话删除等边界仍待验收，官方 Desktop 未支持。范围与证据见 [新版 Web 兼容记录](docs/web-compatibility.md)，功能和剩余工作见 [预览版本说明](docs/release-preview.md)。

## 首版发布路线

当前目标是完成首个市场版本：**市场与安装准备 → 功能缺口与缺陷收口 → DSH 风格 UI 与轻动效 → RC 冻结验收 → 发布与市场实装**。Proxy、Handoff、Task Brief 和 Desktop 独立安排。后续工作统一按 [首版执行计划](docs/first-release.md) 推进，每次一个阶段，完成后测试、审核并更新证据。

官方 DSH 的 Discover 需要启用 Custom plugin markets 并添加索引源；本插件尚未公开发布或完成市场安装验收。首版按公开 npm 包与可添加的 HTTPS 索引准备，具体发布路径与完成条件见计划。

## 目标

在 DSH 中提供一个可停靠、可独立窗口打开的 DeepSeek 网页聊天工具（Companion），
复用用户自己的 `chat.deepseek.com` 登录状态进行聊天。

## 明确不是

- **不是** DeepSeek API Provider。
- **不是** OpenAI-compatible Gateway。
- **不消耗** DeepSeek API 余额；但仍受 DeepSeek 网页端本身的使用限制与风控约束。

## 当前进度

已完成 **Phase 01–08.2**：插件骨架与注入 → Host State / HTTP+SSE → 常驻浏览器与登录 → 文本聊天（流式、Markdown、Deep Think、智能搜索、引用、Stop、新建会话）→ 历史会话列表 / 切换 / 外部导航同步 → 统一状态模型收口。

已完成 **Phase 18A 图片发送**：在 Companion 里选择 PNG / JPEG / WebP / GIF → 经真实 DeepSeek 页面上传 → composer 显示 attachment card（**不显示像素缩略图**）→ 随文本或单独发送；发送时用 completion 请求的 `ref_file_ids` 精确校验，绝不谎报图片已发送。8 个核心场景已在真实环境验收；外部页面手动挂图/删图与失败卡片的删除流程由单测覆盖。**Phase 18B 历史图片恢复已实现**：历史 user 消息中的图片按同一 `.ds-message` 结构归属回填；纯图片消息保留；签名 URL 失效时显示文件名。真实 Chromium 的 3 个图文历史会话通过 reader 复验；2026-10-16 在临时 DSH Web/Chromium 中完成 Client 界面复验，图文混合、纯图片以及图片加载失败后的文件名降级均通过。详见 [docs/architecture.md](docs/architecture.md) 与 [docs/roadmap.md](docs/roadmap.md)。

已完成 **Phase 20A Browser Recovery**：DeepSeek 页面 / Chromium 异常关闭、崩溃、失联或失效后，Host 自动恢复（重建 page 或重启 persistent browser，复用同一 profile 保留登录态），不需要刷新 / 重启 DSH；恢复期间 `connection` 显示 `recovering` 并禁用发送，恢复完成后继续聊天，**绝不自动重发用户消息**。真实故障注入（page close / crash / about:blank / kill Chromium / 流式中 kill / 并发）已全部通过（详见 [docs/architecture.md](docs/architecture.md) 的 Phase 20 §0）。**Phase 20B1 会话回填已实现**：恢复后读取 DeepSeek 自身的 IndexedDB 会话快照，用三层 identity（已有 id / parent-anchor / strict bootstrap）绑定服务端 message id 并原地 patch —— 绝不 destructive replace、不丢附件、不重复消息、不自动重发。真机确认「不丢 / 不重 / 不重发 / 不 full replace」，并能在 commit 后崩溃与流式中崩溃两种情况下**原地补回服务端已完成的回复**：恢复后只让前端自己重新拉取一次 history（Host 仅做一次 bounded reload，不删 IndexedDB、不调 history API、不碰 token/cookie），idle 恢复不受影响（详见 [docs/architecture.md](docs/architecture.md) 的「实现与真机验收记录」与 §7.1）。**Phase 20B2 已实现**：仅在目标会话的前端 history 明确返回 not-found、页面重定向 `/` 且仍已登录时原子清理 Host 会话与消息；证据不足则保留消息、提示并禁用发送；成功恢复后从当前侧栏项刷新标题，三个界面显示恢复状态。正常/不存在会话恢复已用真实 Chromium 验证。

> 尚未实现：文件（文档）附件、代理、Task Brief 等；18B Client 已完成 Web 界面复验 —— 详见路线图。

已完成 **Web P0 Release Hardening** 的工程门禁、安装烟测与最小版回归，以及浮窗窄屏修复、SSE 断流退避重连和 dispose 清理。断流期间保留消息与输入，收到有效新快照后恢复操作；不自动重发聊天。已完成部分的证据见 [验收记录](docs/release-hardening.md)，预览发布准备与剩余验收见 [预览版本说明](docs/release-preview.md)。

## 开发

```sh
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm build
pnpm test
```

## Web 插件安装预览

当前 Web 候选的 `engines.dsh` 精确限定为 `0.1.5-rc.2 || 0.2.1-rc.2`，不是对所有中间版本或 Desktop 的支持声明。新版 DSH 的兼容性检查会拒绝超出声明的运行时；不要通过版本豁免绕过。先确认 `dsh --version` 为其中一个版本，在本仓库安装依赖和匹配 Chromium，再构建并打包：

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm build
pnpm pack --pack-destination dist/release
PACKAGE_TGZ="$(pwd)/dist/release/dsh-deepseek-companion-0.1.0-preview.2.tgz"
cd "${DSH_HOME:-$HOME/.dsh}/profiles/web"
pnpm add "$PACKAGE_TGZ"
dsh --profile web --patch "${DSH_HOME:-$HOME/.dsh}/profiles/web/node_modules/dsh-deepseek-companion/cordis.patch.yml" --no-open
```

`pnpm add` 只安装包；`--patch` 才把 Companion 插入 Cordis 插件树。若要每次启动都加载，可将包内 `cordis.patch.yml` 的 `insert` 项合并到该 profile 现有的 `cordis.patch.yml` 列表中，保留原有条目。首次使用新 profile 时，Companion 会显示 DeepSeek 登录入口。

以上安装目录应已由 DSH 初始化。`0.1.5-rc.2` 首次启动先点击官方测试提示的 **Continue**；模型配置可选择 **Configure later**。`0.2.1-rc.2` 的 **Get started** 弹窗可用右上角关闭按钮或 Escape 关闭。无需为使用 Companion 填写 DSH API Key。完成宿主向导后再打开 Companion 并登录 DeepSeek 网页。优先用隔离测试 profile 验收，并在停机后备份该 profile 的 manifest、lockfile 和 patch。跨机器安装时，需要在目标机器另行安装 Playwright `1.62.0` 对应的 Chromium。回退到 preview.1 时宿主须为 `0.1.5-rc.2`；本轮不覆盖 DSH 宿主本身的升级/降级。步骤和已知限制见 [升级/回退验收](docs/upgrade-rollback.md) 与 [预览版本说明](docs/release-preview.md)。

打包安装与真实 Web 烟测记录见 [docs/release-hardening.md](docs/release-hardening.md)。

详见 [docs/roadmap.md](docs/roadmap.md) 与 [docs/architecture.md](docs/architecture.md)。
