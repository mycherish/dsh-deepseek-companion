# DSH 交接：Web 首版已发布，待发布记录审阅

> 2026-11-13 收尾记录：用户在明确列出文档提交、快进合入 / 推送 main 及清理已完成本地分支的步骤后回复“继续下一步”，本次按该范围执行。下文“文档尚未提交 / 待授权”保留为发布完成时的历史快照。本提交归档 FR-5 发布记录；不改变运行代码、npm 0.1.0、gh-pages 或 v0.1.0。

当前状态（2026-11-12）：FR-5 四项获准公开操作及市场实装全部完成，见 [发布记录](fr5-release.md)。不要重发 npm 包、重复部署或重建 v0.1.0；本轮文档尚未提交，需要用户单独授权。下文为发布前交接背景，原待办已由发布记录覆盖，旧临时环境已清理。

> 2026-11-11 提交记录：用户已明确授权，本次原子提交保存 FR-4 验收、修复、回归与文档。下文“待提交 / 未提交”描述的是提交前审阅状态；本提交不包含 push、tag、npm 发布或 Pages 部署。下一步为 FR-5，具体公开操作仍须对应授权。

更新：2026-11-11。以 `AGENTS.md` 和 [first-release.md](first-release.md) 为执行规范；本文是当前接手导航，不是 commit / push / tag / publish / 部署授权。

## 当前目标与状态

先交付 macOS 本地 Web 首版，不扩功能或改设计，不适配 Desktop。FR-4 本地验收与最后 Review 已完成，未发现新增可执行问题；首次登录入口未观察到，用户明确接受站点行为边界，不宣称实测通过。没有绝对零 bug 保证，后续发现真实缺陷仍需修复与针对性复验。

- 当前分支 `codex/fr4-release-freeze`，HEAD `7c4516a`；FR-4 仍全部未提交。
- `codex/fr3-ui-hardening` 也指向 `7c4516a`；本地 main 停在 FR-2 `f55a76a`。
- 整个待提交集包含版本 / 市场元数据、文档，两个产品源码文件（失败附件文案与诊断 title）及对应两个测试文件。不能把整个差异描述成“只有文档”。接手先重新检查 `git status` / `git diff` / 未跟踪文件。
- 本地 Git remote 前次检查为空，推送前重新核对。源码目标为 `git@github.com:mycherish/dsh-deepseek-companion.git`，不是已推送状态证明。
- 用户 npm 账号 `caelum-maple`；发布权限 / CLI 身份 / 2FA 未核对。项目索引拟为 `https://mycherish.github.io/dsh-deepseek-companion/index.json`，不覆盖已有个人博客。

## 唯一当前候选：RC-C

- 路径：`dist/release/fr4-20261110/fixed/dsh-deepseek-companion-0.1.0.tgz`。
- SHA-256：`2cf6a441861c994cbff47371de0e8d4c8f5d5d5f81da1a927bfb6d8dce1b95c2`，十文件包。
- engines：`0.1.5-rc.2 || 0.2.1-rc.2`；Playwright `1.62.0`。
- 四个构建运行文件与归档需保持一致，不能临时重新 pack 后发布另一份包。
- RC-A / RC-B 仅是保留的历史证据。RC-C 只改失败卡 Client 文案 / title，受影响矩阵已重跑，其余复用依据见 [覆盖表](fr4-evidence-coverage.md)。产品 / 依赖 / patch / UI 产物再变时，重新冻结并复验受影响项目。
- 归档与证据在 Git 忽略目录中，不随源码提交自动转移。异机接手必须另行获得脱敏归档与证据，不能只凭文字声称完整实测。

## 已完成的验收与边界

完整过程见 [候选记录](fr4-release-candidate.md)，包括真实核心聊天、图片、三窗口、SSE / 浏览器 / 页面恢复、外部草稿冲突、主题 / 缩放、升级回退、安装退出、失败卡与真实删卡的证据链。

