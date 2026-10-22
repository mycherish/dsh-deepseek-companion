# Web 插件升级与回退验收

日期：2026-10-22。基线源码：`8c24a4c`。本阶段验证本地预览包升级/回退并同步文档，验收文档审核后以一个本地原子提交保存；未新增产品代码，未执行 push、tag 或发布。

## 固定范围

验证链路：同一个隔离 profile 中安装 `0.1.0-preview.1` → 升级 `0.1.0-preview.2` → 回退 `0.1.0-preview.1`。宿主始终为两个插件版本共同支持的 **DSH Web `0.1.5-rc.2`**。

`preview.1` 的 `engines.dsh` 只声明 `0.1.5-rc.2`，因此不能把此结果理解为可以在 Web `0.2.1-rc.2` 上回退旧插件。本阶段不升级/降级 DSH，不迁移其私有数据格式，不使用版本豁免。Web `0.2.1-rc.2` 的 preview.2 核心验收仍见 [web-compatibility.md](web-compatibility.md)。

环境：macOS、Node `22.20.0`、pnpm `10.26.0`、Playwright `1.62.0` 的匹配 Chromium，DSH 页面视口 `1440 × 900`。Browser plugin 不可用，使用仓库 Playwright。

## 包与隔离方式

运行前核对两个安装包的 `.sha256`，均通过：

| 安装包                                       | 验收时 SHA-256                                                     |
| -------------------------------------------- | ------------------------------------------------------------------ |
| `dsh-deepseek-companion-0.1.0-preview.1.tgz` | `051aef118f310167701ca972b52e65a4e1d059c14f4bb918b1630a888b072d4a` |
| `dsh-deepseek-companion-0.1.0-preview.2.tgz` | `595d5d65973390cd4be3fcbf643dd66e26f19e9e3f5c20c050a6af733d8c61e7` |

- 用官方 Web 模板初始化全新临时 `DSH_HOME`，随后安装旧包，模拟已安装 Companion 的 profile。
- 沿用用户对 `companion-test` 浏览器 profile 副本的明确授权，只复制一次，过滤 Singleton 锁，放到该临时 profile 的默认 `deepseek-companion-browser` 路径。三个阶段共用该副本，没有重新复制登录数据。
- 使用公开 `--patch` 参数激活包内 patch。每次安装前完整停机，升级前备份该测试 profile 的 manifest、lockfile 和存在的 patch；没有重置浏览器目录。
- 每次 `pnpm add --offline <tarball>` 后核对实际安装版本；除 Companion 依赖外，初始 profile manifest 的其它字段与依赖均保持不变。
- 通过正常 Continue → Configure later 引导进入宿主，未填写 DSH 模型密钥，也未禁用官方插件。
- 不读取或打印 Cookie/token。会话 ID 与本轮消息正文只在内存中比较，不输出到验收日志；不记录签名 URL。原测试 profile 未修改。

## 真实运行结果

| 检查                       | 旧包基线 preview.1                            | 升级后 preview.2              | 回退后 preview.1                              |
| -------------------------- | --------------------------------------------- | ----------------------------- | --------------------------------------------- |
| 安装版本核对               | 通过                                          | 通过                          | 通过                                          |
| 登录状态                   | online / logged_in                            | 保持                          | 保持                                          |
| 旧历史恢复                 | 建立基线标记会话                              | 恢复基线 1 个会话             | 恢复基线和升级阶段 2 个会话                   |
| 历史身份与内容             | 记录服务端会话 ID 和消息内容摘要              | ID 一致、2 条消息内容摘要一致 | 两个会话分别 ID 一致、各 2 条消息内容摘要一致 |
| 新聊天                     | 1 条短请求，user + finished assistant 共 2 条 | 同左                          | 同左                                          |
| Dock / Float / 独立窗口    | 打开、显示回复、返回 Dock 均通过              | 通过                          | 通过                                          |
| SSE EOF 重连               | 有效快照后 EOF，第二条流恢复                  | 通过                          | 通过                                          |
| 重连期间行为               | 提示可见、操作禁用；原消息和草稿保留          | 通过                          | 通过                                          |
| SSE 聊天重发               | 0                                             | 0                             | 0                                             |
| 聊天 POST 总数             | 1                                             | 1                             | 1                                             |
| pageerror / console error  | 0 / 0                                         | 0 / 0                         | 0 / 0                                         |
| 停机后残留 Chromium 主进程 | 0                                             | 0                             | 0                                             |

历史验证通过插件公开 `sessions` / `switch` 路由定位已记录的服务端会话 ID，比较角色和正文摘要；不依赖可能重复的标题，也没有读取 DeepSeek 私有接口。恢复成功后再通过 UI 新建并发送当前阶段的短确认消息。该结果证明服务端历史在升级/回退后仍可访问，不代表 Host 消息已持久化。

