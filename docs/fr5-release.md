# FR-5：0.1.0 公开发布与市场实装

> 2026-11-13 收尾记录：用户在明确列出文档提交、快进合入 / 推送 main 及清理已完成本地分支的步骤后回复“继续下一步”，本次按该范围执行。下文“文档尚未提交 / 待授权”保留为发布完成时的历史快照。本提交归档 FR-5 发布记录；不改变运行代码、npm 0.1.0、gh-pages 或 v0.1.0。

完成日期：2026-11-12（Asia/Shanghai）。状态：**四项获准公开操作及市场实装已完成；本轮 FR-5 文档尚未提交。** 公开操作授权为用户明确回复“授权执行 FR-5 四项公开操作”；范围见 [授权单](fr5-release-approval.md)。没有另行创建 GitHub Release、上传资产或修改 Desktop。

## 公开结果

| 项目         | 实际结果                                                                                                                         |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| 源码         | `https://github.com/mycherish/dsh-deepseek-companion`，main 指向 `329e4fdca0d979a964cdc3a06739806a908d4bda`                      |
| npm          | `dsh-deepseek-companion@0.1.0`，public，发布者 caelum-maple                                                                      |
| npm 实际时间 | registry `2026-11-11T15:57:16.015Z`，北京时间 11 月 11 日 23:57:16                                                               |
| 归档 SHA-256 | `2cf6a441861c994cbff47371de0e8d4c8f5d5d5f81da1a927bfb6d8dce1b95c2`，公开下载与获批 RC-C 一致，SHA-1 / SHA-512 integrity 同时通过 |
| 项目索引     | `https://mycherish.github.io/dsh-deepseek-companion/index.json`，HTTPS 合法 JSON，与官方校验通过的本地索引完全一致               |
| 图标         | `https://mycherish.github.io/dsh-deepseek-companion/icons/companion.svg`，与包内图标逐字节相同                                   |
| Pages 分支   | 独立 gh-pages，根提交 `842b6fc`，仅 index.json 和 icons/companion.svg；来源 gh-pages / 根目录                                    |
| 发布 tag     | 注释 tag `v0.1.0` 已推送，指向上述 FR-4 源码提交；不指向尚未提交的 FR-5 文档                                                     |

这是通过官方 Discover 的**自定义插件市场**发布，不是已被官方默认市场预置。用户需要自行启用 Custom plugin markets 并添加上述索引。npm 发布、索引上线和市场实装分别验证，未把其中一项当作全部完成。

支持范围保持 macOS、本地 Web `0.1.5-rc.2 || 0.2.1-rc.2`；本轮市场实装使用固定 Web `0.2.1-rc.2`。官方 latest / Desktop `0.2.2-rc.1` 不在声明内。首次登录入口未观察到的站点行为边界按用户此前接受的决定保留，不声称从零输入凭据登录通过。

## 实装环境与路径

本机全局 CLI 现场已为 `0.2.2-rc.1`，没有修改或降级全局安装。独立临时工具按官方依赖 / peer 声明补齐，核对 295 个 DSH 包全部 `0.2.1-rc.2`。使用全新隔离 DSH_HOME / Web profile，初始没有 Companion；Chromium 使用 Playwright `1.62.0` 匹配的现有缓存。Browser plugin 不可用，仓库 Playwright 操作真实页面，不替换市场、Host 或站点响应。

正常关闭首次“开始使用”弹窗 → 插件 → 实验性插件“更多” → 自定义插件市场 → 启用 → 返回插件列表 → 发现 → 添加索引源 → 输入公开 Pages URL。实际卡片与详情显示插件名、作者 caelum-maple、0.1.0、registry.npmjs.org、Web 支持说明和真实发布日期。选择精确版本安装，接受官方“插件在本机以你的权限运行”确认，再选择“立即启用”。

