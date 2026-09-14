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

- 当前首要兼容目标：DSH 0.1.2-rc.1。
- 后续兼容其他版本时优先做 capability detection。
- 版本敏感 API 优先 `ctx.inject` / capability detection / type guard / runtime feature detection。
- 不假定所有 DSH 版本 API 一致。
- DSH API 不确定时先阅读官方源码/文档，不允许猜测。

## Companion Dock Surface Strategy（Phase 04 已验证）

Companion Dock 在用户点击 sidebar 入口时打开。打开时根据当前 Session 的 `blank` 标志，选择一个官方 Surface 占用：

| 当前 Session | Surface | 槽位 / Scope | 效果 |
|---|---|---|---|
| 非 blank（`blank === false`） | `details` | 单槽、`session` scope | conversation 真实缩窄，dock 在官方右侧列内 |
| blank（`blank === true`）或无当前 Session | `shell.overlay` | 列表槽、`root` scope | frame-right 浮层（fixed right 420px），conversation 不缩窄 |

### 规则

- Surface 在 `open()` 时只决定一次，open 期间不变。即便 Session 的 blank 状态发生变化，也不切换 Surface（避免 UI 跳动、焦点丢失、未来聊天输入状态被冲掉）。
- 只有 `close` → 再次 `open` 时才重新读取 Session blank 并选择 Surface。
- 任何时刻最多只有一个 Surface registration（details 或 overlay）。`close()` 调用对应的 `dispose`，DSH 默认 DetailsPanel 与 `shell.overlay` 容器都自动恢复原状。

### 原因

DSH 0.1.2-rc.1 的 `AppFrame` 在 `detailsSession === undefined`（即当前 Session 为 blank）时强制 `details` 宽度为 0；不存在合法公开 API 可以在不伪造 Host 语义的前提下把 blank Session 变 non-blank。因此 `details` 无法作为唯一 Surface。`shell.overlay`（`root` scope、不依赖 session、官方推荐的 frame-wide surface 座位）作为 fallback 保证「新建 Session 立即可用」的核心需求。

## Companion Dock Width（Phase 05A / 05B）

### Width Ownership（谁拥有布局，谁拥有宽度）

| Surface | 宽度拥有者 | 调整方式 | 持久化 |
|---|---|---|---|
| `shell.overlay` | Companion | 自定义 resize handle（Pointer Capture） | ✅ browser localStorage |
| `details` | DSH | DSH 原生 DragHandle | ❌ Companion 不持久化 / 不同步 |

overlay 与 details 的宽度**故意独立**，绝不相同步。

### overlay（Companion owns width）

- 宽度由 Client 内存态 `dockWidth` 控制（默认 `420px`，`resize.ts` 的 `DOCK_DEFAULT_WIDTH`），左边缘 `col-resize` 拖动把手实时调整（`widthFromPointer` / `clampDockWidth`）。
- **持久化**：Client 初始化时从 localStorage 读取一次偏好，运行期用内存值；`pointerup` 结束时写入 localStorage。key 为 `dsh-deepseek-companion:overlay-width`（`storage.ts`）。
- 读取/写入对 localStorage 异常安全降级（读失败用默认 420、写失败仅本次不持久化），绝不抛进 React tree。
- 刷新页面或重启浏览器后从 localStorage 恢复；跨 blank Session 共享（是插件 UI 偏好，非 Session 属性）。

### details（DSH owns width）

- DSH 0.1.2-rc.1 **不提供公开的 details 列宽修改 API**。`ctx.layout` 公开面（`ILayout`，`dsh-client-ui-layout/lib/types/client/service.d.ts`）只有 `toggleSidebar()` / `openDetails()` / `closeDetails()`；内部 store 的 `setDetails`（`stores.d.ts`）仅由 `AppFrame` 内置的 `DragHandle` 使用（`client.js` 的 `onDetailsDrag`），插件无法合法调用。
- details 保持 DSH 默认宽度（`DETAILS_DEFAULT = 360`，min `300` / max `520`），复用 DSH 自带的左侧拖动把手。localStorage 中即使保存 600，也**不会**应用到 details。

### 结论

- overlay resize + 持久化 ✅ 可合法实现。
- details resize ❌ 被 DSH 官方 API 限制；Companion 不控制、不持久化、不同步 details 宽度。
- 是否后续单独做 details 宽度兼容层，待架构决策。

## Companion Pop-out（Phase 06A）

### 现状

- 使用 **browser-native `window.open`**（DSH 0.1.2-rc.1 不提供公开 pop-out / detached-window API；`window.open` 在 DSH 源码中仅出现在一处注释，无插件使用先例）。
- **单实例**：固定 `window.name = 'dsh-deepseek-companion-popout'`；已存在且未关闭时 `focus()`，否则重新创建。
- **React 渲染**：通过 DSH ModuleLoader 暴露的 `react-dom/client` 的 `createRoot` 渲染到 popup document（复用宿主 React runtime，不打包第二份 React）。
- 初始尺寸 `480 × 720`，`resizable` / `scrollbars`；本阶段不做位置/尺寸记忆。
- 生命周期属于 Client Plugin：关闭 Dock 不影响 Pop-out；插件 dispose 或父页面 unload（`pagehide`）时关闭 Pop-out。
- 当前只是本地 UI Shell（Header + Coming soon），**不支持聊天、不共享 Host 状态**。

### 结论

- Pop-out 骨架 ✅ 已实现。
- Phase 06B 才接入 Host-backed State（聊天状态共享、HTTP/SSE、postMessage 协议等）。

## Companion Host State 通道（Phase 06B）

### 现状

- **Host 拥有权威 Companion State**：`src/host/state.ts` 的 `createCompanionState()` 返回 `{ status: 'ready', revision: 1, instanceId }`，`instanceId` 每次 Host 启动生成一次（`node:crypto.randomUUID`）。
- **只读 Host API**：通过 DSH 官方 `ctx.connection.fetch.register(...)`（`@deepseek-ai/dsh-client-connection` 的 `HostConnectionFetch`）注册一个 exact GET route：`/api/deepseek-companion/state`。认证由 Connection 自动处理（Host/Origin fence + browser cookie）。
- **Client 读取**：`src/client/api.ts` 的 `fetchCompanionState(origin, signal)`，Dock 与 Pop-out 共用这一份 fetch；Pop-out 基于父 DSH 页面 origin 构建 URL（about:blank 下仍能同源请求）。

### 数据流

```
DSH Host
  └─ createCompanionState() → { status, revision, instanceId }
       └─ GET /api/deepseek-companion/state (ctx.connection.fetch.register)
            ├─ Dock   (window.location.origin)   → 显示 Host: ready / Revision / Instance
            └─ Pop-out (parent origin)           → 显示同一份 Host State
```

### 结论

- Dock 与 Pop-out 读取**同一个 Host State**（instanceId / revision 一致）已实测验证；Host 重启后 instanceId 变化。
- 当前 Phase 06B **只有读取**，尚无实时同步（无 SSE / WebSocket / BroadcastChannel / postMessage / polling）。实时同步与 Host 写入留待后续 Phase。
