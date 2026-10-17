# dsh-deepseek-companion

DeepSeek Web Companion plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH)。

> 当前状态：Developer Preview / Early Development

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

当前只支持 DSH Web。先在本仓库构建并打包，再把 tarball 安装到要运行的 DSH profile：

```sh
pnpm build
pnpm pack
PACKAGE_TGZ="$(pwd)/dsh-deepseek-companion-0.0.1.tgz"
cd "${DSH_HOME:-$HOME/.dsh}/profiles/web"
pnpm add "$PACKAGE_TGZ"
dsh --profile web --patch "${DSH_HOME:-$HOME/.dsh}/profiles/web/node_modules/dsh-deepseek-companion/cordis.patch.yml" --no-open
```

`pnpm add` 只安装包；`--patch` 才把 Companion 插入 Cordis 插件树。若要每次启动都加载，可将包内 `cordis.patch.yml` 的 `insert` 项合并到该 profile 现有的 `cordis.patch.yml` 列表中，保留原有条目。首次使用新 profile 时，Companion 会显示 DeepSeek 登录入口。

打包安装与真实 Web 烟测记录见 [docs/release-hardening.md](docs/release-hardening.md)。

详见 [docs/roadmap.md](docs/roadmap.md) 与 [docs/architecture.md](docs/architecture.md)。
