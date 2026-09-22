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
- **实机验证（07L 收尾）**：并发两次 new chat（模拟两个界面）→ 一个 200、另一个 409（`new chat already in progress`），真实控件只点击一次；切换期间发送 → 409（`new chat in progress`）且不产生任何消息；切换结束后发送 200；toggle 组合保留；共享 transcript 清空（三界面同一份状态）。标准 DOM 定位（无 React 私有依赖）在真实页面连续两轮点击均成功触发切换（`pathname = /` 且消息 DOM 清零）——真实候选链为 `SPAN → DIV`，全链无 `button`/`a`/`role`，走的是文本候选 + 原生 click 冒泡路径。
- token / cookie 不离开 browser context。
