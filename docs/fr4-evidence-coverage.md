# FR-4 最终产物证据覆盖复核

复核日期：2026-11-10。目的：逐项核对 [0.1.0 候选记录](fr4-release-candidate.md) 的验收矩阵与原始证据，说明每一项**凭什么可以复用**旧归档、哪些必须针对最终包补验、哪些仍是未验边界。执行依据 [first-release.md](first-release.md) §FR-4 与 [交接文档](dsh-handoff.md) §5B。本复核不改变验收范围；如范围需要变化，先更新首版计划并 Review。

## 1. 归档与运行文件对应关系

复用判定的第一条是运行文件是否逐字节相同，而不是文档写了"同一归档"。

| 归档                                               | SHA-256（前 16）   | `lib/index.js`     | `lib/client.js`    | 与 RC-B 关系                                 |
| -------------------------------------------------- | ------------------ | ------------------ | ------------------ | -------------------------------------------- |
| **RC-C 当前候选 `fixed/…0.1.0.tgz`**               | `2cf6a441861c994c` | `db5877b8f04d7721` | `3bd5804a94474e97` | 基线（终结）                                 |
| RC-B（上一候选）`user-docs-frozen/…0.1.0.tgz`      | `16a25c92cefcf9a6` | `db5877b8f04d7721` | `3ddd3c2e70f5db3f` | 只差 `lib/client.js`（失败卡文案）           |
| RC-A `frozen/…0.1.0.tgz`                           | `84b92175d439a7bd` | `db5877b8f04d7721` | `3ddd3c2e70f5db3f` | 运行文件完全相同，仅 README / Changelog 不同 |
| FR-3 `fr3-ui-20261108/final-ui/…preview.2.tgz`     | `a2e73859398e833d` | `db5877b8f04d7721` | `3ddd3c2e70f5db3f` | 运行文件完全相同                             |
| FR-2 页面故障 `fr2-pages-20261106/…preview.2.tgz`  | `9f162c3fdc33b704` | `db5877b8f04d7721` | `01bd92300f1c8021` | Host 相同，Client 不同（FR-3 改版前）        |
| FR-2 会话 / 图片 / 不确定 `fr2-session-20261104/…` | `5c3ce39446145344` | `a47d5fadf594ebf1` | `01bd92300f1c8021` | Host 与 Client 均不同                        |

另外用 `git log` 核对了受影响源码：附件 Host 路径（`src/host/attachment-route.ts`、`attachments.ts`、`draft-images.ts`）自图片功能落地（`db7daf6`、`c585305`）后未再修改；FR-2 提交 `f55a76a` 改的是页面健康与错误生命周期；FR-3 提交 `7c4516a` 只改 Client 界面层。

## 2. 逐项覆盖结论

| 矩阵项                                                  | 证据                                                                 | 产生归档        | 复用依据                                                        | 结论                             |
| ------------------------------------------------------- | -------------------------------------------------------------------- | --------------- | --------------------------------------------------------------- | -------------------------------- |
| 安装 / 浏览器前置 / 首登入口                            | `install-exit.json`、`primary/c1-*.json`                             | RC-B            | 最终包直接产出                                                  | 通过；首登入口按站点行为边界记录 |
| 核心文本 / Markdown / 代码 / Deep Think / Search / Stop | `primary/observations.json`、`legacy/observations.json`              | RC-A            | 运行文件与 RC-B 逐字节相同                                      | 可复用                           |
| 三窗口 / 历史 / 新建                                    | `primary/observations.json`、`legacy/observations.json`              | RC-A            | 同上                                                            | 可复用                           |
| 图文 / 纯图片 / 历史 / 文件名降级                       | `primary/observations.json`、`legacy/observations.json`              | RC-A            | 同上                                                            | 可复用                           |
| 外部草稿与附件冲突                                      | `primary/conflicts.json`、`legacy/conflicts.json`                    | RC-B            | 最终包直接产出                                                  | 通过                             |
| SSE / 页面 / Chromium / 流式回填                        | `primary/page-faults.json`、`legacy/page-faults.json`、FR-2 流式记录 | RC-B / RC-A     | 页面故障六项在 RC-B 重跑；SSE 与流式回填在 RC-A（运行文件相同） | 通过                             |
| 删除 / 不确定与写门控                                   | `primary/delete-rc2-*.json`、`primary/uncertain-recovery.json`       | RC-B            | 最终包直接产出                                                  | 主基线通过；旧版边界见 §3.3      |
| 主题 / 字体 / 窄屏 / 缩放 / 减少动态效果                | `primary/appearance.json`、`legacy/appearance.json`、FR-3 截图       | RC-A / FR-3     | 运行文件相同                                                    | 可复用                           |
| 操作系统中文输入法                                      | 人工确认记录（候选记录）                                             | RC-A 期人工步骤 | 人工结论不可由自动测试替代；当时使用独立测试 Chrome 窗口        | 人工通过，保留人工边界           |
| 升级 / 回退                                             | `runtime-install-sequence.json`                                      | RC-B            | 最终包直接产出                                                  | 通过                             |
| 卸载 / 重启 / 清理                                      | `install-exit.json`                                                  | RC-B            | 两版最终包直接产出                                              | 通过                             |

## 3. 三个重点项的精确边界

### 3.1 失败上传卡精准移除（保留另一张 ready 卡）

