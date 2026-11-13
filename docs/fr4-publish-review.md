# 0.1.0 发布材料审阅单（FR-4）

> FR-4 已于 2026-11-11 提交为 `329e4fd`。获准发布范围见 [FR-5 授权单](fr5-release-approval.md)，已完成结果见 [FR-5 发布记录](fr5-release.md)；本文保留冻结归档与索引生成规则。

> 2026-11-11 提交记录：用户已明确授权，本次原子提交保存 FR-4 验收、修复、回归与文档。下文“待提交 / 未提交”描述的是提交前审阅状态；本提交不包含 push、tag、npm 发布或 Pages 部署。下一步为 FR-5，具体公开操作仍须对应授权。

> 2026-11-11 状态补充：旧版 RC-C 真实删除 / 不确定恢复及四个写门控已补验通过；用户明确接受首次登录入口因站点直接进入聊天而无法观察的边界，不宣称实测通过。此前旧版“仍缺”描述为历史快照，最新证据见 [候选记录末节](fr4-release-candidate.md)。本轮未提交或发布。

状态：**尚未批准发布；最终矩阵未完成时不得执行以下公开写入**。版本与验收进度见 [候选记录](fr4-release-candidate.md)。FR-5 必须取得具体目标和内容的明确批准。

## 待批准的内容

| 内容           | 值                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------ |
| npm 包         | `dsh-deepseek-companion@0.1.0`，公开包                                                     |
| 待核对的发布者 | `caelum-maple`；CLI 身份 / 发布权限 / 2FA 尚未核对                                         |
| 本地归档       | `dist/release/fr4-20261110/fixed/dsh-deepseek-companion-0.1.0.tgz`                         |
| SHA-256        | `2cf6a441861c994cbff47371de0e8d4c8f5d5d5f81da1a927bfb6d8dce1b95c2`                         |
| 兼容声明       | `0.1.5-rc.2` 或 `0.2.1-rc.2`，macOS 本地 Web，不含 Desktop / 官方 latest                   |
| 源码目标       | `https://github.com/mycherish/dsh-deepseek-companion`；实际推送分支 / 合并须另行明确批准   |
| 索引目标       | 项目 Pages `https://mycherish.github.io/dsh-deepseek-companion/index.json`                 |
| 部署文件       | 真实 `index.json` 与 `icons/companion.svg`；不部署草案、测试截图、profile、日志或整个 dist |

`https://mycherish.github.io/` 是既有个人站点，本项目使用独立项目 Pages，不覆盖个人博客。项目 Pages 设置和实际可达性尚未验收。公开包名本轮 registry 查询返回 E404，仅说明查询时未见公开包，不保证届时的发布权限或可用性。

## 批准后的命令顺序

先在最终矩阵关闭后重新核对归档内容、摘要与本表。以下命令是审阅材料，FR-4 不执行登录、发布、push、tag 或部署。

```sh
ARCHIVE="dist/release/fr4-20261110/fixed/dsh-deepseek-companion-0.1.0.tgz"
shasum -a 256 "$ARCHIVE"
npm whoami --registry https://registry.npmjs.org/
# 只有身份、权限、摘要和发布目标均获确认后才运行：
npm publish "$ARCHIVE" --access public --registry https://registry.npmjs.org/
npm view dsh-deepseek-companion@0.1.0 version dist --json --registry https://registry.npmjs.org/
```

2FA 或登录需用户完成，不提供或打印 token。若归档改变，必须先更新本表并按影响重新验收，不发布工作区临时打出来的另一份包。

## 真实索引生成规则

公开版本存在后，从 `https://registry.npmjs.org/dsh-deepseek-companion` 取得 `versions["0.1.0"]` 与 `time["0.1.0"]`，同时核对：

1. 实际版本、`engines.dsh`、bundle patch、图标、作者和仓库与获批包一致。
2. 从公开 registry 下载 tarball，验证内容 / integrity 与获批归档一致。
3. 复制 `market/index.draft.json` 的获批显示信息，把时间戳替换为实际 npm 发布时间的 Unix 秒数（`Math.floor(Date.parse(time) / 1000)`）；把顶层描述替换为正式市场简介，不保留“草案 / 请勿部署”。
4. 用官方 `parseMarketIndex` 校验产出的 `index.json`，确认安装目标恰为 `dsh-deepseek-companion@0.1.0`。
5. 仅向获批项目 Pages 部署 `index.json` 和 `icons/`。HTTPS 返回合法 JSON、相对图标可达后，再在干净固定宿主中执行 Discover 安装、登录、短聊天、三窗口和卸载烟测。

目前 `publishTimestamp: 0` 是安全哨兵，不是预定发布日期。不能提前生成一个看似已经发布的真实索引，也不能把 npm 发布完成等同于市场安装完成。

## 当前门禁与待批准动作

2026-11-11：FR-4 本地验收与最后 Review 完成。旧版真实删除 / 不确定恢复和四个写门控已补齐，首次登录入口仍未观察到，用户明确接受站点行为边界，不宣称实测通过；其它文案 / tooltip 等边界保留在候选记录。详细方法与限制见 [最终记录](fr4-release-candidate.md)。

尚未执行：用户明确授权 FR-4 提交；确定远端 / 推送与合并分支及 tag；发布当天官方版本核对；npm CLI 身份 / 权限 / 2FA；批准确切归档与公开目标；npm 发布及 registry 内容核验；真实索引生成与项目 Pages 部署；Discover 市场实装。提交授权不自动包括这些公开写入。市场实装未通过前不能写“首版已上架”。
