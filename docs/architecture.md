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

- 当前 Web 候选 `0.1.0-preview.2` 的运行时范围为 `0.1.5-rc.2 || 0.2.1-rc.2`；六个 DSH 开发类型包固定至 `0.2.1-rc.2`，运行 Cordis peer 兼容旧版。安装、界面与 SSE 已在两个固定版本复验；新版已登录核心聊天、图片、SSE 与 Chromium 恢复矩阵已复验，插件升级/回退在共同宿主 `0.1.5-rc.2` 上已验收（不覆盖宿主迁移），会话删除等边界仍待验收，官方 Desktop 尚不支持。证据与边界见 [web-compatibility.md](web-compatibility.md)。
- 后续兼容其他版本时优先做 capability detection。
- 版本敏感 API 优先 `ctx.inject` / capability detection / type guard / runtime feature detection。
- 不假定所有 DSH 版本 API 一致。
- DSH API 不确定时先阅读官方源码/文档，不允许猜测。

## Companion Dock Surface Strategy（Phase 04 已验证）

Companion Dock 在用户点击 sidebar 入口时打开。打开时根据当前 Session 的 `blank` 标志，选择一个官方 Surface 占用：

| 当前 Session                              | Surface         | 槽位 / Scope         | 效果                                                                                      |
| ----------------------------------------- | --------------- | -------------------- | ----------------------------------------------------------------------------------------- |
| 非 blank（`blank === false`）             | `rightbar`      | 单槽、`root` scope   | conversation 真实缩窄，dock 在官方右侧列内（`openRightbar(true, false)` 保留 grid track） |
| blank（`blank === true`）或无当前 Session | `shell.overlay` | 列表槽、`root` scope | frame-right 浮层（fixed right 420px），conversation 不缩窄                                |

### 公开 Session 选择（2026-10-20）

`src/client/session-surface.ts` 只读取公开的 `sessions.list`：旧版存在 `current` 字段时，以该字段为准，显式无当前项不再尝试推断；新版从 `byId` 中选择唯一具有正数且有限的 `retainedBy.mainView` 的条目，再要求 `blank === false` 才使用 rightbar。无主视图、歧义、未知 blank、读取异常均使用 overlay。此选择依据与新版官方 ui-session 发布主视图的公开保留语义一致；不读取其私有 `current` 或修改 DSH 源码。

### 规则

- Surface 在 `open()` 时只决定一次，open 期间不变。即便 Session 的 blank 状态发生变化，也不切换 Surface（避免 UI 跳动、焦点丢失、未来聊天输入状态被冲掉）。
- 只有 `close` → 再次 `open` 时才重新读取 Session blank 并选择 Surface。
- 任何时刻最多只有一个 Surface registration（rightbar 或 overlay）。`close()` 调用对应的 `dispose`，DSH 默认右侧 Sidebar（ui-sidebar-right）与 `shell.overlay` 容器都自动恢复原状。

### 原因

DSH 0.1.2-rc.1 的 `AppFrame` 在 blank Session 时强制 `details` 宽度为 0，且 blank Session 无法合法变为 non-blank，因此当时的 `details` 无法作为唯一 Surface（历史原因）。0.1.5-rc.2 已删除 `details` 槽位与 `openDetails()`/`closeDetails()`：non-blank Surface 迁移为官方 `rightbar` 单槽 —— Companion 以 `priority: -1` 临时占用（与 0.1.2 details 同一套 shadow/restore 模式），`ctx.layout.openRightbar(true, false)` / `closeRightbar()` 控制显隐。`shell.overlay`（`root` scope、不依赖 session）作为 fallback 保证「新建 Session 立即可用」的核心需求，0.1.5 语义不变。

## Companion Dock Width（Phase 05A / 05B）

### Width Ownership（谁拥有布局，谁拥有宽度）

| Surface         | 宽度拥有者 | 调整方式                                 | 持久化                         |
| --------------- | ---------- | ---------------------------------------- | ------------------------------ |
| `shell.overlay` | Companion  | 自定义 resize handle（Pointer Capture）  | ✅ browser localStorage        |
| `rightbar`      | DSH        | DSH 原生 DragHandle（0.1.5 rightbar 列） | ❌ Companion 不持久化 / 不同步 |

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

### Web P0：状态通道断流恢复（2026-10-19）

`subscribeCompanionState` 将传输生命周期交给 `src/client/state-stream.ts`。EOF、fetch/read 异常和非成功 HTTP 响应都会重连，退避为 500/1000/2000/4000ms，之后封顶 5000ms；收到有效 Host 快照后重置退避。每次尝试必须在 10s 内收到首个有效快照，否则取消请求并重试。每次连接使用新的 decoder/buffer，不将旧连接的半个事件拼到新连接；LF 与 CRLF 分隔符均可解析。

界面本地维护 `connecting / connected / reconnecting`，独立于 Host 的 `connection`、browser recovery、session reconciliation。收到有效快照前不解锁发送、Stop、开关、附件和会话操作；断流保留最后消息及本地输入并显示重连提示，重连仅订阅当前快照，不重发聊天。unsubscribe 取消 reader、请求、首快照超时与重试 timer；dispose 后迟到的 fetch body 关闭，不再通知或连接。

自动测试覆盖 EOF、网络/HTTP/read 异常、退避上限和重置、首快照超时、分块事件、无效事件、Host 实例变化与 dispose。真实 DSH Web 中受控结束首条 SSE、失败首条请求、关闭重连中的 Dock 均通过，重连后与新窗口状态一致；详见 [web-regression.md](web-regression.md)。本轮不添加心跳；已连接但长期没有 EOF/error 的静默链路不由此机制主动探测。

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

| 形态           | 实现                                                                            | 说明                                       |
| -------------- | ------------------------------------------------------------------------------- | ------------------------------------------ |
| 右侧停靠       | `rightbar`（non-blank session）/ `shell.overlay`（blank session，右侧停靠样式） | 打开 Companion 的默认形态                  |
| 页面内浮窗     | `shell.overlay`（`position: fixed` 浮窗样式，`CompanionFloat`）                 | 标题栏拖动、右下角调整宽高、限制在可视区域 |
| 独立浏览器窗口 | browser-native `window.open`（Phase 06A）                                       | 单独存在，可与其他形态并存                 |

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

## DeepSeek 文本聊天（Phase 07C / 07C.1 / 07D / 07E / 07F / 07G）

### 现状

- **发送链路**：Client `ChatView` → `POST /api/deepseek-companion/chat`（`src/host/chat.ts` 的 `handleChatMessage`）→ `browser.sendMessage(text, onDelta, onReasoning)`。
- **消息结构**：`ChatMessage { id, role, content, format, reasoning? }`（`format: 'text' | 'markdown'`，`reasoning: { content, format }`），Host 统一维护 `chat.messages` + `chat.sending`；并发由 `chat.sending` 单飞门控制（busy → 409）。
- **Deep Think 状态**：`CompanionState.deepseek.deepThink = { available, enabled }`，由 Host 从 DeepSeek 页面读取后写入（见下文 07G 小节）。

### 流式回复 + Markdown + reasoning（Phase 07D / 07E / 07F）

两条**互相独立**的链路（各有自己的 reader、bridge、throttle、Host 字段）：

```
RESPONSE（正文）
  DeepSeek assistant DOM（.ds-assistant-message-main-content，fallback .ds-markdown）
    → React fiber props.markdown（原始 Markdown）
    → fallback：DOM textContent（纯文本）
    → window.__onReplyDelta（context.exposeFunction 桥接，一次性注册，所有 page 自动拥有）
    → reply throttle（~100ms 合并，createThrottle）
    → updateChatMessage(assistantId, content, format)
    ↘
      CompanionState（chat.messages / chat.sending）
        → SSE（/api/deepseek-companion/state/stream）
        → react-markdown + remark-gfm（format === 'markdown'）
        → Dock / Float / Pop-out（三者读同一份 Host 消息）
    ↗
THINK（Deep Think 思考过程）
  DeepSeek reasoning DOM（.ds-think-content）
    → fiber 上无原始 Markdown prop → DOM textContent（纯文本）
    → window.__onReasoningDelta（独立 bridge，同样一次性注册）
    → reasoning throttle（独立，~100ms）
    → updateChatReasoning(assistantId, content, format)
```

来源与降级：

- **正文 Markdown 来源是 DeepSeek 的 React props**（`src/host/reply.ts`）：从 assistant 节点沿 `fiber.return` 有界扫描（最多 10 层），先认 `memoizedProps.markdown`；其次认 `memoizedProps.content`——**仅当**它的可见文本与当前渲染文本匹配时才采用。
- **reasoning 来源是 `.ds-think-content` 的文本**（`src/host/reasoning.ts`）：Phase 07F 实测其 fiber 链上没有 reasoning 原文 prop，且思考文本不含 Markdown 语法，因此 `format = 'text'`；reader 仍会先探测常见 reasoning prop 名，若将来 DeepSeek 暴露原文则自动升级为 Markdown。
- **两者都是 DeepSeek 私有实现**，所以始终保留 `textContent` fallback，DeepSeek 前端升级不会让聊天挂掉。
- **正文 fallback 必须排除 reasoning 子树**（`excludeWithin`）：DeepSeek 的思考内容同样通过 `.ds-markdown` 渲染，否则正文 reader 会把思考文本当成回答。

要点：

- 发送前 `appendChatMessage('assistant', '')` 创建空 assistant，后续所有 delta 都写到**同一个 id**，消息数量不随 chunk 增长；正文 `format` 允许流式中由 `text` 切到 `markdown`。
- **reasoning 与正文严格独立**：两个字段、两个 bridge、两个 throttle，互不覆盖；`reasoning` 只在 DeepSeek 真的产生思考时出现（否则保持 `undefined`，不创建空 UI）。
- **不使用 `innerHTML` / `dangerouslySetInnerHTML`**：Markdown 交给 `react-markdown` + `remark-gfm` 渲染，raw HTML 保持关闭（不安装 `rehype-raw`）。
- **`response.finished()`（completion POST 的 SSE 结束）是整条回复完成主信号**；结束后分别最后读取一次 reasoning 与正文并强制 flush。
- **Deep Think 开关仍由 DeepSeek 网页控制，Companion 只读取，不主动开启/关闭**；不使用网络 SSE / CDP 私有协议。
- **token/cookie 不离开 browser context**：两个 reader 都在页面上下文读取，只向 Host 传 `{ content, format }`（不含 HTML / React 对象）。
- **错误处理**：发送失败保留 user 与已收到的部分内容，`finally` 恢复 `chat.sending = false` 并清理两个 observer / throttle。
- UI：思考过程以 `<details><summary>思考过程</summary>` 折叠区显示在正式回答**上方**，默认展开、视觉层级弱于正文（`--dsw-alias-label-secondary`）。
- ChatView 不渲染既无正文也无 reasoning 的空 assistant 气泡。
- **构建注意**：Markdown 生态（`vfile` → `unified`）会经 Node `imports` 条件引入 `node:path` / `node:process` / `node:url`；DSH client module loader 没有 `node:*` 表，所以 `tsdown.client.config.ts` 把它们 alias 到 `src/client/shims/*` 浏览器 shim，否则插件整体加载失败。

### Deep Think 开关（Phase 07G）

```
Companion「深度思考」控件
  → POST /api/deepseek-companion/deep-think { enabled }
  → Host 校验/转发 → Playwright 点击 DeepSeek 页面真实 UI 控件
  → 重新读取页面真实状态（绝不做 optimistic）
  → CompanionState.deepseek.deepThink
  → SSE
  → Dock / Float / Pop-out
```

要点：

- **Host state 始终反映 DeepSeek 页面的真实状态**：切换后必须重新读取；若控件不存在（`available: false`）或点击无效，写回的仍是页面真实值，Client 不做长期 optimistic 保留。
- **不使用 DeepSeek 私有网络 API** 控制开关，**不写 DOM 属性伪造状态**，只点击真实 UI。
- **不使用轮询**：只在「初始化 / page load / showLogin 新建 page / 切换成功后 / 每次发送前」这几处重新读取。用户在 DeepSeek 窗口里手动切换的开关，会在**下一次发送前**被重新同步；两次发送之间的手动改动不会实时反映（无 observer，属已知限制）。
- **定位方式**：语义 class `.ds-toggle-button` + `aria-pressed`（状态）；Deep Think 与 Search 其余属性完全相同，只能靠标签多语言集合区分，兜底策略保守（Phase 07H 收紧，详见下文「智能搜索开关」）。
- **page 重建**：新 page 重新读取真实状态，不沿用旧 page 的 `enabled`。
- **生成过程中禁止切换**（Host 返回 409，Client 禁用控件），避免中途改变模式。
- **reasoning 读取继续沿用 Phase 07F**，本阶段未改动其链路。
- **token / cookie 不离开 browser context**：Host 只读写开关状态与 `{ content, format }` 类的最小数据。

### Companion composer controls：Deep Think + 智能搜索（Phase 07H）

```
Companion「深度思考」/「智能搜索」控件
  → POST /api/deepseek-companion/deep-think | /search { enabled }
  → Host 校验/转发 → Playwright 点击 DeepSeek 页面真实 UI 控件
  → 成对重新读取 composer 两个开关的真实状态（绝不做 optimistic）
  → CompanionState.deepseek.deepThink / .search
  → SSE
  → Dock / Float / Pop-out
```

要点：

- **共用一套 toggle 逻辑**（`src/host/toggle.ts`，Phase 07H 从 07G 抽出）：定位、读取、点击、Host 请求流程只有一份；`deep-think.ts` / `search.ts` 只各自提供标签规则与镜像字段。
- **四种组合实测全部允许**（OFF/OFF、ON/OFF、OFF/ON、ON/ON）；DeepSeek 当前不会因为开启一个而自动关闭另一个。但 Host **不假设**这一点。
- **任一切换后成对同步**：`browser.setDeepThinkEnabled()` / `setSearchEnabled()` 先点击目标开关，再 `syncComposerMode()` 一次读取两个并写入 Host，因此页面若发生联动（现在或将来）也不会留下过期状态。发送消息前也成对重新读取。
- **不使用固定 sleep**：点击后用 Playwright 条件等待（`page.waitForFunction`，3s 上限）确认目标开关的 `aria-pressed` / selected class 达到期望值。`click` 动作会把被点击元素记录到页面全局 `__composerToggleTarget`，所以定位规则不在等待逻辑里重复；超时不致命，之后照常重新读取页面真实状态。
- **不使用 DeepSeek 私有网络 API**、不写 DOM 属性伪造状态、不使用轮询；`token` / `cookie` 不离开 browser context。
- **定位兜底策略（保守）**：标签唯一命中 → 使用；标签无命中时，仅当**另一开关可明确识别且排除后只剩唯一候选**才兜底；其余情况（多候选 / 无法识别 / 标签多重命中）一律 `available: false`，宁可暂时不可用也不误点未来新增的开关。
- **page 重建**后两个开关都以新 page 的真实状态为准，不沿用旧 page 的值。

### DeepSeek 搜索引用（Phase 07I）

```
Search 回答 Markdown（含 [reference:N] / [citation:N]）
  → Host marker parser（相邻 marker 归为同一组）
  → 正文完成 + chat.sending=false（citation 不参与这一步）
  → 后台 best-effort citation hydration
      → 绑定本轮 assistant 节点的 ElementHandle
      → 条件等待 badge 数 === group 数且全部拿到 href（8s 上限）
      → URL 校验（仅 http/https）+ marker → url 冲突检查
  → ChatMessage.citations（marker / url / domain）
  → CompanionState → SSE
  → remark citation renderer（只改普通 text 节点）
  → Dock / Float / Pop-out
```

要点：

- **URL 来自最终 DOM 的 `.ds-markdown-cite`**（水合后该元素本身变成 `<a href>`）。不读 DeepSeek 私有 store，不使用 CDP / 网络私有协议，不抓 title / snippet。
- **citation 是后置 best-effort 增强**：`response.finished()` → 最终正文 flush → `chat.sending=false` → 才开始后台 hydration。正文完成即可继续发送下一条，citation 稍后到位或永远不到位都不影响聊天。
- **绑定本轮 assistant 节点**：hydration 通过 reader 暴露的 `__replyNode()` 捕获 ElementHandle，因此下一轮发送不会把新回复的 badge 错配到上一轮。
- **数量不一致时不猜**：group 数必须等于 badge 数；任一 badge 未水合或协议非法（`javascript:` / `data:` / `file:` …）则整次放弃，`citations` 保持 `undefined`，正文继续正常显示。
- Client 侧只重写**普通 text 节点**：`code` / `inlineCode` 内的 marker 保持字面量；未水合时 `[reference:3]` 显示为 `[3]`（不暴露 DeepSeek 内部语法），水合后变成可点击的小角标。
- 目前只有 `url` / `domain`，**没有 title / snippet / favicon**。
- **badge 的真实结构（Phase 07I-1 修正）**：DeepSeek 渲染的是
  `<a href="真实URL" target="_blank" rel="noreferrer"><span class="ds-markdown-cite">…</span></a>`
  —— **URL 在 badge 的父级 `<a>` 上**，不是 badge 自身。读取必须走 `closest('a[href]')`。
- **block 级映射（Phase 07I-1）**：全局"group 数 === badge 数"经常不成立（实测 10 markers / 9 badges、7 / 3、17 / 20），因此改为按 Markdown block 对齐：把源文切成与 DOM 同级的块（`p` / `li` / `blockquote` / `h1-h6` / `td` / `th`），只在**规范化后文本完全相等**时配对，再在该块内要求 group 数 === badge 数。部分成功是常态（实测 6 条真实回答共产出 35 条 citation，含 7 组 / 3 badge 的案例产出 3 条）。块内不做任何模糊匹配。
- **已知限制（实时场景）**：DeepSeek **只在会话（重新）加载后**才把 badge 包进 `<a href>`。对**刚生成完的当前会话**，即使等待数十秒也读不到 URL（实测 14 个 badge 全部无 href，`citations` 恒为 `undefined`）；而同一个会话在侧边栏重新打开后 14/14 都带 URL。因此：
  - `scheduleCitationHydration` 的算法与 URL 校验是**正确且已验证**的（在可读到 URL 时会产出 citation）；
  - 但在**实时聊天**中它拿不到数据，UI 停留在纯文本 `[N]`；
  - 不采用"主动 reload DeepSeek 页面"来换取 URL（会丢失会话 DOM 并打断用户）。
  - **结论：inline citation 在实时场景无法可靠实现**；基础设施保留，若 DeepSeek 改变注入时机即可直接生效。
- token / cookie 不离开 browser context。
- **Search 结果专用 UI 尚未实现**：搜索回答的来源链接**不在** `props.markdown` 中 —— DeepSeek 只在正文 Markdown 里写入 `[citation:N]` 标记，真实 URL 由渲染层注入（`span.ds-markdown-cite` → `a[href]`）。因此 Companion 目前能完整显示搜索回答的正文结构，但**看不到可点击的来源链接**，且 `[citation:N]` 会以纯文本形式出现。引用 / 来源 UI 记录为后续 Phase。

### DeepSeek 停止生成（Phase 07J）

```
Companion「停止」
  → POST /api/deepseek-companion/chat/stop
  → Host 校验（browser 就绪 / chat.sending === true）
  → Playwright 点击 DeepSeek 真实 Stop 控件
      （生成期间 .ds-button--primary 本身就是 Stop）
  → 当前生成结束（completion 正常收尾，HTTP 200）
  → flush 已收到的部分正文 / reasoning
  → chat.sending = false
  → SSE
  → Dock / Float / Pop-out 同步回「发送」
```

要点：

- **没有独立的 Stop 按钮**：DeepSeek 在生成期间把输入区主按钮（`.ds-button--primary`）变成停止控件 —— 同一个元素、圆形图标按钮，图标从"发送箭头"换成"方块 stop"。Host 点击的就是它；不调用任何私有 Stop API，不改 DOM 属性 / React state，不使用固定 sleep。
- **`sending` guard 是前提**：不在生成中时同一个按钮是"发送"，所以 Host 只在自己正在流式时允许停止（`chat.sending === false` → 409；browser 未就绪 → 503）。
- **停止是正常收尾**：实测 completion 响应仍以 **HTTP 200** 结束，`response.finished()` 正常 resolve，因此**不需要把中止当异常**处理。
- **部分内容保留**：`sendMessage` 照常 flush 已收到的正文与 reasoning；**空的最终回复不会覆盖已流式内容**（`handleChatMessage` 只在非空时写入）。停止早于第一个 token 时，assistant 消息保持为空且**不报聊天错误**（`stopRequested` 标记）。
- **Client 不维护本地 sending**：按钮的"发送 / 停止"完全由 Host 的 `chat.sending` 驱动，三个界面天然一致；停止请求自身有防重复点击。
- **停止是幂等的（`stopRequested`）**：一次发送最多点击一次 Stop。发送与停止共用 `.ds-button--primary`，第一次停止后按钮可能**先恢复为"发送"**而 Host 的 `sending` 仍为 true —— 此时若 Dock / Float / Pop-out 再各自请求停止，第二次点击就会变成**发出新消息**。幂等判定因此放在 **Host**（不依赖 Client 的防重复点击，因为各界面看不到彼此的请求）：`sending === false` → 无生成可停；`stopRequested === true` → 直接回报"已请求"，**零点击**。该标记在**新一轮 `sendMessage` 开始前**与**该轮的 `finally`** 中都复位，所以上一轮 Stop 绝不会让下一轮真正的空回复被误判为合法。
- **citation（07I）链路不变**：停止后的部分回答若没有 citation，正常降级为纯文本 `[N]`。
- token / cookie 不离开 browser context。

