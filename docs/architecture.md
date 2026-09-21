# 架构（Architecture）

`dsh-deepseek-companion` 的长期架构。本文档描述目标形态，不代表当前已实现。

## 总览

```
DeepSeek Browser
        │
        ▼
      DSH Host
        │
 ┌──────┼─────────┐
 │      │         │
Auth  Browser  Conversation
State State     State
 │      │         │
 └──────┼─────────┘
        │
    HTTP / SSE
        │
   ┌────┴────┐
   ▼         ▼
Dock UI   Pop-out UI
```

## 核心原则

### Host 拥有状态，Client 只负责 UI

未来的核心状态全部由 Host 管理：

- Browser State
- Auth State
- Conversation State
- Message Store

React Client 只负责渲染，**不得**成为聊天状态的唯一 Owner。
这样 Dock 与 Pop-out Window 才能共享同一套状态。

### Host / Client 边界

- Host Runtime import 与 Type-only import 必须明确区分。
- 插件不能因为可选能力失败而导致整个 DSH Host 崩溃。
- 所有生命周期资源由 `ctx.effect` 管理。
- Browser、SSE、Timer、Connection 等资源必须支持 dispose。
- 不修改 DSH 源码实现插件功能。
- 不直接操作 DSH 内部数据库或私有文件格式。
- 不 monkey patch DSH。
- 不使用 DSH 私有 API。

### 兼容性策略

- 当前首要兼容目标：DSH 0.1.5-rc.2。
- 后续兼容其他版本时优先做 capability detection。
- 版本敏感 API 优先 `ctx.inject` / capability detection / type guard / runtime feature detection。
- 不假定所有 DSH 版本 API 一致。
- DSH API 不确定时先阅读官方源码/文档，不允许猜测。

## Companion Dock Surface Strategy（Phase 04 已验证）

Companion Dock 在用户点击 sidebar 入口时打开。打开时根据当前 Session 的 `blank` 标志，选择一个官方 Surface 占用：

| 当前 Session | Surface | 槽位 / Scope | 效果 |
|---|---|---|---|
| 非 blank（`blank === false`） | `rightbar` | 单槽、`root` scope | conversation 真实缩窄，dock 在官方右侧列内（`openRightbar(true, false)` 保留 grid track） |
| blank（`blank === true`）或无当前 Session | `shell.overlay` | 列表槽、`root` scope | frame-right 浮层（fixed right 420px），conversation 不缩窄 |

### 规则

- Surface 在 `open()` 时只决定一次，open 期间不变。即便 Session 的 blank 状态发生变化，也不切换 Surface（避免 UI 跳动、焦点丢失、未来聊天输入状态被冲掉）。
- 只有 `close` → 再次 `open` 时才重新读取 Session blank 并选择 Surface。
- 任何时刻最多只有一个 Surface registration（rightbar 或 overlay）。`close()` 调用对应的 `dispose`，DSH 默认右侧 Sidebar（ui-sidebar-right）与 `shell.overlay` 容器都自动恢复原状。

### 原因

DSH 0.1.2-rc.1 的 `AppFrame` 在 blank Session 时强制 `details` 宽度为 0，且 blank Session 无法合法变为 non-blank，因此当时的 `details` 无法作为唯一 Surface（历史原因）。0.1.5-rc.2 已删除 `details` 槽位与 `openDetails()`/`closeDetails()`：non-blank Surface 迁移为官方 `rightbar` 单槽 —— Companion 以 `priority: -1` 临时占用（与 0.1.2 details 同一套 shadow/restore 模式），`ctx.layout.openRightbar(true, false)` / `closeRightbar()` 控制显隐。`shell.overlay`（`root` scope、不依赖 session）作为 fallback 保证「新建 Session 立即可用」的核心需求，0.1.5 语义不变。

## Companion Dock Width（Phase 05A / 05B）

### Width Ownership（谁拥有布局，谁拥有宽度）

| Surface | 宽度拥有者 | 调整方式 | 持久化 |
|---|---|---|---|
| `shell.overlay` | Companion | 自定义 resize handle（Pointer Capture） | ✅ browser localStorage |
| `rightbar` | DSH | DSH 原生 DragHandle（0.1.5 rightbar 列） | ❌ Companion 不持久化 / 不同步 |

overlay 与 rightbar 的宽度**故意独立**，绝不相同步。

### overlay（Companion owns width）

