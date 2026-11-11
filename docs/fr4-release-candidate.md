# FR-4：0.1.0 本地候选冻结与最终验收

> 2026-11-11 提交记录：用户已明确授权，本次原子提交保存 FR-4 验收、修复、回归与文档。下文“待提交 / 未提交”描述的是提交前审阅状态；本提交不包含 push、tag、npm 发布或 Pages 部署。下一步为 FR-5，具体公开操作仍须对应授权。

日期：2026-11-10。基线：FR-3 提交 `7c4516a`。状态：**2026-11-11 验收与最后 Review 完成（含用户接受的首登入口边界），待提交授权，未发布**。执行入口：[first-release.md](first-release.md)。本阶段不包含 commit、push、tag、npm 发布或 Pages 部署。

## 官方版本与兼容决策

本轮查询官方 npm dist-tags，`latest` / `next` 为 `0.2.2-rc.1`，`alpha` 为 `0.2.2-alpha.3`；GitHub 对应候选发布同样为 `dsh-v0.2.2-rc.1`。本机全局 CLI 仍为 `0.2.1-rc.2`，没有升级它。

公开接口差异调查：从 `0.2.1-rc.2` 到 `0.2.2-rc.1` 的官方比较包含大量客户端与插件安装改动。新版 ui-layout 文档仍声明 `openRightbar(track, fullscreen)` / `closeRightbar`，但右列空间不足后的关闭、窄屏 drawer 和几何呈现已有变化；ui-slots 已扩展 Factory / scoped props 契约；Session 列表仍使用本地 `retainedBy` 计数；市场校验器仍为 format 1 和精确版本安装。文档中的同名能力存在不等于插件完整兼容，更不能替代真实安装 / 三窗口 / dispose 验证。

按首版计划保留精确兼容范围 `0.1.5-rc.2 || 0.2.1-rc.2`，不扩大 engines、不切换开发依赖或修改宿主。`0.2.2-rc.1` 独立适配验收，当前不宣传支持官方 latest。发布当天 FR-5 再核对版本；若范围变化，先更新计划并 Review。

官方参考：