- 主基线真实删除 / 不确定恢复和写门控通过；旧版的同类真实链路已在 2026-11-11 补证，见 `dist/release/fr4-gap-20261111/`。
- 旧版补验删除场景只核对两消息清理，未独立测 ready 附件 / 三窗口实删与精确网络计数，不扩大解释。
- 空 profile 被站点直接带入可用聊天页；登录入口未观察到且未输入凭据。用户接受此边界，不勾选“首次登录实测通过”，DSH 账号登录也不等于 DeepSeek 网页账号登录。
- 失败卡文案“失败，请重试”未解释先移除再选图、工程诊断仅 title、横幅启发式可能漏内部串等边界已在复审表记录；后续 UI 打磨处理，不在当前收口中扩 scope。
- RC1 已由用户手动删除，RC2 和旧版专用删除测试分别经单独授权删除完成。不要重跑删除脚本，过去授权不适用于新对象。
- 原生中文输入法为用户人工确认；合成 UI 回归不替代真实输入法 / 站点证据。

## 测试环境已清理

原 `dsh-fr4-*` 与补验 `dsh-fr4-gap-*` 临时根、登录副本、私有定位文件与含启动认证 URL 的日志均已按所属清理，关联 Chromium 为 0。不要依赖旧 `/tmp/fr4-runtime-path` / `/tmp/fr4-gap-runtime-path` 或 Codex session ID，不再把这些当成可续用环境。

忽略目录中留存的 QA 脚本是历史一次性工具，可能有发送 / 删除逻辑，不要批量执行。新验收需另建隔离环境，准确限定 profile / 进程，不修改原测试 profile 或用户日常 Desktop，不读取 / 打印 / 提交 Cookie、token、签名 URL、登录目录和原始 Host 日志。

## 下一步：取得 FR-4 原子提交授权

1. 阅读 `README.md`、`AGENTS.md`、[architecture.md](architecture.md)、[roadmap.md](roadmap.md)、[first-release.md](first-release.md) 及最终候选 / 覆盖记录。
2. 核对当前工作区、归档摘要、运行产物与文档一致；保护全部既有修改，不 reset / checkout 覆盖、不强推。
3. 如接手后有新修改，按规范运行 formatter、lint、类型检查、构建、测试和 diff 检查。行为变化加相应 UI / 真机复验。
4. 把确切提交范围和 Review 结论交用户；明确获准后，一个 FR-4 原子提交，双语 Conventional Commit。不要仅凭“继续”执行提交。
5. 提交后报告 commit / status；提交不等于获准 push / 合并 / tag / 发布。

## FR-5 发布待办（尚未执行）

以 [发布审阅单](fr4-publish-review.md) 的确切归档和目标取得对应批准后执行：

1. 实际发布当天重新核对官方版本；保持已验证的固定支持范围，不能自动扩大 engines。
2. 核对 npm 身份、权限和 2FA，由用户完成凭据 / 验证码输入；明确远端、推送 / 合并分支、版本节点和公开目标。
3. 只发布获批摘要归档，从 registry 复核版本、内容 / integrity、engines 与真实发布时间。
4. 生成并校验正式 format-1 `index.json`，使用实际 npm 发布时间；`market/index.draft.json` 的 `publishTimestamp: 0` 仍是未发布哨兵，禁止直接部署。
5. 仅部署获批项目 Pages 的索引和图标，核对 HTTPS / JSON / 图标，不上传整个 dist、测试截图、profiles 或日志。
6. 在干净固定宿主中启用 Custom plugin markets，实际 Discover 安装，验登录 / 短聊天 / 三窗口、升级边界和卸载重启。通过后才写“已上架”；失败按获批方案修复或回退。

## 官方 Desktop

目前所有真实宿主验收都是 Web；官方 Desktop 只做过只读调研。本机所调查官方版本 `0.2.2-rc.1` 不在 engines 内，源码还拒绝当前 Pop-out 所用的新窗口。见 [Desktop 分析](desktop-compatibility.md)。独立适配在 Web 首版之后另立计划并 Review，不修改 DSH 源码、ASAR、私有 IPC 或日常 profile，不把当前包直接安装进去。

给接手者的当前任务：核对 FR-4 收口状态后，准备供用户批准的原子提交；未获对应授权前不提交、不公开发布。不要重新执行已经完成的旧版删除测试或继续寻找已不存在的临时 profile。
