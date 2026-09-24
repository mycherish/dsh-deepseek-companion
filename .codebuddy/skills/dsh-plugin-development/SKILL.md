---
name: dsh-plugin-development
description: 用于开发、修改、调试和审查 dsh-deepseek-companion 及 DeepSeek Harness 0.1.5-rc.2 插件代码，涵盖 Cordis、DSH Client、Slots、Layout、Host/Client 生命周期和兼容性约束。
---

# DSH Plugin Development

本 Skill 固化 dsh-deepseek-companion 项目通过源码调查与真实浏览器验证确认的 DSH 0.1.5-rc.2 插件开发知识，用于快速调用领域事实。只记录已验证事实，不含推测。

更完整的工程规范见 `AGENTS.md`，架构见 `docs/architecture.md`，路线图见 `docs/roadmap.md`。本 Skill 只提供 DSH 插件开发时需要的领域知识，不重复上述文档。

## 运行环境

- 目标 DSH：`@deepseek-ai/dsh@0.1.5-rc.2`
- Cordis：`@deepseek-ai/cordis@4.0.2`
- Node：`>=22`（不锁定精确小版本）
- 技术栈：TypeScript + ESM + React Client + tsdown + pnpm

## Host Plugin 结构

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'deepseek-companion'

export function apply(ctx: Context): void {
  // ...
}
```

规则：

- 优先公开 DSH / Cordis API。
- 用 `ctx.inject`（模块级 `export const inject = [...]`）声明服务依赖。
- 生命周期资源用 `ctx.effect` 管理，返回 disposer。
- 可选能力失败不得拖垮 DSH Host。
- 不 monkey patch DSH、不修改 node_modules、不访问 DSH 私有 store 代替公开 API。

## Host Route 注册生命周期（Phase 06B 已验证，0.1.5 仍成立）

DSH 0.1.5-rc.2 中 `ctx.connection.fetch.register(route)`：

- **返回 disposer**，调用它可移除 route。
- **重复 path 会抛错**（`already registered`）。
- 其内部清理（`owner.effect(...)`）绑定的 `owner = HostConnectionService.ctx`（源码 `get fetch() { const owner = this.ctx; ... }`），即 **dsh-client-connection 自己的 Context**，**不是**调用它的第三方插件 Context。
- 因此**不要假设 `Service.ctx` 是调用插件的 ctx**；第三方插件注册 Route 必须自己管理生命周期：

```ts
ctx.effect(() => ctx.connection.fetch.register({ ... }), 'label')
```

这样插件卸载（dispose/reload）时 Route 才会一起注销，避免残留 route 和重复注册报错。

### Route 能力边界（2026-09-24 对安装版 0.1.5-rc.2 类型/源码核对）

- `methods` 只支持 **`GET | HEAD | POST`**（`lib/types/rpc.d.ts` 的 `ConnectionFetchMethod`）—— **没有 DELETE / PUT / PATCH**。
- `requestBody` 必须显式声明：`'buffered'`（受 `DEFAULT_MAX_REQUEST_BODY_BYTES = 300 * 1024 * 1024` 约束，桥接层**整包驻留内存**）或 `'streaming'`（背压、**无聚合上限**）。
- 该 buffered cap 与 DSH 官方图片通道的「200 MiB 聚合图片 + base64」同源 → **base64 传图是与 DSH 同构的做法**；`requestBody: 'streaming'` 适合将来的大文件通道。
- **没有** multipart / FormData 支持，也**没有**文件上传 helper：要么自行 base64 编解码，要么自建 `streaming` route。

## DSH Bundle 配置

`package.json`：

```json
"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
```

`cordis.patch.yml` 用 `- insert` 插入插件：

- `id`: `deepseek-companion`
- `name`: `dsh-deepseek-companion`

只插入当前插件，不删除/替换 DSH 默认 bundle，不修改 preset。不要复制旧版本 DSH bundle 配置。

## DSH Client Plugin 结构

`package.json`：

- `exports["./client"]` 指向浏览器端入口。
- `dsh.client.platform = "web"`。
- `dsh.client.inject = [...]`（包名依赖边）。

Client 入口同 Host 形状：`export const inject = [...]` + `export function apply(ctx)`。

**关键**：DSH 0.1.5-rc.2 的浏览器 Client bundle 不是普通独立 ESM 页面，而是 `window.__ModuleLoader__.load(...)` 格式的 bundle。不要擅自改成普通 browser ESM bundle，除非先验证当前 DSH loader 机制已变化。

## React 规则

- React / ReactDOM 由 DSH Web Host 提供。
- 插件**不得**打包第二份 React Runtime（会引发 duplicate React）。
- React / ReactDOM 保持 peer dependency，类型包（`@types/react` 等）为 dev dependency。

## Slot 系统（0.1.5 已验证）

| Slot | kind | scope | 用途 / 事实 |
|---|---|---|---|
| `sidebar.footer.action` | list | root | 当前用于 `DS DeepSeek` 入口 |
| `rightbar` | single | root | DSH 默认右侧 Sidebar（ui-sidebar-right）占用；Companion 临时 shadow 用 `priority: -1`（默认 occupant `priority: 0`） |
| `shell.overlay` | list | root | frame-wide 浮层，官方支持的 Shell Surface；容器 `pointer-events: none`，条目需 `pointer-events: auto` |

- `ctx.slots.register(...)` 返回 disposer；dispose 后默认 occupant 自动恢复 `active`（`entriesOfSlot` 重新投影到下一个 survivor）。
- 0.1.5-rc.2 **已删除 `details` 槽位与 `openDetails()`/`closeDetails()`**。不存在 `details` / `right-panel` / `fourth-column` / `additive-details` 扩展点，不要使用。

### slots.register 生命周期（0.1.5 语义，勿混淆）

`ctx.slots.register(...)` 有两种 cleanup 语义，**不要混淆**：

1. **调用方生命周期绑定**：0.1.5 的运行时 Service wrapper 会把注册绑定到调用方（插件）生命周期——插件 dispose 时 slot 注册自动清理（兜底）。
2. **disposer 立即卸载**：`register` 返回的 disposer 用于运行时**主动、立即**卸载当前 slot（Dock ↔ Float 切换、主动关闭）。

Companion 运行时切换 / 主动关闭**必须调用 disposer 立即卸载**，不能等插件 dispose。任何时候最多只有一个 Companion registration（用 `open` 标志 + disposer 判空防重复）。

## Surface 选择与 Session blank（最重要兼容事实）

DSH 0.1.2-rc.1 的 `details` 槽位只在当前 Session `blank === false` 时有实际列宽，blank Session 下宽度为 0（历史原因）。**0.1.5-rc.2 已删除 `details`**，non-blank Surface 迁移为官方 `rightbar` 单槽。

0.1.5 的 `rightbar` 是 `root` scope 单槽（不依赖 Session），blank / non-blank 都能显示。展示策略仍按 Session blank 选择：

- `blank === false` → `rightbar`（conversation 真实缩窄，dock 在官方右侧列）。
- `blank === true` 或无可用 non-blank Session → `shell.overlay`（frame-wide 浮层，conversation 不缩窄）。

**禁止假设单一 Surface 覆盖所有 Session 状态。**

## Companion 展示策略（v0.0.3 已验证，0.1.5 迁移）

打开 Companion 时读取当前 Session `blank` **一次**：

- `blank === true` 或没有可用 non-blank Session → `shell.overlay`
- `blank === false` → `rightbar`

展示方式只在 `open()` 时决定一次。Companion 打开期间即使 Session 从 blank → non-blank，也**不要**自动从 overlay 切到 rightbar（避免布局跳动、焦点丢失、滚动变化、未来 Composer 输入状态丢失）。只有 close → 再 open 才重新判断。

## rightbar 动态占用（正确生命周期）

不要在插件加载时永久 shadow DSH 右侧 Sidebar。

- open non-blank：`register` Companion into `rightbar`（`priority: -1`）→ `ctx.layout.openRightbar(true, false)`（保留 grid track）
- close：`ctx.layout.closeRightbar()` → dispose Companion rightbar registration
- dispose 后 DSH 默认右侧 Sidebar 恢复 `active`
- 任何时候最多只有一个 Companion registration（用 `open` 标志 + disposer 判空防重复）

## Session 状态规则

通过 `@deepseek-ai/dsh-api-session-controller` 的公开只读 API `ctx.sessions.list` 读取 Session 信息（`current` / `blank` / `phase` 等）。

严禁：直接改 `session.blank`、改 `blankBit`、伪造 `running`、改 Session 私有 Store、发送隐藏 prompt、创建假消息。不要为了让 rightbar 可用而污染 Session 语义。

## Layout 规则

`ctx.layout.openRightbar(track, fullscreen)` / `ctx.layout.closeRightbar()` 属于 DSH 官方 Layout Service（0.1.5 的 `ILayout`）。`toggleSidebar()` / `selectPanel()` 亦可用。

不要通过 `document.querySelector`、`MutationObserver`、`appendChild`、直接改 DSH 主 DOM、monkey patch `AppFrame` 来实现右侧面板。若官方 Layout/Slot API 不满足需求，先停止并调查，不自动采用 DOM Hack。

## Width Ownership（谁拥有布局，谁拥有宽度）

宽度归属是稳定架构事实：

- `shell.overlay`：Companion owns width。自定义 resize handle，宽度持久化到浏览器 localStorage（key：`dsh-deepseek-companion:overlay-width`）。
- `rightbar`：DSH owns width。使用 DSH 原生 DragHandle，Companion 不控制、不持久化、**禁止同步** rightbar 宽度。

overlay 与 rightbar 宽度故意独立，绝不相同步，也不把 localStorage 的 overlay 宽度应用到 rightbar。

## Host / Client 边界

长期架构：Host 拥有未来的 Browser State、Auth State、Conversation State、Message Store；Client 只负责 UI（Dock open/close、展示方式、Resize width、滚动等纯 UI 状态）。

不要把 DeepSeek 会话、消息、认证、浏览器生命周期长期存进 React Component state。

## Playwright 页面函数契约（2026-09-24 实机验收确认）

`page.evaluate(fn)` / `waitForFunction(fn)` 会把**函数体序列化**进页面执行：函数体内引用任何模块级 helper、常量或导入都会变成 `ReferenceError`（Host 侧只看到 `page.evaluate` reject）。

- 页面函数必须**完全自包含**：DOM 操作、选择器、常量全部内联在函数体内；跨函数调用同样不允许。
- 失败要显式暴露：`catch` 成「空数组 / 0 个」会把序列化错误伪装成「页面上没有东西」，排查成本极高。
- 需要注入测试替身时，用 `payload.env ?? globalThis` 模式（本仓库 `draft-images.ts` / `new-chat.ts` 的写法）。
- 页面 *读取* 也要限定作用域：整文档扫描（如所有 `img[src^="blob:"]`）会把已发送消息里的图片也算进来，必须限定到 composer 等具体容器。
- 几何点击前必须双重校验（命中元素特征 + 点击后目标状态），并给出安全失败。

## Playwright 生命周期与恢复事实（2026-09-24 故障注入确认）

Persistent context（`chromium.launchPersistentContext`）与普通 launch 的语义**不同**，恢复/重建必须按下面的事实写：

- `context.browser()` **非 null**（`isConnected()` / `version()` 可用），但 **`browser.process()` 不存在** → Playwright 侧拿不到 Chromium 的 PID；测试要 kill 进程只能走进程树（`pgrep -P`）。
- **`context.close()` 等于浏览器关闭**：同时触发 `context:close` + `browser:disconnected`，`isConnected()===false`，`newPage()` 抛 `TargetClosedError`。没有「只重建 context」这一层。
- 事件可靠性（实测）：
  | 故障 | `page.close` | `page.crash` | `context.close` | `browser.disconnected` |
  |---|---|---|---|---|
  | `page.close()` | ✅ | ✖ | ✖ | ✖ |
  | renderer crash | ✖ | ✅（~300ms） | ✖ | ✖ |
  | `context.close()` | ✖ | ✖ | ✅ | ✅ |
  | `kill -9` 主进程 | ✅ | ✖ | ✖ | ✅（~30ms） |
- **renderer crash 不可用「状态」发现**：`page.isClosed()===false`、`page.url()` 仍返回旧 URL、`browser.isConnected()===true`；只有 `page.on('crash')` 事件（操作报错文本是 `Page crashed` / `Target crashed`）。**crash 的页面不可复用**：`goto` / `reload` 都抛 `Page crashed` → 必须 `page.close()` + `context.newPage()`。
- **pending waiter 快速失败**：kill 后 pending 的 `waitForResponse` / `response.finished()` 在 **~30 ms 内** reject（`TargetClosedError`），**不会**等满 timeout → Host 的 `sending` / guard 能在 finally 里立刻归零。
- **`context.exposeFunction` 是 context 级**：同 context 内新建的 page 仍有该函数（重建 page 不必重装）；但**浏览器重建后必须重装**，否则发送「成功」却永远收不到页面回调。
- **profile 锁不需要人工清理**：`SingletonLock/Cookie/Socket` 存在时，同一 `profileDir` 在 `close()`（即使未 await）或 `kill -9` 之后**立即**重启都成功（555–711 ms，登录态保留）；**禁止删除 lock 文件**。若另一个实例仍**存活**，第二次 launch **176 ms 快速失败**，错误信息误导（报成 `Target … has been closed`）→ 只能靠有限重试 + 如实报 offline 处理。
- **判定禁止基于错误文案**：文案会变（`TargetClosedError` / `Page crashed` / `Target crashed`），一律用 `isClosed()` / `isConnected()` / crash 事件标记判定。
- **「活着但不可用」的页面必须靠分类发现**：`about:blank` 之类页面 `isClosed()===false`、`isConnected()===true`，但功能不可用（业务操作要等满 locator timeout）→ 恢复的判定要用「生命周期状态 + origin + **bounded DOM readiness（≤2s，禁止无上限轮询）**」分类（healthy / login-required / invalid-page / page-dead / browser-dead），**sign-in 页面天生没有 composer，不能据此判 invalid**。
- **page 替换后必须抑制过期回调**：给每次 page 替换 / 浏览器重建递增 `pageEpoch` / `browserEpoch`，listener 与异步操作在注册时捕获 epoch、回调用 `captured !== active` 早退；尤其是 `framenavigated`、auth response、delta 回调与「send 结束时的最终 DOM 读取」。比较页面**对象引用**不可靠（crash 未 close 的旧 page 仍是活引用）。
- **每一步恢复动作都要有自己的 timeout**（close / newPage / goto / 登录探测 / DOM readiness / 单次尝试总上限），否则「有限重试」会被某一步的无限等待架空。
- 恢复/重建必须 **single-flight**（一个 in-flight promise + 有界重试 + `finally` 清锁），并与「页面操作互斥」（PageGuard）**分开**：前者是浏览器生命周期，后者是谁可以点页面。

## 后续 Browser 约束（工程约定）

Browser Engine 使用 Playwright（已接入）：Browser 生命周期属于 Host；selector 集中管理；使用有限 timeout/retry；登录走 DeepSeek 官方页面；不记录 Cookie/Token/密码；Browser/Profile 数据不得进入 Git。

## DSH API 兼容原则

DSH API 变化较快。禁止因旧项目示例存在就直接复制旧 API——旧版 `dsh-web-chat` 曾使用旧 Client Runtime / Slot API，不能直接视为 0.1.5-rc.2 官方结构。

遇到版本敏感 API，优先级：

1. 阅读本机目标版本源码
2. 阅读当前官方文档
3. capability detection
4. type guard
5. dynamic fallback

不要猜。

## 开发流程

每次只完成当前 Phase；修改后执行 `pnpm typecheck`、`pnpm build`、`pnpm test`、`git diff --check`；未经用户批准不 commit、不 push、不进入下一 Phase。完整 Git 规范见 `AGENTS.md`。
