# 官方 Desktop：安装路径与当前兼容结论

日期：2026-11-10。本轮仅分析官方产品，不分析社区 Desktop，不安装或修改用户 Desktop，不改变首版 Web 范围。

## 当前事实

- 本机 `/Applications/DeepSeek Harness.app` 的 Info.plist 显示版本 `0.2.2-rc.1`、bundle ID `com.deepseek.dsh`；应用内存在 `runtime/cli/bin/dsh`；只读解析应用归档中的 `desktop-runtime.json`，确认内置 `@deepseek-ai/dsh` / `dsh-desktop-host` 同为 `0.2.2-rc.1`，Node `24.21.0`、darwin arm64。这里只读检查应用元数据、运行描述和启动脚本，没有启动安装命令、读取认证或用户配置。
- 目前实际宿主验收全部是 DSH **Web** `0.1.5-rc.2` / `0.2.1-rc.2`。原生 CUA 操作的 Chrome 是 Companion 驱动的 DeepSeek 源网页，不是 DSH Desktop 验收。
- 插件 `engines.dsh` 仍为 `0.1.5-rc.2 || 0.2.1-rc.2`，不覆盖本机 Desktop 的版本。版本限制应保留，不能修改声明或绕过检查来代替兼容测试。

## 官方支持的安装入口

依据官方固定发行版的 [Desktop README](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.1/apps/desktop/README.md#bundled-command-runtime)：Desktop 有独立 `desktop` profile，由应用拥有；插件页使用共享插件管理器。应用自带 CLI 可在完全退出 Desktop 后管理该 profile，npm 安装的普通 dsh 不能修改它，CLI 也不能替代 Desktop 启动该 profile。首次应正常运行 Desktop 初始化，不能把未初始化的 desktop profile 建成普通 Web profile。

完成独立适配并通过 Review 后，可使用本地已批准归档，尚未发布 npm 不妨碍本地安装。以下仅是未来安装模板，**不适用于当前未经适配的归档，也没有执行**：

```sh
# 先从应用菜单完全退出 Desktop；关闭窗口可能只是隐藏，Host 仍在运行。
DESKTOP_DSH="/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh"
"$DESKTOP_DSH" --version

# PACKAGE_TGZ 指向届时已通过 Desktop 验收的完整归档路径。
"$DESKTOP_DSH" plugin --profile desktop add "$PACKAGE_TGZ"
"$DESKTOP_DSH" plugin --profile desktop exec playwright --version
"$DESKTOP_DSH" plugin --profile desktop exec playwright install chromium --no-shell

# 然后正常打开官方 Desktop，检查实际插件版本和入口。
```

不必替换当前终端的全局 dsh，不修改应用签名内容，不编辑其 ASAR，不手动合并宿主 patch。安装源代码、应用版本与实际运行结果仍需一致。

## 已找到的阻碍与待验证项

| 项目                  | 证据和结论                                                                                                                                                                                                                                                                                                                                            |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 版本范围              | 当前归档不声明支持 `0.2.2-rc.1`；这本身已阻止正常安装成为受支持路径。                                                                                                                                                                                                                                                                                 |
| Pop-out               | 官方固定版 [main.ts](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.1/apps/desktop/src/main.ts#L292-L295) 的 `setWindowOpenHandler` 返回 `deny`；HTTP(S) 链接转系统浏览器。当前 `src/client/popout.ts` 使用 `window.open('about:blank')` 并访问新窗口文档。由源码可推断此实现不能按 Web 方式弹出窗口；尚未进行 Desktop 真机复验。 |
| Host 请求 / SSE       | Desktop 使用 `dsh-app://app/` 与认证转发，而 Client 以主页面 origin 拼接公开 API。需要在真实 Desktop 检查 URL、流读取、重连、附件资源和认证转发，不能假设普通 HTTP 测试证明兼容。                                                                                                                                                                     |
| Dock / Float 与主题   | 需要针对新版布局、slots、字体 / token 和窄屏行为复验。相同 React 界面不等于宿主集成兼容。                                                                                                                                                                                                                                                             |
| Playwright 与生命周期 | Desktop 插件运行于 Electron Node-mode Host。需验证完整 Chromium 启动、安装路径、登录目录隔离，以及隐藏 / 退出 / 重启后的 dispose。应用内置 Browser 不是当前插件的 Playwright Chromium。                                                                                                                                                               |

因此当前答案是：**有官方安装机制，但当前插件尚不能作为已兼容插件直接安装到你的 Desktop 使用；至少需要处理 Pop-out 行为，并完成新版宿主适配验收。** 可能选择仅保留 Dock / Float 并明确隐藏不支持入口，或者在官方提供合适公开窗口能力时使用它；具体方案另行 Review，不修改 DSH 源码、不使用私有 Electron IPC。

登录 Desktop 的账号不等于 Companion 的 `chat.deepseek.com` 网页登录。当前插件按 DSH profile 隔离浏览器目录，不能假定 Web 测试登录自动迁移到 Desktop，也不应让两个正在运行的实例共用同一 Chromium profile。

## 后续顺序

先完成当前 FR-4 与 Web 首版 FR-5。Desktop 独立立项时，先更新首版后的计划并 Review：锁定官方版本 → 明确 Dock / Float / Pop-out 能力 → 新版公共 API / 自定义协议及 Playwright 验证 → 独立 profile 本地安装 → 聊天 / 图片 / 恢复 / 退出矩阵 → 再扩大 engines 和发布兼容声明。用户的实际 Desktop profile 安装应在隔离验收通过后进行，避免把未验证修改写入日常使用环境。