### DeepSeek 新建会话（Phase 07L）

```
Companion「新建聊天」
  → POST /api/deepseek-companion/chat/new
  → Host 校验（browser 未就绪 → 503 / chat.sending === true → 409）
  → Playwright 点击 DeepSeek 侧边栏真实 New chat 控件（语义标签定位，绝不用 hash class）
  → 有界条件等待确认：location.pathname === '/' 且消息 DOM（.ds-message）已清空
  → 重新读取 composer 两个开关的真实状态（新会话沿用页面开关）
  → 页面确认成功后才 store.clearChatMessages()
  → SSE
  → Dock / Float / Pop-out 三界面同时清空（Host 是唯一权威状态）
```

要点：

- **定位规则（保守，纯标准 DOM）**：候选 = 元素自身直接文本 / `aria-label` / `title` **精确等于**语义标签（`New chat` / `开启新对话` / `新对话` 等多语言集合）；点击目标 = 候选向上最近的**标准**可点击元素（`button` / `a` / `role=button|menuitem|link`）；链上没有标准控件时（实测 DeepSeek 的控件是纯 `div` 容器），点击**文本候选元素本身**，由原生 click 冒泡交给页面处理器。**不依赖 React 私有字段**（`__reactProps$` / fiber）、不用 hash class、不写 DOM 属性。**多候选（ambiguous）或无候选（missing）一律安全失败**（不改页面、不清 Host）；历史会话链接（`href` 含 `/chat/s/`）即使标题同名也永不当作控件。不使用 DeepSeek 私有网络 API、不用固定 sleep。
- **Host 并发 guard（07L 收尾）**：一个页面被所有 route 共享，互斥因此放在 Host（`createNewChatGuard()`，`index.ts` 的 `apply` 作用域，**不进 `CompanionState`**——它不是任何界面要渲染的状态）。`handleNewChatRequest` 在触碰页面前**同步原子** `tryClaim()`（无 await 间隙，两个并发请求不可能同时成功），`finally` 释放。期间：发送消息 → 409 `new chat in progress`（`handleChatMessage` 的 `newChatGuard` 参数；`sendMessage` 零调用、不追加任何消息）；再次 new chat → 409 `new chat already in progress`。`chat.sending === true` 时 new chat 仍 409（既有语义不变）。Client 的 `startingNew` 只是本地防抖（三个界面互相看不见），真正的仲裁始终在 Host。
- **只有页面确认成功才清 Host**（先页面后 Host）：`browser.newChat()` 在点击后必须等到「空态 pathname + 无消息 DOM」才 resolve，否则抛错 → Host 返回 500 且 `chat.messages` 完全不动。绝不允许「先清 Companion 再点页面」。
- **page 复用**：不新建 tab、不 `goto`，就在当前页面上点击——与用户手动点 New chat 完全一致（07L-0 实测：点击零网络请求，纯 SPA 状态切换；首个 completion 发出时才 `POST /chat_session/create` 生成会话）。
- **toggle 状态保留**：DeepSeek 的 Deep Think / Search 开关是**页面级全局状态**，新会话原样继承（07L-0 实测 DT+Search 组合跨新建保留）。`newChat()` 成功后重新读取页面真实值写回 Host 镜像，不沿用旧镜像、不做 optimistic。
- **conversation id**：空态 `pathname = /`；**首条消息发出后才变为 `/a/chat/s/<uuid>`**（同一 id 也可从侧栏选中条目 href / 消息节点 fiber `memoizedProps.sessionId` 读到）。本阶段**不引入 `conversationId` state**，仅在此记录。
- **本阶段不做**：历史会话列表、多会话管理、会话切换/删除。
- **旧 citation 迟到不污染新会话**：citation hydration 绑定旧 assistant message id，`clearChatMessages()` 之后该 id 已不存在，`updateChatCitations` 自然 no-op。
- **UI**：ChatView 控件行进输入区上方右侧新增「新建聊天」轻按钮；`chat.sending === true` 时禁用（Host 层同时 409 双保险），本地 `startingNew` 防重复点击；Client **不维护本地 messages**，清空只由 Host 推送到三个界面。
- **实机验证（真实页面 + 真实产品代码）**：多轮消息（4 条）→ 新建 → Host 200 + messages 0（页面清空由 `newChat()` 的确认条件保证）；toggle 组合跨新建保持一致；新会话首条发送 200 且 reply/reasoning 均流式（deltas 3 / reasoningDeltas 7）、可 Stop；生成中新建 → 409 且既有生成不受影响（Stop 后正常收尾）。
- **实机验证（07L 收尾）**：并发两次 new chat（模拟两个界面）→ 一个 200、另一个 409（`page operation in progress`，07L 收尾后与历史切换共用同一个 page guard），真实控件只点击一次；切换期间发送 → 409 且不产生任何消息；切换结束后发送 200；toggle 组合保留；共享 transcript 清空（三界面同一份状态）。标准 DOM 定位（无 React 私有依赖）在真实页面连续两轮点击均成功触发切换（`pathname = /` 且消息 DOM 清零）——真实候选链为 `SPAN → DIV`，全链无 `button`/`a`/`role`，走的是文本候选 + 原生 click 冒泡路径。
- token / cookie 不离开 browser context。

### DeepSeek 历史会话（Phase 08）

```
Sidebar sessions（a[href*="/a/chat/s/"]）
  → conversationId（来自 href 自身；URL 与 fiber 同源，只用于交叉校验）
  → Host GET /api/deepseek-companion/chat/sessions（只读投影：{ id, title, active }）
  → POST /api/deepseek-companion/chat/switch { conversationId }
  → page guard（与 send / new chat 互斥）
  → Playwright 原生 click 目标历史链接（id 字符串比较，绝不拼选择器）
  → 有界确认：pathname === /a/chat/s/<id> 且点击前的消息节点全部脱链
  → 虚拟列表补齐（滚动到顶，5 → 16 节点）→ 重建当前 transcript
  → store.replaceChatMessages（一次替换、一次 notify）
  → SSE
  → Dock / Float / Pop-out
```

要点：

- **统一 page guard（`src/host/guard.ts`）**：一个页面被所有 route 共享，`send` / `newChat` / `switchChat` 三者互斥。`chat.sending === true` → new chat / switch 返回 409 `chat is busy`；任一页面操作持有 guard → 发送返回 409、再次页面操作返回 409 `page operation in progress`。`tryClaim()` 是同步 check-and-set（无 await 间隙），`finally` 必定释放。三个界面共享同一个 Host guard，不再依赖各自的本地防抖。
- **会话列表**：只读投影侧栏**标准锚点** `a[href*="/a/chat/s/"]`，`id` 从 href 解析（用 `indexOf(marker)` + 截断，绝不把外部输入拼进选择器），`title` 取条目文本（**绝不作为键**——同名会话按 id 并列），`active` 由 id 与页面 pathname 比较得出（**不用样式类**），重复 id 去重。返回的永远只是 DOM 当前能可靠读到的条目。
- **切换确认**：点击前把当前 `.ds-message` 节点记录到页面全局 `__switchBase`（内联字面量——页面函数被序列化，模块常量不存在），确认条件 = pathname 命中目标 id **且** 旧节点全部 `isConnected === false`（身份而非计数）；随后等待消息计数 + 滚动高度的「双签名」稳定，再读取。
- **虚拟列表补齐（Phase 08 关键技术点）**：DeepSeek 的聊天是**虚拟列表**，切换后 DOM 只保留视口附近的节点（实测 16 条只渲染 5 条，滚动到顶后补齐为 16 条、scrollHeight 3545 → 8767）。`readTranscript` 会先把列表滚到顶（有界轮次 + 稳定等待）**并保持在那里读取**——读完才滚回底部（提前滚回会再次裁剪，曾导致只读到 1 条）。滚动目标是「真正可滚动的祖先」（内层包裹的 `scrollHeight === clientHeight`，滚它无效）。
- **transcript 重建**：DOM 顺序遍历 `.ds-message`；角色由**结构**决定（含 `.ds-assistant-message-main-content` 的是 assistant，其余为 user）；正文优先 fiber `markdown` prop（有界扫描 + 松散文本校验，与 `reply.ts` 同一策略），否则渲染文本（`format: 'text'`）；reasoning 取 `.ds-think-content`；citation 用与实时 hydration **完全相同**的 DOM block 读取 + 严格 block 规则。Host 侧为每条消息生成新的 message id（不与 DeepSeek 对齐）。
- **Host 更新顺序**：页面切换成功 → transcript 读取成功 → `replaceChatMessages`（一次替换、一次 notify、`sending` 与 composer/login 状态不动）。**任一步失败都保留现有 transcript**；重新读到等价内容（id 不同）时静默不推送。旧 citation hydration / 旧 message update 因目标 id 已不存在而自然 no-op。
- **旧 citation 描述修正**：07I 曾记录「实时生成后 badge 无 href，只有重新打开会话才能读到 URL」。**当前 DeepSeek 前端已改变**：08-0/08 实测**实时生成完成后的 badge 已带 `a[href]`（20/20）**，切换离开再回来后同样 20/20。Host 既有的 `scheduleCitationHydration` 因此现在能真正产出 citations。
- **citation 重建的已知限制（严格规则的正常结果，不是缺陷）**：历史重建对单个搜索回复实测出现三种不映射情形——① 未水合的角标在 DOM 中渲染为隐藏的 `-` 字形（`normalizeBlockText` 现已**对称剔除 `-`**，使文本仍能精确匹配），但该块 badge 数为 0 < group 数 → 正确放弃；② **Markdown 表格**是一整块而 DOM 按单元格（`td`/`th`）拆成多块 → 无法匹配；③ 相邻 marker 合并假设不总成立（实测 3 groups vs 2 badges）→ 严格规则放弃。文本匹配本身链路正常（实测 `exactMatch` 成功），失败点始终在「数量/水合」条件，符合「不猜」原则。
- **Client**：控件行新增「历史会话」按钮 + **覆盖式浮层列表**（标题 + 「当前」标记，点击切换）。浮层是 `position: absolute`，锚在 **composer 区块（控件行 + 输入行）**之上，`bottom: 100%` 向上展开覆盖消息区——**完全不占布局高度、不挤压消息区，也不遮挡控件行**（「收起历史」在浮层展开时仍可点）；背景用 `--dsw-alias-bg-overlay` 实底；关闭方式为点条目 / 点浮层外（`mousedown` 外部判定）/ Esc，监听仅在打开期间存在。`sending`/`newChat`/`switching` 期间统一禁用；Client **不缓存任何其它会话的 messages**，列表也不落地——Host 是 transcript 唯一权威来源。
- **实机验证（Phase 08）**：A→B→A 切换 200/200（同一会话再次切换 200 且不点击）；B 恢复 15 条（roles 交替、Markdown 406/397/379/346/2311、thinking 800–96、尾部 3 条为 08-0 中断产生的孤立 user 消息）；切换后继续发送 200（正文 + reasoning 流式）；`Stop` 200 并保留部分内容；生成中切换 → 409 `chat is busy` 且消息不变。
- token / cookie 不离开 browser context。

### DeepSeek 外部会话切换同步（Phase 08.1）

```
用户在 DeepSeek 窗口内自行导航（侧栏条目 / New chat）
  → page.on('framenavigated')（main frame；SPA history.pushState 同样触发）
  → sessionLocationFromPath → { session | empty | other }
  → browser 先判定「这对正在进行的发送意味着什么」
      accept-created：DeepSeek 为本次发送创建了会话 → 记录，绝不重读
      external：切到别的会话 / New chat → sessionInterrupted + 立即断开两个 receiver
  → Host session sync controller
      空闲  → PageGuard.tryClaim → readTranscript → replaceChatMessages
                                    empty → clearChatMessages
      忙    → pending（latest wins，事件不丢）
  → send / newChat / switch 结束后 drain → 应用 pending
  → SSE
  → Dock / Float / Pop-out
```

要点：

- **唯一信号是 `framenavigated`**（实测覆盖：首条消息 `/` → session、侧栏点击、New chat → `/`、生成中点击侧栏；同一会话被点击**不产生**事件，天然去重）。不轮询、不 patch `history`、不读 fiber/hash class；conversation id 只从 URL path 解析。
- **三态 location**：`{ kind: 'session', id }` / `{ kind: 'empty' }`（`/`）/ `{ kind: 'other' }`（sign_in 等）。**`other` 永远不修改 Host transcript**；只有真正停在 `/` 的 `empty` 才清空。绝不用 `null` 混合「空会话」与「未知页面」两种含义。
- **首条消息不会被误判为外部切换**：发送开始时记录本轮起始 location；`classifyDuringSend` 只接受「从 `/` 开始 → 第一次出现的 session id」为 `accept-created`（DeepSeek 为本次发送创建），此后的**另一个** id 才是 external。`accept-created` 一路传到 Host 的 controller 并触发 `markKnown`，因此**不会重新读取/替换 transcript**（实测：发送前后 `messages[].id` 完全不变）。
- **生成中外部切换 = reader 隔离 + 安全收尾**：`sessionInterrupted` 与 `stopRequested` **严格分开**；检测到 external 时立即把 `currentDeltaReceiver` / `currentReasoningReceiver` 置空，final read **跳过页面**（否则会读到新会话的最后一条回复）改用「已收到的最后一帧」，不点击 DeepSeek 的 Stop；空正文不再报 `empty reply from DeepSeek`（`emptyReplyError(content, stopRequested, sessionInterrupted)`）。
- **pending latest-wins**：`chat.sending` 为真或 PageGuard 被占（DSH 自己的 newChat/switchChat）时不争抢页面，只把最新 location 停在 `pending`；三类操作结束后 `drain()` 应用它。
- **DSH 自身操作不产生重复同步**：`newChat` / `switchChat` 成功后由 route 调用 `markKnown({ kind: 'empty' } / { kind: 'session', id })`；watcher 收到同位置事件时按 `lastKnown` 去重（no-op）。
- **PageGuard 保持不变**：send / newChat / switchChat / external session sync 四者继续共用同一个 guard，永不并发操作页面。
- **page 重建**（`showLogin` 新建 page）时 watcher 随 `attachListeners` 一起重挂。
- **Client 零改动**：同步只改 Host store → SSE，三个界面天然一致（无 UI、无列表、无多会话缓存）。
- **实机验证（Phase 08.1，真实产品代码）**：外部切换到历史会话（快速排序，15 条）→ Host 自动替换；外部 New chat → Host 自动清空；从 `/` 发送首条 → `messages[].id` 在 send 与 drain 前后均不变（无重复重建）；**生成中切换** → `handleChatMessage` 返回 200（无 empty reply）、deltas 不含目标会话任何内容、生成结束后 Host 一次性切换到目标会话的 transcript。
- token / cookie 不离开 browser context。

### 状态模型收口（Phase 08.2）

**目标**：不新增功能，只把散落在 Host / Client / 各视图里的「同一件事」收敛成单一来源。

```
收口前 → 收口后
  deepseek.status (checking|logged_in|logged_out|error)
  browser === null（6 个 route 各自判断）        → connection { status: online|offline|login_required, browserReady }
  sessions.active（每次重新读侧栏）              → currentSession { id, title }
  chat.sending + 本地 stopping 派生              → composer { sending, stopping, deepThink, search }
  消息只有 content/format/reasoning/citations    → + message.status{streaming|finished|interrupted|error} + sessionId
```

```
DeepSeek page（URL pathname / 侧栏 href，标准 DOM）
  → Host store（唯一权威）
       connection   ← setBrowserReady(browser 创建/销毁) + probeLogin 结果
       currentSession ← framenavigated / switch 请求 / newChat 确认 / 侧栏 active 条目
       composer     ← send 生命周期 + stop 请求 + 页面真实开关
       chat.messages← 同一份消息，带 status 与 sessionId
  → GET /state + SSE /state/stream
  → normalizeCompanionState（兼容层：旧形态缺字段时由旧字段派生）
  → ChatView（Dock / Float / Pop-out 同一组件，仅 origin 不同）
```

要点：

- **`connection` 是派生量，不是新事实**：`connectionFrom(status, browserReady)` 放在 `src/shared/state.ts`，Host store 与 Client 兼容层**共用同一张映射表**——`online` 仅当「浏览器存在 + 已登录」；`logged_out → login_required`；`checking/error/无浏览器 → offline`。旧的 `deepseek.status` 原样保留（登录文案仍读它），二者由同一次 store 写入一起更新。
- **`currentSession` 只来自标准 DOM / URL**：id 从 `/a/chat/s/<id>` 或侧栏 `href` 解析，title 只来自侧栏条目文本（且只作展示）。`setCurrentSession({id})` 在 id 不变时保留已读到的 title；id 变化才丢弃旧标题。**位置是 URL 事实，transcript 才是页面事实**：watcher 事件先记录位置，transcript 仍在「读取成功之后」才替换（失败保留旧 transcript，此前语义不变）。
- **send 铸出的会话 id 的归属（`adoptSessionMessages`）**：从 `/` 发出的第一条消息在 DeepSeek 铸出 id 之前就已写入 Host，watcher 收到 `createdBySend` 的 location 时会把 id 认领给它——不重读 transcript、不改写消息内容（08.1 语义不变）。
- **`composer` 是唯一投影，`chat.sending` 仍是唯一闸门**：`setChatSending` 一次写入同时更新 `chat.sending` + `composer.sending`（结束时一并清 `composer.stopping`）；`setDeepThinkState` / `setSearchState` 同时写 `composer` 与 `deepseek` 镜像，且**两个投影指向同一对象引用**，不可能漂移。
- **`stopping` 上移到 Host**：stop 请求成功（`stopped: true`）时写入 `composer.stopping`，send 结束时自动归零；Client 的 stop 状态机新增 `host-stopping` 事件——点击方仍走本地乐观标记（保持 07J 的「不闪回」），**其它界面靠 Host 推送同样显示「停止中…」**；`host-stopping: false` 是 no-op（否则会擦掉本地点击窗口）。
- **Message 模型向后兼容**：`status` / `sessionId` 都是可选字段；append 时 assistant 为 `streaming`、user 为 `finished`，send 收尾按 `browser.wasInterrupted()`（stop 或外部切换）落 `interrupted`，抛错落 `error`，历史重建统一 `finished`。旧状态被 Client 归一化为 `finished`，**无持久化数据需要迁移**（Companion state 全在内存）。
- **Client 兼容层**：`normalizeCompanionState` 统一处理快照与 SSE 事件：缺 `connection/currentSession/composer` 时由 `deepseek`/`chat` 派生，缺 status 的消息补 `finished`，形状错误的消息/字段被丢弃而不是让视图崩。
- **「当前」标记实时同步**：历史浮层优先用 Host 的 `currentSession.id` 高亮（含用户在 DeepSeek 窗口内手动切换），列表自身的 `active` 只在 Host 尚无 id 时兜底。
- **不用 React fiber 做状态**：本次全部新增状态都来自 URL / 标准 DOM / 既有 store 写入；`readTranscriptInPage` 里 fiber 只用于读取 DeepSeek 自己的 raw Markdown（既有行为，未改动）。
- **测试**：`tests/state.test.ts`（connection/currentSession/composer/message 状态与三界面快照一致）、`tests/state-compat.test.ts`（兼容层 + 旧状态迁移）、`tests/stop-state.test.ts`（Host 停止标记让未点击界面也显示「停止中…」）、`tests/chat.test.ts` / `tests/stop.test.ts` / `tests/new-chat.test.ts` / `tests/sessions.test.ts` / `tests/session-sync.test.ts`（各自的不回归用例）。

## DeepSeek 图片发送与历史恢复（Phase 18 · **18A、18B 均已实机验收**）

> 本节先记录**设计**，再记录**实现与实机验收**。设计期的「实测」结论来自真实页面上的两轮探测（2026-09-23 能力 / DOM / 历史恢复；2026-09-24 上传响应关联与失败路径），用 **companion-test profile 的临时副本** + 独立 Playwright 实例完成。**18A 已实现**（`feat(image): send images`）：8 个**核心**发送/清理场景已在真实 `companion-test` DSH 实例上跑通；**外部页面手动草稿、页面外部删除、失败卡片删除**这几条安全路径**没有完整真机驱动**，由单测覆盖（其中「审核失败后页面保留卡片」的行为已在真实环境观察到）。**18B 已实现，历史图文 reader 与 Client 界面均已在真实 Chromium / DSH Web 复验**；验收边界见下文。
>
> **⚠ 实机验收纠正了两条设计期假设**（详见文末「实现与实机验收」）：① 页面函数必须自包含（Playwright 序列化）；② 草稿 blob 扫描必须限定在 composer 内 —— 已发送消息里的图片同样以 `blob:` 渲染。

### 实测事实（真实 DeepSeek 页面）

**上传入口**