- 历史证据：`fr2-images-20261106/results.json` 的 `failedUpload` 记录了站点拒绝后卡片为 `error`、Client 移除后失败卡消失、另一张 ready 卡与 Host 条目保留、临时文件剩 1、真实 Host 发送 409。该证据产生于归档 `5c3ce394…`，其 Host 与 Client 运行文件都与 RC-B 不同。
- 复用判定：附件 Host 路径自图片功能落地后未再修改（见 §1），Client 在 FR-3 改版但"错误卡 + 移除控件"的渲染已由 FR-3 浏览器测试覆盖（`tests/browser/companion.test.ts`：`failed.png` 错误卡渲染、`移除 failed.png` 可用、ready 卡时发送可用）。
- 本轮针对最终包补验（`primary/b-removal.json`，RC-B）：真实上传**两张** ready 卡 → 用产品自身移除控件移除一张 → 被移除条目、其页面卡与临时文件消失（2 → 1），另一张卡保持 `ready` 且页面仍有两张移除控件中的一张，pageerror 0。这补齐了"精准移除、保留另一张"在最终包上的真实站点证据。
- **失败卡变体已在最终候选补齐（RC-C，用户协助）**：用户在真实 DeepSeek 窗口的 DevTools 里阻断上传端点，Agent 用产品自身控件上传第二张图，得到真实 `error` 卡：卡面文案为「失败，请重试」、带失败卡时发送禁用且真实发送 409、移除失败卡后 ready 卡与其页面卡 / 临时文件保留。**该次验收同时暴露并修复了一个缺陷**：修复前卡面直接显示 Playwright 原文，见候选记录的"终审前发现的缺陷与修复"。

### 3.2 网页实际删卡 与 本轮刷新丢卡的区别

- 最终包 `primary/conflicts.json` / `legacy/conflicts.json` 覆盖的是**外部刷新导致托管卡丢失**：Host 仍持 ready 条目，send 409、单独 remove 409、显式 new 才清理。记录中已明确"没有冒充点击网页删除按钮的证据"。
- **网页上真实点击删除托管卡**的历史证据在 `fr2-images-20261106/results.json` 的 `externalDelete`（`cardRemovedViaNativeUI: true`、`explicitRemoveRefusedWhenCardMissing: true`、`newChatClearsHostDraft: true`），同样产生于 `5c3ce394…`。
- 本轮先在 RC-B 上尝试用公开辅助功能接口点击站点控件未成（宿主未暴露网页内容树）；随后改为**用户在该窗口内直接点掉托管卡的 ×**，在 RC-C 上完成补验：Host 保留自己的 ready 条目，发送 409、单独移除 409，原消息与本地草稿不变，显式新建才清理 Host 草稿。至此"网页真实删卡"在最终候选上有了真实站点证据。
- 两者对 Host 的差别仅在"卡为什么消失"：Host 侧结论一致（缺卡时 send / remove 均 409，显式 new 才清理），该结论在最终包已由 §3.1 与 conflicts 证据实际观察。

### 3.3 旧版真实链路：2026-11-11 已补齐

旧版 RC-C 的真实删除恢复、不确定时原会话 / 完整消息保留、Enter 门控、四个写接口 409 及有效历史切换解除提示已有 `dist/release/fr4-gap-20261111/` 证据。删除场景核对两消息清理，未另测旧版 ready 附件与三窗口独立实删，不扩大为这些维度；主基线相应证据仍保留原范围。旧版 Search 未另做独立源页逐条比对。

首次登录入口在空 profile 仍不可观察，用户明确接受此站点行为边界，不填写实测通过。补验环境已销毁，后续变更若需要重跑，必须重新搭建。

## 4. 结论

1. 凡运行文件与 RC-B 逐字节相同的归档（RC-A、FR-3 `final-ui`），其真实运行证据可直接复用，不需要仅因文档版本号不同而重跑。
2. 与 RC-B 运行文件不同的旧归档（FR-2 `5c3ce394…`）只在"受影响源码未变 + 本轮有替代或补充证据"的前提下复用，逐项理由见 §2、§3。
3. 最终包已补的两项：两张真实 ready 卡的精准移除（§3.1）、两版卸载 → 重启 → 重装与资源清理（`install-exit.json`）。
4. 站点真实拒绝上传的 `error` 卡与网页真实点击删除托管卡，均已通过在最终候选 RC-C 上的用户协助验收补齐（并顺带修复了失败卡暴露内部错误文本的缺陷）。旧版真实删除 / 不确定链路已由 2026-11-11 补验关闭；首次登录入口仍按用户接受的未观察边界记录。
5. 这些边界不改变首版"异常路径不会误发、重复发送、错误清空或串会话"的标准：缺卡与错误卡的写入门控在最终包上有实际观察，未覆盖的是产生错误卡的注入方式本身。

## 2026-11-11 补充：旧版真实链路与首登入口决策

旧版 RC-C 的真实删除恢复、session_unverified 原会话 / 消息保留、Enter 门控、四个写接口 409 及有效历史切换解除提示，已在新隔离环境补验。此前 §3.3 的“未执行”只描述补验前状态，现由 `dist/release/fr4-gap-20261111/` 证据补齐。该次删除只测两消息清理，不扩大为旧版 ready 附件或三窗口独立实删验收。首次登录入口在全新 profile 仍不可观察，用户已明确接受站点行为边界，不勾选入口实测通过；未输入凭据。精确方法、计数和清理见候选记录末节。
