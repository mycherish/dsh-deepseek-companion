# FR-1 市场与安装准备

更新：2026-10-23（安装验收：2026-10-22）。当前包：`0.1.0-preview.2`。FR-0 计划已审核并提交为 `899607f`；本阶段仅准备和验证分发路径，不公开发布，不进入 FR-2 / FR-3。

## 免费发布方案与账号创建

推荐使用个人账号的 **GitHub 公开仓库 + npm 公开包 + GitHub Pages 索引**。无需购买域名或服务器：npm 公开发布免费，GitHub Free 的公开仓库可以使用 Pages。依据：[npm 公开分享费用](https://docs.npmjs.com/about-npm/#sharing-packages-and-collaborating-with-others)、[GitHub Pages 可用范围](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)。

1. **GitHub 源码仓库**：用户已创建 [mycherish/dsh-deepseek-companion](https://github.com/mycherish/dsh-deepseek-companion)，SSH 地址为 `git@github.com:mycherish/dsh-deepseek-companion.git`。本轮匿名查询官方 API 确认它是公开空仓库，问题反馈已启用；本地尚未设置 origin，也未 push。包与索引草案已填写对应 repository / homepage / bugs 地址。
2. **npm 发布者**：2026-10-23 用户确认登录用户名为 `caelum-maple`，包与草案的作者字段已填写，公开身份信息已齐备。实际发布前仍需核对邮箱验证、发布认证、CLI 登录身份及届时包名权限；填写作者不会授予 npm 发布权限。密码、Cookie、token 与恢复码不要放进仓库或聊天。无需创建付费组织，本阶段不执行 publish。[官方注册说明](https://docs.npmjs.com/creating-a-new-npm-user-account/)
3. **市场索引托管**：用户已有个人站点 `https://mycherish.github.io/`，本轮访问返回 HTTP 200。建议在插件仓库单独启用项目 Pages，准备发布时把 `market/` 下生成的正式索引与图标部署为该项目站点根目录。后续在插件仓库 Settings → Pages 配置 GitHub Actions 发布来源；部署流程在 FR-5 执行，不在本阶段启用自动上传。[个人站点与项目站点规则](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)

拟用索引地址为 `https://mycherish.github.io/dsh-deepseek-companion/index.json`。本轮官方仓库 API 的 `has_pages` 为 `false`，项目站点与索引尚未部署，当前不能把该地址添加到 DSH。个人站点首页不是插件市场索引；项目站点可独立部署，无需改动个人站点、建立第二个仓库或购买自定义域名。

### 当前公开信息与待核对项

| 信息                 | 当前状态                                                          | 何时使用                                |
| -------------------- | ----------------------------------------------------------------- | --------------------------------------- |
| GitHub 仓库 URL      | 已确认公开空仓库；本地没有 origin                                 | 元数据已填写，审核并授权后再 push       |
| npm 用户名与发布权限 | 用户确认登录用户名 `caelum-maple`；发布认证与包名权限待发布前核对 | 作者元数据已填写，FR-5 核对实际发布身份 |
| Pages 索引地址       | 已有个人站点；插件项目 Pages 未启用，索引路径已规划               | 正式索引部署及 Discover 实装            |

只读查询公共 npm registry 的 `dsh-deepseek-companion` 在本次检查返回 HTTP 404，表示当时没有公开包记录；不等于已经预留名称或证明当前账号有发布权限。实际发布前必须重新检查。

### npm 注册访问限制（历史排查）

2026-10-22 用户截图显示“访问暂时受限”及人机验证说明，没有显示账号字段校验结果。当时 [npm 官方状态页](https://status.npmjs.org/) 显示各服务正常；这不排除单个浏览器或网络出口遇到限制。截图列出的脚本运行受阻、访问行为或网络出口等原因只是可能性，没有证据确定根因。2026-10-23 用户已提供可登录账号 `caelum-maple`，不再把注册是否成功列为身份信息缺口；下述步骤保留作排查记录。

1. 先检查收件箱与垃圾邮件，若已收到 npm 验证邮件，完成验证后再尝试登录。发布前需要验证邮箱，见 [npm 注册说明](https://docs.npmjs.com/creating-a-new-npm-user-account/)。
2. 若没有邮件，用关闭扩展的无痕窗口重试，允许该站点运行 JavaScript 和使用 Cookie；也可换稳定网络，例如手机热点。若使用代理，可更换可信的稳定出口后重试。
3. 避免连续重复提交；仍被限制时，使用页面的“联系我们”向官方反馈并附该页请求编号。不将密码、认证信息或请求页面中的网络信息写入项目。

GitHub 的 `mycherish` 与 npm 的 `caelum-maple` 为用户分别提供的公开身份，不从一个平台推断另一个平台的账号。本轮未读取认证文件或自动执行 npm 登录。

## 市场草案与包边界

`market/index.draft.json` 有中英文标题 / 说明、Web / macOS 支持边界、精确版本 / `engines.dsh`、npm 安装来源及相对图标地址。仓库、主页和作者 `caelum-maple` 已填写，发布日期使用 `0` 哨兵，并显式标注未发布。它可用于结构校验，不能用于正式分发。

开发依赖固定 `@deepseek-ai/dsh-plugin-market-index@0.2.1-rc.2`；测试用官方校验器检查结构、相对图标解析、精确安装目标和包信息一致性。运行依赖仍只有 Playwright `1.62.0`。索引校验器不会随运行包安装，也不进入 Host / Client bundle。

图标通过公开的 `package.json.icon` 随包分发；草案本身不进入 npm tarball。包内预期 10 个文件：4 个构建产物、patch、Changelog、图标及自动包含的 package.json / README / LICENSE。源码、主页、反馈地址及作者均来自用户提供的公开信息，发布前再核对实际发布身份。

## 安装验证

所有测试使用全新临时 `DSH_HOME` / 浏览器目录，不复用已有认证目录，不发送真实聊天。下方分别记录普通缓存启动、CDN 自动下载失败，以及人工协助取得官方归档后完成的空缓存最小安装。

### 新版公开安装路径

在开发仓库构建本地候选：

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm pack --pack-destination dist/release
PACKAGE_TGZ="$(pwd)/dist/release/dsh-deepseek-companion-0.1.0-preview.2.tgz"
```

目标机器已安装 DSH Web `0.2.1-rc.2` 时，先初始化所选 Web profile，再用官方 bundle 命令安装：

```sh
dsh --version
dsh --profile web --dump-config > /dev/null
dsh plugin --profile web add "$PACKAGE_TGZ"
dsh plugin --profile web exec playwright --version
dsh plugin --profile web exec playwright install chromium --no-shell
dsh --profile web --no-open
```

这里的 `web` 需替换为用户实际使用的 Web profile 名；变量 `PACKAGE_TGZ` 必须是目标机器上存在的绝对 tarball 路径。正式公开包尚未发布，当前不能把安装参数替换成一个已发布包名。

`dsh plugin add` 读取现有 `dsh.bundle` 并维护 profile 的 bundle 列表；与直接 `pnpm add` 的预览步骤不同，无需再传同一份 `--patch` 或手工合并 patch。Playwright 命令在已安装 profile 内解析依赖，须显示 `1.62.0`；不依赖开发仓库的 node_modules，不通过 `npx playwright@latest` 安装另一版本的浏览器。Companion 使用可见的完整 Chromium，官方 `--no-shell` 选项会省去额外的 Headless Shell，保留完整 Chromium 与 FFmpeg；旧提示中不带该选项的命令也有效，但会额外安装 Headless Shell。安装与启动使用同一操作系统用户；若自定义 `PLAYWRIGHT_BROWSERS_PATH`，两者必须使用同一值。

`dsh --profile web --dump-config > /dev/null` 用于初始化或检查内置 Web profile，不把可能含用户配置的树输出到终端，也不给内置的 `web` 名额外加 `--from-default-profile web`。该选项仅用于创建 / 重建自定义 profile；不能对已有用户 profile 随意重建。同一 profile 的插件命令串行执行，等待浏览器安装结束后再运行 add / remove，避免争用官方的写锁。

缺少 Chromium 时，Host 的浏览器启动失败保持 `offline / browserReady=false`，Client 显示匹配浏览器安装及重启提示；浏览器已存在但站点检测失败时不提示重新安装。安装浏览器后重启 DSH，再按正常 UI 登录 DeepSeek。

### 下载缓慢或受限

本机若已有可用的 HTTP 代理，可以仅为浏览器安装命令传入 `HTTPS_PROXY`。下例端口 `7890` 是示例，替换为实际已配置的代理地址，profile 也需与安装目标一致：

```sh
HTTPS_PROXY="http://127.0.0.1:7890" dsh plugin --profile web exec playwright install chromium --no-shell
```

下载长时间没有收到数据时，可按需设置 `PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT=120000`。这是下载 socket 的空闲超时，不是整个下载的总时限；提高它不能替代可用的网络链路。上述环境变量只作用于该次安装命令。保留官方 HTTPS 下载来源，安装后的 `PLAYWRIGHT_BROWSERS_PATH` 继续与启动时一致。依据：[Playwright 官方代理与下载超时说明](https://playwright.dev/docs/browsers#install-behind-a-firewall-or-a-proxy)。

### 卸载与登录目录

```sh
dsh plugin --profile web remove dsh-deepseek-companion
dsh --profile web --no-open
```

卸载后复核 bundle 列表及重启后的入口消失；检查运行时进程退出。DeepSeek 登录目录由插件数据路径规则决定，卸载包不应静默删除它。若要清除登录数据，须先退出 DSH，再由用户明确指定目录清理，不把该操作放进普通卸载命令。

两个固定宿主的上述 bundle 命令均已验证；旧版 profile 多保留 `patchReload: live` 字段，安装 / 移除不改变它。此前人工 tarball / patch 的 [升级回退记录](upgrade-rollback.md) 继续作为历史证据；迁移到 bundle 路径时需清除同一 Companion 的旧手工条目，保留其它配置。官方依据：[bundle 安装与移除](https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/publish)、[官方市场索引与 Discover](https://deepseek-harness.github.io/deepseek-harness/en/guide/plugin-market)。

## 本轮结果

环境为 macOS、Node `22.20.0`、pnpm `10.26.0`、Playwright `1.62.0` 与其匹配的 Chromium `151.0.7922.34`；固定宿主 `0.1.5-rc.2` / `0.2.1-rc.2`。宿主从临时工作目录启动，插件来自 tarball，没有源码链接。测试驱动使用仓库 Playwright，插件运行时解析已安装 profile 中的依赖。

| 场景                 | 结果                                                                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| bundle 安装与激活    | 两版均通过：自动登记且只有一个 Companion bundle，保留 base / web-app，组合配置包含插件，不传额外 `--patch`                                                   |
| 安装依赖解析         | 在开发仓库外运行新版 `plugin exec playwright --version`，返回 `1.62.0`，命令来自 profile 的 `node_modules/.bin`                                              |
| 空缓存提示 RED→GREEN | 旧包状态为 `error / browserReady=false`，界面没有 Chromium 指引；修复后的新包同场景展示安装 / profile 替换 / 重启步骤，页面错误 0、Chromium 残留 0           |
| 已有匹配缓存启动     | 两版均为 `logged_out / browserReady=true`、消息 0；登录入口、Dock / Float / Pop-out 均通过，页面错误 0，退出后 Chromium 残留 0                               |
| 官方候选升级         | 在旧版宿主用官方命令安装 preview.1，再升级本轮 preview.2；版本正确、bundle 始终只有一个，base / web-app 保留。本轮不重复聊天历史回退矩阵                     |
| 卸载与重启           | 两版均通过：包与 bundle 移除，重启后入口消失、宿主正常、页面错误 0、Chromium 残留 0；其它 manifest 字段和用户 patch 内容保留                                 |
| 登录数据保留         | 在本轮独立 browser 目录放置非认证测试标记；普通卸载后目录与标记仍在，不读取 Cookie 或认证内容                                                                |
| 包边界与索引         | 10 文件清单正确；4 个构建产物与图标逐字节一致；运行依赖仅 Playwright。官方索引校验、安装版本 / engines 与包一致、相对图标解析测试通过                        |
| CDN 自动下载         | **未通过**：大文件自动获取出现 30 s 超时或传输中连接断开；增加空闲超时和使用代理仍未完成，不把小文件段或旧缓存计作自动下载成功                               |
| 空缓存最小安装       | **通过（人工协助获取主归档）**：官方 ZIP 摘要 / CRC / 版本一致，官方 CLI 从临时本地下载源安装 Chromium / FFmpeg，随后新版启动 / 登录唤起 / 三窗口 / 清理通过 |
| 公开发布             | **未执行**：公开源码仓库、npm 登录用户名与个人 Pages 已确认；发布认证待核对、项目索引未部署、草案没有真实发布日期，未进行 Discover 在线安装                  |

### 2026-10-23 自动下载中断与人工协助安装

- 新建临时 `DSH_HOME`，用官方 bundle 命令安装当前归档；从仓库外确认已安装的 Playwright 为 `1.62.0`。下载前两个独立观察缓存及最终完整尝试缓存均为空，没有复制已有浏览器或登录数据。
- 沙箱内最初因 DNS 限制无法访问 registry，允许联网后官方安装成功；这与插件运行错误分别记录。直连官方 CDN 的 1 MiB 探测在 20 s 内仅收到 47,857 字节，4 min 的直接下载观察未完成，主动停止。
- 用户提供本地 HTTP 代理后，同一官方地址的 1 MiB ZIP 文件段返回 HTTP 206，4.24 s 收齐 1,048,576 字节。但完整下载在进度达到 60% 后报告 `server closed connection` 并从头重试；完整尝试运行约 763 s 后停止本轮下载进程组。小文件段成功不计作完整安装通过，连接断开的具体来源尚未确定。
- 用户协助下载主文件：macOS Apple 芯片版 Chrome for Testing `151.0.7922.34`（Playwright Chromium revision `1234`），来自 [Playwright 官方下载地址](https://cdn.playwright.dev/builds/cft/151.0.7922.34/mac-arm64/chrome-mac-arm64.zip)。ZIP 为 187,406,357 字节，全部 647 个条目 CRC 通过，应用版本符合预期，MD5 与官方 HTTPS 响应头一致；SHA-256 为 `01a23ef9501b2745e0c2944c2e583207e6f6132d8d91c3a87ff65b5079e438ef`。
- 在另一份新空缓存中，用仅绑定 loopback 的临时下载源提供已校验 ZIP，设置公开的 `PLAYWRIGHT_CHROMIUM_DOWNLOAD_HOST`，由已安装 profile 的官方命令执行 `install chromium --no-shell`；FFmpeg `1011` 继续从官方源下载。命令退出 0，约 4.54 s 完成，完整 Chromium `1234` / FFmpeg `1011` 的安装标记由官方安装器生成，随后关闭临时 HTTP 服务。没有手工写缓存标记，用户的原始 ZIP 保留。公开依据：[Playwright 自定义下载源与浏览器选项](https://playwright.dev/docs/browsers#download-from-artifact-repository)。
- 使用 Node `22.20.0`、DSH Web `0.2.1-rc.2` 和新安装的 arm64 Chromium `151.0.7922.34` 启动；UI 驱动也使用这份完整 Chromium。目标为临时 `localhost:42983`、1440 × 900；Browser plugin 不可用，沿用仓库的 Playwright 方案与临时脚本。Host 为 `logged_out / browserReady=true`、消息 0，点击登录按钮后 Host 唤起网页返回 200 / `ok=true`；Dock / Float / Pop-out 通过，页面错误 0、控制台错误 0，退出后 Chromium 残留 0。没有登录账号或发送聊天，不重复此前的已登录核心矩阵。
- 首次烟测被宿主中文“预览版说明”遮罩拦住，截图确认按钮实际为“继续”，临时脚本原先只识别英文。按实际 UI 处理引导后重跑通过，没有修改宿主源码或强制穿透遮罩。README 同步中英文引导与最小安装命令。工程门禁、673 / 673 测试及包内容检查通过；本轮产品运行时代码没有新增变更。

早期脚本将内置 profile 名与 `--from-default-profile` 组合使用，已按官方 CLI 报错改为直接初始化内置 Web profile。下载命令占用该测试 profile 的官方写锁，期间并发更新超时，因此未更新的旧包界面不计入修复复验；随后在独立新 profile 安装新包，校验 Client 与构建产物相同后才接受 GREEN。卸载的首次对比把 pnpm 正常删除空 `dependencies` 键当作失败，改为按语义对比后通过；没有为测试修改 DSH 源码或清理其私有锁文件。

缺浏览器界面截图已目视确认安装步骤可见。截图及无认证测试脚本暂存仓库外，临时宿主 / 浏览器目录与下载进程在验收结束后清理。源码只改启动失败提示，不改 Host 协议或聊天 / 恢复逻辑；新增 6 项定向测试。

格式、lint、类型、Host / Client 构建、**673 / 673 自动测试**、`git diff --check` 与包内容检查通过。开发锁文件仅增加官方校验器的 14 行记录，没有顺带升级其它依赖。审核启动提示条件、旧版兼容、安装 / 卸载路径、索引真实性、包边界与清理后，未发现可执行代码问题。人工协助获取官方 ZIP 后，空缓存最小安装及启动烟测已通过；本机 CDN 自动获取大文件的网络限制保留，发布认证与在线 Discover 按发布阶段验收。FR-1 已完成、待用户 Review，未自动提交、push 或发布。

最终本地归档位于 `dist/release/fr1/dsh-deepseek-companion-0.1.0-preview.2.tgz`，SHA-256 为 `a2037b1b4a5589c9a0d4baac0807d5ca64c7b13dcd01221b15efc4f4360db56e`，旁边有校验文件。真机测试候选摘要为 `a1a44d847a88527be7a6cf57922569c20f43637a1c5b12a1908706259c31c2da`；最终归档只更新 README 安装说明，四个执行 / 类型产物与真机已安装文件逐字节一致，其余包文件与候选一致，全部包内容与当前源文件一致。pnpm 打包会正常省略 manifest 的 `packageManager` 字段，扣除该标准化后其余声明一致。两份 JS 语法检查与 61 个本地文档链接检查通过。两轮临时运行 / 缓存目录均已清理；2026-10-23 本轮清理 7 个目录，临时下载服务、下载进程、Host / UI 驱动均已退出，用户下载的原始 ZIP 保留。仓库外仅保留脚本、截图、日志和本地候选等无认证证据。

**下一步是 Review FR-1**：公开仓库、npm 登录用户名及索引地址规划已齐备，人工协助取得官方归档后的空缓存安装、启动和退出清理通过。审核后按用户授权提交本阶段，再进入 FR-2 的删除 / 不确定、图片 / 外部草稿、页面故障及旧错误残留收口。邮箱与发布认证核对、真实上传、正式索引部署和 Discover 在线安装按 FR-5 执行。