- 宽度由 Client 内存态 `dockWidth` 控制（默认 `420px`，`resize.ts` 的 `DOCK_DEFAULT_WIDTH`），左边缘 `col-resize` 拖动把手实时调整（`widthFromPointer` / `clampDockWidth`）。
- **持久化**：Client 初始化时从 localStorage 读取一次偏好，运行期用内存值；`pointerup` 结束时写入 localStorage。key 为 `dsh-deepseek-companion:overlay-width`（`storage.ts`）。
- 读取/写入对 localStorage 异常安全降级（读失败用默认 420、写失败仅本次不持久化），绝不抛进 React tree。
- 刷新页面或重启浏览器后从 localStorage 恢复；跨 blank Session 共享（是插件 UI 偏好，非 Session 属性）。

### rightbar（DSH owns width）

- DSH 0.1.5-rc.2 的 `ctx.layout`（`ILayout`）公开 `toggleSidebar()` / `selectPanel()` / `openRightbar(track, fullscreen)` / `closeRightbar()`，**不提供列宽修改 API**；列宽由 `AppFrame` 依 `RightbarOwnerProps.width` 解析并配合内置拖动把手调整，插件只报告显隐与 track/fullscreen 组合。
- rightbar 保持 DSH 解析宽度（`RIGHTBAR_MIN = 300`，首开偏好 `RIGHTBAR_DEFAULT_RATIO = 0.45`，上限 `RIGHTBAR_MAX_RATIO = 0.7`），复用 DSH 自带的拖动把手。localStorage 中即使保存 600，也**不会**应用到 rightbar。

### 结论

- overlay resize + 持久化 ✅ 可合法实现。
- rightbar resize ❌ 被 DSH 官方 API 限制；Companion 不控制、不持久化、不同步 rightbar 宽度。
- 是否后续单独做 rightbar 宽度兼容层，待架构决策。

## Companion Pop-out（Phase 06A）

### 现状

- 使用 **browser-native `window.open`**（DSH 不提供公开 pop-out / detached-window API；0.1.2-rc.1 与 0.1.5-rc.2 的官方 client 插件 bundle 中均无 `window.open(` 使用先例）。
- **单实例**：固定 `window.name = 'dsh-deepseek-companion-popout'`；已存在且未关闭时 `focus()`，否则重新创建。
- **React 渲染**：通过 DSH ModuleLoader 暴露的 `react-dom/client` 的 `createRoot` 渲染到 popup document（复用宿主 React runtime，不打包第二份 React）。
- 初始尺寸 `480 × 720`，`resizable` / `scrollbars`；本阶段不做位置/尺寸记忆。
- 生命周期属于 Client Plugin：关闭 Dock 不影响 Pop-out；插件 dispose 或父页面 unload（`pagehide`）时关闭 Pop-out。
- 当前只是本地 UI Shell（Header + Coming soon），**不支持聊天、不共享 Host 状态**。

### 结论

- Pop-out 骨架 ✅ 已实现。
- Phase 06B 才接入 Host-backed State（聊天状态共享、HTTP/SSE、postMessage 协议等）。

## Companion Host State 通道（Phase 06B–06C）

### 现状

- **Host 拥有权威 Companion State**：`src/host/state.ts` 的 `createCompanionStateStore()` 返回可订阅 store（`getState` / `subscribe` / `bumpRevision` / `dispose`）。`instanceId` 每次 Host 启动生成一次；`revision` 每次 `bumpRevision` 递增，`subscribe` 立即回放当前状态。
- **只读 Host API**：通过 DSH 官方 `ctx.connection.fetch.register(...)`（`@deepseek-ai/dsh-client-connection` 的 `HostConnectionFetch`）注册两个 exact GET route：
  - `/api/deepseek-companion/state` — 一次性快照。
  - `/api/deepseek-companion/state/stream` — `text/event-stream` 实时推送通道（复用 Connection 的流式 `Response.body`，bridge 逐 chunk 转发，客户端断开会触发 `request.signal` abort）。
- **Client 读取**：`src/client/api.ts` 的 `fetchCompanionState`（快照）与 `subscribeCompanionState`（fetch + ReadableStream 解析 SSE，返回 unsubscribe）。Dock 与 Pop-out 共用同一份 reader，各自持独立 SSE 连接。

### 数据流

```
DSH Host
  └─ CompanionStateStore { status, revision, instanceId }
       ├─ GET /api/deepseek-companion/state        → 一次性快照
       └─ GET /api/deepseek-companion/state/stream → SSE 实时推送
            ├─ Dock   (window.location.origin) → 实时更新
            └─ Pop-out (parent origin)         → 实时更新（独立连接）
```

### 结论

