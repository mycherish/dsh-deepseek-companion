# Web Release Hardening 验收记录

日期：2026-10-17。目标：验证当前 tarball 可在 DSH Web 中安装、加载和运行最小聊天链路；本次不扩展 Phase 21–25。

## 安装路径

1. `pnpm build` 后用 `pnpm pack` 生成 `dsh-deepseek-companion-0.0.1.tgz`。
2. 在从 DSH 官方 Web 模板新建的临时 profile 中，使用 `pnpm add <tarball>` 安装。仅安装包时插件不会进入 Cordis 树。
3. 应用包内 `cordis.patch.yml` 后启动 DSH Web，插件加载成功。将其中的 `insert` 项合并进临时 profile 的 `cordis.patch.yml` 后，不传命令行 `--patch` 再次启动也加载成功。安装命令见 [README](../README.md#web-插件安装预览)。

安装时 pnpm 报告 `@deepseek-ai/cordis`、`react`、`react-dom` peer dependency 缺失；干净 profile 中实际加载和注入均成功。发布前仍应在目标 DSH 版本上重复安装检查。

## 烟测结果

| 场景 | 结果 |
|---|---|
| tarball 内容 | 仅包含 Host/Client 的 JS 与类型声明、patch、package.json、README、LICENSE |
| 干净 profile | 打包插件加载，DSH Web 显示“DS快速聊天”；无登录态时状态为 `login_required / logged_out`，显示登录入口，页面无运行时错误 |
| 已登录 profile 副本 | Companion 状态为 `online / logged_in`；通过 UI 发送一条标记测试消息，得到一条已完成的 user 消息与一条已完成的 assistant 回复 |
| 历史图片 | UI 切换到图片测试会话后，Host 有 10 条消息、7 个附件；Client 的 7 个历史图片节点均加载成功 |
| 图片请求失败 | 拦截 `/api/file` 请求后，Client 保留 7 个文件名标签，图片节点与破图均为 0 |
| Chromium 故障 | 仅终止临时 profile 的唯一 Chromium 主进程；未刷新的 DSH Web 观察到 `recovering → online`，恢复后仍已登录，原会话、10 条消息 ID 和 7 个附件保持一致 |

验收使用本机 macOS、DSH Web、Playwright Chromium 与临时 profile。已登录场景使用测试 profile 的隔离副本；干净安装场景使用新建 profile。脚本只输出状态、数量和加载结果，不输出 token、cookie、签名 URL 或会话正文；用于目视核对的临时历史截图已随 profile 副本清理。原始 profile 未修改。

文本发送烟测在测试账号的 DeepSeek 服务端留下了一条以 `P0 release smoke 2026-10-17` 开头的测试会话；本轮未删除该会话。

## 范围边界

- 本轮只验证 Web；Windows、Linux、DSH Desktop 和多账号不在验收范围内。
- 干净 profile 只验证安装、注入和未登录态；发送及恢复使用已登录的隔离副本。
- 此记录不等同于 Phase 25 的完整回归或正式发布批准。
