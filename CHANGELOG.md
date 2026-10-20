# Changelog

## 0.1.0-preview.1 — 未发布候选（2026-10-19）

首个 Web 最小版预览候选，支持范围固定为 macOS、DSH Web `0.1.5-rc.2`、Node 22 与 Playwright `1.62.0` 的匹配 Chromium。该版本号不代表已发布或已通过最新版 DSH/官方 Desktop 验收。

### 已有能力

- 右侧 Dock、页面内可拖拽/缩放浮窗、独立浏览器窗口，共享 Host 状态。
- DeepSeek 网页登录持久化，文本流式聊天、Markdown/代码块、Deep Think、Search、Stop、新建及历史会话切换。
- PNG/JPEG/WebP/GIF 图片上传与发送、历史图片恢复、图片失效后的文件名降级。
- 页面/Chromium 故障恢复、按严格 identity 原地回填服务端回复、会话删除证据与恢复提示；不自动重发。

### 发布加固

- 修复新发图片立即切回历史时的页面临时图片地址问题。
- 修复窄屏浮窗边框造成的 2px 溢出。
- SSE EOF/请求失败自动退避重连，首个有效快照前禁用操作，保留消息和本地输入，完整清理连接与 timer。
- 接入 Prettier、Biome、类型检查、构建与测试门禁；迁移 tsdown 已弃用的 external 配置。
- 显式声明 `engines.dsh` 支持范围，采用本地 tarball 预览分发，随包附带本 Changelog。

- 补充干净 DSH_HOME 的首次引导步骤；通过官方 Configure later 路径即可使用 Companion，无需填写 DSH API Key。

### 已知限制

- 尚不支持最新版 DSH Web 与官方 Desktop；Desktop 的新窗口策略与当前独立窗口实现不兼容。
- Search 引用为 best-effort；未验证映射时不制造可点击来源。
- 极快连续发送的空 parent anchor 与树形历史仍 safe-fail；SSE 静默半开连接无主动心跳探测。
- 尚无文档附件、代理配置、DSH Composer Handoff、Task Brief、多账号或 Host 消息持久化能力。

源码中的历史 `v0.0.x` Git 节点属于开发进度记录，不据此声明已有公开分发版本。详细验收、兼容性来源和剩余工作见仓库的 `docs/release-preview.md`。