- Dock 与 Pop-out 读取**同一个 Host State**，**Host 状态变化时**（真实业务变化调用 `bumpRevision()`）会实时推送到两个视图（已实测）；单独关闭任一侧不影响另一侧；重新打开会立即收到当前最新状态。
- Phase 06C 目前只是**状态同步通道**，`revision` 初始为 1，不包含定时/轮询触发；真实的状态变化源（聊天轮次等）与写入留待后续 Phase。**不是 DeepSeek 回复流式输出。**

## Companion 界面形态（Phase 06D）

Companion 支持三种界面形态，三者**复用同一份 Host State**（都渲染同一个 `HostStateView`、订阅同一条 SSE 通道），互不新增状态逻辑：

| 形态 | 实现 | 说明 |
|---|---|---|
| 右侧停靠 | `rightbar`（non-blank session）/ `shell.overlay`（blank session，右侧停靠样式） | 打开 Companion 的默认形态 |
| 页面内浮窗 | `shell.overlay`（`position: fixed` 浮窗样式，`CompanionFloat`） | 标题栏拖动、右下角调整宽高、限制在可视区域 |
| 独立浏览器窗口 | browser-native `window.open`（Phase 06A） | 单独存在，可与其他形态并存 |

- 停靠 ↔ 浮窗互斥（同一时刻只有其一），通过 `DockController` 的 `enterFloat()` / `dockBack()` 切换；独立窗口独立存在。
- 浮窗位置/尺寸是**内存态**（`float.ts` 的纯函数 `clampFloatPosition` / `clampFloatSize`），本阶段不持久化。
- 浮窗与停靠都不复制状态逻辑，继续复用 `HostStateView`（订阅 `/api/deepseek-companion/state/stream`）。

## DeepSeek 浏览器会话（Phase 07A）

### 现状

- **Host 管理浏览器**：`src/host/browser.ts` 用 Playwright（`chromium.launchPersistentContext`）打开并复用 **插件自己的独立 Profile**。多个界面共用一个浏览器会话，关闭 Dock/浮窗/独立窗口都不关闭它。
- **Profile 路径规则**（`src/host/paths.ts`）：默认 `<profileDir>/deepseek-companion-browser`，其中 `<profileDir>` 取自 DSH 公开的 `ctx.baseUrl`（boot 时锚定在 `$DSH_HOME/profiles/<name>/`），因此 **web / companion-test 等不同 profile 默认即隔离**；`DEEPSEEK_COMPANION_PROFILE` 仍可覆盖（测试用）；`ctx.baseUrl` 缺失时回退 `$DSH_HOME/deepseek-companion-browser`。
- **Chromium 策略**：只用 Playwright 自己匹配的 Chromium（`chromium.executablePath()`）；缺失时 `launchPersistentContext` 抛清晰的 "Executable doesn't exist" 错误，由 Host 映射为 `error` 状态（不崩溃）。**不自动下载、不执行 shell 安装、不遍历旧版本缓存**（`findCachedChromium` 已移除）。Playwright 锁在 `1.62.0`（匹配本机已有 chromium-1234），安装后即可直接使用。
- **登录状态判断**（`deepseek.status`）：`checking` / `logged_in` / `logged_out` / `error`。**不以 `userToken` 是否非空为据**，改为调用 DeepSeek 自己的 **`GET /api/v0/users/current`**，由服务端返回的稳定字段判定（`src/host/login.ts` 的 `loginStatusFromCurrentUser`，接收最小信号 `{ code, id }`）：`id` 非空 → `logged_in`；`code !== 0` 且无 `id`（如 `40002 Missing Token`）→ `logged_out`；异常 → `error`。检测由 `page.on('load')`（全页导航）与 `page.on('response')`（SPA 内登录/退出后前端重调 `users/current`）触发，无轮询。
- **凭证与隐私边界**：`localStorage.userToken` **仅作为 `GET /api/v0/users/current` 的 `Authorization: Bearer <token>` 请求凭证**，不作为登录判定依据。token 在 `page.evaluate` 浏览器上下文内读取、使用并丢弃，**只把 `{ code, id }` 最小信号返回 Host**；token/Cookie/用户信息不 console.log、不写文件、不进 `CompanionState`、不通过实时接口下发、不进错误信息。
- **状态同步**：`deepseek.status` 纳入现有 `CompanionState`，通过 `/api/deepseek-companion/state/stream` 实时推送到 Dock / 浮窗 / 独立窗口，三者显示 `DeepSeek：检测中/已登录/未登录/检测失败`。
- **依赖**：新增 `playwright@1.62.0`（Host 依赖，tsdown `external`，不打包进 bundle；DSH 自身的 `dsh-web-frontend` 只在 devDependencies 用 `playwright@^1.49.0`，运行时无需对齐）。

