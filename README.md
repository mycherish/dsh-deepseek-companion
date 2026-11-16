# DSH Chat Buddy for DSH

当前源码候选：`dsh-chat-buddy@0.1.3`（未发布）；已发布基线为 `0.1.2`。下文介绍 0.1.3 候选的行为；安装前以 [npm](https://www.npmjs.com/package/dsh-chat-buddy) 实际可下载版本为准。支持 **macOS、本地 DSH Web `0.1.5-rc.2` / `0.2.1-rc.2` / `0.2.2-rc.1`、Playwright `1.62.0` 匹配的 Chromium**；官方 Desktop、其它宿主版本／系统／浏览器及远程无界面部署未纳入兼容声明。插件要求 Node.js 22 或以上，同时需满足所选 DSH 宿主自身的 Node.js 要求。

在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 中使用自己的 DeepSeek 网页账号聊天，提供 Dock、页内 Float 与独立 Pop-out 三种窗口。`0.1.3` 改为打开面板后才启动后台网页会话，只有手动登录时显示工作浏览器窗口；窗口操作提示与侧栏入口样式同步优化。兼容声明保持原范围，本轮真实后台窗口验收使用 Web `0.2.2-rc.1`，未重做另外两个宿主的完整聊天矩阵。开发与验收记录见 [后台运行记录](docs/browser-background.md)，此前版本的发布记录见 [0.1.2 兼容记录](docs/web-022-compatibility.md)。

原名 DeepSeek Companion。旧公开包 `dsh-deepseek-companion@0.1.0` 保留，但只兼容原来的两个固定 Web 版本；新旧包不能在同一 profile 同时启用。迁移保留原登录目录，详见文末和 [更名计划](docs/rename-migration.md)。

## 功能与边界

- 文本流式、Markdown / 代码、Deep Think、Search、跨窗口 Stop、新建及历史会话切换。
- PNG / JPEG / WebP / GIF 图文与纯图片发送；历史图片失效时保留文件名。
- 三窗口共享 Host 消息和状态；Float 可拖动、缩放，主题与可用字体设置跟随 DSH。
- SSE 断流重连、页面 / Chromium 恢复及严格身份原地补全；不确定时保留消息并阻止发送，不自动重发。
- 键盘焦点、组合输入保护、阅读历史时不抢滚动，以及支持减少动态效果的轻动效。

这是网页聊天工具，不是 DeepSeek API Provider 或 OpenAI-compatible Gateway。它不消耗 DeepSeek API 余额，但受网页账号限制和风控约束。**DSH 登录与 DeepSeek 网页登录是两套状态**；登录 DSH 不会自动登录 DeepSeek。

Search 只把真实取得并准确映射的来源变为链接，未映射编号保留为普通文本。极快连续发送的空 parent anchor、树形历史保持安全拒绝；SSE 静默半开没有主动心跳探测。首版没有文档附件、Proxy、多账号、Handoff 或 Host 消息持久化；不要把 Host 重启等同于浏览器恢复。

## 安装与首次登录

先运行 `dsh --version`，确认宿主属于上述三个固定版本。**0.1.3 尚未发布**：当前只使用本地候选归档安装；下面的 npm 安装命令须等该版本实际可下载后执行。已发布的 `0.1.2` 仍可安装，但使用此前的可见工作浏览器流程。

```sh
dsh plugin --profile web add dsh-chat-buddy@0.1.3
dsh plugin --profile web exec playwright --version
dsh plugin --profile web exec playwright install chromium --no-shell
dsh --profile web --no-open
```

`web` 替换为实际 Web profile 名。Playwright 应显示 `1.62.0`；不要用 `playwright@latest` 代替安装后 profile 的匹配版本。0.1.3 使用完整 Chromium：日常无界面运行，手动登录时才显示窗口；`--no-shell` 省去额外的 Headless Shell，无需另装浏览器。安装与运行使用同一用户；自定义 `PLAYWRIGHT_BROWSERS_PATH` 时，两者保持一致。

本地候选可把首条命令替换为 `dsh plugin --profile web add /path/to/dsh-chat-buddy-0.1.3.tgz`。从源码构建候选的命令见下方开发说明，不把未发布草案当作公开包。

官方 add 命令自动登记 bundle，无需手工 patch。曾手工加入旧 Companion patch 的用户，先停止 DSH 并备份配置，仅移除那条旧 Companion insert / 启动 patch，保留其它条目，避免重复加载。

启动后正常完成宿主预览引导：旧版可选 Continue → Configure later，新版可点“继续”并关闭开始使用引导。无需为 Chat Buddy 配置 DSH API Key。0.1.3 的登录步骤：

1. 启动 DSH 不会创建工作浏览器；点击侧栏“快速聊天”后才准备后台网页会话。
2. 未登录时点击“登录 DeepSeek”，在出现的独立窗口手动登录。
3. 回到 Chat Buddy 点击“完成登录，返回聊天”，登录窗口关闭，聊天改由后台实例工作。直接关闭登录窗口也会返回后台；未完成登录时仍提示登录，不自动重新弹窗。
4. 以后需要重新登录时使用“管理登录”；发送、恢复或有图片草稿时先完成相应操作。首次缺 Chromium 时，按界面提示安装并重启 DSH。

## 使用

- 后台实例在面板首次打开后随宿主保留；关闭面板不会终止它，退出宿主时释放工作浏览器。
- 在 Dock 标题栏切换 Float 或打开 Pop-out；三窗口共享消息和服务状态，输入框里的未发送文字属于各窗口本地草稿。
- 用“图片”添加附件，等待就绪后发送；失败附件需移除或重试。页面与 Companion 草稿不一致时会拒绝发送，请先检查网页，不要假定图片已经发出。
- 流式中使用“停止”；历史菜单支持上下方向键与 Esc，新建聊天或切换历史由 Host 确认后更新消息。
- 发生连接或浏览器故障时保留消息和草稿。会话无法确认时发送被禁用，可按提示新建或切换历史；恢复不会自动重发原消息。

官方 Discover 需要启用 Custom plugin markets 并添加索引，npm 发布不会自动进入所有用户的市场。正式索引为 `https://mycherish.github.io/dsh-deepseek-companion/index.json`。`0.2.1-rc.2` 的发现、安装与实际聊天已验收；其它已支持宿主可使用上面的命令行安装路径；本轮 rc.1 验收采用官方 CLI，未重做 Discover 界面流程。不能直接添加 `index.draft.json`。

## 升级、回退与卸载

更新前停止对应 DSH 实例并保留上一份已验证归档，再用官方 add 命令安装目标确切版本。重启后确认实际版本、DeepSeek 登录和历史切换；未发送草稿和 Host 内存消息不承诺跨进程升级持久化。

0.1.3 候选可回退到同一宿主兼容的已发布 `0.1.2`，回退后恢复此前可见工作浏览器的行为。回退只使用同一宿主兼容的归档，不绕过 engines。原来的两个固定宿主可回退到公开 `dsh-chat-buddy@0.1.1`；`0.2.2-rc.1` 不能安装只支持旧宿主的 `0.1.1` 或旧名 `0.1.0`，不要用版本豁免绕过兼容检查。

```sh
dsh plugin --profile web remove dsh-chat-buddy
```

卸载后重启 DSH。普通卸载不删除 DeepSeek 登录目录，也不要手工删除整个 DSH_HOME。

## 开发

```sh
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm build
pnpm test
# 已准备匹配 Chromium 后运行本地协议的真实组件交互回归
pnpm test:ui
pnpm pack --pack-destination dist/release
```

设计、版本兼容和安装 / 恢复验收记录见 [docs](https://github.com/mycherish/dsh-deepseek-companion/tree/main/docs)。`test:ui` 不代替真实站点、操作系统输入法或最终包矩阵。

问题反馈：[GitHub Issues](https://github.com/mycherish/dsh-deepseek-companion/issues)。请提供插件、宿主、操作系统和浏览器版本及复现步骤；不要附上 Cookie、token 或完整登录目录。

## Chat Buddy 安装与旧名迁移

新名称的精确安装命令（须确认 npm 已发布）：

```sh
dsh plugin --profile web add dsh-chat-buddy@0.1.3
```

浏览器准备、宿主兼容范围和使用方式与上文相同。仅当对应 profile 已安装旧包时，先停止 DSH，执行 `dsh plugin --profile web remove dsh-deepseek-companion` 后再安装新包，重启并刷新界面。卸载新包使用 `dsh plugin --profile web remove dsh-chat-buddy`。保留旧浏览器目录与设置，不能在同一 profile 并装新旧包。旧公开包和原市场索引地址仍保留。