- 整页只有 **一个** `input[type=file]`：`multiple=true`，`accept` 是一份超长扩展名清单（图片与文档混在一起，**不是** `image/*`），**没有** `aria-label` / `title` / `name`，且视觉隐藏（`offsetParent === null`）。UI 上的附件图标按钮只是替用户调 `input.click()`。
- Playwright 直接 `setInputFiles()` 写这个隐藏 input 即可走同一条路径（无需点击按钮，实测反复可用）。
- **粘贴**与**拖拽**都真实支持：手工派发带 `File` 的 `ClipboardEvent('paste')` 与 `DragEvent('drop')` 都触发了真实 `upload_file` 请求。

**上传与引用**

- `POST /api/v0/file/upload_file`，`Content-Type: multipart/form-data`（浏览器原生 FormData），**不需要 conversationId**（在 `/` 空会话上也能上传）。
- 响应结构：`data.biz_data = { id: "file-<uuid>", status, file_name, file_size, is_image, model_kind, audit_result, … }`；随后 SPA 再 `GET /api/v0/file/fetch_files?file_ids=file-<uuid>` 取元数据。
- **页面的**草稿预览是**本地 blob**：`img[src^="blob:"]`（64×64，外层是 `div[role=button]`，无 aria/title）；Companion 只用它做内部 `previewIdentity`，**不作为 Client 的图片 src**。
- 发送时 `POST /api/v0/chat/completion`（JSON）用 **`ref_file_ids: ["file-<uuid>"]`** 引用图片：图片**不进入 prompt**、不 base64；只发图片时 `prompt === ""`。
- 会话创建仍由 SPA 负责（`POST /api/v0/chat_session/create`），与 Phase 07L 一致。

**草稿生命周期**

- 上传是**后台异步**的：attach 后 ~120ms 缩略图即出现（本地 blob），上传失败时草稿卡片显示 `Upload failed` 文本，composer 仍可继续输入。**这是 DeepSeek 页面自身的缩略图**，Companion 不复用它的 `blob:` src（见「Client UI 边界：attachment card」）。
- **删除入口**：hover **页面**卡片后其**右上角出现深色圆形 X**（`cursor: pointer` 的 `<svg>`，无 aria/title）；点击后草稿消失，且**不产生任何服务端删除请求**（纯前端移除，服务端文件保留）。
- **只发图片**（无文本）是允许的；图片 + 文本同样允许。
- **生成中仍可继续附加图片**（实测草稿 1 → 2 且上传真实发生）。
- 实测至少可同时附加 **6 张**（未继续加压，未触及上限）。

**上传响应关联与“成功”判据（2026-09-24 实测）**

- 在 `setInputFiles()` **之前**注册 `page.waitForResponse(POST …/api/v0/file/upload_file)`，可以稳定拿到**本次动作触发的那一条** response（顺序 attach 三次全部命中，延迟 224 / 496 ms；`file_name` / `file_size` 与本地文件逐字节一致）→ 这就是关联证据，不需要任何 DOM 推断。
- 成功响应的真实取值：`code: 0`、`data.biz_code: 0`、`data.biz_data.id: "file-<uuid>"`、`file_name`、`file_size`、`is_image: true`、**`status: "PENDING"`**。`PENDING` 是入库后的处理/审核状态，**不是失败** —— 所以判据**不能**写成 `status === 'SUCCESS'`。
- 两条失败路径都实测过：`upload_file` 被 abort → `waitForResponse` **超时**（此时本地缩略图仍会出现，卡片显示 `Upload failed`）；服务端 500 → response 正常返回，但 `code: 50000` 且没有 `biz_data`。
- 因此 `attachImage` 的“成功”必须是：**① 先注册 response waiter → ② setInputFiles → ③ 校验 HTTP 200 + `code`/`biz_code` + `id` 形状 + `file_name`/`file_size` 与本次文件一致 → ④ 才置 `ready`**，并带显式超时（建议 10 s）。**绝不以「blob 缩略图出现」或「草稿数 +1」作为成功判据**（失败时缩略图同样出现，实测已验证）。

**草稿 identity 与定向删除（2026-09-24 实测）**

- **唯一新增**：每次 `setInputFiles()` 前后对 `img[src^="blob:"]` 取差集，**恰好得到一个**新增 blob src（连续三次 attach 均 `newCount === 1`）→ 可作内部 `previewIdentity`。
- **稳定**：identity 在 6 s 后、以及输入触发 React 重渲染后**完全不变**；删除后再 attach **不会复用**旧 identity。
- **定向删除可行**：删除中间那张 → 目标 identity 消失、其它 identity 全部保留（再删第一张同样精确）；hover 后右上角命中元素是 `cursor: pointer` 的 `<svg>`（可作安全判据）。
- **`ready` 后立即发送可行**：upload response（`status: PENDING`）之后马上点发送，completion 的 `ref_file_ids` 正常带上全部草稿文件 → Host **不需要**自己等 `fetch_files`（那是 SPA 内部步骤）。

**历史恢复（切走再回）**

- user 消息中的图片是 `img`：`src` 为 **CDN 绝对 URL** `https://files.deepseeksvc.com/api/file?...`（会话内实时为相对 `/api/file?...`），两处都带 `file_id` + 签名 `state` + `ty`；`alt` = 原始文件名。
- **只有图片、没有文本的 user 消息**：`.ds-message` 的 `textContent === ""`，结构判定仍是 `user`，但当前 reader 的「空 user 气泡丢弃」规则会让**整条消息丢失**。

### 对现有 transcript reader 的影响

| 场景         | 现状（实测）                                     | 结论              |
| ------------ | ------------------------------------------------ | ----------------- |
| 图片 + 文本  | 文本保留，图片被静默忽略                         | 不破坏现有行为    |
| 只有图片     | user 消息被丢弃                                  | ✗ 必须处理（18B） |
| role 判定    | 结构判定（是否含 assistant 容器）不受图片影响    | 不需改动          |
| session 恢复 | 图片不进入 `content` / `reasoning` / `citations` | 不污染现有字段    |

### 数据模型（两个类型，**不复用**）

```ts
/** 已发送消息里的图片：没有 uploading / error —— 发出去的一定是 ready 的。 */
export interface ChatAttachment {
  id: string
  kind: 'image'
  name: string | null // 原始文件名（历史恢复时来自 img.alt）
  mimeType?: string
  bytes?: number
  remoteUrl?: string // 历史恢复的 CDN 签名 URL（会过期，仅展示；18B）
}
// ChatMessage += { attachments?: ChatAttachment[] }

/** 待发送草稿：只有它带上传生命周期。 */
export interface ComposerAttachment {
  id: string
  kind: 'image'
  name: string
  mimeType: string
  bytes: number
  status: 'uploading' | 'ready' | 'error'
  error?: string
}
// CompanionState.composer += { attachments: ComposerAttachment[] }
```

**Client UI 边界：attachment card，不是像素缩略图（18A 定稿）**

`ComposerAttachment` 只带**元数据**（`id / kind / name / mimeType / bytes / status / error`），**没有**可供 Client 渲染图片的数据。因此 18A 的 Companion UI 统一使用 **attachment card / attachment draft UI**：

```
[image icon] foo.png   ×
1.8 MB · 已就绪
```

- 三界面（Dock / Float / Pop-out）的卡片**完全由 Host `composer.attachments` 渲染**：image 图标 + `name` + `bytes` + `status`（`上传中… / 已就绪 / 失败`）+ `error` 文案 + remove 按钮（remove 走 `remove` action，Host 与页面一起删）。
- **绝不**把原图 `dataBase64` / 原始字节放进 `CompanionState`；**绝不**通过 SSE 推送完整图片。
- **绝不**把 Host `tempPath` 暴露给 Client。
- **绝不**把 DeepSeek 页面的 `blob:` URL 当作 Client 的图片 `src`（页面内部对象，跨 surface 无意义）。
- 真实 DeepSeek 页面**自己**的草稿缩略图照旧存在（那是页面的 UI，不是 Companion 的 UI）。
- **真正的 Companion 图片 thumbnail 不在 18A**：留给 Phase 24 UI Polish 或独立后续阶段；18A 不实现 thumbnail proxy / gallery / lightbox。
- 文档与实现中统一使用 **attachment card / attachment draft UI** 这一表述，避免被误解成“Companion 要渲染图片像素”。

**Host 内部记录（与 shared state 分离，永不进 SSE）**：

```ts
/** 只存在于 Host 内存的附件资源记录：id 与 ComposerAttachment.id 一一对应。 */
interface AttachmentRecord {
  id: string // att-<uuid>，与 shared state 里的 ComposerAttachment.id 相同
  tempPath: string // 随机文件名的临时文件（Host 私有）
  previewIdentity?: string // 页面草稿缩略图的 blob src（仅 Host/Browser 使用）
  deepSeekFileId?: string // file-<uuid>（仅 Host 使用；Client 无用途，不下发）
}
```

- **不进入 shared state 的东西**：`tempPath`、`previewIdentity`、`deepSeekFileId`、原始字节、`File` 句柄。
- **两者必须同步维护**：`add` 成功 → 同时写 shared state 与 record；`remove` / commit / 清空草稿 / page 重建 / dispose → 同时删两边的条目（record 里的 `tempPath` 是删除临时文件的唯一依据）。
- **`previewIdentity` 与 `deepSeekFileId` 是发送前置条件**：前者用于「页面 blob 身份集合 === Host 集合」的比对与定向删除，后者用于 `ref_file_ids` 精确校验；缺任何一个 → 该轮 send 直接 409（PRE-SUBMIT，不点 Send）。
- **Host 权威、Client 只读**：`composer.attachments` 与已发送 `message.attachments` 都只能由 Host 写；Client 通过 add/remove action 请求变更，**不能直接改**。
- **Client 本地**：仅 `File` 句柄与“正在读取文件”的瞬时 UI 态（不进 state）。
- **三界面一致**：草稿是 Host state，`New chat` / 切换 / 外部导航 / page 重建都会清空它 —— Pop-out 添加的图片，Dock / Float 通过 SSE 立即看到同一份。
- **不引入 `sessionId` 绑定**：草稿属于“当前 composer”；会话一变就丢弃（避免把 A 会话的图片带进 B）。

### 文件传输边界（三种方案对比）

| 方案 | 机制                                                                | 内存                             | 大图                                                      | 文件名/MIME                      | DSH 能力                                                                                  | 结论                                                     |
| ---- | ------------------------------------------------------------------- | -------------------------------- | --------------------------------------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| A    | Client 直接把 `File` 交给 Host API，Host 再交给 Playwright          | 全量驻留 Host                    | 受 buffered cap 限制                                      | 需显式传 name/type               | `connection.fetch` 的 route 只有 `GET/HEAD/POST` + `buffered                              | streaming` 两种 body 模式，**没有** multipart helper     | 不可行（`File` 不能跨 HTTP 直接传） |
| B    | Client base64/DataURL → Host 落临时文件 → `setInputFiles`           | base64 膨胀 33%，Host 内存峰值高 | 受 `buffered` 上限（**300 MiB**）约束，桥接层整包驻留内存 | name/type 由 Client 提供，需校验 | 与 DSH 官方图片通道同构（官方 cap 就是按「200 MiB 聚合图片 + base64」推导的）             | **可用，推荐**                                           |
| C    | Client 二进制 POST（`requestBody: 'streaming'`）→ Host 边写盘边转发 | 常驻低（背压）                   | 无聚合上限                                                | 需在 header/query 带 name/type   | 0.1.5-rc.2 的 `ConnectionFetchRoute.requestBody` 支持 `'streaming'`（无聚合上限、有背压） | 可行，但需自建一条 route + 流式落盘 + 清理，复杂度高于 B |

**推荐：方案 B**，但**只用于 `add` 这一个动作用**：Client 把**一张**图片 base64 后 POST 给 Host，Host 落临时文件并驱动页面上传；**最终 `POST /chat` 不再携带任何图片字节**（矛盾点已消除，见下）。

**限制**：单张 ≤ 20 MiB；草稿内聚合 ≤ 40 MiB（也远低于 DSH 的 300 MiB `buffered` cap，留给信头与其它字段）。若将来需要更大，再评估方案 C（`streaming`）作为 18C。

**临时文件生命周期**（`<profileDir>/deepseek-companion-uploads/`，与浏览器 profile 同域）：

| 时机                                                       | 行为                                                                  |
| ---------------------------------------------------------- | --------------------------------------------------------------------- |
| `add` 成功                                                 | 文件保留（发送前页面随时可能需要重试/展示）                           |
| `add` 失败 / 超时                                          | **立即删除**该临时文件，Host 记 `error`（保留草稿条目让用户看到失败） |
| `remove` 成功                                              | 删除对应临时文件                                                      |
| send commit 确认（见「状态一致性」）                       | **只删 snapshot（consumedAttachmentIds）里条目的临时文件**            |
| send pre-submit 失败                                       | **不删**（草稿仍在，用户可重试）                                      |
| `newChat` / `switch` / 外部导航 / page 重建 / 插件 dispose | 清空草稿 → 删除全部临时文件                                           |
| `remove` 一个 `error` 条目                                 | 见下「失败草稿的 remove 规则」；删除临时文件**幂等**                  |
| Host 启动                                                  | 扫描并清理遗留目录（上次异常退出的残留）                              |

**失败草稿的 remove 规则（18A 定稿）**

upload 失败时 record 有两种形态，remove 必须区分处理：

| 失败发生点                                                                                       | record 状态                                                                                                    | remove 行为                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **blob preview 已经出现**后失败（服务端 500 / `code: 50000` / 元数据校验不通过，页面已画出卡片） | **保留 `previewIdentity`**；临时文件按上表规则删除；`ComposerAttachment` 保持 `status: 'error'` + `error` 文案 | ① 按 `previewIdentity` 精确删除**页面上的失败卡片**（与正常草稿同一段几何点击逻辑，仍要求“目标 identity 消失、其它 identity 仍在”）；② 页面卡片确认消失后，才删除 Host 的 error attachment / record |
| **blob preview 出现之前**就失败（`upload_file` 被 abort / 超时）                                 | record **没有 `previewIdentity`**                                                                              | **不执行任何页面点击**，只清 Host 的 error attachment / record                                                                                                                                      |

- `previewIdentity` 只在“页面确实画出了卡片”时写入，因此它**不会指向不存在的元素**；找不到 identity → 安全失败（409），绝不误删其它草稿。
- 清理临时文件**必须幂等**：`unlink` 忽略 `ENOENT`（同一 record 可能经 remove / commit 清理 / newChat 清空 / dispose 多条路径到达），清理失败绝不允许阻断后续清理。
- 失败条目的清理**只针对该 record**，不影响其它草稿。

### Browser API（草案，未实现）

```ts
// Browser（Playwright 层；self-contained helper 与 sessions / new-chat 同风格）
attachImage(input: { path: string; fileName: string; mimeType: string; bytes: number })
  : Promise<{ ok: true; previewIdentity: string; deepSeekFileId: string | null } | { ok: false; error: string }>
//   ⓪ before = 当前所有 img[src^="blob:"]（identity 基线）
//   ① 注册 waitForResponse(POST /api/v0/file/upload_file)（超时 ~10s）
//   ② input[type=file].setInputFiles([{ name: fileName, mimeType, buffer }])
//   ③ 校验 HTTP 200 / code / biz_code / id 形状 / file_name / file_size 与本次文件一致
//   ④ after = 当前所有 blob src；差集必须**恰好一个** → 它就是 previewIdentity
//      （差集不为 1 → 失败：视为无法安全关联，返回 error 并让 Host 回滚）
removeDraftAttachment(input: { previewIdentity: string }): Promise<boolean>
//   ① 精确定位 img[src === previewIdentity] → 最近的 div[role=button] 卡片
//   ② hover 卡片 → 点其右上角（命中元素必须是 cursor:pointer 的 <svg>）
//   ③ 重新取 blob src：**目标 identity 必须消失**（其它 identity 必须仍在）→ 才返回 true
countDraftAttachments(): Promise<number>   // 仅诊断用，**不作**任何成功判据
// 发送：现有 sendMessage 只增加一个可选 onSubmitted（request 级 commit point），其余流程不变
sendMessage(text, onDelta, onReasoning, onCitations?, onSubmitted?: (submitted: { refFileIds: string[] }) => void)
//   ① 注册 requestPromise  = page.waitForRequest(isCompletionRequest)   （click 之前）
//   ② 注册 responsePromise = page.waitForResponse(isCompletionRequest)  （沿用现有 generation 逻辑）
//   ③ fill → click
//   ④ request 兑现 → onSubmitted(readCompletionSubmission(request)) 恰好一次
//      （字段缺失 / null = malformed，属 post-submit integrity error，绝不 `?? []` 兜底）
//   ⑤ response 兑现 → response.finished()（生命周期不变）
```

- **上传与 sendMessage 的关系**：`attachImage` 在**选图时**完成（SPA 自己上传并持有 file id），`sendMessage` 只负责发文本；Host **不构造** `ref_file_ids`。
- **上传由 Browser Host 全权拥有**：只有 Host 的浏览器能上传；Client 只投递字节、展示状态。
- **多附件 / 同名文件**：Host 侧把 attachment 操作**串行化**（内部队列 + PageGuard），一次 `add` 只 attach 一个文件；关联靠「动作前注册的 response waiter」，再用 `file_name` / `file_size` 复核，因此**同名不同大小的文件也能区分**（实测通过）。
- **response 到达顺序**：串行化后不存在并发竞态；若将来允许批量，则一次 `setInputFiles([...])` 对应 N 条 response，逐一按 name/size 匹配。
- **页面重建**（`showLogin` 新建 page）：草稿随页面消失 → Host 清空 `composer.attachments` 并删除临时文件（不试图迁移）。
- **Stop 只停 generation**：不动草稿（与真实页面一致）。

### Host API（最小：一条 route，action 判别）

- **一条 route**：`POST /api/deepseek-companion/chat/attachment`（**不用 DELETE** —— DSH 只支持 `GET/HEAD/POST`）。add / remove 操作的是同一个草稿集合，用 body 里的 `action` 判别，比两条 route 更少的注册/注销面。

```jsonc
// add：一次一张；Client 只投字节，id 与 status 由 Host 决定
POST /api/deepseek-companion/chat/attachment
{ "action": "add", "name": "a.png", "mimeType": "image/png", "dataBase64": "…" }
→ 200 { "attachment": { "id": "att-…", "kind": "image", "name": "a.png",
                        "mimeType": "image/png", "bytes": 40083,
                        "status": "uploading" | "ready" | "error", "error": "…"? } }

// remove：Host 先让页面删掉真实 draft，再删 state
POST /api/deepseek-companion/chat/attachment
{ "action": "remove", "id": "att-…" }
→ 200 { "removed": true }               // 页面草稿确实减少 + state 已删
→ 409 { "error": "page draft not removed" }   // 安全失败：Host state 与临时文件都不动
```

- 状态码：`400` 形状/MIME/尺寸非法、`409` 页面忙（guard）或页面草稿未被删除、`503` browser 未就绪。
- `composer.attachments` **只能**由这两个 action 修改；Client 永远不发送 `status`。

### 完整数据流（修正后）

```
① 选图（Dock / Float / Pop-out 任一处发起，结果全体可见）
Client File → FileReader → base64
  → POST /chat/attachment { action:'add' }
  → Host：MIME 白名单(png/jpeg/webp/gif) + 尺寸/上限校验 → 写临时文件
  → Browser：PageGuard claim → 注册 upload_file 的 response waiter → input.setInputFiles()
  → DeepSeek SPA：multipart /api/v0/file/upload_file（页面自己持有 file-<uuid>）
  → Host：校验 response → status='ready'（失败/超时 → 'error' + 删临时文件）
  → SSE → 三界面同步（uploading / ready / error 都是 Host 状态）

② 发送（**不再传图片字节**，且基于 snapshot）
Client → POST /chat { message }            // 文本可以为空（见下）
  → Host：入口检查 guard + uploading/error → consumedAttachmentIds = 当前 ready 的 id
        → 逐条要求 record.previewIdentity / record.deepSeekFileId 存在（否则 409）
        → 页面 blob 身份集合 === Host identity 集合（否则 409，不点 Send）
  → Browser：sendMessage(text, …, onSubmitted)（request/response 两个 waiter 都在 click 前注册）
  → ★ commit point：**completion REQUEST 已出现** →
        ref_file_ids === expectedFileIds（去重排序比较）
          ├─ 相等 → 写 user message.attachments → 只移除 snapshot 的 composer 条目 → 只删 snapshot 临时文件
          └─ 不等 → post-submit integrity error：不写 attachments、不回滚草稿、只清理 snapshot 资源
  → pre-submit 失败（含 request 未出现）：草稿 + record + 临时文件全部保留（可重试）
  → post-submit 失败 / Stop / interrupted：附件已归属 user 消息，不回滚
  → SSE → 三界面

③ 删除草稿（发送前）
Client → POST /chat/attachment { action:'remove', id }
  → Browser：按 record.previewIdentity 定位卡片 → hover → 点右上角 X → 确认**该 identity** 消失
  → 只有目标消失才删 Host state + record + 临时文件；否则 409（三者都不动）
```

### 只发图片（prompt === ""）