三次冷启动的 Host 内存消息数均为 0，符合当前无 Host 消息持久化的设计；通过历史切换后才重建消息。跨启动不要求 Host 临时消息 ID 相同；SSE 在同一运行实例内重连时则核对消息 ID 保持不变。

SSE 测试让 Float 的第一条状态流返回真实有效快照后正常 EOF，第二条请求暂挂；等待 UI 出现重连提示，再断言操作禁用，填写草稿，随后放行真实流。恢复后草稿和消息 ID 不变，聊天 POST 没有增加。这次禁用检查在可控的 UI 重连状态中完成，不跨 HTTP/UI 两个瞬间作断言。

已目视核对升级、回退后的页面身份、回复展示和布局，没有空白页、框架异常覆盖层或运行时错误。无须修改产品代码。

## 清理与证据

三个阶段共留下 3 个以 `P0 upgrade rollback 2026-10-22` 开头的短测试轮次，保留在测试账号服务端，未删除。所有临时 DSH/Chromium 进程均退出，包含认证状态的测试副本与备份目录已删除；仅在仓库外保留本轮标记聊天截图与不含认证信息/会话 ID 的计数结果供 Review。

同步验收文档后重新运行完整工程门禁。最终归档仅同步 README 文案；Host/Client 运行产物、patch 和安装 manifest 与本轮已验收 preview.2 包保持一致，当前归档校验和以 `dist/release/*.sha256` 为准。以上表格保留实际运行时的包摘要。

## 可复用操作顺序

以下针对已初始化、已授权且停机的隔离 Web profile。先确认 `dsh --version` 为 `0.1.5-rc.2`，并让 `DSH_HOME` 指向隔离目录；两个本地 tarball 应已存在。备份位置须保留到升级/回退验收结束。

```sh
# 在仓库根目录记录包路径
COMPANION_PREVIEW1_TGZ="$(pwd)/dist/release/dsh-deepseek-companion-0.1.0-preview.1.tgz"
COMPANION_PREVIEW2_TGZ="$(pwd)/dist/release/dsh-deepseek-companion-0.1.0-preview.2.tgz"
COMPANION_TEST_PROFILE="${DSH_HOME:?请先设置隔离 DSH_HOME}/profiles/web"
export DSH_HOME
cd "$COMPANION_TEST_PROFILE"

# 在旧包已安装、DSH 已停止时备份公开安装配置
COMPANION_BACKUP_DIR="$(mktemp -d)"
cp package.json pnpm-lock.yaml "$COMPANION_BACKUP_DIR/"
if test -f cordis.patch.yml; then cp cordis.patch.yml "$COMPANION_BACKUP_DIR/"; fi

# 升级；完成一轮运行检查并停止 DSH 后，再执行回退
pnpm add "$COMPANION_PREVIEW2_TGZ"
```

升级或回退安装完成后，用同一启动方式检查：

```sh
dsh --profile web --patch "$COMPANION_TEST_PROFILE/node_modules/dsh-deepseek-companion/cordis.patch.yml" --no-open
```

停止 DSH 后回退：

```sh
pnpm add "$COMPANION_PREVIEW1_TGZ"
```

随后用相同命令启动，复验登录、旧历史、新聊天、窗口、SSE 和退出清理。若原来使用 profile 自己的 patch，备份并保留其其它条目；本轮只验收了官方模板加 Companion、命令行 patch 的组合，没有覆盖任意第三方插件或自定义配置的组合。

## 提交审核

核对三阶段计数结果、测试流程、包摘要和回退宿主约束，未发现其余可执行问题。文档明确区分服务端历史恢复、Host 内存与草稿的生命周期，以及插件回退和宿主迁移。复用命令显式导出 `DSH_HOME`，确保 CLI 继承已设置的隔离目录。

提交前重新通过格式、lint、类型、构建、667 项自动测试、diff、Shell 示例语法和归档检查。本次审核不重复真实聊天验收，既有三阶段证据按上述日期和版本保留。

## 本阶段之外

- DSH 宿主本身的升级/降级，以及 Web `0.2.1-rc.2` → `0.1.5-rc.2` 的配置/数据迁移。
- Windows/Linux、官方 Desktop、复杂第三方插件 profile，以及其它插件版本的回退。
- 本轮宿主为空白 Session，Dock 使用 overlay；没有重新验证非空宿主 Session 的 rightbar，既有证据仍见兼容记录。
- 会话删除、纯图片、外部草稿和剩余页面故障类别，仍按 [兼容记录](web-compatibility.md#接下来全部工作) 验收。
- 当前没有持久化未发送草稿到 Host 或磁盘；不能把同一实例 SSE 保留草稿推断为停机升级时保留输入。

验收文档审核提交后，本阶段结束。下一阶段先确定 Web 最小版发布承诺，再补会话删除、图片/草稿等承诺覆盖的剩余边界，最后冻结候选；不继续扩展功能。
