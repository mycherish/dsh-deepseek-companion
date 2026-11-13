# FR-5 发布准备与授权单

> 2026-11-13 收尾记录：用户在明确列出文档提交、快进合入 / 推送 main 及清理已完成本地分支的步骤后回复“继续下一步”，本次按该范围执行。下文“文档尚未提交 / 待授权”保留为发布完成时的历史快照。本提交归档 FR-5 发布记录；不改变运行代码、npm 0.1.0、gh-pages 或 v0.1.0。

日期：2026-11-11。状态：**用户已于 2026-11-11 明确授权四项公开操作；源码已推送，npm 已发布并核对公开归档，Pages 索引 / 图标已上线；市场实装通过，v0.1.0 tag 已推送；FR-5 文档待提交。** 以下为已批准范围及执行记录。FR-4 已本地提交为 `329e4fdca0d979a964cdc3a06739806a908d4bda`；准备分支 `codex/fr5-release`。

## 已完成的只读预检

| 检查            | 2026-11-11 实际结果                                                                                                  |
| --------------- | -------------------------------------------------------------------------------------------------------------------- |
| 源码            | 工作从干净的 FR-4 提交开始；main 尚停在 FR-2，不能直接推本地 main 作为首版                                           |
| GitHub          | `mycherish/dsh-deepseek-companion` 为公开空仓库，无分支，默认目标 main；未启用 Pages                                 |
| GitHub 权限     | gh 身份 mycherish，目标仓库 push / admin=true；SSH 只读连接成功，refs=0                                              |
| 本地 remote     | 尚未配置，待获准后添加 origin，不使用强推                                                                            |
| 官方 npm latest | 官方 registry 返回 `@deepseek-ai/dsh@0.2.2-rc.1`，继续限定已有两版 Web；不增加 latest / Desktop 支持                 |
| npm 目标包      | 公共 registry 返回 404：尚未见公开包，不等于发布权限已确认                                                           |
| npm 终端认证    | 初次 E401；用户完成本机登录后复查 `npm whoami` 为 `caelum-maple`。未输出凭据，包发布权限 / 实际 2FA 仍按发布流程核对 |
| 项目 Pages      | `https://mycherish.github.io/dsh-deepseek-companion/index.json` 返回 404；尚未上线                                   |
| RC-C            | 摘要、十文件边界、包内元数据与运行文件核对；完整摘要见下表                                                           |

初次网络预检在沙箱内失败，随后以只读网络权限重查得到上表结果。身份 / 版本 / 远端状态可能改变，实际写入前须再检查；404 不作为未来可用性保证。

## 申请授权的确切对象

| 动作         | 对象与边界                                                                                                                                                                       |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 首次推送源码 | 配置 origin=`git@github.com:mycherish/dsh-deepseek-companion.git`，将 **329e4fdca0d979a964cdc3a06739806a908d4bda** 推为远端 main；若远端已出现其它历史则停止核对，不覆盖、不强推 |
| npm 公开发布 | 用户 caelum-maple，包 `dsh-deepseek-companion@0.1.0`，registry=`https://registry.npmjs.org/`，access=public；仅发布以下确切归档，不重新 pack 替换                                |
| 市场索引部署 | 新建独立 gh-pages 部署分支，只放正式 `index.json` 和 `icons/companion.svg`，启用目标仓库项目 Pages；不改 `mycherish.github.io` 个人站点仓库                                      |
| 发布节点     | 市场实装通过后，创建并推送注释 tag `v0.1.0`，指向上述 FR-4 源码提交；不自动创建 GitHub Release 或上传额外资产                                                                    |

归档：`dist/release/fr4-20261110/fixed/dsh-deepseek-companion-0.1.0.tgz`。

SHA-256：`2cf6a441861c994cbff47371de0e8d4c8f5d5d5f81da1a927bfb6d8dce1b95c2`。

支持范围：macOS、本地 DSH Web `0.1.5-rc.2 || 0.2.1-rc.2`，Playwright `1.62.0` 匹配 Chromium。首登入口不可观察的站点行为边界已由用户明确接受，不宣称该项实测通过；官方 Desktop 未适配。

上述源码包含此前 FR-1–4 的提交历史；这次授权若获准，允许的是该确切版本首次公开推送，不将 FR-5 尚未提交的准备文档冒充已推送源码。FR-5 完成记录后续本地提交 / 推送另行报告并请求对应授权。

## 获准后的顺序与停止条件

1. 重新确认 RC-C 摘要、归档内容与源码对应；`npm whoami` 必须为 caelum-maple。如为其它身份或仍失败，停止 npm 写入，请用户修复认证；2FA 在用户本机完成。
2. 复查远端空仓库状态，配置 origin，推送确切 FR-4 提交到 main。若存在非预期分支 / 历史，停止，不自动合并或强推。
3. 发布确切 tarball。若 0.1.0 已存在，先比对公开内容，绝不盲目重发、覆盖、unpublish 或改版本绕开问题。
4. 从 registry 重新下载公开归档，核对 integrity / 内容、版本、engines、作者 / 仓库，并取实际 `time["0.1.0"]`。失败时保留已发生状态，不能声称发布成功。
5. 依据实际 registry 元数据生成正式索引：format=1、精确版本 0.1.0、实际发布时间的 Unix 秒（向下取整）、正式市场简介和图标路径。使用官方 `parseMarketIndex` 与安装目标检查。当前草案 `publishTimestamp: 0` 不改成预估日期，不直接部署草案。
6. 在独立临时工作目录创建只含索引 / 图标的 gh-pages 提交并推送该新分支；启用仓库 Pages 的 gh-pages / 根目录来源。不部署整个源码、dist、截图、登录副本或日志。若分支已有非预期内容或 Pages 目标不同则先停止核对。
7. 检查项目 HTTPS 索引直接返回合法 JSON、图标可达、版本 / engines 正确，再用全新固定 Web profile 启用 Custom plugin markets，添加索引并完成 Discover 安装、详情、启动与实际运行验收。
8. 市场实装至少验证：登录状态边界、一次短聊天、三窗口同步、预览归档到公开包的升级边界、卸载 / 重启与资源退出。登录凭据与验证码由用户输入。不得把 npm 发布或索引可达等同于已上架验收完成。
9. 全部通过后创建并推送 v0.1.0 tag，记录各项实际状态、公开地址与时间。失败时不创建成功节点，不未经授权删除公开包 / 远端分支；修复或回退方案需明确范围。