- 真实页面允许 `prompt === ""` + `ref_file_ids`（实测）。
- Phase 18A 的改动点只有两处门禁：Host 的 `/chat` 校验从「message 非空」放宽为「message 非空 **或** `composer.attachments` 中至少一条 `ready`」；`ChatView.send()` 的 `text === ''` 早退同理放宽。
- **纯文本路径不变**：没有附件时仍然要求非空文本，`expectedFileIds` 为空集合，而实测纯文本发送的 `ref_file_ids === []` → 校验天然通过、行为与现在完全一致（回归测试覆盖）；request 级 commit point 对它只是提前判断“已提交”，不改变任何可见行为。

### 状态一致性：send snapshot / commit point / attachment identity

**发送必须用 snapshot，不能“发送结束后清空草稿”**（否则会误删发送开始后新增的附件）：

```
send 开始（已通过 guard 与 uploading/error 检查）
  consumedAttachmentIds = composer.attachments.filter(a => a.status === 'ready').map(a => a.id)
  // snapshot 之后，本轮只能碰这些 id
```

- 本轮 `message.attachments` **只由 snapshot 里的记录生成**；
- 本轮清理（composer state + 临时文件）**只针对 snapshot 里的 id**；
- 不在 snapshot 里的附件（例如提交后才出现的）**本轮绝不触碰**；
- 由于生成期间 add/remove 被禁止（见下），snapshot 在整轮 send 内保持稳定。

**发送前的 draft identity 闸门（严格模式）**：发送前必须比较**集合**，不能只比数量：

```
pageDraftIdentities = 页面当前所有 img[src^="blob:"] 的 src 集合
hostDraftIdentities = 所有 AttachmentRecord.previewIdentity 集合

pageDraftIdentities === hostDraftIdentities（集合完全相等）才允许发送
否则 → /chat 409 "DeepSeek page contains image drafts not managed by Companion"
       不点击 Send、不改 composer、不删临时文件
```

即 **Companion 不允许发送它无法追踪的页面图片草稿**（用户在 DeepSeek 页面手动拖入/粘贴的图片）。用户可先删掉页面上的外部草稿，或 New chat 后重试。

**commit point = completion REQUEST 已经从页面发出**（不是 response 返回）。为什么不能用 response：`click → request 已发出 → 页面已消费图片 draft → 服务端迟迟不返回 / 连接被 reset` 时，response waiter 会超时，若把它当 pre-submit 就会**保留草稿**，造成 Host 与页面分叉。request 才是“页面已提交”的唯一可靠信号。

```
① requestPromise  = page.waitForRequest(isCompletionRequest)     ← 必须在 click 前注册
② responsePromise = page.waitForResponse(isCompletionRequest)    ← 保留，用于既有 generation 生命周期
③ page.fill(textarea, text)
④ page.locator('.ds-button--primary').first().click()
⑤ const committedRequest = await requestPromise   ← ★ commit point（已提交，不可回退）
   onSubmitted(payload)                            ← 恰好一次；payload 由 committedRequest 现场解析
   —— 校验 ref_file_ids（见下），再写入 user message.attachments
⑥ const response = await responsePromise
   if (response.request() !== committedRequest) → POST-SUBMIT ERROR（不是本轮的 response）
   await response.finished()                       ← 之后只是 generation 生命周期
```

- 两个 waiter 必须共用同一个谓词 `isCompletionRequest(req)`（`method === 'POST'` 且 `new URL(url).pathname === '/api/v0/chat/completion'`），且在 click **之前**注册。
- **request / response 强关联**：commit 后拿到 `committedRequest`，response 到达时**必须**校验 `response.request() === committedRequest`（同一对象引用，等价于“这条 response 属于本轮已提交的那个 request”）。**绝不允许**把另一条请求的 response 当作本轮 response；关联不成立 → 按 **post-submit generation/integrity error** 处理（不恢复草稿、不写 attachments、按 post-submit 清理）。
- **request 超时前失败 = pre-submit**；**request 已发出之后**（response 超时 / HTTP 5xx / connection reset / `response.finished()` 抛错 / Stop / sessionInterrupted）**一律是 post-submit**。
- **malformed completion payload 也是 post-submit**（request 一旦出现即为 COMMITTED，不因解析失败退回 PRE-SUBMIT）：`request.postData() === null`、`JSON.parse` 失败、payload 不是 object、**`ref_file_ids` 字段缺失**、**`ref_file_ids === null`**、`ref_file_ids` 不是 array、`ref_file_ids` 含非 string 元素、存在 duplicate file id、expected/actual mismatch —— **全部**归入 **POST-SUBMIT INTEGRITY ERROR，即使本轮 expected = `[]` 也不例外**：不恢复 composer attachments、清理本轮 consumed snapshot 的 record/临时文件、**不写** `ChatMessage.attachments`、不影响 snapshot 之外的 attachment、写明确的 Host error 日志。
- 实测（2026-09-24）：`click → request` 约 113 ms，`request → response headers` 约 31 ms，`response.finished()` 约 956 ms；**request 解析时 `request.postData()` 已可完整读取**，因此 `ref_file_ids` 校验可以在 commit 点同步完成，无需延迟。

**`ref_file_ids` 精确校验（唯一性集合比较，不 fuzzy、不用 dedupe 掩盖）**：

```
expectedFileIds = consumedAttachmentIds → AttachmentRecord[] → deepSeekFileId[]

规则（全部满足才算通过）：
  0. `ref_file_ids` 必须在 payload 里**显式存在**且为 array —— 缺字段 / null 一律 malformed
     （即使 expected = [] 也不接受：读不出来的请求不等于「没有引用任何文件」）
  1. expected 每一项都是合法非空 string
  2. actual 必须是 array，且元素全部是合法非空 string
  3. expected 不允许重复
  4. actual   不允许重复                    ← [A] 与 [A, A] 必须判 mismatch
  5. actual.length === expected.length
  6. Set(actual) === Set(expected)          ← 只要求集合相等，不要求数组/DOM 顺序一致
  任一不满足 → mismatch

纯文本发送：expected = []；实测 ref_file_ids === [] → 天然通过（行为与现在一致）
```

**绝不**用 `dedupe(sort(actual)) === dedupe(sort(expected))` 这类比较：它会把重复项藏起来（`[A]` 与 `[A, A]` 会被误判为相等），而**重复的 file id 本身就是异常**（同一张图片被引用两次），必须暴露为 mismatch。

- 校验**通过** → 把 snapshot 写成 `ChatAttachment[]` 写入本轮 user 消息 → 从 composer 移除 snapshot 的 id → 删除这些临时文件。
- 校验**不通过**（request 已发出）→ **post-submit integrity error**：页面已经提交，附件的归属无法确证，因此
  - **绝不**把附件放回 composer（页面已消费，回滚只会再次分叉）；
  - 只清理 **snapshot 的** record 与临时文件，**绝不**碰其它 attachment；
  - user 消息**不写** `attachments`（**不谎报**“图片已发送”）——这是最保守、最真实的数据策略；`assistant` 消息照常完成/中断，`error` 字段留在 Host 日志与该轮的错误记录里（`ChatMessage` 不新增“附件部分成功”的表达，避免假状态）。

**三阶段最终定义**：

| 阶段            | 触发条件                                                                                                                                                                                                                                                                                                | 结果                                                                                                                                                                               |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PRE-SUBMIT**  | 校验失败 / browser 未就绪 / PageGuard busy / **page↔Host draft identity 不一致** / ready record 缺 `previewIdentity` 或 `deepSeekFileId` / fill 或 click 抛错 / **completion REQUEST 未出现（request waiter 超时）**                                                                                    | composer、record、临时文件**全部保留**（等于没发生过）；user 消息沿用现有文本语义，不带 attachments；可重试                                                                        |
| **COMMITTED**   | **completion REQUEST 已出现**（`waitForRequest` 兑现）                                                                                                                                                                                                                                                  | 本轮 snapshot 进入已提交生命周期；`ref_file_ids` 唯一性集合校验**通过**则写入 `message.attachments`；一次且仅一次 `onSubmitted`。此后**任何**异常都不再回退（含 payload 无法解析） |
| **POST-SUBMIT** | response 超时 / HTTP error / `response.finished()` 失败 / Stop / sessionInterrupted / 生成中途错误 / **`response.request() !== committedRequest`** / **ref_file_ids 不一致** / **malformed payload**（postData 为 null、JSON 解析失败、非 object、`ref_file_ids` 非 array 或含非 string、duplicate id） | **不恢复**草稿；只清理 **snapshot 的** record + 临时文件；不影响其它 attachment；**不写** `message.attachments`；记录明确 Host error                                               |

**`ChatMessage.attachments` 的写入时机（最终规则）**：`/chat` 先按现有语义创建 user 消息（纯文本行为不变）→ commit 点确认 + `ref_file_ids` 校验通过后才 `update` 该消息的 `attachments`。**request 发出前绝不写入永久 attachments**；已经提交但校验失败时**保持为空**（宁缺毋假）。

**ready record 的三项前置条件**（发送前逐条检查，缺一即 PRE-SUBMIT 409）：

1. `status === 'ready'`（不允许 `uploading` / `error`）；
2. `AttachmentRecord.previewIdentity` 存在；
3. `AttachmentRecord.deepSeekFileId` 存在（用于 `ref_file_ids` 比对）。

### PageGuard 与草稿失效（唯一互斥规则）

现状（真实代码）：**send 不持有 `PageGuard`** —— `handleChatMessage` 只在入口检查 `pageGuard.inProgress()`；guard 仅被 `newChat` / `switchChat` / 外部 session sync 在各自操作期间 claim。生成期间 `chat.sending === true` 才是互斥信号。因此 18A 的规则是：

| 场景                                            | 规则                                                                                                                             |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `chat.sending === true`                         | **attach / remove / newChat / switch 一律 409**（新 route 必须显式检查 `sending`，不能只看 guard）；Client 图片按钮同时 disabled |
| `attach` / `remove` 执行期间                    | `guard.tryClaim()` 成功才继续，`finally` 释放；guard 被占用 → 409 `page operation in progress`（沿用现状）                       |
| `send` 入口                                     | 现有 `guard.inProgress()` 检查即已覆盖“有 attach/remove 在飞”竞态 → **snapshot 取定时不可能有 attach/remove 在途**               |
| 草稿里有 `uploading` / `error`                  | 禁止 send（409 + Client 禁用）                                                                                                   |
| `newChat` / `switchChat` / 外部导航 / page 重建 | 清空 `composer.attachments` + 删临时文件 + 删内部 record；外部导航由 sessionSync 触发同一段清理                                  |
| `Stop generation`                               | **不动草稿**（首版生成期间不允许新增，所以无需任何草稿善后）                                                                     |
| `attach` 失败/超时                              | 删该临时文件，条目留 `error`（用户可 remove / 重选）                                                                             |

**生成期间不复制 DeepSeek 的“可继续挂图”能力**（YAGNI）：真实页面允许，但那会让 consumed snapshot 与下一轮草稿并发、并把 `PageGuard` 生命周期复杂化；18A 首版明确禁止，扩展留到后续 Phase。

### 安全边界

1. **临时文件名**：一律 `randomUUID()` 生成（如 `att-<uuid>`，扩展名由校验后的 MIME 推导），**绝不用用户文件名拼路径**；原始 `name` 只用于展示与上传 metadata（`setInputFiles` 的 `name`）。
2. **MIME（Client 不可信）**：Host 按 **magic bytes** 判定，只接受 `png / jpeg / webp / gif` 四种（小型纯函数，无新依赖）；magic 与声明的 `mimeType` 不一致 → `400`；`<img>` 解码不属于 Host 职责。
3. **base64**：严格解码（长度/字符集校验，非法 → `400`）；**解码后再计算真实 `bytes`**（不信任 Client 上报）；单张 ≤ 20 MiB、草稿聚合 ≤ 40 MiB、数量 ≤ 5 张，超限 → `400` 并给出具体原因。
4. **状态写入**：`status` / `error` 只有 Host 能写；`previewIdentity`（blob src）与 `deepSeekFileId` 只存在 Host 内部 record，**永不进 shared state、永不下发 SSE**。

### `ready` 的准确语义

`ComposerAttachment.status === 'ready'` = **「`upload_file` 已被 DeepSeek 受理，并返回了有效 `file-<uuid>`，页面草稿已具备可提交条件」**。

- 它**不是**“服务端审核/处理最终完成”：真实响应里 `biz_data.status === "PENDING"`（处理/审核中），`PENDING` **不是失败**，也**不必等待**。
- **不需要 Host 调 `fetch_files`**：那是 SPA 自己的步骤。实测在 upload response 之后**立即**点发送，completion 的 `ref_file_ids` 正常带上全部草稿文件（`["file-<uuid>", …]`）。
- UI 文案不得承诺审核结果（文案只说“已就绪/可发送”）。

### UI 范围（最小）

- composer 行新增「图片」按钮（`<input type="file" accept="image/*" multiple hidden>`，Client 侧仍按 MIME 白名单再过滤一次），沿用现有 DSH token 的 pill 样式。
- 待发送草稿一律用 **attachment card**：image 图标 + `name` + `bytes` + 状态文案（`上传中… / 已就绪 / 失败`）+ `error` 文案 + remove 按钮；**不渲染图片像素**（无 thumbnail、无 base64、无页面 `blob:` src —— 见「Client UI 边界」）。
- **删除走 `remove` action**（Host + 页面一起删），不是只删本地卡片；失败卡片同样按 `previewIdentity` 走 `remove`（见「失败草稿的 remove 规则」）。
- 禁用规则：`sending`（与 Stop 抢主按钮）或 `pageBusy` 或 `uploading` 时禁用「图片」按钮；有 `uploading`/`error` 条目时禁用发送。
- 不做 thumbnail proxy / gallery / lightbox / crop / 编辑器 / 非图片文件（真正的 Companion 缩略图留给 Phase 24 UI Polish 或独立阶段）。

### 18A / 18B 拆分结论

- **18A（发送图片）**：选图 → Host action → 页面上传 → 草稿状态（attachment card，无像素缩略图）→ 发送（request 级 commit point + `ref_file_ids` 校验）→ 消息 `attachments`。**可独立交付，且不依赖 18B。**
- **18B（历史图片恢复）**：`readTranscriptInPage` 读 user 消息里的 `img`；只有图片的消息不再被丢弃；URL 映射必须基于**结构证据**（「这个 `img` 属于这条 `.ds-message`」），**禁止 fuzzy mapping**（不按顺序/数量猜对应关系）。签名 URL 过期后的展示降级需单独决定（例如只显示文件名占位）。
- 若 18B 达不到结构证据标准，则**只交付 18A**，历史里继续表现为“该轮只有文本/空白”，不伪造。

### 18B 实现与验收记录（2026-09-30）

- `readTranscriptInPage` 逐条读取 user `.ds-message` **内部**的 `img`。只接受 `/api/file` 且有唯一 `file_id` 与 `state` 的相对 URL 或 `files.deepseeksvc.com` HTTPS URL；相对 URL 转成 `chat.deepseek.com` 绝对地址，避免 Companion UI 错误地请求 DSH 自身域名。任何图片来源不明、参数缺失或同一消息出现重复 `file_id`，该消息的附件集合整体 safe-fail；文本照常保留，不按位置猜归属。
- 页面返回后 Host 再次验证 URL 域名、路径、签名和 `file_id` 一致性。`ChatAttachment` 只承载 `id/name/remoteUrl`；图片不混入正文、reasoning 或 citations。纯图片 user 消息因有附件而保留；空且无附件的占位消息仍丢弃。
- Host transcript 等价比较纳入**本次确证**的附件：同一文本后来出现历史图片时触发状态更新；相同图片重复读取不推送；本次未读到附件（实时页面仍是 `blob:`）时不抹掉 Host 已验证的 18A 附件。Client 对带历史 URL 的附件显示图片和文件名，加载失败（包括签名过期）时仅显示文件名；18A 实时发送的附件仍显示元数据卡片。
- 自动测试覆盖纯图片、图文混合、跨消息归属、异常 URL/重复 ID safe-fail、Host 二次校验、同文本附件更新及 `blob:` 重读保护；Client 通过 typecheck/build 验证。独立 `companion-test` profile 临时副本的只读缓存扫描定位到 3 个带 FILE 的历史会话；真实 Chromium 页面里的 user 消息分别有 1、2、1 张 `files.deepseeksvc.com/api/file` 图片，页面 reader 分别恢复 1、2、1 个附件，未打印会话内容或签名参数。此副本没有纯图片历史轮次；纯图片保留由自动测试和设计期结构探测覆盖。**Client 界面复验（2026-10-16）**：在临时 DSH Web profile 的真实 Chromium 中打开 Companion，验证图文混合消息、纯图片消息和 7 个历史图片节点的正常加载；拦截 `/api/file` 图片请求后，所有图片均由 Client `onError` 路径退化为文件名，未留下破图。临时 profile、截图和测试脚本均在验证后清理，未修改原始 profile。
- **Web 回归补充（2026-10-19）**：新发送图片后立即从“新建聊天”切回历史时，DeepSeek SPA 可能继续显示已发送消息的 `blob:` 图片；reader 不能把它当作历史签名 URL。历史读取只在检测到这类页面临时图片时触发一次有预算的前端刷新，重新读取后要求会话 ID 不变，并逐条核对原 user 消息的图片数量已成为可验证的签名附件。若证据仍不足则保持原 Host transcript。真实 DSH Web 的新图片轮次已通过立即切换复验；见 [release-hardening.md](release-hardening.md)。

### 风险与未决项（实现前已知，均可接受）

1. **`remove` 的控件是几何定位，但目标身份是精确的**：hover 后页面卡片右上角是无 aria 的 `<svg>`（几何点击），而**删哪一张由 `previewIdentity` 决定**（已实测唯一 / 稳定 / 不复用）；失败卡片（`status: 'error'`，仍带 `previewIdentity`）走同一段逻辑。缓解：identity 找不到、命中元素不是 `cursor:pointer` 的 `<svg>`、或点击后该 identity 仍在 → **安全失败（409，Host state + record + 临时文件都不动）**；绝不误删其它草稿。
2. **草稿上限未知**：实测 ≥6 张，官方上限未确认 → Host 自设上限 5 张 + 明确错误提示。
3. **上传被受理 ≠ 最终可用**：成功响应 `status: "PENDING"`（审核/处理中）。若最终审核失败，发送时的行为**未测**；Phase 18A 只保证“受理成功”，并在文档与 UI 文案上不承诺审核结果。
4. **失败草稿“手动发送”行为未测**：因此设计上**禁止**在存在 `error` 草稿时发送（比 DeepSeek 页面更保守）。
5. **签名 URL 过期**（18B 相关）：`state` 是签名参数；当前 Client 已验证过期时降级为文件名，若未来需要长期像素展示仍需重新取 URL（额外 API）。
6. **`accept` 不是 `image/*`**：文件选择器允许文档 → Client 必须自行按 MIME 白名单过滤（png/jpeg/webp/gif），不依赖 `accept`。
7. **不新增生产依赖**：base64 编解码用浏览器 `FileReader` / Node `Buffer`。
8. **外部手动草稿会被严格拒绝**（预期行为）：页面身份集合 === Host 集合是硬闸门，因此用户在 DeepSeek 页面自己拖入/粘贴的图片会让 `/chat` 返回 409，直到用户删掉它或 New chat。这是 18A 的明确取舍：**宁可拒发，也不发送无法追踪的图片**。
9. **`ref_file_ids` 不一致时消息不带 attachments**（预期行为）：页面已提交、归属无法确证时按“宁缺毋假”处理——user 消息只保留文本，附件资源被清理，Host 记录 integrity error。若将来需要“部分成功”的可视表达，应作为独立 Phase 设计，不在 18A 引入。

### 实现与实机验收（Phase 18A implemented，2026-09-24）

**代码落点**

| 文件                                           | 职责                                                                                |
| ---------------------------------------------- | ----------------------------------------------------------------------------------- |
| `src/host/attachments.ts`                      | magic MIME / 严格 base64 / 限额（20 MiB · 40 MiB · 5 张）/ 随机临时文件 / 幂等清理  |
| `src/host/attachment-resources.ts`             | Host 私有记录（`tempPath`/`previewIdentity`/`deepSeekFileId`）与按 id 精确清理      |
| `src/host/draft-images.ts`                     | **自包含**页面函数（草稿 identity / 卡片 / 删除控件 / file input 选择）+ 纯校验助手 |
| `src/host/send-attachments.ts`                 | 发送事务：snapshot、身份集合闸门、`ref_file_ids` 唯一性集合校验、commit 语义        |
| `src/host/attachment-route.ts`                 | `/chat/attachment` 的 add / remove 流程（400 / 409 / 503 全边界）                   |
| `src/client/attachment-ui.ts` + `ChatView.tsx` | attachment card（无像素）、图片按钮、三界面共用                                     |

**实机验收结果（真实 DSH + DeepSeek 页面；8 个核心场景通过）**

