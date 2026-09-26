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

已完成 **Phase 18A 图片发送**：在 Companion 里选择 PNG / JPEG / WebP / GIF → 经真实 DeepSeek 页面上传 → composer 显示 attachment card（**不显示像素缩略图**）→ 随文本或单独发送；发送时用 completion 请求的 `ref_file_ids` 精确校验，绝不谎报图片已发送。8 个核心场景已在真实环境验收；外部页面手动挂图/删图与失败卡片的删除流程由单测覆盖（详见 [docs/architecture.md](docs/architecture.md) 的实现小节）。**历史会话里的图片恢复（18B）尚未实现**（历史消息里的图片仍不显示）。其余 Phase 见 [docs/roadmap.md](docs/roadmap.md)。

已完成 **Phase 20A Browser Recovery**：DeepSeek 页面 / Chromium 异常关闭、崩溃、失联或失效后，Host 自动恢复（重建 page 或重启 persistent browser，复用同一 profile 保留登录态），不需要刷新 / 重启 DSH；恢复期间 `connection` 显示 `recovering` 并禁用发送，恢复完成后继续聊天，**绝不自动重发用户消息**。真实故障注入（page close / crash / about:blank / kill Chromium / 流式中 kill / 并发）已全部通过（详见 [docs/architecture.md](docs/architecture.md) 的 Phase 20 §0）。**Phase 20B1 会话回填已实现**：恢复后读取 DeepSeek 自身的 IndexedDB 会话快照，用三层 identity（已有 id / parent-anchor / strict bootstrap）绑定服务端 message id 并原地 patch —— 绝不 destructive replace、不丢附件、不重复消息、不自动重发。真机确认「不丢 / 不重 / 不重发 / 不 full replace」，并能在 commit 后崩溃与流式中崩溃两种情况下**原地补回服务端已完成的回复**：恢复后只让前端自己重新拉取一次 history（Host 仅做一次 bounded reload，不删 IndexedDB、不调 history API、不碰 token/cookie），idle 恢复不受影响（详见 [docs/architecture.md](docs/architecture.md) 的「实现与真机验收记录」与 §7.1）。20B2（会话删除 / 标题 / 恢复文案）尚未实现。

> 尚未实现：文件（文档）附件、历史会话里的图片恢复（18B）、会话删除 / 标题 / 恢复文案（20B2）、代理、Task Brief 等 —— 详见路线图，不要再把未实现能力当作业已可用。

## 开发

```sh
pnpm install
pnpm typecheck
pnpm build
pnpm test
```

详见 [docs/roadmap.md](docs/roadmap.md) 与 [docs/architecture.md](docs/architecture.md)。
