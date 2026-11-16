# 窗口提示与侧栏按钮修复

日期：2026-11-16。用户已明确确认“按此范围修复界面”，在独立分支 `codex/ui-controls-polish` 执行；用户本轮追加授权先审核并提交 UI 修复；不推送、不发布。

## 已批准范围与设计

- Dock / Float / Pop-out 的打开、关闭、停靠和调整大小提示统一为中文，title 与 aria-label 保持一致；产品名 DSH Chat Buddy 不改。侧栏提示按状态显示“打开快速聊天”／“关闭快速聊天”。不新增完整语言系统。
- 侧栏入口沿用宿主公开主题变量，对齐圆角、横向留白与背景绘制区域，展开时占满可用行、收起时保持 36 px 控件。悬停／按下／键盘焦点分别可辨，深浅色跟随主题，不使用宿主私有 class 或修改原生按钮。
- 新版原生 Settings 入口采用 `--dsw-radius-md`、`--dsh-sidebar-row-padding`、`--dsh-sidebar-paint-inset` 和 padding-box 背景绘制；本插件旧实现写死圆角 12 px 和留白、没有占满行。公开 token 缺失时提供独立回退。
- Chromium 当前在插件启用时以 headless=false 创建，用于真实 DeepSeek 网页聊天／图片／历史；本轮保持启动、登录、恢复和 dispose 不变。“首次使用才启动”另行设计，不能将隐藏浏览器当成纯 UI 改动。

## 执行步骤与门禁

- [x] 先补失败浏览器回归：中文 title／读屏名、侧栏展开／收起尺寸、主题 token、hover／active／键盘焦点及 reduced-motion。
- [x] 最小实现并 GREEN：只改 client 提示和侧栏局部样式，保持事件与窗口生命周期。
- [x] 运行 format:check → lint → typecheck → build → test → diff --check → status／diff，再运行 test:ui；验证截图与轻量／深色／收起状态。
- [x] 独立复审、同步本文／architecture／first-release／roadmap；停止等待 Review，不 commit / push / publish，不调整 main。

Browser plugin 不可用时使用项目已有 Playwright 渲染协议 fixture，不安装浏览器依赖、不复制用户登录资料、不启动 DeepSeek 后台浏览器、不发送真实聊天。组件 fixture 验证不标记为新一轮真实宿主／站点矩阵。

## 结果

- Dock／Float／Pop-out 的提示为“在新窗口中打开”“关闭聊天窗口”“停靠到侧栏”“调整聊天窗口大小”；侧栏 title 与读屏名按开关状态为“打开快速聊天”／“关闭快速聊天”。品牌标题仍为 DSH Chat Buddy。
- 入口展开时 width=100%、background-clip=padding-box，收起为 36 px；圆角、留白、背景色跟随宿主公开变量，缺失时保留可用回退；鼠标操作不显示额外 focus outline，键盘 focus-visible 仍有 2 px 主题焦点环。
- 先确认旧版两项浏览器回归失败，再最小修改。最终 format:check / lint（103 文件）/ typecheck / build / diff --check 全通过，单元测试 699/699，组件浏览器测试 13/13。
- 图像证据：`dist/review/ui-controls-20261116/` 下 light／dark × wide／rail 四张入口截图及 Dock light／Pop-out dark；已逐张检查。`COMPANION_UI_PROOF_DIR` 可在 test:ui 时保存纯 fixture 图像，默认不保存。页面错误数为 0。
- 完整门禁发现一条既有毫秒竞态：recovery budget 的严格 60000 ms 断言偶发读到 59999。仅在该测试内 mock Date.now，保留严格断言、不修改恢复运行代码；独立测试时钟自动由 node:test 还原。另补测试 fixture 按钮的 type=button，满足 lint。
- 品牌契约保留所有窗口品牌与旧品牌禁用检查，侧栏允许使用本轮批准的中文动作提示，不再要求侧栏源码包含英文品牌字符串。真实 title／aria／开关状态由渲染回归覆盖。
- 本轮未复制登录资料、未运行真实 DeepSeek 页面或发送聊天；验证使用 Playwright 协议 fixture，不代替新版宿主真实侧栏逐像素验收。Host／SSE／浏览器启动／恢复及登录目录均未改变。
- 当前包版本仍为已发布 0.1.2，改动只在本地源码，不覆盖 npm 0.1.2。后续若发布，须另行确定新版本并授权提交／发布。
- 独立只读复审完成，Blocker / High / Medium / Low 均无可执行问题。已核对中文 title／aria、局部样式与焦点、几何回退、测试时钟及 Host 未变边界；未重做真实宿主 sidebar.footer.action 像素对照，焦点通过状态／描边断言验证，未单独保存焦点截图。原 Review 门禁已由用户确认，授权先提交本轮 UI 修复；不推送或发布。

## 提交授权

2026-11-16 用户明确要求“先审核提交，不发新版”，本次在重新核对差异和完整门禁后仅提交本篇 UI 修复。随后按新计划单独验证按需启动与后台工作，不将两类运行变更混在 UI 提交中。