| 场景                                                                                   | 结果    |
| -------------------------------------------------------------------------------------- | ------- |
| 单张 PNG 上传 → attachment card `ready`                                                | ✅ 真机 |
| 图片 + 文本发送（`ref_file_ids` 精确匹配 → `user message.attachments` 写入、草稿消费） | ✅ 真机 |
| 只发图片（`prompt === ""`）                                                            | ✅ 真机 |
| 两张图一起发送（两个 file id 全部匹配）                                                | ✅ 真机 |
| 三张里删中间一张（目标消失、其它保留、下一次发送仍通过闸门）                           | ✅ 真机 |
| Stop（`stopped:true`、`status:interrupted`、已发出内容保留、草稿不回滚）               | ✅ 真机 |
| New chat → 草稿清空                                                                    | ✅ 真机 |
| Session 切换 → 草稿清空                                                                | ✅ 真机 |

**以下安全路径没有完整真机驱动，由单测覆盖**（不要读成「全部实机通过」）：

- DeepSeek 页面**手动加入** Companion 未知图片 → 发送被 409：判定逻辑由 `evaluateDraftGate` 的「集合不相等」分支单测覆盖；真机需要人工在 DeepSeek 窗口操作。
- DeepSeek 页面**手动删掉** Host 管理的 preview → 发送被 409：同样只由单测覆盖。
- **失败卡片（`status: 'error'`）的完整 remove 流程**：`remove` 的几何定位 + 确认逻辑由 `draft-images` / `attachment-route` 单测覆盖；其中「审核失败后页面卡住草稿」的现象已在真机观察到，而**由人工点击 remove 走完这一流程**未真机执行。
- `ref_file_ids` 的 malformed 分支（缺字段 / null / 非数组 / 重复）全部由单测覆盖（`tests/send-attachments.test.ts`）；真机只验证过正常路径（`[]` 与 `[file-…]`）。

**实机验收纠正的设计假设（重要）**

1. **页面函数必须自包含**。`page.evaluate(fn)` 会把函数体序列化进页面，函数体内引用任何模块级 helper / 常量都会变成 `ReferenceError`，而 `listDraftIdentities` 的 `catch` 会把它变成「页面没有草稿」的静默错误 —— 表现为上传成功但「差集为 0」，且发送闸门永远认为页面集合为空。现在 6 个页面函数各自内联 DOM 逻辑，并有一条**序列化契约测试**（`tests/draft-images.test.ts`）禁止模块级标识符与页面函数互相调用。
2. **草稿扫描必须限定在 composer 内**。设计写的是「页面所有 `img[src^="blob:"]`」，但实机发现**已发送消息里的图片同样以 `blob:` 渲染**：图片发送成功后再发一条纯文本会被闸门判成「页面存在 Companion 不认识的草稿」而 409。现在扫描规则是「祖先（≤8 层）含 `textarea` 且不含消息容器」——即 composer 内的 blob，删除确认与 attach 差集用同一规则。
3. **file input 不能取第一个**。整页可能有多个 `input[type=file]`（设计期只有 1 个）。现在按证据选择：`multiple` + 接受图片 + accept 清单最长；并列即安全失败（`ambiguous`）。失败时把「页面有几个 file input / 几个 blob」写进 Host 日志。
4. **删除控件几何规则实测可用**：hover 卡片 → 右上角 `cursor:pointer` 的 `<svg>` → 点击 → 目标 identity 从 composer 消失且其它 identity 仍在。实机还暴露了一个实现缺陷（谓词返回 `{x,y}` 而点解析要求 `{found:true}`）导致删除永远 409，已修复。
5. **审核失败的真实行为（设计风险 #3 已实测）**：上传受理 ≠ 最终可用。若 DeepSeek 侧审核/解码失败，completion 会返回**空回复**（Host 记为 `error`），而页面会**保留草稿卡片**；此时 Host 已按 commit 语义消费掉该草稿，于是页面集合 ≠ Host 集合 → 后续发送被严格闸门拒绝（409），需要用户手动删掉页面卡片或 New chat 才能继续。这是「宁可不发」策略的已知代价，**不在 18A 内自动恢复**。

**未驱动项的处理原则**：这些路径的实现仍按定稿设计保留严格语义（安全失败优先），只是**没有用真机走完**；任何后续真机验证若发现与设计不符，应以真机结论为准更新本节。

## Browser Recovery（Phase 20 · **20A 已实现并验证**）

> 本节记录 2026-09-24 的**调查 + 真实故障注入**结论、**定稿设计**，以及 Phase 20A 的**实现与验收**。
>
> **本节为 20A 验收时的历史记录**：当时 Phase **20A 已实现并验证**，20B 尚未开始；当前 20B1 / 20B2 均已完成，见下方 Phase 20B 章节。实现与设计对应关系、真实故障注入结果、与定稿设计的偏差、已知限制见下方 **§0 实现状态**。证据来源：Playwright **1.62.0** + 其自带 Chromium **151.0.7922.34**，用 `companion-test` profile 的**临时副本**（`/tmp`，独立进程）做真实故障注入；**未使用 web profile**，未记录 token / cookie，结束后清理全部进程与副本。

### 0. 实现状态（20A 已实现并验证，2026-09-24）

| 设计小节                         | 实现位置                                                                                                                                     |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| §5 健康分类 / §7 预算            | `src/host/recovery.ts`（纯函数 `classifyPageHealth` / `createRecoveryBudget` / `maxAttemptsFor` / `backoffForAttempt`，单测覆盖）            |
| §11 `recovering`                 | `src/shared/state.ts`（`ConnectionStatus`）+ `src/host/state.ts`（`setRecovering`）+ `src/client/api.ts`（`CONNECTION_STATUSES`）            |
| §3 epoch / §8 listener ownership | `src/host/browser.ts`：`pageEpoch` / `browserEpoch` + `mountPage`（`WeakSet` 去重 + 每个回调先查 `disposed` / epoch）                        |
| §6 single-flight                 | `recover()` / `runRecovery()`：`recoveryPromise` + `pendingRecovery`（settle 后仍不健康才再跑）                                              |
| §10.1 navigation suppression     | `recoveryNavigationActive`（`mountPage` 的 `framenavigated` 分支）+ `recovery.onMarkKnown`                                                   |
| §9 / §10 Level 1/3               | `rebuildPage()` / `rebuildBrowser()`（Level 3 重装 `exposeFunction` + 复用同一 `profileDir`）                                                |
| §8 recoverTarget / 状态保留      | `recovery.getRecoverTarget`（index.ts 由 `currentSession` 构造）+ 恢复期不改 `currentSession` / `messages`                                   |
| §13 route 接线                   | `index.ts` 的 `readyBrowser()`：chat / attachment / deep-think / search / new-chat / sessions / switch / show 在 page 操作前 `ensureReady()` |

**真实故障注入结果**（`companion-test` profile 副本，2026-09-24）：

| 场景                                     | 结果                                                                                                                                                | 恢复耗时 |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| A `page.close()` → Level 1               | ✅ recovering → online，transcript 未清，markKnown 恰好一次                                                                                         | ~1.2 s   |
| B renderer crash → Level 1               | ✅ close + newPage 恢复（crash 页不可复用）                                                                                                         | ~1.5 s   |
| C `about:blank` → PAGE_INVALID → Level 1 | ✅ 不等 30 s locator timeout                                                                                                                        | ~1.3 s   |
| D kill Chromium → Level 3                | ✅ 同 profile 登录态保留、bridge 重装                                                                                                               | ~1.6 s   |
| E 流式中 kill（commit point 后）         | ✅ send `rejected`（324 ms，不卡 60 s）、不自动重发、恢复后 logged_in                                                                               | —        |
| F 5 并发 `ensureReady`                   | ✅ 只一次 recovery（`recovering` true→false 仅一轮）                                                                                                | ~1.3 s   |
| G ready attachment + Level 1/3 page loss | ✅ 真实上传 PNG → page.close 与 kill 各一次：composer draft、AttachmentRecord、temp file 全部清空，currentSession / transcript 保留                 | —        |
| H 已打开的 Client/SSE 跨 recovery        | ✅ 真实 DSH Client（未刷新，navigation 恒为 1）：SSE 观测到 `online → recovering → online`，恢复后同一 Client 发消息 streaming 正常、切开关状态保持 | —        |
| I recovery 后 session watcher 恢复       | ✅ 真实页面点击 A→B→A→New chat：recovery 的 goto(A) 被 suppression 挡住（locationLog 未增长）、markKnown(A) 恰好一次、watcher 完整恢复              | —        |

**与定稿设计的偏差（如实登记）**：

1. **`pendingRecovery` 再触发前先查健康态**：设计 §6 说「同一预算内再跑一次」；实测 kill 会**同时**触发 `page close` + `disconnected` 两个事件，第一轮 Level 3 已经治好一切，直接再跑会多一轮多余 rebuild。实现改为 settle 后先 `syncHealth()`，仍不健康才再跑。
2. **`lastOpDomFailed` 细粒度标志未实现**：设计 §5 的「最近操作因 DOM/locator failure 才 probe」由 `knownHealthy` 的一次性确认 + 生命周期事件置 false 覆盖（crash / close / disconnected / 新 page / 恢复成功重确认）；未单独维护「上次 DOM 失败」标志，一个 DOM 级失败由下一次 `ensureReady` 的同步生命体征或操作自身的快速失败兜住。
3. **Level 1 → Level 3 升级时 `onPageReplaced` 触发两次**：kill 场景先按 `page-closed` 走 Level 1（触发一次 draft invalidation），`newPage` 抛 `TargetClosedError` 后升级 Level 3（再触发一次）。draft invalidation 幂等，无副作用。
4. **`onDiagnostics` 诊断钩子**：`RecoveryCallbacks.onDiagnostics` 仅为 fault injection / 调试暴露 `getPage` / `getContext`，不进入任何 route。

**已知限制**：20B 的 `readTranscript` 回填、删除会话后的 transcript 最终决策、恢复文案未做（见 §15 边界）。

### 1. 现状：Browser 生命周期（源码事实）

```
index.ts ctx.effect
  └─ createDeepSeekBrowser(profileDir, onStatus, onDeepThink, onSearch, onSessionLocation, onPageReplaced)
       ├─ chromium.launchPersistentContext(profileDir, { headless:false, viewport })  ← persistent context（唯一 context）
       ├─ let page = context.pages()[0] ?? await context.newPage()                     ← 可变闭包变量，方法调用时读取
       ├─ await context.exposeFunction('__onReplyDelta' | '__onReasoningDelta')        ← context 级桥（page 无关）
       ├─ attachListeners(page)       : page.on('load') / page.on('response', …/users/current)
       ├─ attachSessionWatcher(page)  : page.on('framenavigated') → 会话位置 → onSessionLocation
       └─ { check, showLogin, …, dispose }
     成功 → browser = created · setBrowserReady(true) · await created.check()
     失败 → warn + setBrowserReady(false) + status 'error'   ← **之后永不重试**（只有 plugin reload 才会再试）
```

| 事实          | 结论                                                                                                                                                     |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **事件监听**  | `browser.on('disconnected')`、`context.on('close')`、`page.on('close')`、`page.on('crash')` **全部缺失**（只有 `load` / `response` / `framenavigated`）  |
| 探活          | 无周期探活；`page.isClosed()` 只在 `showLogin()` 里用了一次                                                                                              |
| page 引用     | 可变闭包 `page` → **Level-1 重建只要重新赋值 `page`，其余方法自动自愈**（它们都在调用时读 `page`）                                                       |
| context 引用  | `const context` → Level-3 必须改成可变，并**重装 context 级桥**                                                                                          |
| `showLogin()` | 仅当 `page.isClosed()` 才新开 page（+ attachListeners + attachSessionWatcher + `onPageReplaced`）→ **crash 页面 `isClosed() === false`，它救不了 crash** |
| `dispose()`   | `disposed = true` + 清 delta receiver + `await context.close()`；index.ts 里 **不 await**（`void browser.dispose()`）                                    |
| 路由          | `browser === null → 503`；页面操作 guard 一律 `finally` 释放；`/chat` 一律 `finally` 清 `chat.sending`                                                   |

**没有任何一处会在故障后改变 `connection`**：`setBrowserReady` / `setDeepSeekStatus` 只由启动成败与 `runDetect()`（load / `/users/current` response）驱动 → 浏览器死掉后 Host 仍报 `online`，Client 的发送按钮**仍然可点**，点下去才失败（错误文案是原始 Playwright 英文错误）。

### 2. 故障注入结果（真实测量，2026-09-24）

**事件可靠性**

| 故障                               | `page.on('close')`                 | `page.on('crash')` | `context.on('close')` | `browser.on('disconnected')` |
| ---------------------------------- | ---------------------------------- | ------------------ | --------------------- | ---------------------------- |
| `page.close()`                     | ✅                                 | ✖                  | ✖                     | ✖                            |
| renderer crash（`chrome://crash`） | ✖（只有 `ctx.close()` 时才补触发） | ✅（~300 ms）      | ✖                     | ✖                            |
| `context.close()`                  | ✖                                  | ✖                  | ✅                    | ✅                           |
| `kill -9` Chromium 主进程          | ✅                                 | ✖                  | ✖                     | ✅（**+28~38 ms**）          |

**状态与错误（关键）**

| 观测                     | `page.close()`                                                          | renderer crash                                                                                | `context.close()`     | `kill -9`             |
| ------------------------ | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | --------------------- | --------------------- |
| `page.isClosed()`        | `true`                                                                  | **`false`（不变）**                                                                           | `true`                | `true`                |
| `page.url()`             | 抛错                                                                    | **仍返回旧 URL（陈旧）**                                                                      | 抛错                  | 抛错                  |
| `browser.isConnected()`  | `true`                                                                  | **`true`**                                                                                    | `false`               | `false`（+28 ms）     |
| `context.pages().length` | `0`                                                                     | `1`                                                                                           | `0`（不抛）           | `0`                   |
| `context.newPage()`      | ✅ 260 ms                                                               | ✅                                                                                            | ✖ `TargetClosedError` | ✖ `TargetClosedError` |
| 页面操作报错             | `TargetClosedError: …: Target page, context or browser has been closed` | `page.goto: Page crashed` / `page.evaluate: Target crashed` / `locator.count: Target crashed` | `TargetClosedError`   | `TargetClosedError`   |
| 关闭全部 page            | 浏览器仍活着，`newPage()` 可用                                          | —                                                                                             | —                     | —                     |

- **崩溃页不能复用**：crash 后 `page.goto()` / `page.reload()` 都抛 `Page crashed`，`evaluate` / locator 抛 `Target crashed`；`page.close()` 可用，随后 `context.newPage()` 正常 → **crash 的恢复路径必须是 close + newPage**。
- **pending waiter 会快速失败，不会挂到超时**：`kill -9` 时 pending 的 `waitForResponse` 在 **28 ms** 内 reject；`response.finished()`（真实流式中）在 **22 ms** 内 reject，均为 `TargetClosedError`。**因此 `chat.sending` / guard 都能立刻归零，不存在「卡到 60 s 超时」的情况。**
- **Host 不崩**：kill 后 Node 侧（= DSH Host 的等价物）继续运行，只有等待页面操作的 promise reject；无进程级崩溃。

**时间（用于 retry/backoff）**

| 操作                                                     | 实测                                                                                                               |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `launchPersistentContext`（首次 / 热重启）               | 1453–1567 ms / 555–711 ms                                                                                          |
| `context.newPage()`                                      | 260 ms                                                                                                             |
| `goto(HOME)` + `domcontentloaded` + 检测                 | ~2–4 s                                                                                                             |
| 第二次启动（同 profile、第一个实例存活）                 | **176 ms 快速失败**，错误信息**误导**：`…launchPersistentContext: Target page, context or browser has been closed` |
| 同 profile 立即重启（`close()` 未 await / SIGKILL 之后） | **成功**（621 / 555 ms）                                                                                           |

**persistent context 特有事实**：`context.browser()` 非 `null`（`isConnected()` 可用、`version()` = 151.0.7922.34），但 **`browser.process()` 不存在** → Playwright 侧拿不到 PID（测试要靠进程树）。

### 3. 故障类别与当前行为

| #   | 故障                              | 当前行为                                                                            | Host state                               | Client 看到                                            | 现状可否自动恢复                                                                  | 需重建                      |
| --- | --------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------- | --------------------------- |
| A   | **page 被关闭**                   | 无事件 → 无状态变化；页面操作快速抛 `TargetClosedError`                             | `browserReady=true` · status `logged_in` | 仍 `online`、按钮可点 → 发送后显示原始 Playwright 错误 | ✖（只有用户手动「打开登录窗口」能救）                                             | **page**                    |
| B   | **page crash**                    | 无监听；`isClosed()===false` 使 `showLogin()` 也不触发重建；操作抛 `Target crashed` | 同上                                     | 同上                                                   | ✖                                                                                 | **page（close + newPage）** |
| C   | **context 被关闭**                | `browser:disconnected` 触发但无人监听                                               | 同上                                     | 同上                                                   | ✖                                                                                 | **browser（= context）**    |
| D   | **browser / 进程死亡**            | `disconnected` 28 ms 触发、无人监听；pending waiter 快速 reject                     | 同上                                     | 同上                                                   | ✖                                                                                 | **browser**                 |
| E   | **页面跳到非预期路由**            | `load` → `runDetect` → `/users/current` 失败 → status `error` → `offline`           | status `error`                           | 状态变为离线（当前无横幅渲染）                         | 部分自愈：未知路由 / 已登录时的 `/sign_in` 都被 DeepSeek **重定向回 `/`**（实测） | 无需重建                    |
| F   | **页面活着但 DOM 永不可用**       | 同 E（无周期探活）；发送会**等满 locator timeout（~30 s）** 才失败                  | 视 `load` 是否触发                       | 长时间等待后失败                                       | ✖                                                                                 | page（或先探活再决定）      |
| G   | **网络短暂异常**                  | completion 失败 → 500 + assistant `error`；**与浏览器故障无关**                     | 不变                                     | 正常错误提示                                           | —（**不应**触发重建）                                                             | 无                          |
| H   | **DSH 活着、Playwright 子进程死** | 等价于 D；Host 进程存活（等价 Node 进程实测未崩）                                   | 同 D                                     | 同 D                                                   | ✖                                                                                 | browser                     |

> **E / F 两类（非预期路由 / 页面活着但 DOM 不可用）在 §5 统一收口为 `C. PAGE_INVALID`**：`about:blank` 这类「活着但不可用」的页面不允许继续走 30 s locator 慢失败，而 sign-in 页面（天生没有 composer）不算 invalid。

### 4. 恢复层级（提案）

**Level 2 不存在**：本项目用 `launchPersistentContext`，**只有一个 context，且它就是浏览器会话**。实测 `context.close()` 同时触发 `context:close` + `browser:disconnected`、`isConnected()===false`、`newPage()` 抛 `TargetClosedError` → 「重建 context」与「重建 browser」是同一件事。

```
Level 1 — 重建 page（browser/context 健康）
  page.isClosed() || crashed  →  close()（crash 页必须 close）→  context.newPage()
  →  attachListeners(newPage) + attachSessionWatcher(newPage)
  →  onPageReplaced()            （Phase 18A：草稿随旧页失效 → 清 composer + records + temp files）
  →  goto(HOME) → runDetect() → syncComposerMode()
  ✔ 不需要重装 exposeFunction（实测：同 context 内新 page 仍有 __onReplyDelta）

Level 3 — 重建 browser（disconnected / isConnected()===false / Level 1 失败）
  closeQuietly(旧 context)         （best effort，忽略一切错误）
  →  context = await chromium.launchPersistentContext(**同一个 profileDir**, 同参数)（bounded retry）
  →  await context.exposeFunction('__onReplyDelta' | '__onReasoningDelta')   ★ 必须重装
  →  page = context.pages()[0] ?? await context.newPage()
  →  attachListeners + attachSessionWatcher + onPageReplaced()
  →  goto(HOME) → runDetect() → syncComposerMode()
  ✖ 不重装桥 → 发送会「成功」但**永远收不到流式增量**（实测 Level-3 后 window.__onReplyDelta === undefined，重装后恢复）
```

**profile 与登录态**：`DEEPSEEK_COMPANION_PROFILE` → `<profileDir>/deepseek-companion-browser` → `$DSH_HOME/deepseek-companion-browser` 优先级**不变**，Level-3 必须复用同一目录。实测：`kill -9` 后立刻用同目录重启 → **555–711 ms 成功，`/users/current` 仍 200（登录态保留）**；`SingletonLock / SingletonCookie / SingletonSocket` 存在但**不阻塞重启** → **禁止删除 lock 文件**。

### 5. 页面健康分类与恢复入口（提案）

**「活着但不可用」的页面不能靠 `isClosed()` 发现**：实测 `about:blank` 时 `page.isClosed() === false`、`browser.isConnected() === true`，但 composer 不存在 → 发送要**等满 locator timeout（~30 s）**才失败。因此 `probe()` 是**五分类**，`ensureReady()` 在任何页面操作前按分类决策：