### 结论

- 已实测：浏览器缺失 → `error`（DSH 不崩溃）；chromium-1234 直接可用（Playwright 1.62 匹配，无需下载）；浏览器 Profile 落在 `profiles/<name>/deepseek-companion-browser`（按 profile 隔离）。
- 登录态：全新未登录 Profile → `logged_out`（`users/current` 返回 `40002 Missing Token`）；已登录 → `logged_in`（`users/current` 返回 `code:0` + 用户 id）。判定以服务端为准，显著降低误判风险。
- 未做：自动登录、发送消息、聊天、历史、Deep Think、Search、Handoff。浏览器 Profile 数据（含 Cookie）不进 Git。

## DeepSeek 文本聊天（Phase 07C / 07C.1 / 07D / 07E）

### 现状

- **发送链路**：Client `ChatView` → `POST /api/deepseek-companion/chat`（`src/host/chat.ts` 的 `handleChatMessage`）→ `browser.sendMessage()`。
- **消息结构**：`ChatMessage { id, role, content, format }`（`format: 'text' | 'markdown'`），Host 统一维护 `chat.messages` + `chat.sending`；并发由 `chat.sending` 单飞门控制（busy → 409）。

### 流式回复 + Markdown（Phase 07D 流式 / 07E Markdown）

正式链路：

```
DeepSeek assistant DOM（.ds-assistant-message-main-content，fallback .ds-markdown）
  → React fiber props.markdown（原始 Markdown）
  → fallback：DOM textContent（纯文本）
  → window.__onReplyDelta（context.exposeFunction 桥接，一次性注册，所有 page 自动拥有）
  → Host throttle（~100ms 合并，createThrottle）
  → updateChatMessage(assistantId, content, format)（同一条 assistant 持续覆盖，不新增消息）
  → CompanionState（chat.messages / chat.sending）
  → SSE（/api/deepseek-companion/state/stream）
  → react-markdown + remark-gfm（format === 'markdown'）
  → Dock / Float / Pop-out（三者读同一份 Host 消息）
```

来源与降级（`src/host/reply.ts`）：

- **Markdown 来源是 DeepSeek 的 React props**：从 assistant 节点沿 `fiber.return` 有界扫描（最多 10 层），先认 `memoizedProps.markdown`；其次认 `memoizedProps.content`——**仅当**它的可见文本与当前渲染文本匹配时才采用。
- **React fiber 属于 DeepSeek 私有实现**，所以始终保留 `textContent` 纯文本 fallback（找不到时 `format = 'text'`）；DeepSeek 前端升级不会让聊天挂掉。

要点：

- 发送前 `appendChatMessage('assistant', '')` 创建空 assistant，后续所有 delta 都 `updateChatMessage` 到同一个 id，消息数量不随 chunk 增长；`format` 允许流式中由 `text` 切到 `markdown`，最终以原始 Markdown 为准。
- **不使用 `innerHTML` / `dangerouslySetInnerHTML`**：原始 Markdown 交给 `react-markdown` + `remark-gfm` 渲染，raw HTML 保持关闭（不安装 `rehype-raw`）。
- **`response.finished()`（completion POST 的 SSE 结束）是回复完成主信号**；结束后再读一次最终值（React props 优先）并强制 flush，最终内容不因 throttle 丢失。
- **token/cookie 不离开 browser context**：reader 在页面上下文读取，只向 Host 传 `{ content, format }`（不含 HTML / React 对象）。
- **错误处理**：发送失败保留 user 与已收到的部分 assistant 内容，`finally` 恢复 `chat.sending = false` 并清理 observer / throttle。
- ChatView 不渲染 `content === ''` 的空 assistant 气泡（流式中的空 assistant 由「正在回复…」占位覆盖）。
- **reasoning 仍未实现**：已确认 DeepSeek 的 `THINK` fragment（网络）与 `.ds-think-content`（DOM）与正文分离，留待后续 Phase。
- **构建注意**：Markdown 生态（`vfile` → `unified`）会经 Node `imports` 条件引入 `node:path` / `node:process` / `node:url`；DSH client module loader 没有 `node:*` 表，所以 `tsdown.client.config.ts` 把它们 alias 到 `src/client/shims/*` 浏览器 shim，否则插件整体加载失败。