实际安装目录版本 0.1.0，bundle 只登记一次；四个运行文件与从 registry 下载的 RC-C 逐字节相同。随后正常打开 Companion：online / logged_in。登录状态来自先前获准复制的 companion-test 独立浏览器副本，不读取或公开认证，也不扩大成首次登录成功。

## 真实验证结果

| 场景                            | 结果                                                                                                                                                       |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Discover 发现 / 详情 / 确认安装 | 通过，未通过 CLI 预装替代市场安装                                                                                                                          |
| 实际聊天                        | 新建唯一 FR5_MARKET_20261112 测试轮次，助手完成 FR5_MARKET_OK，消息两条，finished                                                                          |
| 三窗口                          | Dock / Float / Pop-out 均显示同一完成回复；实际 chat POST=1，没有额外发送，市场主界面 pageerror / console error 均 0                                       |
| preview.2 → 公开版              | 同一固定宿主停机切换兼容 preview.2，再从官方 registry 安装公开 0.1.0；逐段实际启动，登录保持，经正常历史切换重建同一会话两条消息，chat POST=0、pageerror=0 |
| 卸载 / 重启                     | 官方 remove 后实际重启，入口消失，state 路由 404，pageerror=0；其它 manifest 语义保持、浏览器目录保留                                                      |
| 退出 / 清理                     | 全部驱动与 Host 停止，所属 Chromium 0；准确删除本轮临时根及指针、登录副本、私有会话定位文件和原始日志，原 profile / 全局 CLI / Desktop 未改动              |

升级后的消息由站点历史切换重建，不承诺 Host 内存消息跨进程持久化。卸载阶段登录 / 历史不适用，JSON 使用 null，不以 false 表示丢失登录。仅保留本轮测试会话在服务端，未额外删除会话。临时目录删除不影响用户原登录目录。

## 失败尝试与纠正

- 首次索引生成误用毫秒，被官方 parseMarketIndex 拦截，未部署错误索引。按实际实现修正为 Unix 秒，`publishTimestamp=1794412636`，重新验证后才部署；相应文档已纠正。未改发布包或版本。
- Pages POST 返回“已启用”409；GET 确认现有来源恰为 gh-pages / 根目录、随后公开 JSON / 图标核对通过，没有擅改其它配置。
- 固定宿主首次依赖准备因旧版包名 / 缺失 Cordis peer 失败，按当前固定包声明补齐后初始化成功；失败准备不计实装通过。
- 初次按钮定位被引导遮罩或实际 aria-label 阻挡，正常关闭引导、读取真实可访问名称后操作；没有强制穿透。
- 实验性开关异步更新，Playwright 即时 check 报未变；重新观察实际两个组件“运行中”后继续，没有重复切换回关闭。
- 一条过长临时控制器输入被 PTY 截断，取消该未执行输入并拆短操作，未新增聊天或产品改动。
- 卸载比较首次把“dependencies 字段被删除”和“dependencies={}”视为不同而停止。复核唯一差异为该空字段后，只规范化空依赖语义再比较，其余 manifest 完全一致；保留第一次升级证据与后续卸载结果，不隐藏失败或忽略任意字段。

## 证据与后续

本地 Git 忽略目录 `dist/release/fr5-20261111/`（路径沿用准备日）保留 registry-verification.json、pages-deployment.json、market-smoke.json、lifecycle-upgrade.json、lifecycle.json、progress.json、cleanup.json、公开归档 / 索引快照及对应界面截图。没有复制登录 profile、认证链接、token、原始 Host 日志或真实会话 ID。纯源码 Git 提交不自动包含这些本机证据。

公开四项操作已完成，FR-5 发布与实装可收口。剩余是用户审阅后对本轮文档改动的单独提交 / 推送授权；不能把此前四项授权扩大为额外源码提交。后续 Desktop、UI 文案可访问性与其它高级功能按独立范围立项，先更新计划并 Review，不在首版发布中继续扩功能。