| 分类                  | 判定（只用生命周期状态 / URL / bounded DOM，**禁止 message matching**）                                                                                                                          | 动作                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| **A. HEALTHY_CHAT**   | `!isClosed()` · 无 crash 标记 · `isConnected()` · origin 是 DeepSeek · 非 sign-in · composer readiness 通过                                                                                      | 直接执行（零额外 IO）                                                                |
| **B. LOGIN_REQUIRED** | 生命周期健康 + origin 是 DeepSeek，但 **URL 是 sign-in 路由**（`/sign_in`，或页面已渲染 sign-in 表单 / `detectStatus` 结论为 `logged_out`）                                                      | **不 recovery**；`connection → login_required`；`currentSession` / messages **保留** |
| **C. PAGE_INVALID**   | `!isClosed()` · 无 crash 标记 · `isConnected()`，但 **origin 不是 DeepSeek**（`about:blank` / `chrome://…` / 其它站点）**或** DeepSeek origin 下 **bounded readiness 内拿不到核心 composer DOM** | **Level 1**（close → newPage → attach → goto(recoverTarget) → detect）               |
| **D. PAGE_DEAD**      | `page.isClosed()` **或** crash 标记（`page.on('crash')` 已置位）                                                                                                                                 | **Level 1**                                                                          |
| **E. BROWSER_DEAD**   | `!browser.isConnected()` **或** 收到 `disconnected` **或** Level 1 自身抛 `TargetClosedError`                                                                                                    | **Level 3**                                                                          |

规则：

- **bounded readiness**：composer 就绪只用**一次带上限的等待**（`waitForSelector` / `waitForFunction`，**≤2 s**），**绝不**无上限轮询；超时即判 **C**，而不是让业务操作自己去撞 30 s locator timeout。
- **sign_in 绝不判成 invalid**：先判生命周期与 origin，再判 sign-in 路由；sign-in 页面**天生没有 composer**，「composer 缺失」对它是**期望行为** → 归 **B**（不 recovery）。
- **origin 优先**：非 DeepSeek origin 一律 **C**（在 `about:blank` 上做 DOM 探测没有意义）。
- **判定是「操作前的即时分类」，不是周期轮询**：没有 background timer、没有「探活 → 失败 → 重建」的循环。
- **零成本热路径**：A 的判定只需 `isConnected()` / `isClosed()` / crash 标记 / `page.url()`（全同步、无 IO）。只有以下情况才做 ≥0 次 IO 的 readycheck：① origin 不是 DeepSeek；② 页面刚被重建 / 刚 `goto` 完成（composer 存在性未知）；③ **上一次页面操作以 DOM 相关超时失败**（这同时覆盖故障类别 F「页面活着但 DOM 永不可用」，无需常驻探活）。
- 只有 **A / B** 允许进入业务路径；**C / D / E** 先走 single-flight 恢复，恢复失败 → `connection = offline`。

入口仍是两个（与 §6 的 single-flight 共用同一个 promise）：

```ts
// 每个页面操作前的唯一入口：A/B 直接返回（零额外 IO），C/D/E 触发 single-flight 恢复
ensureReady(): Promise<{ kind: 'HEALTHY_CHAT' | 'LOGIN_REQUIRED' | 'PAGE_INVALID' | 'PAGE_DEAD' | 'BROWSER_DEAD'; status: DeepSeekStatus }>
// 事件驱动入口（listener 内调用，防重入）
recover(reason: 'page-closed' | 'page-crashed' | 'context-closed' | 'browser-disconnected' | 'invalid-page' | 'probe-failed'): Promise<void>
// 只读探针（不恢复）：供 ensureReady() 与诊断使用
probe(): Promise<{ kind: …; pageAlive: boolean; crashed: boolean; connected: boolean }>
```

- **触发源 = 事件 + 惰性分类**：事件（`page close` / `page crash` / `browser disconnected`）负责「立刻知道」；`ensureReady()` 的分类负责「事件漏了也能自愈」。**crash 必须靠事件**（`isClosed()` 检测不出来）。
- **禁止 message matching**：文案会变（`TargetClosedError` / `Page crashed` / `Target crashed`），判定只用生命周期状态 / URL / bounded DOM。

### 6. 并发模型：single-flight（与 PageGuard 分开）

```
recoveryPromise: Promise<…> | null      // 非 null 时所有调用者 await 同一个 promise
epoch: number                            // 每次成功重建 +1
```

- 5 个请求同时发现 page 死了 → **只启动一次 Chromium**，其余 await 同一个 promise。
- 恢复中又收到 `disconnected`（新浏览器立刻又死）→ 置 `pendingRecovery = true`，当前 promise settle 后**在同一预算内**再跑一次，而不是无限递归。
- 恢复结束（含失败）**一定**在 `finally` 清 `recoveryPromise` → **锁不会泄漏**。
- **与 PageGuard 的关系：分开，不复用。**
  - PageGuard = 「现在谁可以点这个页面」= 同步 `tryClaim` + `finally release`，持有者是 route（新建 / 切换 / 外部同步）。
  - Recovery = 「浏览器生命周期」= 异步 single-flight promise，**不 claim PageGuard**（页面已死时，任何持有 guard 的操作都已经在快速失败）。
  - 唯一耦合：恢复的「goto + detect」阶段若 `guard.inProgress()` 为真（罕见：某 locator 超时仍在跑），**有界等待**（≤3 s）再继续；等待不改变 guard 归属。

### 7. 重试与退避（提案，基于实测）

- **Level 1**：最多 2 次（`newPage` 260 ms）；仍失败 → 升级 Level 3（**同一次 recovery 内升级**，不新开预算）。
- **Level 3**：最多 3 次，退避 `0 / 250 / 750 ms`（launch 555–1567 ms；实测「同 profile 立刻重启」成功率 100% → 不需要长退避；**不做无限 polling**）。
- 分类：
  - 重试耗尽 → `browserReady=false` + status `error` → `connection = offline`（**不是** `login_required`）。
  - 重启成功但 `runDetect()` 返回 `logged_out` → `login_required`（页面真实结论）。
  - 网络导致的 `goto` 超时 → **不重建**（重建也修不好），报 `offline`，避免重建风暴。
- plugin reload（旧 `context.close()` 未 await）与「用户手动跑第二个实例」：实测前者**不阻塞重启**（621 ms 成功），后者 **176 ms 快速失败**且信息误导 → 只能靠「重试 3 次 + 失败后如实报 offline」处理，**不得**据此把用户引导到重新登录。

**每一步自身都必须 bounded**（否则「有限重试」没有意义）：

| 步骤                                                 | 上限（建议）                              | 依据 / 说明                                                                          |
| ---------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------ |
| `closeQuietly(旧 page / 旧 context)`                 | **≤2 s**                                  | 超时即放弃（吞掉错误）；旧进程仍活着时 launch 会 176 ms 快速失败，重试会处理         |
| `context.newPage()`                                  | **≤5 s**                                  | 实测 260 ms，留足余量                                                                |
| `page.goto(目标)`                                    | **≤30 s**（`domcontentloaded`）           | 与现有 `check()` / `showLogin()` 的 30 s 预算一致；**不再追加** `networkidle` 长等待 |
| login detection（`detectStatus` → `/users/current`） | **≤10 s**                                 | 复用现有 detect 的预算                                                               |
| composer readiness（判 A / C）                       | **≤2 s**                                  | 唯一 DOM 判据，见 §5                                                                 |
| **单次 recovery 尝试总上限**                         | **≤45 s**                                 | 超出即判本次失败 → 进入下一次（或耗尽 → `offline`）                                  |
| **整个 recovery 的全局预算**                         | **60 s**（`RECOVERY_TOTAL_BUDGET`，定稿） | 从 `recoveryPromise` 创建起算；下面的次数上限受它二次约束                            |

- 任何一步都要有**自己的** timeout 与 `catch`；**禁止**出现「某一步无限等待」把有限重试架空。
- **全局 wall-clock 预算（定稿）：`RECOVERY_TOTAL_BUDGET = 60 s`** —— 从 single-flight `recoveryPromise` 创建开始计时。Level 1 / Level 3 的**全部**重试、backoff（0 / 250 / 750 ms）与每一步（closeQuietly / newPage / goto / login detection / composer readiness）**共享同一个 60 s 总预算**。每一步的实际 timeout 取 `effectiveTimeout = min(stepTimeout, remainingRecoveryBudget)`；`remaining ≤ 0` 时**立即停止 retry** → `connection = offline`，保持 last-known `currentSession` / `messages`，并在 `finally` 里清空 `recoveryPromise`、`pendingRecovery` 与全部锁。
- **Level 1 ≤2 / Level 3 ≤3 / 退避表只是「次数上限」**：真正执行的次数还受 60 s 总预算约束——不允许 3 次 attempt × 45 s 被拉成数分钟的恢复，也不允许任何一步以「自己的完整 step timeout」越过剩余预算。
- 恢复期间的时间预算对外可见：`recovering` 若逼近 / 超过 60 s 总预算就应如实转 `offline`，而不是继续挂着。

### 8. Listener 生命周期与 stale-event 抑制（epoch）

**attach 去重**：

- **每个 page 对象只 attach 一次**：用 `WeakSet<Page>` 记录已挂载 page；`attachListeners` / `attachSessionWatcher` 入口先查表。
- 旧 page 死掉后其 listener 不再产生事件（实测 close / crash 后无后续事件）→ 但 **crash 且未 close 的 page 仍是「活对象」**，所以重建时**必须** `close()` 旧 page，并在逻辑上注销。
- Level-3 后**全部重挂**：`load` / `response` / `framenavigated` + 两个 `exposeFunction`（后者是 context 级，实测 Level-3 后必须重装）。

**stale-event 抑制（最小改造，不动 chat 架构）**：

```
pageEpoch: number      // 每次 page 被替换（Level 1 / Level 3）+1
browserEpoch: number   // 每次 Level 3 +1
```

- **所有 listener 与异步操作在注册 / 启动时捕获当时的 epoch**；回调或续接（continuation）进入时先比较：

```ts
const myPage = pageEpoch              // 注册时捕获
…回调内…
if (disposed || myPage !== pageEpoch) return   // 过期事件：不 forward、不写 store、不产出业务状态
```

- **必须覆盖的路径**（每一条都对应一个真实的污染面）：

| 路径                                                                                    | 若不过滤会怎样                                          |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| 旧 page 的 `framenavigated`                                                             | 旧页导航改写 `currentSession`，把重建后的真实位置覆盖掉 |
| 旧 page 的 `response(…/users/current)`                                                  | 旧页的 auth 结论覆盖新页的 `status`                     |
| 旧 send 的 `__onReplyDelta` 回调                                                        | 旧页/旧 send 的增量写进新页的 assistant 消息            |
| 旧 send 的 `__onReasoningDelta` 回调                                                    | 同上（reasoning 内容串台）                              |
| 旧 send 结束时的**最终 DOM 读取**（final reply read / citation hydration / `JSHandle`） | 旧页（已 close/crash）的读取结果被当成这一轮的真实回复  |

- **`currentDeltaReceiver` / `currentReasoningReceiver`**：page 替换时**立即置 null**，新 send 自己重新赋值 —— 旧 send 的接收器不会再被调用（这是 §9「send 中崩溃」语义的实现基础）。
- **`dispose()` 也走 epoch**（+1）→ 关闭后的所有过期回调天然被忽略。
- **不允许**用「比较 page 对象引用」代替 epoch：crash 且未 close 的旧 page 仍是活跃对象引用，只有 epoch 能表达「它已经不是当前页面」。

### 9. 故障期间的操作语义

| 场景                               | 语义                                                                                                                                                          |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **sendMessage 中崩溃**             | pending waiter 22–28 ms 内 reject → `chat.ts` 的 `finally` 清 `chat.sending`，assistant 消息 `status='error'`（已流出的内容保留）。**绝不自动重发用户消息。** |
| **Stop 中崩溃**                    | `stopGeneration` 快速失败 → 503/500；`chat.sending` 仍由 send 流程收尾 → 不会永久 `stopping`                                                                  |
| **attachment 上传中崩溃**          | `upload_file` waiter reject → 该 attachment `status='error'`（页面预览若已出现则保留 `previewIdentity`）；composer 不静默清空                                 |
| **attachment 已 ready 但页面丢失** | **沿用 Phase 18A 规则**：page 重建 = 草稿失效 → `onPageReplaced()` → 清 `composer.attachments` + records + temp files                                         |
| **newChat / switch 中崩溃**        | guard `finally` 释放（页面操作快速失败）→ 无永久忙；transcript **保持不动**（page-first 原则）                                                                |
| **外部会话同步中崩溃**             | `run()` 的 `catch` 吞掉错误 + `finally` 释放 guard；`lastKnown` 不更新，下次导航可重试                                                                        |
| **共性要求**                       | 所有 `finally` 必须释放：`chat.sending`、`composer.stopping`、PageGuard、**recoveryPromise**；恢复本身不引入新的「永久忙」                                    |

### 10. 恢复期与恢复后的 session / transcript 策略

**核心原则（20A 收口）：recovery 不改写 Host 的 session / transcript 事实。`offline` 表示「浏览器状态不可验证」，不代表「没有会话」。**

1. **恢复开始前**：`recoverTarget = { ...currentSession }`（last-known snapshot）+ Host `messages` 原样保留、`currentSession` 原样保留。
2. **恢复期间**：`currentSession` 与 `messages` **一律不动**；只有 `connection` 变化（`recovering` → 最终态）。
3. **只有以下三种情况允许改 `currentSession`**：
   - **恢复成功且确认原会话**：页面 URL 真实落在 `/a/chat/s/<recoverTarget.id>` → **保持原 id**（不写、无变化）。
   - **恢复成功，且 DeepSeek 页面自己把已不存在的会话重定向到 `/`**（URL 事实）→ `currentSession = {id:null}`；**是否清 messages 留给 20B reconciliation**（20A 不清）。
   - **`login_required`**（页面真实是 sign-in）→ `currentSession` / `messages` **全部保留**，`connection = login_required`；**绝不因为退出登录销毁用户仍在看的历史**。
4. **恢复失败 / 恢复导航失败 / 网络失败 / 重试耗尽**：`connection = offline`，`currentSession` **保持 recoverTarget**，`messages` 保持，**不猜页面位置**。
5. **禁止的组合**：`currentSession = {id:null}` + 仍带 `sessionId` 的历史消息（语义冲突，本设计不再产生）。
6. `recoverTarget.id === null`（崩溃前就在新会话）：`goto('/')`，`currentSession` 保持 `{id:null}`，messages 保持。

**与 Phase 08.2 的兼容性**：`currentSession` 在 08.2 的语义是「当前（**最后确认的**）会话」，不是实时探针；实时可用性由 `connection` 表达。因此「`offline` / `recovering` + 保留 `currentSession` / `messages`」**不新增 currentSession 的 unknown 状态、不修改 MessageStatus**，也不与 `setCurrentSession` 的既有写点冲突；唯一扩大的枚举是 `connection.status`，其正式新值 `recovering` 见 §11（定稿）。

#### 10.1 recovery-generated navigation 与 session watcher

Recovery 自己会产生 `newPage` / `goto('/')` / `goto('/a/chat/s/<id>')`。这些**不是用户导航**，绝不能被 `sessionSync` 当成「用户切会话」而触发 `apply()`（那会 `clearChatMessages()` / `replaceChatMessages()`）。

**最终方案（定稿，唯一方案；三层防护职责不同、互不替代，全部实现——不存在「至少一种」的选项）**：

1. **recovery 开始**：置 `recoveryNavigationActive = true`（或等价的 recovery-navigation token / epoch）。
2. **Recovery 自己产生的** `newPage` / `goto('/')` / `goto('/a/chat/s/<id>')` 会照常触发 `attachSessionWatcher` 的 `framenavigated`，但该导航属于当前 recovery → watcher **不调用 `sessionSync.onLocation()`**、不 `clearChatMessages()`、不 `replaceChatMessages()`、不产生 external switch、不排队 `pending`。
3. **recovery 成功并取得最终真实 location 后**：调用 `sessionSync.markKnown(actualLocation)` —— 只把 `lastKnown` 对齐到页面真实位置，**不触发 transcript rebuild**。
4. **然后清** `recoveryNavigationActive`（`finally`，含失败路径）。
5. `pageEpoch` / `browserEpoch`（§8）继续拦截**旧 page** 的 `framenavigated` / auth response / delta / reasoning / final DOM read。

| 三层防护（定稿）                        | 职责                                                  |
| --------------------------------------- | ----------------------------------------------------- |
| `recoveryNavigationActive` suppression  | 挡**当前新 page** 上由 Recovery 自己制造的合法导航    |
| `sessionSync.markKnown(actualLocation)` | 对齐 `sessionSync.lastKnown`（不 rebuild transcript） |
| `pageEpoch` / `browserEpoch`            | 挡**旧 Browser / Page** 的 stale callbacks            |

**20A 的可见结果**：浏览器崩了 → 自动恢复 → 用户不刷新 DSH → **Host 现有 transcript 不被误清** → 恢复成功后页面回到 `recoverTarget` 的 URL（原会话尽量重新打开）→ 用户可以**继续发送**。

> 20B 才做：`readTranscript()` 回填、补齐「服务端已完成但 Host 未收到」的 assistant reply、会话被删除后的 transcript 最终决策、更完整的 title refresh、以及「正在恢复 DeepSeek…」文案。

### 11. connection 状态模型（定稿）

`ConnectionStatus` **正式新增 `recovering`**（不是加一套 `browser.status` 子对象）。实现阶段的类型设计写死为：

```ts
type ConnectionStatus =
  | 'online' // Browser/Page 已验证可正常使用
  | 'offline' // Recovery 失败 / 预算耗尽 / 网络或 Browser 状态无法恢复
  | 'login_required' // Browser/Page 健康，但 DeepSeek 明确要求登录
  | 'recovering' // single-flight recovery 正在执行
```

- **`recovering` 的精确语义**：single-flight `recoveryPromise` 在飞行中（含 Level 1/3）＝ **Client 操作禁用**（所有既有 `connection !== 'online'` 门禁天然生效）＝ **不代表 login lost** ＝ **不改 `currentSession` / `messages`**。
- 转移：`recovering → online`（重启 + detect = logged_in）；`recovering → login_required`（重启成功但页面真实未登录，logged_out）；`recovering → offline`（重试次数耗尽 / §7 的 60 s 总预算耗尽 / 网络不可用 / 浏览器不可用，browserReady=false）。
- **为什么不用 `offline` 兜**：现在的 `offline` 等于「需要用户动手（重启 DSH / 重新登录）」，而恢复中的真实语义是「最多几十秒就回来，别动手」；用 `offline` 会给出错误引导，并在重试成功时产生 `online → offline → online` 的闪烁。
- **不会无意义闪烁**：只在**真的在恢复**时进入 `recovering`；恢复结束直接落到最终状态。
- **Client（实现阶段必须做的一件事）**：`src/client/api.ts` 的 `CONNECTION_STATUSES` 加入 `'recovering'`（旧 Client 收到未知值退回 fallback，向后兼容）。除此之外**不需要改**：`canSendRound` / `canPickAttachment` 等既有 `connection === 'online'` 校验对 `recovering` 继续成立（自动禁用发送 / 图片 / 新建 / 切换，Host 仍做最终校验）。
- **枚举边界（与 08.2 兼容）**：不新增 currentSession 的 unknown 状态、不修改 MessageStatus——`ConnectionStatus` 是唯一扩大的枚举。
- **`offline` 的最终语义 = 「浏览器状态不可验证」**（恢复失败 / 预算耗尽 / 网络不可用 / 浏览器不可用）。它**不**表示「没有会话」：此时 `currentSession` 与 `messages` 一律保持 last-known（见 §10），Client 仍显示用户此前看到的历史。
- `login_required` 同理：**保留** transcript 与 `currentSession`，只表达「页面需要登录」。

### 12. Client 最小 UX

- **不加 UI 组件**：不加 toast、error center、重试按钮。恢复期间靠既有 gate（`connection !== 'online'`）把发送 / 图片 / 新建 / 切换置灰；Host 的 409/503 仍是最终真相。
- Client 目前**没有渲染任何连接横幅**，所以 `recovering` 对用户表现为「按钮变灰」。若要一行可见文案，最小做法是复用 composer 占位符显示「正在恢复 DeepSeek…」（现有 theme token，无新组件）——**是否要做，留给 Review 决定**。
- 恢复完成后状态回到 `online`，**无需刷新 DSH**。

### 13. 测试计划（只设计，不实现）

**20A — 纯逻辑 / 单测（无需浏览器）**

