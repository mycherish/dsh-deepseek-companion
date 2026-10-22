# Changelog

## 0.1.0-preview.2 — 未发布候选（2026-10-20）

- 适配 DSH Web `0.2.1-rc.2` 的公开 Session 列表结构，保留 `0.1.5-rc.2` 的 `current` 选择；新版通过唯一的 `retainedBy.mainView` 判断主视图，无有效证据时使用 overlay。
- Dock 仍只在打开时选择一次 Surface；关闭后重新打开才重新判断，不读取 DSH 私有 UI 状态。
- 六个 DSH 开发类型包升级并固定至 `0.2.1-rc.2`，开发 Cordis 更新至 `^4.0.5`，运行 peer 保留 `^4.0.2`；精确声明两个 Web 运行时版本。
- 增加 13 个真实 Client 构建/Controller 回归场景，自动测试总计 667；完成新旧 Web 干净安装、Dock/Float/Pop-out、SSE EOF 重连，新版用官方本地 mock 验证非空 Session 的 rightbar。
- 新版首次引导改为可关闭的 Get started 弹窗；用户授权测试 profile 副本后，新版已登录核心矩阵通过（文本/Markdown、Deep Think/Search、跨窗口 Stop、图片历史/失败降级、SSE、空闲及流式中 Chromium 恢复）。会话删除等边界和升级/回退仍待验收，官方 Desktop 未支持。验收边界见 `docs/web-compatibility.md`。

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