## 发布前命令方案（历史，已执行结果见末节）

```sh
# 源码推送：再次确认远端没有非预期历史后执行。
git remote add origin git@github.com:mycherish/dsh-deepseek-companion.git
git push origin 329e4fdca0d979a964cdc3a06739806a908d4bda:refs/heads/main

ARCHIVE="dist/release/fr4-20261110/fixed/dsh-deepseek-companion-0.1.0.tgz"
shasum -a 256 "$ARCHIVE"
npm whoami --registry https://registry.npmjs.org/
npm publish "$ARCHIVE" --access public --registry https://registry.npmjs.org/
npm view dsh-deepseek-companion@0.1.0 version dist engines --json --registry https://registry.npmjs.org/

# 索引部署依赖上一步真实 registry 数据，尚未生成部署提交。
# 完成 Discover 实装后，才执行获批的发布节点动作：
git tag -a v0.1.0 329e4fdca0d979a964cdc3a06739806a908d4bda -m "DeepSeek Companion 0.1.0"
git push origin refs/tags/v0.1.0
```

以下为发布前部署方案（历史）：Pages 启用操作将使用 gh CLI 调用 GitHub Pages API（GitHub 连接器未提供本任务所需的 Pages 配置入口），以仓库 gh-pages 分支为源；这项仓库配置变化也在上面的待授权范围中。需要的部署 commit 只包含由真实 registry 生成的两项资源，当前不能提前制造看似已发布的索引。

## 本轮完成标准与交接

本轮仅准备授权材料与只读预检，不提交新代码、不执行公开写入。用户已完成 npm 本机认证，身份复核为 caelum-maple；下一步等待明确批准上表全部动作或指出只授权其中哪些项。公开动作发生后持续区分：源码已推送、npm 已发布、Pages 已部署、Discover 已验收、tag 已推送；不把任一单项等同于 FR-5 完成。

## 执行进度（2026-11-11）

- 用户明确回复“授权执行 FR-5 四项公开操作”，适用上表确切对象。
- 再次核对 caelum-maple、远端空仓库和 RC-C 摘要后，已添加 origin 并成功将 `329e4fdca0d979a964cdc3a06739806a908d4bda` 推送到远端 main。
- 已对确切 RC-C 执行 npm publish，npm 正在等待本次发布的浏览器账号验证；已请用户在本机完成，不记录认证链接 / 验证码 / token。本段不表示 npm 已发布成功。
- Pages 依赖公开 registry 内容与真实发布时间，因此尚未生成正式索引、未部署；Discover 未验收，tag 未创建 / 推送。
- 当前全局 CLI 现场核对已为 `0.2.2-rc.1`；不使用该未支持版本替代基线，正在新临时目录准备独立 `0.2.1-rc.2` 宿主。首次离线依赖图准备失败，随后改为最小 CLI 入口和固定包版本重建；不将环境准备写成实装通过。
- 进度证据 `dist/release/fr5-20261111/progress.json`；临时根通过 `/tmp/fr5-runtime-path` 定位，不提交临时目录或原始认证输出。FR-5 文档改动仍未提交，这次公开操作授权不扩大为额外源码提交。

## 2026-11-12 npm / Pages 实际结果

用户完成本次 npm 浏览器验证，发布命令 0 退出，公开 `dsh-deepseek-companion@0.1.0` 已可取得。registry 实际发布时间为 `2026-11-11T15:57:16.015Z`（北京时间 11 月 11 日 23:57:16），公开 tarball SHA-256 与获批 RC-C 完全相同，SHA-1 与 SHA-512 integrity 均核对通过，未重发或改包。

索引生成首次把时间写成毫秒，被固定版官方 parseMarketIndex 拒绝，未部署该错误索引。核对官方实现后修正为 `Math.floor(Date.parse(time) / 1000)`，实际 `publishTimestamp=1794412636`，重新校验通过。前面发布规则的单位也已纠正为 Unix 秒；这是部署材料错误，不改已发布产品。

仅含正式 index.json 与 icons/companion.svg 的 gh-pages 根提交 `842b6fc` 已推送。Pages POST 返回 409“已启用”，随后 GET 确认来源正是 gh-pages / 根目录；未更改其它来源或个人博客。公开 HTTPS 索引与本地合法 JSON 完全一致，图标与包内资源完全一致。

证据：`dist/release/fr5-20261111/registry-verification.json`、`pages-deployment.json`。当前尚未完成 Discover 实装，不创建 / 推送 tag，不把 npm / Pages 上线等同于市场验收完成。隔离固定宿主的 peer 依赖图仍在准备，未使用全局 0.2.2 代替支持范围内版本。

## 2026-11-12 四项执行完成

Discover 实际安装、短聊天 / 三窗口、preview.2 到公开版本升级及卸载重启均已通过，所属 Chromium 为 0 后创建并推送 v0.1.0，指向329e4fd。已清理本轮临时根与认证日志。详细公开结果、精确边界及失败尝试见 [FR-5 发布记录](fr5-release.md)。本轮文档尚未提交，未额外创建 GitHub Release 或修改 Desktop。