- [发布列表](https://github.com/deepseek-ai/deepseek-harness/releases)。
- [固定两版比较](https://github.com/deepseek-ai/deepseek-harness/compare/dsh-v0.2.1-rc.2...dsh-v0.2.2-rc.1)。
- [新版 ui-layout](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.1/packages/client/ui-layout/README.md)、[ui-slots](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.1/packages/client/ui-slots/README.md)、[Session Controller](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.1/packages/api/session-controller/README.md)、[市场格式](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.1/packages/util/plugin-market-index/README.md)。

## 冻结内容

- 包版本 `0.1.0`，运行依赖仍为 Playwright `1.62.0`，兼容范围不变；没有新增功能代码。
- README 改为安装 / 使用 / 边界说明，Changelog 增加首版摘要；包内说明采用中性版本说明，动态发布状态留在验收记录；本地索引草案版本同步 `0.1.0`。
- 索引 `publishTimestamp: 0` 继续作为未发布哨兵。FR-5 从实际 registry 元数据生成 `index.json`，不能把草案直接部署或提前编造发布时间。
- 最终候选归档、SHA-256、十文件边界及实际安装产物核对将在下方记录。候选运行产物变化后，相关验收失效。

## 早期矩阵快照（RC-A / RC-B，最终结论见文末）

Browser plugin not available；使用仓库 Playwright 验证 Web，真实操作系统输入法通过原生 UI / 人工步骤验收。`test:ui` 的合成 SSE 仅作为交互回归，不计真实站点 / 浏览器恢复通过。测试使用独立 DSH_HOME 与已授权的测试登录副本，不读取或打印认证内容，不改变源 profile。

下表明确区分 RC-A 的实际运行证据与仅修改用户说明的 RC-B。RC-B 已补齐两版实际启动与 preview.2 升级 / 回退；剩余矩阵仍待验，不能写成全部通过。

| 项目                                                | Web 0.2.1-rc.2                                                                                                                                                       | Web 0.1.5-rc.2                                                                          |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 安装 / 浏览器前置 / 首次登录入口                    | RC-A 官方安装、已登录副本启动；RC-B 实际启动、登录保留、历史切换；最终包空缓存提示与前置后可用性通过；首登入口未出现（站点给匿名会话并回跳根页），按站点行为边界记录 | RC-A 安装、已登录启动通过；RC-B 实际启动、登录保留、历史切换通过                        |
| 文本 / Markdown / 代码 / Deep Think / Search / Stop | RC-A 通过；真实来源 URL 也与独立源页徽章精确匹配                                                                                                                     | RC-A 通过；Search 来源完整独立比对未另重跑                                              |
| 三窗口 / 历史 / 新建                                | RC-A 通过；以公开插件切换路由准确恢复同一历史，真实 Client 呈现                                                                                                      | RC-A 同类路径通过                                                                       |
| 图文 / 纯图片 / 历史 / 文件名降级                   | RC-A 通过，真实图片请求故障后移除失效 img 并保留文件名；RC-C 补验两张真实 ready 卡精准移除一张、另一张条目与临时文件保留；真实失败上传卡与网页真实删卡亦在 RC-C 通过 | RC-A 通过，同样记录了图片请求故障                                                       |
| 外部草稿与附件冲突                                  | RC-B 外部图片 / 文字草稿拒绝、外部刷新丢卡拒绝及显式清理通过                                                                                                         | RC-B 相同两类冲突及清理已补验                                                           |
| SSE / 页面 / Chromium / 流式回填                    | RC-A SSE、空闲 Chromium 与流式原地回填通过；RC-B page close / crash / about:blank 已补验                                                                             | RC-A SSE 与空闲 Chromium 恢复通过；RC-B page close / crash / about:blank 同类路径已补验 |
| 删除 / 不确定与写门控                               | RC-B 实际 RC2 删除恢复与三窗口清理通过；RC-C 真实不确定恢复（页面偏离目标）与四条写接口 409、切换 / 新建解除通过                                                     | 用户确认已手动删除唯一测试会话；Agent 未执行删除，完整删除恢复链路仍待验                |
| 主题 / 字体 / 窄屏 / 缩放 / 减少动态效果            | RC-A 实际设置、打开后同步、原生 150% 与 390 × 700 通过                                                                                                               | RC-A 主题 / 正文字号回退、原生 150% 与窄屏通过                                          |
| 操作系统中文输入法                                  | 用户人工确认选字未发送、Shift+Enter 换行正常；发送计数仍为 6；未保留中文草稿自动化旁证                                                                               | 按共有代码路径复用主基线，未单独声称人工通过                                            |
| 最终候选升级 / 回退                                 | RC-B → preview.2 → RC-B 逐段安装 / 启动、登录保留、历史列表 / 恢复通过                                                                                               | RC-B → preview.2 → RC-B 逐段安装 / 启动、登录保留、历史列表 / 恢复通过                  |
| 卸载 / 重启 / 清理                                  | RC-B 独立 profile remove 去登记；最终包 remove → 重启入口 / 路由消失、日志单次加载、登录与配置保留、Chromium 残留 0 通过                                             | 最终包 remove → 重启入口 / 路由消失、登录与配置保留、Chromium 残留 0 通过               |

## 发布材料与剩余门禁

准备审阅的公开内容：`package.json`、README、Changelog、包内 `cordis.patch.yml`、`market/icons/companion.svg` 与 `market/index.draft.json` 的版本 / engines / 作者 / 仓库信息。确认最终摘要和矩阵后，FR-5 再批准具体发布目标及命令。

预期发布顺序：核对 npm 身份 / 权限 → 发布确切已批准归档 → 从 registry 核对版本 / 内容 / 时间 → 生成真实 index.json → 部署项目 Pages 索引与图标 → 干净新版 profile 的 Discover 安装 / 烟测 / 卸载。当前不得执行这些公开写入。

FR-4 仅在完整最终矩阵、真实输入法、包 / 索引 / 安装说明一致性与最后代码 Review 都通过后关闭；未验项目保持待验。

## 本轮归档与证据

| 归档                                                                                | SHA-256                                                            | 使用情况                                                                                                            |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| RC-A：`dist/release/fr4-20261110/frozen/dsh-deepseek-companion-0.1.0.tgz`           | `84b92175d439a7bd0c008271b01add12743f7fc6d3755b8eb3e3ff448f2ba768` | 新旧真实矩阵的当前运行归档，保留不覆盖                                                                              |
| RC-B：`dist/release/fr4-20261110/user-docs-frozen/dsh-deepseek-companion-0.1.0.tgz` | `16a25c92cefcf9a65f06bcfc4bcf2245823792b1c1ae4e08164a155cb5001bd3` | 当前待定稿候选；仅 README / Changelog 与 A 不同，已补两版真实启动与升级 / 回退；完整矩阵未关闭                      |
| **RC-C：`dist/release/fr4-20261110/fixed/dsh-deepseek-companion-0.1.0.tgz`**        | `2cf6a441861c994cbff47371de0e8d4c8f5d5d5f81da1a927bfb6d8dce1b95c2` | 当前最终候选：与 RC-B 只差 `lib/client.js`（失败卡片文案修复），`lib/index.js` 逐字节相同；受影响矩阵已在 RC-C 重跑 |

两份归档均为十文件包。逐文件比较只有 README / Changelog 不同，其余八个条目（四个运行产物、package.json、patch、图标、LICENSE）相同；版本 / engines 与索引草案一致。当前构建四个文件与已安装的新旧 RC-A 完全相同。主宿主全局 CLI 未改动；旧版使用独立工具图，审计 231 个 DSH 包全部固定 `0.1.5-rc.2`、Cordis 4.0.2，公开 profile 为 `patchReload=startup`，不绕过 engines。

环境为 macOS、Node 22.20.0、Playwright 1.62.0 / Chromium 151.0.7922.34。真实站点主驱动发送 6 次聊天请求，旧版核心 / 图片驱动发送 5 次；另在旧版准备删除会话发送 1 次。受控恢复断言均比较消息 ID、保留本地草稿并检查没有额外 chat POST；不公开真实会话 ID 或签名图片 URL。单独外观驱动两版均为真实 chat POST=0。各驱动 pageerror=0；未对所有驱动统一统计 console，不能报告全局 console 0。

主基线流式恢复通过：终止明确属于主测试 profile 的 Chromium 主进程后，恢复保持同一会话及 assistant 消息 ID，补到 `finished`，没有重发。SSE 使用仅转发真实请求的 loopback 代理切断既有流连接，期间新流返回 503，恢复转发后验证重连、草稿 / 消息保留及无重发；没有替换 Host 快照为合成数据。最初单独设置浏览器 offline 未可靠断开既有流，不计作通过或产品失败。

图片由本地生成的 128 × 128 蓝色色块验证，不上传用户图片。图文和纯图片均取得实际回复及一张用户附件；通过公开插件切换路由恢复同一历史。对某张实际图片请求注入 abort，确认请求被阻断、该 img 从 DOM 移除而文件名仍可见；恢复网络后图片再次显示。旧版重载会再次显示“稍后配置”，先正常关闭引导再操作；早期被遮罩阻挡的尝试没有计作成功。

来源复核使用独立登录副本正常打开本轮会话。源页最初只挂载最近 2 条助手回复；通过正常滚动挂载 5 条后，取得 1 个已解析徽章 URL，与 Host 的 1 条来源精确一致；没有直接调用 history API、读取 React 私有状态或放宽引用映射。

证据在忽略目录 `dist/release/fr4-20261110/`：`primary/` 与 `legacy/` 的截图 / observations / appearance、`primary/citation-source-check.json`、`install-sequence.json`、工具依赖清单及候选摘要。它们不包含登录 profile、原始 Host 日志或真实会话 ID。原测试登录目录未修改。

## 审核与当前交接

本轮只修改版本 / 索引元数据及文档，没有修改产品功能代码、运行依赖或协议。审核发现随包说明过多包含临时阶段状态，已在 RC-B 改为稳定用户说明并保留 RC-A / RC-B 摘要链；未发现新增可执行产品代码问题。完整 format:check、lint、typecheck、build、695 / 695 自动测试与 diff 检查通过，8 / 8 本地协议 UI 检查通过；这些检查不代替上表未关闭的真实场景。

[发布材料审阅单](fr4-publish-review.md)已准备，但不是批准请求：尚未通过完整矩阵，未执行 commit、push、tag、npm publish 或 Pages 部署。npm 包名公开查询为 E404，不等于发布权限已通过。

用户已人工确认原生拼音选字未发送、Shift+Enter 换行正常。随后自动复核发送计数仍为 6、消息数为 12，未出现额外发送；输入框已为空，因此未取得中文草稿的自动化旁证。该项按人工验收记录，不声称自动化观察到中文草稿。人工验收当时使用独立测试 Chrome，地址为 `127.0.0.1:18548`（现已关闭）；它不是普通 Chrome 新打开页面，后者会要求独立认证，没有复制认证内容绕过此限制。人工步骤为 macOS 拼音输入 `ceshi`、Enter 选出“测试”、Shift+Enter 换行，不再按普通 Enter 发送。合成 composition 事件和空草稿状态不作为真实输入法通过依据。

远端删除对象仅为本轮新建的“删除恢复测试确认”，首条消息标记 `FR4_DELETE_20261110_RC1`，仅一问一答；用户已明确授权删除，但执行前发现旧版宿主为空会话；公开切换接口返回 500 / `chat session not found`，独立源页也跳回首页且未出现唯一标记。用户随后确认已手动删除该会话，解释了目标不可定位的现象。Agent 未点击删除、未操作其它会话；未在删除前捕获有效恢复基线，因此不能记录为本轮完整删除恢复通过。其定位信息只保存在权限受限的临时目录，不写入公开证据。本轮升级 / 回退后两个隔离 Host 与前端测试窗口均已关闭，专属 Chromium 进程核对为 0；临时登录副本保留供剩余矩阵复用，原 profile 不变。最终卸载 / 重启与临时目录清理仍待验收。

## 最终包真实启动与升级 / 回退补验

本轮在两版固定宿主上分别执行 RC-B `0.1.0` → FR-3 `0.1.0-preview.2` → RC-B `0.1.0`。每步通过官方 bundle 安装命令停机安装，核对实际版本与单次登记，再启动真实 Web；共六次启动均 online / logged_in，公开历史列表返回的 100 个会话身份与首步一致，正常历史切换恢复同一会话的 10 条消息。这里的 100 是界面列表返回数量，不是账号全部历史的完整性证明。历史 ID 只留在私有临时目录，不写入证据。

每步真实聊天 POST=0、pageerror=0，入口与输入框可用；截图已检查，无空白 / 框架错误覆盖。仅统计页面脚本异常，未统一统计 console，不声称 console 0。每步停机后再换包，最终两版 Host 均停止，专属 Chromium 进程为 0。没有重新复制登录、没有重新登录，也没有宣称 Host 内存消息跨重启持久化；消息由正常历史切换重建。历史图片的完整恢复不由本次文字消息断言替代。

证据：`runtime-install-sequence.json`、两版 `lifecycle-final-start.png` / `lifecycle-rollback-preview.png` / `lifecycle-upgrade-final.png`。本轮没有改产品代码、依赖或归档，未执行 commit / push / 发布。此结果关闭实际启动与该候选的升级 / 回退项；其余矩阵保持待验。

## 最终包页面故障补验

两版固定 Web 均实际启动 RC-B（SHA-256 见上），安装的四个运行文件与归档逐字节相同。Browser plugin not available；仓库 Playwright 观察真实前端 / Host 状态，CUA 原生地址栏输入 about:blank 与 chrome://crash/，关闭标签页前先保留同一测试浏览器的空标签，避免关闭最后一页导致浏览器退出。没有改源码、注入 Host 快照、修改 IDB、读取认证或直接调用 DeepSeek history API。故障期间不点击 readiness / history / send，仅只读轮询公开状态。

| 故障           | Web 0.2.1-rc.2 | Web 0.1.5-rc.2 |
| -------------- | -------------- | -------------- |
| about:blank    | 2662 ms        | 1482 ms        |
| renderer crash | 2966 ms        | 1465 ms        |
| page close     | 3208 ms        | 2899 ms        |

时长从轮询首次观察到 recovering 到恢复 online / logged_in，采样间隔约 100 ms，不是整个 30 s reconcile 预算的精确性能测量。六项均比较原会话 ID、消息 ID / 角色 / 正文 / 状态 / 附件字段，文字草稿保持，notice=null；真实聊天 POST=0、pageerror=0。截图确认恢复后消息与输入区可见，没有空白或框架错误覆盖；未统计全局 console，不报告 console 0。没有断言未采集的浏览器 PID 相等。

新旧截图与脱敏结果为 `primary/page-faults.json`、`legacy/page-faults.json` 及对应 `page-fault-1.png` 至 `page-fault-3.png`。首次临时控制器因未分配交互终端而退出，未触发故障；重新以交互终端建立基线后才执行六项注入，不将前次启动算作验收。原生操作一次被用户窗口切换提示阻止，重新读取当前窗口后操作，没有向其它应用发送按键。

驱动和两个 Host 均已停止，专属 Chromium 残留 0。临时副本继续保留供剩余冲突 / 删除与不确定分支 / 安装退出矩阵使用。本项未发现需改产品代码的问题，FR-4 仍未整体完成，未提交或发布。

## 最终包外部草稿 / 附件冲突补验

两版固定 Web 的 RC-B 均通过以下真实路径，没有修改产品代码。仓库 Playwright 操作实际 Companion、读取公开插件接口；CUA 原生操作真实 DeepSeek 页与文件选择器。仅上传本轮生成的 128 × 128 蓝色 PNG，不使用用户文件。安装的四个运行文件与冻结归档逐字节相同。

1. 在空聊天的真实源页输入 `FR4_EXTERNAL_DRAFT_KEEP` 并选择测试图片。Host 无对应附件；公开 chat 接口发送尝试返回 409，chat / composer 及会话身份与尝试前一致、消息数仍为 0。原生源页复核外部文字与图片仍在，没有被替换或发送。
2. 正常刷新测试根页清空本轮外部草稿，再由 Companion 文件输入上传图片至 ready。随后在源页正常刷新使页面卡消失，Host 的 ready 条目仍在。发送返回 409，原 Host 消息与 composer 保留；单独 remove 同样返回 409，保留原附件条目。此项是“外部刷新导致卡丢失”，没有冒充点击网页删除按钮的证据。
3. 显式调用公开 new 路由后，Host 消息与附件均为 0；源页输入为空、图片卡消失。未自动清除用户其它会话，也没有执行远端会话删除。

每版主动经公开 API 发起 chat 尝试 2 次（均 409）、remove 尝试 1 次（409）；前端额外 chat POST=0，不能把它说成全部 HTTP chat 请求为 0。Host 未新增消息。每版 pageerror=0；未统一采集 console，预期 409 也不能据此报告全局 console 0。这里验证发送门控与状态，不将 API 调用扩大为完整 UI 错误提示验收。

结果与 Companion 截图：`primary/conflicts.json`、`legacy/conflicts.json` 及各自 `conflict-1.png` / `conflict-3.png`。主基线查看图片卡时打开了图片预览，未把该操作算作删除；随后用真实根页刷新注入卡丢失。测试结束后两版 Host 与驱动停止，专属 Chromium 残留为 0。临时登录副本继续保留供剩余验收使用。

官方 Desktop 的本轮只读调研见 [Desktop 安装与兼容分析](desktop-compatibility.md)，不计入 Web 矩阵或 Desktop 支持声明。外部草稿 / 丢卡冲突项已补齐；失败上传卡精准移除的历史证据仍有原归档边界，最终包完整安装退出、删除 / 不确定分支及最后 Review 仍待关闭。

## RC2 真实删除恢复与不确定分支尝试

主宿主 Web `0.2.1-rc.2` 使用相同 RC-B，四个已安装运行文件与归档逐字节相同。先尝试在页面 crash 恢复期间，通过 CUA 正常导航根页以制造位置 / 历史证据不足；两次均先正常恢复为 notice=null，根页导航没有命中判定窗口，第二次随后按正常外部会话切换清空了历史视图。这两次不计作不确定分支通过，也不判定为产品缺陷；没有伪造 Host / SSE / 历史响应。最终包的不确定恢复与四个写接口端到端门控仍待验。

随后新建唯一 `FR4_DELETE_20261110_RC2` 测试会话，仅一问一答，并上传一张本轮生成的蓝色 PNG 至 Host ready。源页精确路径 / 提示标记及 Host 两条消息和附件基线均核对通过，定位信息仅留在权限受限的临时目录。用户明确批准不可恢复删除该新对象后，Agent 通过源页删除菜单与“删除该对话”确认框执行，仅删除这一条；源页目标链接消失。此前 RC1 的授权不作 RC2 的授权使用。

实际删除后，原 Host 仍保留原会话、两条完整消息与一个 ready 附件。再次逐项比较基线后终止仅属于主测试 profile 的 Chromium 主进程，真实恢复达到 online / logged_in / session_deleted；当前会话 ID=null，消息和 Host 附件均为 0，无自动重发。Dock / Float / Pop-out 都显示清空本地聊天记录的删除提示；随后显式 new 返回 200、notice 解除。源页实际删除与后续恢复分开观察，未用合成状态替代。

首次恢复驱动错误要求本地未发送文字清空，在已确认删除 verdict 和 Host 清理后停止，实际读到原 `FR4_DELETE_LOCAL_DRAFT` 仍在。检查 ChatView 后确认本地文字按设计保留，清理的是 Host 会话、消息与托管附件；未为迁就测试改变产品。保留该失败及边界，后续只读观察器核对已经恢复的真实状态、三窗口提示和显式 new，不重新制造第二次远端删除，也不声称第二个观察器重新见证了恢复过程。Pop-out 本地文字在首驱动停止前未单独断言，不宣称三窗口草稿清空或全部保留。

本段新建真实聊天请求 1 次（RC2），真实恢复没有新增 chat 请求；不确定门控的直接 409 检查未执行，不能写入通过计数。页面观察器 pageerror=0，未统一统计 console。不报告纯恢复耗时：初次驱动在计时结果落盘前因错误测试假设停止，第二观察器含界面核对不适合作性能时长。

证据为 `primary/delete-rc2-source.json`、`delete-rc2-recovery.json`、`delete-rc2-before.png`、`delete-rc2-menu.png`、`delete-rc2-after-source.png` 及三窗口截图。两个观察阶段在 JSON 和本文中明确区分。旧版未另执行本轮远端删除；不把主基线结果扩大为旧版独立实删验收。驱动及 Host 已停止，专属 Chromium 残留为 0；临时副本仍保留供剩余矩阵使用，源 profile 未改动。本轮不改功能代码、不提交或发布。

## 最终包不确定恢复与四写接口门控补验

主基线 Web `0.2.1-rc.2`、RC-B `0.1.0`（SHA-256 `16a25c92cefcf9a65f06bcfc4bcf2245823792b1c1ae4e08164a155cb5001bd3`）。安装目录里 `lib/index.js`、`lib/client.js`、`package.json`、`cordis.patch.yml` 四项与归档逐字节相同；宿主用隔离 `DSH_HOME` 与已授权登录副本的隔离浏览器目录启动，未读取或打印认证内容。本项修改产品代码 0 行。

**为什么必须用原生导航注入。** 复核源码确认：所有会导航页面的公开路由（`browser/show`、`chat/new`、`chat/switch`）进入处理前都 `await readyBrowser()`，而 `ensureReady()` 在恢复进行中直接 `return recoveryPromise`，所以恢复窗口内没有任何 HTTP 注入面；`session_unverified` 只能由真实页面在结算时（`runRecovery` 的 finally 重读 `page.url()`）偏离目标会话产生。本会话 AppleEvents 被 macOS 拒绝（`-10004`，负责进程为宿主 App），因此改为只用系统公开的辅助功能 API：读该窗口地址栏、置前窗口、把地址栏写入目标地址并按回车。未修改 Host 快照、SSE、IndexedDB、恢复回调或站点历史响应，也没有伪造网络响应；唯一故障注入是 SIGKILL 属于隔离测试 profile 的唯一 Chromium 主进程 + 那次真实导航。

**步骤与结果。** 先建立专属测试会话（1 问 1 答，标记 `FR4_UNCERTAIN_20261110_RC3`），记录会话、两条消息身份 / 正文 / 状态与发送计数，并在输入框键入本地草稿 `FR4_UNCERTAIN_LOCAL_DRAFT_RC3`。注入后观测到 `recovering`；恢复用**新**的浏览器进程加载回目标会话地址（地址栏序列 `about:blank → /a/chat/s/<目标> → 站点根页`），此时把真实页面导航到站点根页，恢复结算读到 `location=empty`、history 无明确证据，得到 `session_unverified`。从 kill 到结算 6448 ms，一次命中，未做反复碰运气式重试。

| 断言                 | 结果                                                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 状态                 | `online` / `logged_in` / `recoveryNotice=session_unverified`                                                                          |
| 原会话与消息         | 会话 ID 与两条消息（ID / 角色 / 正文 / 状态 / 附件）逐项相等                                                                          |
| 注入前的本地文字草稿 | 恢复后仍在输入框（视图未被切换时），未清空                                                                                            |
| Enter 门控           | Dock 与 Pop-out 各按一次 Enter：聊天 POST 增量 0，文字保持                                                                            |
| 三窗口提示           | Dock / Float / Pop-out 均显示「无法确认原会话状态；已保留聊天记录。请新建聊天或切换历史会话后继续。」并保留原消息                     |
| 四条写接口           | 直接请求真实 Host：`chat`、`chat/attachment`（add）、`deep-think`、`search` 全部 409 `recovered session is unverified`                |
| 拒绝后的状态         | 消息、composer、两个开关状态逐项不变；前端 attachment / toggle POST 均为 0，自动重发 0                                                |
| 解除与恢复写入       | 显式历史切换回原会话 200 → 提示解除、转录由真实页面恢复；随后真实发送 200 并取回完成的回复；显式新建聊天 200 → 提示保持解除、消息归零 |

本轮真实聊天 1 次（切换后的恢复写入），注入与恢复期间 UI chat POST=0、pageerror=0；未统一统计 console，不报告 console 0。测试宿主已正常停止，所属 Chromium 残留 0。

**失败尝试与纠正（保留记录）。** 前一次已真实进入 `session_unverified`，但驱动把 Float 视图切换放在 Enter 门控之前：DSH 每个视图各自持有 composer 文字，切换视图会重新挂载输入框，于是断言把"视图重建后为空"误判为"Enter 清空草稿"。随后在真实不确定状态下单独复核：Enter 前后文字保持、chat POST=0；打开 Float 时 Dock 与 Float 的输入框互不共享文字。据此只调整验收顺序（先 Enter 门控、后三窗口截图），未修改产品实现。另一处工具问题：初次导航助手要求窗口已置前，恢复重建的新窗口尚未置前时返回失败，补上置前与焦点校验、并只在**新**浏览器进程上匹配后一次命中。

证据：`primary/uncertain-recovery.json`（已去除真实会话 ID）、`uncertain-3-dock.png` / `uncertain-3-popout.png` / `uncertain-3-float.png` / `uncertain-3-blocked.png` / `uncertain-3-restored.png`。边界：旧版 `0.1.5-rc.2` 本轮未重跑真实不确定链路，其门控证据仍是 FR-2 的合成快照 Client 复验加共享代码路径测试，不冒充端到端通过；本轮不涉及远端会话删除。

## 最终包浏览器前置、卸载 / 重启与清理补验

RC-B `0.1.0`（SHA-256 `16a25c92…`），两版固定宿主，本轮产品代码改动 0 行。**空缓存**：把 `PLAYWRIGHT_BROWSERS_PATH` 指向空临时目录（未触碰用户共享的浏览器缓存），主基线宿主启动后为 `offline / browserReady=false`，Dock 显示「首次使用请先安装匹配的 Chromium…」指引，没有启动任何 Chromium 进程，pageerror=0。**前置完成**：同一路径链接已核对过的 `chromium-1234` 构建并配全新空 profile，宿主为 `online / browserReady=true`，输入区可用、安装指引消失。

**首次登录入口本轮未观察到**：站点对全新 profile 直接开匿名会话（插件判定 `logged_in`、输入区可用），`browser/show` 把真实页面导航到 `/sign_in` 后又被站点回跳聊天根页，`logged_out` 状态不可达，因此没有渲染登录入口。按**站点行为边界**记录，既不写成通过也不写成缺陷；首登入口仍以 FR-1 的未登录入口证据为准，实际登录凭据输入未执行、需要用户时交接。

**卸载 / 重启（两版）**：官方 `plugin --profile web remove` 后插件目录移除，profile manifest 只剩两个官方 bundle；重启后 Dock 无 Companion 入口、`/api/deepseek-companion/state` 返回 404、日志无插件加载、未启动 Chromium、pageerror=0。随后用同一归档重装：入口与路由恢复、日志仅一次加载、`online / browserReady=true`（沿用原登录副本），四个运行文件与归档逐字节相同。

**清理边界**：卸载不删除 `DSH_HOME`、`.credentials.yaml`（重装前后 SHA 相同）、sessions / storages、cordis 配置与其它 bundle；插件自己的 `deepseek-companion-uploads` 目录保留且为空（临时上传文件 0）；两版浏览器登录副本各 14 个条目完整，本轮未重新复制也未修改源 profile。测试停止后宿主进程 0、两版专属 Chromium 0。

**工具说明（不是产品结论）**：本会话文件沙箱使 pnpm 想改用临时 store，首次 remove 因 `ERR_PNPM_UNEXPECTED_STORE` 失败；用 `npm_config_store_dir` 指回原 store 后两版 remove / add 均 0 退出。另：相对 tarball 路径会按 DSH profile 目录解析，安装必须给绝对路径。

## 终审前发现的缺陷与修复（RC-C）

真实失败上传卡验收（见下文"网页真实删卡与失败卡补验"）在 RC-B 上暴露了一个**用户可见的文案缺陷**：上传失败时卡片显示 Host 传来的内部原因原文，实际看到的是 Playwright 自己的报错 `page.waitForResponse: Timeout 10000ms exceeded while waiting for event "response"`。这与 FR-3 已勾选的「用户文案不直接堆叠 Playwright 堆栈」冲突，属于首版承诺范围内的已知缺陷，因此按 FR-4 流程修复并重新冻结。

- 定位：`src/client/attachment-ui.ts` 的 `attachmentStatusText()` 在 `status === 'error'` 时把 `attachment.error` 原文拼到「失败 · 」后面；Host 侧该字段存的是 Playwright 异常文本。
- 最小修复：失败卡文案固定为「失败，请重试」；原始原因只作为卡片 `title` 提示（新增纯函数 `attachmentCardTitle()`），Host 协议、写门控与状态结构均未改。
- 回归：先补 RED 单测（技术错误原文不得进入可见文案、诊断信息必须出现在 title），再补浏览器回归（发布带 `waitForResponse` 的失败卡，断言界面无该文本且出现「失败，请重试」）。修复后 696 / 696 自动测试、8 / 8 浏览器检查通过；`lib/index.js` 哈希不变，`lib/client.js` 由 `3ddd3c2e…` 变为 `3bd5804a…`。
- 重新冻结：新归档 RC-C，SHA-256 `2cf6a441861c994cbff47371de0e8d4c8f5d5d5f81da1a927bfb6d8dce1b95c2`，仍为十文件包，与 RC-B 只有 `lib/client.js` 不同。未执行 commit / push / 发布。
- 受影响矩阵在 RC-C 重跑（主基线 Web `0.2.1-rc.2`）：真实不确定恢复（`session_unverified`、消息 / 草稿保留、三窗口提示、Enter 门控、四条写接口 409、切换后恢复写入）、两张 ready 卡精准移除、真实失败上传卡（修复后文案）与网页真实删卡、两版卸载 → 重启 → 重装，全部通过；证据与 `archiveSha256` 字段均指向 RC-C。不受该差异影响的矩阵项（核心操作、Search、SSE、页面故障、外观等）继续按"受影响源码未变"的判据复用 RC-A / RC-B 证据，理由见[证据覆盖复核](fr4-evidence-coverage.md)。

## 证据覆盖复核

逐项核对本记录矩阵与原始证据的复用依据、归档运行文件对应关系与未验边界，结论见 [最终产物证据覆盖复核](fr4-evidence-coverage.md)。要点：运行文件与 RC-B 逐字节相同的归档（RC-A、FR-3 `final-ui`）可直接复用；FR-2 旧归档只在"受影响源码未变 + 有补充证据"下复用。本轮在最终包补验了**两张真实 ready 卡精准移除一张**（`primary/b-removal.json`：被移除条目 / 页面卡 / 临时文件消失，另一张 ready 卡与页面控件保留，pageerror 0）。后两项当时未覆盖，已在 RC-C 上由用户协助以真实站点操作补齐（见下文"网页真实删卡与失败卡补验"）；仍未覆盖的是旧版 `0.1.5-rc.2` 真实删除 / 不确定链路，按已知边界与剩余风险记录。

证据：`install-exit.json`、`primary/c1-empty-browser.json` + `c1-empty-browser-dock.png`、`primary/c1-fresh-profile.json` + `c1-fresh-profile-anonymous.png`。**保留边界**：含启动凭证的日志已删除；临时副本与登录副本按下面"临时环境清理"一节在处理。最后 Review 仍是 FR-4 清单唯一未关闭项。

## 网页真实删卡与失败卡补验（用户协助，RC-C）

在最终候选 RC-C 上补齐此前只能在旧归档或自动化测试中支撑的两项，均由用户在其 DeepSeek 窗口内完成原生操作，Agent 不伪造站点行为、不修改 Host 快照 / SSE / IDB。归档 SHA-256 `2cf6a441…`，宿主 Web `0.2.1-rc.2`，产品代码仅含上一节的文案修复。

**失败上传卡（真实站点拒绝）**：用户在该窗口的 DevTools Request conditions 中阻断 `https://chat.deepseek.com/api/v0/file/upload_file*`，随后 Companion 上传第二张图。结果：新卡状态 `error`，与既有 ready 卡共存（`b-failed-and-upload` 场景两张卡）；卡面文案为「失败，请重试」（修复前显示 Playwright 原文）；带失败卡时发送按钮禁用且真实发送返回 409；点产品自身的移除控件后只删掉失败卡及其页面卡，ready 卡、它的 Host 条目与临时文件保留，发送恢复可用；pageerror 0。阻断规则由用户随后删除。

**网页真实删卡**：用户在同一窗口直接点掉托管卡的 ×（不是刷新导致的丢卡）。结果：Host 仍保留自己的 ready 条目；发送返回 409 `DeepSeek page contains image drafts not managed by Companion`，单独移除返回 409 `failed to remove the DeepSeek draft image`；原消息与本地文字草稿不变；显式新建聊天 200 后 Host 草稿清空、临时文件 0；UI 聊天 POST 0、pageerror 0。

两项证据：`primary/b-failed-upload.json`、`primary/b-failed-and-ready.png`、`primary/b-failed-removed-ready-kept.png`、`primary/b-page-deleted.json`、`primary/b-page-deleted-host-kept.png`。至此 FR-4 矩阵里"失败卡 / 网页实删卡"两项在最终候选上有了真实站点证据；旧版 `0.1.5-rc.2` 未重跑这两项，仍按共享代码路径与 FR-2 合成快照复验记录，不冒充端到端。

## 临时环境清理与剩余风险（收尾）

RC-C 冻结、受影响矩阵重跑通过后，临时验收环境已销毁：

- 先留档再删：把 scratch 根的目录结构与每个文件字节数脱敏写入 `dist/release/fr4-20261110/temp-runtime-cleanup.json`（1539 条路径，宿主会话 id、主目录名已脱敏，不含 Cookie / Token 内容）。
- 结束残留的 Playwright Chromium（`ms-playwright/chromium-1234`）进程，随后删除整个 scratch 根（约 560 MB，含 `primary-home` / `legacy-home` / 带登录态的浏览器 profile，以及安装 / 重装验证用的 node_modules）；删除后核对无其它 `dsh-fr4-*` scratch 根。Playwright 浏览器安装缓存保留（属安装缓存，不含登录态）。
- 因此后续若再需要真机复跑，必须重新搭建环境；这也是把"临时目录清理"排在最后一项的原因。

本节即为最终状态：前面各节里"临时副本继续保留 / 临时目录清理仍待验收"都是当时的进度表述，以本节为准。

**剩余风险（不冒充已验）**：旧版 `0.1.5-rc.2` 的真实删除 / 不确定链路未在本轮端到端复跑，其可信度来自与主基线共享的代码路径、FR-2 的合成快照复验以及本轮在 `0.2.1-rc.2` 上通过的真实不确定恢复与网页真实删卡；"首次登录入口"因站点给匿名会话未能观察到，按站点行为边界记录。两项均需在发布决策中作为已知缺口知悉。

## 收尾门禁复跑（RC-C 归档 ↔ 工作区一致）

清理与文档收口后重跑工程门禁，并核对归档与重新构建产物一致：`format:check`、`lint`（99 文件）、`typecheck`、`build` 全部通过；`pnpm test` 696 / 696；`pnpm test:ui` 8 / 8（跑完清掉专属 Chromium，残留 0）；`git diff --check` 干净。重新构建出的 `lib/index.js`（`db5877b8…`）与 `lib/client.js`（`3bd5804a…`）与 RC-C 归档内文件逐字节相同，归档 SHA-256 仍为 `2cf6a441861c994cbff47371de0e8d4c8f5d5d5f81da1a927bfb6d8dce1b95c2`（十文件包）。未提交、未发布。

## 独立复审（RC-C 文案修复）与处置

收尾前对本次修复做了一次独立只读复审（不复用我的推理链），基线为未提交工作区、HEAD `7c4516a`。结论：**无 Blocker**，修复最小、方向正确；`attachment.error` 为空 / 非 error 状态时不泄露内部信息，React `title` 无注入面，关闭 / 移除 / 发送门控零改动，新增单测可 RED、浏览器回归非空断言且无新增时序依赖。

处置（按"是否值得为此重冻候选"判断）：

| 编号         | 发现                                                                                | 处置                                                                                                                                                                                                         |
| ------------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| H1           | `architecture.md` 两处仍写卡片含 `error` 文案，与实现矛盾                           | **已修**：改为状态文案 `上传中… / 已就绪 / 失败，请重试` + 卡片 `title` 诊断提示                                                                                                                             |
| L1           | 浏览器回归没验 `title` 接线，回退成 `title={name}` 会静默丢诊断                     | **已修**：断言 `getByTitle(/waitForResponse/)` 计数为 1                                                                                                                                                      |
| L2           | 单测未覆盖 `error: ''` 与非 error 残留 `error`                                      | **已修**：补 4 条断言（空串回退文件名、残留不生成提示）                                                                                                                                                      |
| M1           | 「失败，请重试」未说明"先移除再重试"                                                | **接受为已知边界**：失败卡的 `×`（读屏名「移除 failed.png」）就是恢复入口，移除后重新选图即可；文案不构成死路，改文案需重冻并重做一次真实失败卡复验，收益不抵成本，排到 0.1.0 之后的首轮 UI 打磨             |
| H2           | 诊断原因只在 tooltip，键盘 / 读屏器拿不到                                           | **接受为已知边界**：丢失的是工程诊断串（如 Playwright 原文、`page: N blob previews…`），不是操作信息；读屏器仍会播报「失败，请重试」与移除按钮名。计划随首轮 UI 打磨改为视觉隐藏 `span` + `aria-describedby` |
| M2           | 卡片文案与横幅文案对同一故障给了不同下一步                                          | **接受为已知边界**：横幅管"整轮操作失败"、卡片管"这张图失败"，两者粒度不同；已在此记录分工，避免误读为不一致                                                                                                 |
| M3           | 横幅 `uiErrorText` 是正则启发式，仍可能漏出内部英文串（如 `new chat did not open`） | **接受为发布剩余风险**：修复前就存在、不在本次范围；因此 `first-release.md:117` 的承诺按"卡片固定文案 + 横幅启发式兜底"理解，不做无保留表述                                                                  |
| M4 / L3 / L5 | `state.ts` 注释仍写 "Human-readable"、`error: ' '` 尾随空格、tooltip 含工程术语     | **延后**：纯注释 / 边角文本，任何 `src` 改动都会改变运行文件哈希并连带重冻候选，留到下一次代码变更批次                                                                                                       |

复审后重跑：`format:check`、`lint`（99 文件）、`typecheck`、`build`、`pnpm test` 696 / 696、`pnpm test:ui` 8 / 8 全部通过；重新构建的 `lib/index.js`（`db5877b8…`）与 `lib/client.js`（`3bd5804a…`）仍与 RC-C 归档逐字节相同，归档 SHA-256 未变。本轮只改文档与测试，产品代码与归档未动。

## 2026-11-11 旧版支持证据补验启动（未完成）

用户要求先解决发布风险决策项，本轮选择补证，不直接接受风险或缩减支持范围。原临时环境已销毁，从本机 npm 缓存重建独立旧版工具，核对 231 个 DSH 包均为 `0.1.5-rc.2`；在新隔离 Web profile 官方安装同一 RC-C，四个运行文件与冻结归档逐字节一致，公开 `patchReload=startup`。沿用此前授权的 companion-test 登录副本，不修改源 profile / Desktop / 全局 CLI；复制时跳过临时锁与悬空运行链接。

实际启动后页面可用，已新建唯一标记 `FR4_LEGACY_DELETE_20261111_RC_C` 的一问一答测试会话，准确身份及两条消息基线只存私有临时目录。尚未删除，已向用户请求该新对象的不可恢复删除授权，不能复用 RC2 授权。旧版真实删除 / 不确定链路、首次登录入口仍为待验，本段不表示关闭风险。测试 Host 与驱动暂保留供获准后继续，尚未做本轮最终资源清理。

## 2026-11-11 旧版真实链路补齐与首登入口风险决策（已完成）

用户单独授权后，按精确源页路径与 `FR4_LEGACY_DELETE_20261111_RC_C` 标记确认唯一一问一答测试会话，通过站点“删除该对话”不可恢复确认框删除，其它会话未操作。原 Host 仍保留两消息基线；终止该隔离 profile 唯一 Chromium 主进程后，旧版 RC-C 真实经历 recovering → online / session_deleted，会话 ID=null、消息 2 → 0，界面删除提示可见，pageerror=0。此删除驱动没有额外上传附件或独立统计网络请求，因此不扩大为旧版 ready 附件清理 / 精确重发计数；附件部分仍参照主基线证据。

另建独立 `FR4_LEGACY_UNCERTAIN_20261111_RC_C` 一问一答测试，保留会话与完整消息基线。CUA 通过真实地址栏访问 chrome://crash/，观察新页面 about:blank → 目标会话后立即正常导航站点根页，实际进入 session_unverified。没有改 Host / SSE / IDB / recovery callback / history 响应。旧版原会话及完整两条消息逐项不变；Enter 后本地文字保持、额外前端 chat POST=0。真实公开 chat / attachment add / Deep Think / Search 四条写接口均 409，chat / composer 不变；有效历史切换返回 200 后 notice=null。四个直接 API 尝试与 Enter 计数分开记录，不能说所有 chat HTTP 请求为 0；该不确定会话保留，未额外删除。pageerror=0。本轮旧版新增两个短聊天轮次，不重造主基线三窗口矩阵。

两段均在固定 231 个旧版 DSH 包、公开 patchReload=startup 的独立工具 / profile 上执行；实际安装四个运行文件与 RC-C `2cf6a441861c994cbff47371de0e8d4c8f5d5d5f81da1a927bfb6d8dce1b95c2` 归档逐字节相同，未修改产品代码、依赖或归档。Browser plugin 不可用，仓库 Playwright 观察真实 Client / Host，CUA 只用于源页真实导航；未读取或公开认证。

首次登录入口再次以完全空的独立浏览器目录核对：旧版公开状态 online / logged_in，界面无登录按钮；调用 browser/show 返回 200 后仍回可用聊天页。没有输入凭据，不能称为账号首次登录成功或登录入口实测通过。**用户已明确接受此站点行为边界，要求不宣称首登入口实测通过**。不靠合成 logged_out 状态替代该事实；该风险决策不等于批准提交 / 发布。

本轮释放旧 Host 端口时有一次 EADDRINUSE，失败启动及尚无 ready URL 的观察器不计通过；正常停止精确所属进程、使用独立端口重试后完成空 profile 检查。全部驱动 / Host 已停止，所属 Chromium 0；本轮 dsh-fr4-gap-* 临时根和指针已准确清理，登录副本 / 原始日志 / 私有 ID 文件未复制入证据，源 profile 与 Desktop 未修改。

脱敏证据独立保存在 `dist/release/fr4-gap-20261111/`：deletion.json、legacy-delete.json、legacy-uncertain.json、fresh-login.json、summary.json 及对应截图 / QA 脚本。本节补齐此前旧版真实链路缺口，并记录首登入口的明确风险接受，关闭“支持范围与风险决策”这一项；其余 FR-4 文档收口、最后 Review 与明确提交授权、FR-5 仍按原顺序进行，未提交或发布。

## 2026-11-11 最后 Review 与 FR-4 收口

复核 HEAD `7c4516a` 至当前未提交集的产品代码 / 测试、RC-C 十文件归档及前述证据链。产品变化仅为失败附件固定文案、诊断 title 及其接线，未修改 Host 协议、发送 / 移除门控或恢复逻辑；空 / 缺失 error、非 error 残留值和实际 title 接线有回归。未发现新增可执行问题，没有 Blocker / High 阻塞。已知文案、诊断可访问性和横幅启发式边界沿独立复审处置保留，不把“重冻成本”本身作为豁免真实严重缺陷的理由。

旧版真实删除 / 不确定恢复补证与用户接受的首登入口边界已关闭此前风险决策；旧版删除测试没有独立附件 / 三窗口实删及网络计数，其精确范围保留，不扩大解释。RC-A / RC-B / RC-C 的变化与复用依据见覆盖表；临时目录已清理，脱敏证据留本机忽略目录，不能仅靠 Git 在另一台机器复核全部真机材料。

FR-4 的本地验收 / 最后 Review 收口，不等于公开发布或“绝对无 bug”。未运行公开写入，下一步由用户明确批准 FR-4 原子提交；FR-5 的发布日版本 / npm 权限核对、具体公开目标批准、registry / Pages 与 Discover 实装仍未执行。官方 Desktop 仍在首版范围外。当前归档摘要保持 `2cf6a441861c994cbff47371de0e8d4c8f5d5d5f81da1a927bfb6d8dce1b95c2`，不可用另一份临时 pack 替代。