1. **健康分类矩阵**：`isConnected` / `isClosed` / crash 标记 / origin / sign-in / composer readiness 的组合 → 恰好落到 A–E 之一。
2. **`about:blank` + `isConnected()===true`** → `PAGE_INVALID`（**C**）→ 触发 Level 1，**且不进入任何 30 s locator 等待**（断言：分类在 bounded 预算内返回）。
3. **sign_in 页面** → `LOGIN_REQUIRED`（**B**）→ **不触发 recovery**、`connection=login_required`。
4. **DeepSeek origin 但 composer readiness 超时**（bounded 内始终没有 composer DOM）→ `PAGE_INVALID` → Level 1。
5. **`browser.process()` 不存在 / 无 PID 也能分类**（persistent context 特例，别写依赖 PID 的判定）。
6. Level 选择：page 死 / invalid + context 健康 → Level 1；`!isConnected()` → Level 3；Level 1 自身抛 `TargetClosedError` → 同一次内升级 Level 3。
7. 重试预算：Level 1 ≤2、Level 3 ≤3、退避 `0/250/750`、耗尽 → `offline`（有限次，无无限循环）。
8. **每一步 bounded**：`closeQuietly` / `newPage` / `goto` / login detection / composer readiness / 单次尝试总上限，各自超时都能让该次尝试**结束**（断言逐步 timeout，不出现「某一步挂住」）；且每步实际等待还须取 `min(stepTimeout, remainingRecoveryBudget)`（见 N9）。
9. 分类结果分支：重启成功但 `logged_out` → `login_required`；`goto` 网络超时 → **不重建**、`offline`。
10. **single-flight**：5 个并发 `ensureReady()` 只调用一次重建；失败后 `recoveryPromise` 清空（锁不泄漏）；恢复中再次 `disconnected` → 预算内再跑一次而非递归。
11. listener 去重：同一 page 重复 attach 不产生第二次 `load` 回调。
12. **epoch 过滤**：旧 page 的 `framenavigated` / `response(auth)` 在 epoch 变化后触发 → **被忽略**，不改 `currentSession` / `status`。
13. **旧 send 的 delta / reasoning 回调**（rebuild 后触发）→ 不写新页的 assistant 消息、不污染状态。
14. **旧 send 的最终 DOM 读取**（rebuild 后 resolve）→ 不得当作本轮 reply。
15. Level-3 **只对新 context** 生效的 `exposeFunction`：新 context 必须重装（未重装即断言失败），旧 context 的绑定不参与。
16. **恢复成功但导航失败 / 重试耗尽**：`connection=offline`、`currentSession` **保持 recoverTarget**、messages 保持（**断言不出现 `currentSession=null`**）。
17. **`login_required` after recovery**：`currentSession` / messages 保持。
18. **recovery-generated navigation**：`goto('/')` 与 `goto('/a/chat/s/A')` 都不触发 `apply()`（不 `clearChatMessages()`、不 `replaceChatMessages()`）；`recoveryNavigation` 窗口 `finally` 一定清除。
19. 恢复期间的 send：assistant `status='error'`、`chat.sending=false`、**不自动重发**。
20. 恢复期间的 Stop：`stopping` 归零、无永久忙。
21. 恢复期间的 attachment 上传 → `status='error'`；已 ready 的草稿在页面重建后被清空（18A 规则）+ temp file 清理幂等。
22. `newChat` / `switch` / 外部同步在恢复期间：guard 必被释放（finally 断言）。
23. `connectionFrom`：`recovering` 进入/退出矩阵（含旧 state 兼容）；`recovering` 不产生 `online→offline→online` 抖动。
24. dispose / plugin shutdown 在恢复中：不残留 promise、不产生未捕获 rejection、epoch +1 生效。

**connection / recovery-navigation / 全局预算（定稿补充，只设计不实现）**

N1. `connectionFrom` / state normalize 支持 `recovering`：三种最终态都能从 `recovering` 导出；`CONNECTION_STATUSES` 白名单含 `'recovering'`；旧 Client 收到未知值的 fallback 路径不误判。
N2. `recovering` 期间快照断言：`currentSession`、`messages`、`MessageStatus` 全部不变（`recovering` 只表达 connection）。
N3. **recovery navigation `/`**：watcher 收到 `framenavigated → /`，但 `sessionSync.onLocation` 未执行、无 `apply({kind:'empty'})`、`clearChatMessages()` 未被调用（在 `recoveryNavigationActive` 窗口内）。
N4. **recovery navigation `/a/chat/s/A`**：watcher 收到，但**不产生 external switch**、不排队 `pending`、transcript 不被 replace。
N5. **recovery 成功**：`sessionSync.markKnown(actualLocation)` **恰好执行一次**，且只改 `lastKnown`（不 rebuild transcript）。
N6. **recovery 结束（窗口清除）后用户真实点击会话 B**：watcher 恢复正常，`sessionSync` 正常执行——suppression 不泄漏。
N7. **stale old-page event**：即使 recoveryNavigation 窗口已清除，旧 page 的 `framenavigated` / auth response / delta / final DOM read 仍被 epoch mismatch 过滤（N3–N6 只保护新 page，旧 page 靠 epoch）。
N8. **60 s 全局预算耗尽**：不再进入下一次 retry；`connection=offline`；`currentSession` / `messages` 保持 recoverTarget；`recoveryPromise` / `pendingRecovery` 在 `finally` 中清空。
N9. **单步 timeout > 剩余预算**：实际等待取 `min(stepTimeout, remainingRecoveryBudget)`（如剩余 3 s 时 `goto` 最多等 3 s），不使用完整 step timeout。

**20A — 真实环境（companion-test profile + 故障注入）**

25. `page.close()` → 自动 Level 1 → `online`，三界面一致。
26. `chrome://crash` → 自动 close + newPage → 恢复（含「crash 页不可复用」断言）。
27. **`about:blank` 真机**（页面人为导航到空页）→ 判 invalid → Level 1 恢复 → **不再出现 30 s 慢失败**。
28. **kill -9** → ~30 ms 内 `disconnected` → Level 3 → 登录态保留、`/users/current` 200。
29. 流式中 kill → assistant `error`、部分内容保留、`sending` 归零、**不重发**。
30. 恢复后立刻发送 → 正常 streaming（证明 delta 桥与 listener 都装回）。
31. **恢复后 Host transcript 未被清**（与崩溃前逐条一致）+ 页面回到原会话 URL。
32. 恢复期间 SSE 不中断（Client 不刷新即看到 `recovering → online`）。
33. 回归：纯文本 / 图片发送 / Stop / New chat / 切换 / 外部同步 / 18A 事务语义全部不变。

**20B（仅登记，不实现）**：`readTranscript()` 回填、补齐服务端已完成的 reply、会话删除后的 transcript 最终决策、title refresh、恢复文案。

### 14. 风险与未知

1. **恢复后页面与会话可能不再匹配**：20A 已经把「不改 Host 事实」定死（§10），因此恢复后**可能出现**「Host 显示会话 A 的历史、页面停在 `/`」——这只发生在**页面自己把已删除的会话重定向到 `/`** 的场景（此时 `currentSession` 按规则置 null，messages 保留待 20B 决策）。其余情况（恢复失败 / offline）一律保留 last-known，不猜。
2. **恢复窗口内仍然失败的请求**：恢复需要 1–4 s，这期间的 `/chat` 会得到 409/503（`recovering`）。**不排队、不自动重试**，由用户重发（避免隐式重发用户消息）。
3. **crash 的自动发现依赖事件**：`crash` 是唯一可靠信号（`isClosed()` 为 false）；若事件丢失，只能等下一次操作失败 → `ensureReady()` 记录「上次操作是否以 DOM/locator 失败」，下一次操作即升级为 bounded readiness 探测并归入 **C**（不依赖 message matching）。
4. **多实例 / 双 DSH**：第二个实例在 profile 被占用时 176 ms 快速失败且错误信息误导 → 重试耗尽后只能报 `offline`，用户可能误以为登录失效（文档需写明）。
5. **恢复风暴**：若 crash 反复发生（页面自身 bug），会不断重建。缓解：**每个恢复周期最多 3 次**，且不引入周期探活（避免「探活 → 失败 → 重建」循环）。
6. **未测**：Windows / Linux 的进程 kill 行为、headless 模式、多 page 窗口管理（本项目恒为单 page）。
7. **20A 当时明确不做**：Proxy、多账号、browser pool、多 DeepSeek page、durable message persistence、自动重发；Phase 18B 后续已独立完成。

### 15. Phase 20A / 20B 边界（实现范围收口）

**20A — Browser Lifecycle Recovery（可独立交付）**

必须包含：

- `page.on('close')` / `page.on('crash')` / `browser.on('disconnected')` 监听（+ `context.on('close')` 可选，与 disconnected 同义）
- **alive-but-invalid page 探测**（§5 的 A–E 分类，含 bounded composer readiness）
- **Level 1 / Level 3 重建**（Level 3 必须重装 `exposeFunction`）
- **single-flight recovery**（一个 in-flight promise + `pendingRecovery` 再入）
- **bounded retry**（§7 的次数上限 + 逐步 timeout + `RECOVERY_TOTAL_BUDGET = 60 s` 全局预算）
- **`recovering` connection 状态**（`ConnectionStatus` 正式新值，§11 定稿）
- **listener ownership + `pageEpoch` / `browserEpoch`**（§8 的 stale-event 抑制）
- page 重建时 **attachment draft invalidation**（沿用 18A：`onPageReplaced()`）
- **`recoverTarget` snapshot** 与「恢复期不改 `currentSession` / `messages`」策略（§10）
- **recovery-generated navigation 三层防护（§10.1 定稿，全部实现）**：`recoveryNavigationActive` suppression + `sessionSync.markKnown(actualLocation)` + epoch（各自职责见 §10.1 表）
- 恢复到 `recoverTarget` 的 URL（原会话尽量重新打开）
- **dispose safety**（恢复中 dispose / plugin shutdown 不留悬空 promise）
- **绝不自动 resend**

20A 的验收句：**浏览器崩了 → 自动恢复 → 用户不刷新 DSH → Host 现有 transcript 不被误清 → 原 session 尽量重新打开 → 用户可继续发送。**

**20B — Session Reconciliation & UX（20A 完成时的后续设计；现已实现）**

- recovery 成功后的 `readTranscript()` 回填
- 补齐「服务端已完成但 Host 未收到」的 assistant reply
- 会话已删除 / 被重定向到 `/` 之后的 **transcript 最终决策**（是否清、怎么展示）
- 更完整的 session title refresh
- 「正在恢复 DeepSeek…」文案（若仍需要）

**边界纪律**：20A 不实现 20B 的任何一项；20B 不重做 20A 的生命周期。

## Phase 20B — Session Reconciliation & UX（**20B1 + 20B2 implemented + validated**）

> 本节保留 2026-09-25 的调查、真实探测与设计记录；20B1 与 20B2 均已实现并验收（见 `docs/roadmap.md`）。
>
> 证据来源：Playwright 1.62.0 + companion-test profile 临时副本（`/tmp`），真实 `history_messages` 网络 JSON、IndexedDB 内容、`completion` 请求体。未记录 token/cookie，结束后清理全部进程与副本。

### Phase 20B2 实现与验收（2026-09-27）

**真实前端证据**：隔离的 `companion-test` profile 副本访问正常会话时，前端自己的 `GET /api/v0/chat/history_messages?chat_session_id=<id>` 返回 HTTP 200、`code=0`、`data.biz_code=0`，`biz_data` 为历史对象，URL 留在目标会话。访问确定不存在的 UUID 时，同一路径返回 HTTP 200、`code=0`、`data.biz_code=1`、`biz_data=null`，SPA 把 URL 重定向到 `/`；`users/current` 仍表明已登录。探测只输出状态与字段形状，没有记录认证值或历史内容。随后用仓库的 `createDeepSeekBrowser` 真实执行 page close → Level 1 恢复：正常会话得到 `location=session / history=found / verdict=reconcile`，侧栏有 active exact-id 的非空标题；不存在会话得到 `location=empty / history=not_found / verdict=deleted`。

**删除判定**：`src/host/browser.ts` 只观察恢复期、当前 page epoch、**目标 `chat_session_id` 精确相等**的前端响应；Host 不直接请求 history API。`src/host/recovery-settlement.ts` 仅认可上面的精确 not-found envelope。`logged_in + 目标会话 + 实际 URL=/ + not_found` 全部成立时，`src/host/state.ts` 在一次 notify 中将 `currentSession` 置空、清空消息并发布 `session_deleted` 提示，清除 committed anchor。网络异常、认证失败、未知响应、响应与目标不匹配、未知重定向或跳到其他会话都不能触发删除；不确定时保留 transcript，发布 `session_unverified` 警告并拦截发送，用户可新建聊天或切换历史会话继续。后续 URL 导航不会提前解除警告，只有成功读取目标 transcript / 成功切换会话或用户确认新建聊天后才解除。

**标题与文案**：恢复到目标会话才进行 20B1 reconcile，随后至多等待 2 s 读取侧栏；只有 `active && id===recoverTarget.id` 的非空标题更新 `currentSession.title`，读取失败不改变消息。Dock、Float、Pop-out 共用 Host 状态：`connection=recovering` 显示「正在恢复 DeepSeek…」并保留 transcript；确认删除显示清理提示；无法确认显示保留与操作提示。`recovering` 仍是 connection 状态，reconcile 与 session verdict 仍各自独立。恢复导航的 `networkidle` 也消耗 20A 的 60 s 剩余预算。

**边界**：本轮真实恢复验收使用已存在与确定不存在的会话，不删除测试账号内已有会话；完整 DSH 三界面人工视觉验收仍留给 Phase 25。`parent_message_id=null` 与树形/分支 IDB entry 仍 safe-fail，分别属于后续 anchor identity 与 history branch resolution，不扩入 20B2。

**回归覆盖**：`tests/recovery-settlement.test.ts` 固定 URL/方法/目标 ID、not-found envelope、删除 verdict 与标题精确匹配；`tests/state.test.ts` 固定删除的单次通知和不确定时的消息保留；`tests/chat.test.ts` 固定不确定状态下发送前拒绝；`tests/state-compat.test.ts` 固定三个界面消费的新状态值。

### 实现与真机验收记录（Phase 20B1，2026-09-25）

**代码结构**

| 位置                                | 内容                                                                                                                                                                                                      |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/host/history-idb.ts`           | 只读 IDB reader（`deepseek-chat`→`history-message`）+ `parseHistoryEntry` 结构校验（**按 parent chain 重建顺序**，见下）                                                                                  |
| `src/host/reconcile.ts`             | 纯逻辑：三层 identity（`resolveIdentity`）、`buildReconcilePlan`、`createCommittedAnchorRegistry`、`readAndPlanReconcile`（读 → bounded stability wait → 校验 → plan）、`RECONCILE_TOTAL_BUDGET_MS = 30s` |
| `src/host/browser.ts`               | `readHistorySnapshot(sessionId)`（epoch 栅栏 + `stale`）、`onSettled` 钩子（recovery 的**最后一步**是 reconcile，`recovering` 覆盖全程）                                                                  |
| `src/host/state.ts`                 | `applyChatReconcile`（bindings + patches + appends **一次 notify**）；`ChatMessage.deepSeekMessageId`                                                                                                     |
| `src/host/chat.ts` / `src/index.ts` | commit point 始终记录 anchor（Host-only，跨 recovery 保留；newChat / switch / 成功 reconcile / dispose 清理）                                                                                             |

**测试**：新增 5 个文件 / 84 项（`history-idb` / `reconcile` / `reconcile-apply` / chat commit point / anchor）→ 全量 619 tests。

**真机验收（companion-test profile 临时副本，真实 Chromium + 真实会话）**

| 场景                 | 结果                                                                                                                                                                                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A idle recovery      | ✅ 恢复 2.4 s → `online`，Host message id 不变；reconcile `skipped:reasoning mismatch`（见下 ②）                                                                                                                                                        |
| B commit 后 kill     | ⚠️ **数据安全全通过**（无重复消息、Host id 不变、不自动 resend、不 full replace）；补全未发生（见下 ④）                                                                                                                                                 |
| C mid-stream kill    | ✅ 无重复、Host id 不变、不自动 resend、partial 保留                                                                                                                                                                                                    |
| D Stop 后 recovery   | ⚠️ 时序未命中（回复先完成 → `finished`）；Stop 语义由既有单测覆盖                                                                                                                                                                                       |
| E/F 图片轮次         | ⚠️ 上传与发送本身 OK（`attachImage` 返回真实的 `deepSeekFileId`）；**附件落库未在 harness 覆盖**（验收脚本未接 18A attachment transaction），该部分由单测覆盖（`reconcile-apply`：patch 不触碰 attachments；`reconcile`：FILE 不覆盖 Host attachments） |
| G reconcile 中途切换 | ✅ `skipped:stale snapshot`，store 完全不变                                                                                                                                                                                                             |
| H 连续两次 recovery  | ✅ 两次恢复，消息数与 Host id 全程不变                                                                                                                                                                                                                  |

**真机发现（与设计前提不一致，实现按设计保持 safe-fail）**

① **`MERGE` entry 的数组顺序不是链序**：实测 `cache_control='MERGE'` 时 ids 为 `7,8,9,10,1..6`、parents 为 `6,7,8,9,null,1..5` —— 前端把增量插在**数组头部**。设计 §2 假设"数组即完整有序快照"不成立。
→ 实现改为**按 `parent_id` 从唯一根重建顺序**，再执行设计原有的全部校验（唯一 id、单根单链、role 交替）；任何缺口/环/分叉仍 `malformed`。

② **历史 reasoning 的 DOM 文本常是 server `THINK` 的严格前缀**：同一条 assistant 实测 `textExact=true`（5700/5700）但 `hostReasoning=8918 < serverReasoning=9261`。
→ 设计 §5.2 规则 5/6 要求历史段 **exact**、只有当前 crash turn 允许 prefix，因此 Level 3 在完整历史 transcript 上通常 safe-fail（保守、不破坏数据）。

③ **IDB entry 不会自动刷新**：前端在页面加载时写入一次；服务端 `WIP → FINISHED` 不会回写 entry。因此 §11 的 stability wait 读到"连续两次指纹相同"即结束（符合设计），但**快照可能是停更的 WIP**。

④ **crash-commit 场景下 entry 不含该轮**：B 场景实测 entry 停在 `1..22`，本轮 `23/24` 不在其中（服务端持久化晚于 recovery 的页面加载），因此 Level 2 报 `parent anchor not found in history` → safe-fail。
→ 这是 20B1 的**功能边界**：补全要求"reconcile 时 IDB 已含该轮"，实测在 commit→kill→立即恢复的时序下不满足。

**已知限制**

- ~~commit→kill 的自动补全不会生效~~ → **已解决**（§7.1 单次前端刷新；B/C 真机补全通过）。数据安全（不丢、不重、不重发）同样真机确认。
- Level 3 strict bootstrap 的 reasoning 规则已按真机放宽为「Host 是 server 的严格前缀」（② 已解决，2026-09-27）；Level 2（有 anchor）为常规路径（实测 `applied, level=2, bindings=2, patches=1`）。
- reconcile 只覆盖当前 committed turn（设计范围，历史无 anchor 消息不会补 id）。

### 0. 调查结论（真机，2026-09-25）

**① DeepSeek 有稳定 message id**（网络 JSON 与 IndexedDB，DOM 没有）

`GET /api/v0/chat/history_messages` 的 `chat_messages[]` 每条：

```jsonc
{
  message_id: 3,          // 数字，会话内严格递增（链式）
  parent_id: 2,           // null（首条）或父 message_id
  role: "USER",           // USER | ASSISTANT
  status: "FINISHED",     // FINISHED | WIP
  fragments: [
    { id, type: "REQUEST",  content: "用户文字" },
    { id, type: "RESPONSE", content: "助手正文(markdown)", references, stage_id },
    { id, type: "THINK",    content: "推理", elapsed_secs, references, stage_id },
    { id, type: "TIP",      content: "提示" },
    { id, type: "FILE",     files: [{ id: "file-<uuid>", file_name, file_size, signed_path, model_kind: "VISION", status }] }
  ],
  incomplete_message, inserted_at, accumulated_token_usage, thinking_enabled, search_enabled
}
```

实测链：`1(USER,null) → 2(ASSISTANT,1) → 3(USER,2) → 4(ASSISTANT,3) → 5(USER,4) → 6(ASSISTANT,5)`。

**② 前端 cache 协议（本轮查清，20B1 的关键）**

| 观测                         | 事实                                                                                                                                                                                                                                |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cache_control`              | **`REPLACE` = 全量快照；`MERGE` = 增量**（相对客户端携带的 cache 版本）                                                                                                                                                             |
| 请求参数                     | 客户端**有**本地 cache 时带 `?cache_version=2&cache_reset_at=<unix ts>` → 服务端返回 `MERGE`（实测 msgCount=0 表示无增量）；**无** cache 时不带参数 → 返回 `REPLACE`（实测 msgCount=2、ids=[1,2]）                                  |
| **cache 位置**               | **IndexedDB `deepseek-chat` → objectStore `history-message`，`key = session id`**                                                                                                                                                   |
| entry 结构                   | `{ data: { chat_session{...current_message_id}, chat_messages:[...完整数组...], cache_control, cache_reset_at }, version, key, cacheResetAt, timestamp, frontendVersion:"fv-6" }`                                                   |
| 合并规则                     | 前端把 `REPLACE`（覆盖）或 `MERGE`（并入）写回该 IDB entry；`cache_control` 记录最后一次操作；A→B→A **不再发请求**（IDB 命中）                                                                                                      |
| **deterministic 拿完整历史** | **直接读 IDB entry**（`page.evaluate` + `indexedDB.open('deepseek-chat')`，无需网络、无需 token）✓；备选：删除该 entry + 重新导航 → 前端发无参数请求 → `REPLACE` 全量（实测可行，但 `deleteDatabase` 会 `blocked`，需处理前端连接） |
| 手动 `fetch` 直连 API        | **不可靠**：需要精确复制前端的 `authorization`/`x-device-id` 等 header（实测缺 header 返回 `40002/40003`），因此**不作为 Host 依赖**                                                                                                |

> 结论：**Host 不需要 HistoryAccumulator**。前端自身已在 IDB 维护该 session 的历史；Host 读 IDB 得到的是 **validated cached snapshot（可验证缓存快照）** —— 结构可由 Host 校验，但**新鲜度不是**：它由前端写入，可能落后于服务端。只有在 IDB **没有**该 entry（从未打开过）时才需要先导航一次让前端写入；entry **过旧**时由 §7.1 的单次前端刷新修正。

**③ 三边 id 映射（本轮修正：completion request 提供稳定 parent anchor，不提供新 message id）**

- `POST /api/v0/chat/completion` 请求体（实测完整字段）：`chat_session_id`, **`parent_message_id`**, `prompt`, `ref_file_ids`, `model_type`, `thinking_enabled`, `search_enabled`, `action`, `preempt`。
- **`parent_message_id` = 发送前最后一条消息的 message_id**（实测：会话末条 id=2 → `parent_message_id=2`；末条 id=4 → `parent_message_id=4`；新会话首发 = `null`）。它是**稳定、authoritative 的 parent anchor**。
- ⚠️ **实测普通发送目前呈 `parent+1`(USER) / `parent+2`(ASSISTANT)**（2→3/4、4→5/6，链连续）。**这是 observed behavior（仅可作诊断断言），不是 request 直接给出的新 message id —— 不作为 production authoritative mapping，不参与 reconcile correctness。**
- **authoritative 结论**：realtime 只能拿到 **parent anchor**；本轮 user/assistant 的 `message_id` **必须由 history snapshot 的 parent chain 确认后**才绑定（§3 Level 2）。

**④ crash 后服务端继续完成**（沿用上一轮 + 本轮复核）：commit 后 kill → 服务端 assistant `FINISHED`；mid-stream kill → `WIP` → 约 10s 后 `FINISHED`。**⑤ 稳定时间**：`WIP → FINISHED` 约 10s，需要 bounded stability wait。**⑥ 18B**：`FILE` fragment 完整保留图片元数据。

### 1. 数据源：读 IndexedDB（不是 DOM、不是手动 fetch）

当前 `readTranscript()`（Phase 08）是纯 DOM：无 id、无 status、无 FILE、受 virtual-list 限制。20B1 的 history reader **改为读 IDB**：

```
page.evaluate(indexedDB.open('deepseek-chat') → objectStore('history-message').get(sessionId))
→ { chat_messages[], cache_control, cache_reset_at, chat_session.current_message_id }
```

优点：拿到 `message_id`/`parent_id`/`status`/`fragments` 全量、不受滚动影响、不依赖 token/header、复用前端已维护的权威状态。DOM reader 仍保留给 18A 的实时发送路径。

### 2. History reader 返回模型（snapshot；**不需要 accumulator**）

```ts
type HistoryRead =
  | { kind: 'snapshot'; sessionId: string; currentMessageId: number | null; messages: DeepSeekHistoryMessage[] }
  | { kind: 'unavailable'; reason: 'no-entry' | 'malformed' | 'stale' }
```

- IDB entry 是**前端缓存快照（validated cached snapshot）**：`cache_control` 记录它由 `REPLACE` 或若干 `MERGE` 累积而成。**它可验证（结构），但不是权威实时状态**——实测前端只在页面加载时写一次，崩溃轮会永久停在 `WIP`（见 §7.1）。
- **`kind: 'no-entry'` 的处理**：Host 先导航到目标 session（让前端写入 IDB），再 bounded 重读；仍无 → `unavailable` → **reconcile safe-fail**（保留 Host transcript、warning，不做 destructive patch）。
- 完整性校验（进入 reconcile 的前提）：`chat_messages` 非空时，`message_id` 唯一、`parent_id` 形成**单根合法链**（每条 parent 指向前一条的 id，首条为 null）、`role` 交替合法。

### 3. 三层 identity strategy（取代「B 为主 + C 为辅」与「realtime 直绑」）

identity 解析**按顺序命中即停**：

```
Level 1 — Existing ID
  Host message 已有 deepSeekMessageId
  → 直接 ID reconciliation（不重新绑定、不 bootstrap）

Level 2 — Parent-anchor binding（当前 committed turn）
  Host 持有本轮 completion request 的 parent_message_id（anchor）
  → 在 IDB snapshot 里按 parent chain 绑定本轮 user/assistant（算法 §5.1）
  → 成功后进入 ID reconciliation

Level 3 — Strict bootstrap（无 ID 且无可用 anchor）
  完整 strict chain alignment（算法 §5.2）
  → 成功后写 deepSeekMessageId
```

- **20A 的 repeated recovery 之后**：多数消息已有 id → **直接 Level 1**（不重复绑定）。
- **严禁** 把 `userId = parent + 1` / `assistantId = parent + 2` 当作 authoritative mapping；`+1/+2` 只保留为诊断断言（§0 ③）。
- **失败语义**：Level 2 一旦命中 anchor 却出现歧义/不匹配 → **直接 safe-fail**（不降级成算术推断，也不退回 Level 3 —— anchor 在场却不一致说明链不可信）。只有 **Host 根本没保存 anchor**（或无 ID）时才进入 Level 3。
- conservative alignment **不再是 fuzzy fallback**，只在 Level 3 作为「无 identity 时唯一允许的 bootstrap」；任一歧义 → safe-fail，不做任何猜测性 patch。

**`deepSeekMessageId` 写入时机（定稿）**：**只有 server snapshot 已验证、identity 绑定成功时才写**（Level 2 / Level 3）。**发送实时阶段绝不**把 `parent+1/+2` 提前写成正式 `deepSeekMessageId`。若实现需要跨 recovery 保留 anchor：优先 **transaction-local 保存 `parentMessageId`**，或增加 **Host-only committed metadata**；**优先不扩大 shared `ChatMessage` API**（结合现有 chat/send transaction 选最小实现）。

### 4. 「谁是真相」按阶段定义

| 阶段                                 | 真相                      | 规则                                                                          |
| ------------------------------------ | ------------------------- | ----------------------------------------------------------------------------- |
| PRE-SUBMIT                           | Host                      | Host 有未提交 user entry，server 没有 → **不删**                              |
| COMMITTED（assistant error/partial） | server 优先，**只能补全** | server content/reasoning **≥ Host 才采用**；server 更短 → 保留 Host（不倒退） |
| Stop / interrupted                   | **Host**                  | Host `interrupted` **永不自动改 `finished`**（即使 server 后来 FINISHED）     |
| server WIP                           | Host                      | 不缩短、不升级 status，等 stability wait                                      |
| transient status / Host id           | Host                      | `streaming`/`error`/`interrupted` 与 Host message id 保留                     |

### 5.1 Level 2 — Parent-anchor binding（当前 committed turn）

前置：snapshot 完整可验证 + chain 合法 + Host 持有本轮 `parent_message_id`（anchor）。

**已有 session（anchor ≠ null）**：

1. 在 snapshot 中找 `role == USER && parent_id == anchor` 的条目；
2. **必须唯一**：0 个或多个 → **safe-fail**（不猜测、不做 `anchor+1` 算术）；
3. 校验该 USER：`REQUEST` content 与 Host user content **exact match**；
4. 校验 **session id 正确**；
5. `FILE` evidence：若两边都有附件（Host 已有 `ChatMessage.attachments`）则必须匹配（**file 数 + `file_name` + `file_size` 集合**）；Host 无而 server 有 FILE → 视为「Host 不认识」（不覆盖、不绑定）；
6. 成功后 `hostUser.deepSeekMessageId = serverUser.message_id`；
7. 再找 `role == ASSISTANT && parent_id == serverUser.message_id`，**必须唯一**（0 个或多 → safe-fail）；
8. 成功后 `hostAssistant.deepSeekMessageId = serverAssistant.message_id`（此时 server 可能是 `WIP`，绑定仍然成立，但 content 补全要等 stability wait）；
9. 进入 ID reconciliation。

**新 session（anchor == null）**：

1. 找 `role == USER && parent_id == null` 的 **唯一 root**；0 个或多个 → **safe-fail**；
2. 校验 exact text / FILE evidence / session id；
3. 绑定 root user 的 `deepSeekMessageId`；
4. 再经 `assistant.parent_id == root.message_id`（唯一）绑定 assistant；
5. root 不唯一或内容不符 → safe-fail。

**Level 2 失败不降级为算术推断**（见 §3 失败语义）。

### 5.2 Level 3 — Strict chain alignment（无 ID 且无可用 anchor 时）

前置：history snapshot 完整可验证 + 严格 chain 合法。逐条比对 Host 链与 server 链：

1. `role` 必须相等（Host user ↔ server USER、Host assistant ↔ server ASSISTANT）；
2. 顺序必须一致（Host 第 n 条 ↔ server 第 n 条，从头部对齐）；
3. server `parent_id` 必须形成合法链（首条 null，其后指向前一条）；
4. 已 finished 的历史 **user 文本**：`REQUEST` content 与 Host content **exact match**；
5. 已 finished 的历史 **assistant**：server `RESPONSE` 与 Host content **exact match**（Host 为 server 的严格 prefix 时**不视为同一段** —— 只有 exact 才绑定历史段）；
6. **当前 crash turn** 的 assistant：Host content/reasoning 允许是 server `RESPONSE`/`THINK` 的**严格 prefix**（唯一允许的「不相等」情形）；
7. `FILE` fragment：仅作**辅助 identity evidence**（file 数 + `file_name` + `file_size` 集合），**不覆盖** Host attachments；Host 无 attachments 而 server 有 FILE → 视为「Host 不认识」；
8. **禁止**仅按 index/message count 绑定；**禁止** Levenshtein / fuzzy similarity / 标题猜测 / 中间 merge；**禁止** `parent+1/+2` 算术；
9. 任何一处 `role` 不匹配、文本不 exact（非当前 turn）、链断裂、条数不齐、歧义 → **bootstrap 失败** → safe-fail（保留 Host transcript）；
10. 成功后只**写入** `deepSeekMessageId`（不改 content/status），后续交给 ID reconciliation。

### 6. FILE fragment 的 20B1 边界（不越 18B）

- 允许用途：**identity evidence**（§5 规则 7）、**判断历史含附件**、**防止 destructive merge**。
- **Host 已有 `ChatMessage.attachments` → Host authoritative**，20B1 **不用** history 的 FILE 覆盖它。
- 历史中出现 Host 没有的 image-only/user FILE 消息 → 20B1 **不恢复像素**、**不 full replace**、**不创建假的图片恢复能力** → **safe-skip + 标记需要 Phase 18B**。
- 只有**当前 crash turn** 的 user message 本来就由 18A 存在于 Host 时，才用 FILE 信息**验证 identity**，且保留原 Host attachments。
- **设计期记录：18B 当时继续 pending，不被 20B1 阻塞，也不被 20B1 顺手实现；18B 后续已独立完成。**

### 7. server 新增消息的 append 策略（收紧）

| 情形                                                                                          | 20B1 行为                                                                             |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| A. 当前 committed turn 的 assistant（Host 已有 placeholder/error 消息）                       | **原地 patch**（按 `deepSeekMessageId` 或 bootstrap 绑定），**绝不 append duplicate** |
| B. server 产生 Host 没有的 assistant，且其 `parent_id` **精确指向已绑定的 Host user**         | 允许 append（新 Host id + `deepSeekMessageId`）                                       |
| C. server 出现 Host **不认识**的 user message（外部页面操作 / image-only 历史 / switch race） | **不盲 append** → 视为 bootstrap 失败或 safe-skip                                     |

原则：**没有明确 parent/chain evidence 就不 append。**

### 7.1 前端刷新：唯一一次 bounded reload（真机定稿，2026-09-27）

**问题**：前端只在**页面加载时**写一次 IDB entry，之后不再更新。实测 commit→kill→recovery 后：
entry 里崩溃轮的 assistant 永久停在 `WIP`（18 s 后仍 `WIP`），而服务端早已 `FINISHED`（同一 entry reload 后为 `FINISHED`，884 chars）。

**解决**：让**前端自己**重新拉取历史 —— Host 只做一次 bounded `reload()`。

```
snapshot 判为「落后于服务端」：
  ① committed turn 不在 entry 中（页面在服务端写入之前就加载了）
  ② entry 的最后一条仍是 WIP（连续两次读取指纹相同 → 前端缓存停更）
→ 先等待，直到预算只够一次刷新（REFRESH_HEADROOM_MS = 12 s）
   —— entry 已冻结，等待是唯一让「服务端」写完的手段
→ page.reload()（step 上限 15 s；networkidle 上限 8 s）
→ 前端自行 MERGE/REPLACE，Host 重新读 entry
→ 至多一次，绝不循环 reload（仍超预算/仍缺失 → safe-fail，Host 不变）
```

约束（全部满足）：**不删 IDB、不手动 fetch history API、不读 token/cookie、不伪造 cache 参数**；
**硬 deadline**：reconcile 的 30 s 预算是**共享的**——每一次 `readHistorySnapshot`、整个 refresh（reload 与 networkidle 各自再被 `left()` 收紧）实际 timeout 都是 `min(stepCap, deadline − now)`；IDB 的 `page.evaluate` 同时受 Host 侧超时约束，读取返回后及交出 plan 前再次核对 deadline。刷新拿到的是「剩余预算」（真机实测传入 10 378 ms）；超预算一律 safe-fail，不应用过期 plan（`tests/reconcile.test.ts` 的 `20B1 deadline:` 测试覆盖）。
reload 导致的导航被 suppression 吞掉（不会被当成用户切换）；`malformed`／`no-entry` **不触发**刷新（reload 改变不了结构）。

**真机实测（fresh session）**

| 场景                       | 结果                                                                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| B commit 后 kill           | `refreshes = 1`；`applied, level 2, bindings 2, patches 1`；assistant 原地补全为服务端全文并 `finished`；Host id 不变、无重复、无重发 |
| C mid-stream kill          | 同上（partial → 服务端全文，928 chars）                                                                                               |
| A idle recovery            | `refreshes = 0`、reconcile 10 ms、transcript 不变（**不变慢**）                                                                       |
| 刷新耗时                   | reload + 前端写入 ≈ 6 s（reload 15 s 上限内）                                                                                         |
| B/C 的 `recovering` 总时长 | ≈ 20 s（等待服务端 + 刷新 + 补全），仍在 30 s 预算内                                                                                  |

**仍存在的边界**：会话若因反复实验/分支而成为**树形**（`parent_id` 分叉，实测 `cache_control='REPLACE'` 也可能分叉），entry 判定 `malformed` → 不刷新、直接 safe-fail（reload 无法修复结构）。

### 8. status merge 最终规则

| server                  | Host 当前                                  | 结果                                             |
| ----------------------- | ------------------------------------------ | ------------------------------------------------ |
| WIP                     | partial / error                            | **不缩短、不升级**（等 stability wait）          |
| FINISHED                | error / partial **且 identity 已唯一确认** | 补全 content/reasoning → `finished`              |
| FINISHED                | finished                                   | no-op                                            |
| FINISHED 但 server 更短 | partial                                    | **保持 Host**（不倒退）                          |
| 任意                    | **interrupted（Stop）**                    | **保持 interrupted**（20B1 永不自动改 finished） |

因 `interrupted` 保守规则，**E（Stop + browser failure）不再是 20B1 blocker**，但登记为真机验收项。

### 9. reconciliation 完整性前置条件（任一失败 → no-op）

执行任何 state patch 前必须全部满足：

- `actual session id === target session`；
- `pageEpoch` 未变化；
- `reconcileGeneration` 未变化；
- history snapshot **完整可验证**（IDB entry 存在、结构合法）；
- message chain 合法（单根、递增、parent 连续）；
- **identity 唯一**：已有 `deepSeekMessageId`（Level 1），或 Level 2 parent-anchor 命中唯一，或 Level 3 bootstrap mapping 唯一。

任一失败 → **no-op** + 保留 Host transcript + warning + connection 最终回 **online**（**不 offline**、**不 destructive replace**）。

### 10. concurrency / stale

- reconcile 复用 **PageGuard**（与 send / newChat / switch 互斥）；在 `markKnown(actualLocation)` 之后、next 用户操作之前执行。
- 捕获 `sessionId` + `pageEpoch` + `reconcileGeneration`；提交前**再验证**；不一致丢弃（迟到的 A reconcile 不能覆盖 B）。
- repeated recovery：已有 id → Level 1；不重复 parent-anchor binding / bootstrap。

### 11. bounded reconcile 预算

- `RECONCILE_TOTAL_BUDGET ≈ 30s`（WIP→FINISHED ~10s + stability wait 2×500ms + IDB 读取 + buffer）。
- stability wait：`current_message_id` + `chat_messages` 长度/末条 content 长度**连续 2 次（≥500ms）一致**；不用固定 sleep。
- 超预算 → 保留 Host、warning、不 destructive、不 offline。

### 12. UX / title

- 不加 toast / 文案；`recovering` 延续到 reconcile 完成（idle session 是快速 no-op，只有未完成 assistant 才花 stability wait）。**但**若 identity 任一 Level 失败 / 无 entry，reconcile 立即结束（safe-fail），不让 UI 无意义禁用。
- title：成功后可刷 `currentSession.title`；失败不影响 reconcile（title 不是 identity）。

### 13. session 已删除 / recoverTarget 重定向 `/`

只有**明确证据**（目标 ID 的前端 history 返回 HTTP 200 / `code=0` / `biz_code=1` / `biz_data=null`，且 logged-in、实际 URL 重定向 `/`）才清 transcript；network / auth / unknown redirect → **保留 Host + `session_unverified` 提示并阻止发送**。实际行为与实现见上方「Phase 20B2 实现与验收」。

### 14. 测试计划（本轮修订；上一轮仍适用者保留）

**snapshot / cache 协议**

1. snapshot（`REPLACE`）→ reader 得完整 history
2. `MERGE` 累积 → Host 读 IDB 得完整（由前端合并）
3. IDB `no-entry` → 导航重读；仍无 → safe-fail
4. duplicate / out-of-order → 结构校验拒绝
5. `message_id` duplicate → reject
6. broken `parent_id` chain → reject

**identity（本轮定稿重点）**

7. **Level 2 基本路径**：anchor=4，snapshot `USER.message_id=5(parent_id=4)` + `ASSISTANT.message_id=6(parent_id=5)` → **经 parent chain 绑定**（断言绑定不依赖 `+1/+2` 算术）
8. **Level 2 非连续 id**：anchor=4、`USER.message_id=7(parent_id=4)` → **仍正确绑定 7**（证明实现不依赖 id 连续）
9. **Level 2 ambiguous**：两个 `USER` 都 `parent_id=4` → safe-fail
10. **Level 2 text mismatch**：parent 命中但 text 不 exact → safe-fail
11. **Level 2 chain broken**：USER 命中但 `assistant.parent_id != user.message_id` → safe-fail
12. **Level 2 新 session**：`parent=null` + 唯一 root USER exact → 绑定 user，再经 `assistant.parent_id == user.message_id` 绑定 assistant
13. **Level 2 新 session ambiguous**：多个 root（或 0 个）→ safe-fail
14. **Level 2 FILE mismatch**：Host 已有 attachments 而 server FILE 集合不符 → safe-fail
15. **不依赖连续性**：`parent+1/+2` 不成立但 chain 正确 → reconciliation **仍成功**
16. **Level 1 优先**：已有 `deepSeekMessageId` → 直接 ID reconciliation，**不重新** parent-anchor / bootstrap
17. **Level 3 strict bootstrap**：无 ID 且无 anchor → §5.2 全部规则生效；成功后才写 `deepSeekMessageId`
18. **禁止算术（负向）**：断言实现路径不存在 `parent+1` / `parent+2` 作为 authoritative mapping（代码审查 + 负向用例）
19. Host partial prefix server full → bind + patch（当前 turn 唯一允许的不相等）
20. ambiguous chain / role 不符 / 条数不齐 / text mismatch → Level 3 bootstrap fail
21. identity 任一 Level 失败 → **no-op**（保留 Host transcript + warning + connection 回 online）

**reconcile / status**

22. `FILE` 仅作 identity evidence，**不覆盖** Host attachments
23. image-only unknown history → 不 destructive replace
24. server assistant parent 指向已绑定 user → append/patch 正确
25. unknown server user → 不盲 append
26. Host interrupted + server FINISHED → interrupted 保留
27. WIP → FINISHED stability（bounded wait）
28. stale session / epoch / generation → no-op

### 15. 真机验收计划

A commit-before-delta kill · B mid-stream kill · C server 完成于 browser 死期间 · D Stop 后 kill · E idle recovery · F image+text · G image-only · H deleted session URL · I reconcile 切 B · J 连续两次 recovery。对比 Host before / server history / Host after（count、roles、content length、reasoning、status、ids、attachments）。

### 16. 20B 拆分

- **20B1 — Safe transcript reconciliation**（IDB reader + **三层 identity strategy（Level 1 existing id / Level 2 parent-anchor binding / Level 3 strict bootstrap）** + 原地 patch + stability wait + stale 防护 + status merge）：**design finalized，可 implementation**。
- **20B2 — Session-not-found / title / UX**：**已实现并验证**（2026-09-27）；目标 ID 的前端 not-found + `/` 重定向 + logged-in 才清理；其它结果 safe-fail；恢复后的 active exact-id 侧栏标题与共享恢复提示已接入。

18B 已完成并验证（含 Client 界面与签名 URL 失败降级）；21 Proxy 保持后续。
