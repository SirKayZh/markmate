# 更新日志 / Changelog

本项目遵循[语义化版本 SemVer](https://semver.org/lang/zh-CN/)。

版本号规则：`主版本.次版本.修订号`
- **修订号（patch）**：bug 修复，向下兼容 — `npm run release:patch`
- **次版本（minor）**：新增功能，向下兼容 — `npm run release:minor`
- **主版本（major）**：破坏性改动 — `npm run release:major`

---

## [1.4.4] - 2026-06-12

### 修复 Fixed
- **大纲侧栏默认可见**：v1.4.3 大纲面板初始 `class="hidden"`，用户需要 ⌘\ 才能看到——但 toggle 状态可能跟 DOM 不同步，导致"大纲消失了"。现在改为大纲默认展开可见（`outlineVisible = true`，HTML 去掉了 `class="hidden"`），用户如果不想要可以 ⌘\ 收起。
- **vditor outline 样式加固**：给 `#outline-content .vditor-outline` 的 `position/left/width` 等全部加 `!important`，彻底防止 vditor 自身 CSS 的绝对定位覆盖。

### 技术细节 Technical
- `index.html`：`<aside id="outline">` 不再带 `class="hidden"`
- `renderer.js`：`outlineVisible` 初始值 `false → true`
- `styles.css`：`#outline-content .vditor-outline` 加了 `position: static !important` 等全覆盖

---

## [1.4.3] - 2026-06-12

### 修复 Fixed
- **大纲跳转——换方案，彻底搞定**：v1.0.1~v1.4.2 三版全没修好，因为一直在跟 vditor 的内部滚动机制打架。这次 CDP 深入 debug 找到**真正的根本原因**：
  - `vditor.vditor.element`（即 `#vditor` DIV）的 `overflow: visible` 且 `scrollHeight == clientHeight`（均为 706）——**根本不可滚动**。
  - vditor 自己的 outline click handler 往这个不可滚动的元素设 `scrollTop`——等于写进黑洞，**连 vditor 原生的跳转在这套布局下都不生效**。
  - 真正可滚动的容器是 `pre.vditor-reset`（scrollHeight=1712, clientHeight=705, overflow-y:auto），但 vditor 没去滚它。

- **1.4.3 改用全新方案**：不再自己渲染大纲、不再自己算滚动位置。改为：
  1. vditor 负责渲染大纲（用 `outline: { enable: true }`），它在每个 `<span>` 上挂了正确的 `data-target-id`，跟编辑器内的 h 元素（带 `id`）一一对应。
  2. 我们在 `after` 回调里把 vditor 生成的 `.vditor-outline` DOM **搬进**自己的 `#outline-content` 侧边栏。
  3. 在 `#outline-content` 上挂 capture 阶段的 click 委托：拦截对 `[data-target-id]` 的点击 → `e.preventDefault()` 阻止 vditor 无效的 scrollTop 操作 → `document.getElementById(targetId).scrollIntoView({ block:'start' })` —— **浏览器原生 API 不管嵌套多深都能找到正确滚动容器**。
  4. Toast + flash 高亮保留。

- 删除了**全部**自己写的死代码：`parsedHeadings`, `refreshOutline`, `slugify`, `tagHeadingsInDom`, `getEditorHeadings`, `getScrollContainerFromElement`, `scrollToHeadingByIndex`, `scrollHeadingIntoView`, `collectScrollableAncestors`, `moveCaretTo`, `escapeHtml` ——约 200 行定制逻辑全部替换为 15 行 `moveVditorOutline` + 委托 listener。

### 技术细节 Technical
- `renderer.js`：新增 `moveVditorOutline()`（在 `after`/`input` 回调中调用，把 vditor outline 搬进侧边栏）；`#outline-content` 上挂 capture click 委托 listener 拦截 `[data-target-id]` 点击。
- `styles.css`：新增 vditor 自带 outline 在侧边栏内的样式适配（`.vditor-outline__content ul/li`, `[data-target-id]` 等）。
- CDP 验证：6 个标题逐个点击，`scrollTop` 全部正确递增（44→157→396→658→1006），toast/flash 全部触发。

---

## [1.4.2] - 2026-06-12

### 修复 Fixed
- **大纲点击跳转，这次真的彻底搞定**：v1.4.1 CDP 真机验证滚动确实发生（`pre.vditor-reset.scrollTop` 数值正确变化），但用户主观仍感觉"没跳"。复盘定位到两个真正根因：
  1. v1.4.1 调了 `moveCaretTo`（`Selection.removeAllRanges + addRange`）想把光标移到目标——这反而触发 vditor IR 模式自带的 `selectionchange` 处理，**vditor 立刻把视口拉回光标位置**，跟我们的滚动反向打架。
  2. smooth 动画 + 默认欢迎文档段间距不大，整个滚动看上去"只挪了一点点"，很难感知。
- 1.4.2 的方案：① **彻底不再操作 selection/focus**——只做"滚动 + 高亮 + toast"三件事，避开 vditor 内部干扰；② 滚动改用 instant（瞬时）+ 自动收集所有可滚动祖先逐个对齐，外加 `scrollIntoView` 兜底；③ flash 高亮加强（背景透明度 0.55 + 6px 蓝色光晕，时长延长到 1.6s）；④ **新增顶部 toast**：每次点击大纲都会在屏幕顶部居中弹出"已跳转到：xxx"提示，1.4s 后淡出——用户**绝对不会感知不到**跳转。

### 技术细节 Technical
- `renderer.js`：删除 `moveCaretTo` / `getScrollContainerFromElement` / `scrollElementInto`；新增 `scrollHeadingIntoView` / `collectScrollableAncestors` / `showJumpToast`。
- `styles.css`：增强 `@keyframes mp-heading-flash-kf`（更高对比度 + 光晕），新增 `#mp-jump-toast` 样式。
- 验证：CDP 自动化脚本逐个点击 6 个大纲项，每次 `toastShown=true / hasFlash=true / scrollTop` 数值正确递增。

---

## [1.4.1] - 2026-06-12

### 修复 Fixed
- **大纲点击跳转真正生效**：v1.4.0 的实现逻辑虽对、但用户感知不到——根因有两个：
  1. 之前的 `getEditorRoot()` 把滚动容器锁定到了 `.vditor-reset` 节点（也叫"内容元素"），但 IR 模式下真正可滚动的是它自己（`pre.vditor-reset`，`overflow-y:auto`），需要从目标 h 元素往上找最近一个 `scrollHeight > clientHeight` 的祖先才稳。
  2. 点完大纲，光标还停在原编辑位置，用户一打字就跳回去，会以为"没跳过"。
- 现在大纲点击：① 用 `getScrollContainerFromElement(target)` 沿祖先链找正确滚动容器；② 平滑滚动到目标；③ 给目标标题做一个 1.1s 的**蓝色淡入淡出闪烁**（`.mp-heading-flash`）作为视觉确认；④ 把光标移到目标标题开头（`window.getSelection` + `Range`），确保后续编辑就在这里发生。
- 通过 Chrome DevTools Protocol 真机自动化验证：6 个标题逐个点击，`scrollTop` 数值递增正确，每次都有 flash 元素出现，大纲 active 项也跟着切换。

### 技术细节 Technical
- `renderer.js`：新增 `getScrollContainerFromElement` / `flashHeading` / `moveCaretTo`；移除"在 h 上挂 id"的无效逻辑（vditor 每次 input 都会重渲染 DOM，挂的属性会被冲掉，所以改用即时 `querySelectorAll` + 索引定位）。
- `styles.css`：新增 `@keyframes mp-heading-flash-kf` 动画。
- `main.js`：保留环境变量 `MARKPAD_DEBUG=1` 时自动打开 DevTools，方便后续诊断（生产模式默认关闭）。

---

## [1.4.0] - 2026-06-11

### 新增 Added
- **大纲点击跳转**：左侧大纲列表点击任一标题，中间编辑区平滑滚动到对应位置；当前项高亮显示。修复了之前 IR 模式下用 `textContent` 模糊匹配导致跳错位置的问题——改为按"第 i 个标题对应 DOM 里第 i 个 h 元素"的索引绑定，并给每个 h 标记 `id` 方便定位。
- **三栏布局 / 源码同步面板**：右上角加了一个面板切换按钮（⌘E），打开后右侧出现「Markdown 源码」面板。中间是渲染好的 WYSIWYG 视图，右侧是纯文本 Markdown 源码——无论在哪一边修改都会**双向同步**到另一边。源码侧改动 220ms 节流后回写到 vditor，避免每个按键都重渲染；焦点切换时立即落地。
- **关闭未保存提示**：点关闭按钮 / ⌘W / ⌘Q 时，如果当前文档有未保存改动，会弹出原生对话框「保存 / 不保存 / 取消」。选「保存」走标准保存流程（无路径时自动出另存为），保存成功才真正关闭；选「取消」窗口保持原状不丢内容。

### 技术细节 Technical
- `main.js`：拦截 `window.close`，脏状态下发 `confirm-close` 给渲染层走原生 dialog；新增 `ask-close-confirm` IPC handler；`before-quit` 兜底处理 ⌘Q。
- `renderer.js`：新增 `syncSourceFromVditor` / `syncVditorFromSource` 双向同步，用 `syncingFromVditor`/`syncingFromSource` 标志位防回环；大纲改为按索引直跳，并给每个 h 标记 `data-mp-idx` + `id`。
- `index.html` / `styles.css`：右侧 420px 源码面板（可收起 `.hidden` → `margin-right:-420px`），顶栏新增源码切换图标。

---

## [1.3.0] - 2026-06-11

### 修复 Fixed
- **拖拽文件打不开**：窗口拖入 `.md` 后停留在「松开以打开文件」遮罩、文件没真正加载。根因有两个：①Vditor 自身在编辑区注册了 `drop` 监听并 `stopPropagation`，吞掉了 window 层的处理器；②Electron 已经把 `File.path` 这个非标准扩展逐步收敛到 `webUtils.getPathForFile()`，渲染层直读 `f.path` 在新版本会拿到空串。修复办法：window 上的 `dragover/dragleave/drop` 全部改走捕获阶段抢先处理，路径解析下沉到 preload 用 `webUtils.getPathForFile()`，并对老 API 做兜底。

### 新增 Added
- **右上角主题切换图标**：标题栏右上角加了一个小的主题按钮，点击循环切换：亮色 → 暗色 → 跟随系统。图标统一是一个半亮半暗的小圆，跟随系统模式下整体透明度稍降以做区分；与菜单「视图 › 主题」、`⌘/` 快捷键共用同一套状态。

---

## [1.1.0] - 2026-06-11

### 新增 Added
- **拖拽打开文件**：可将 `.md` 等文件直接拖到窗口内打开（拖动时显示提示遮罩）；也支持拖到 Dock 图标、Finder 双击、以及应用未启动时拖入（冷启动会暂存待应用就绪后自动打开）。
- **文件关联**：打包后可在 Finder「打开方式」中选择 MarkPad 打开 `.md` / `.markdown` / `.mdown` / `.mkd` / `.mdtext` / `.txt` 文件，并支持设为默认编辑器。
- **三态主题**：「视图 › 主题」新增 亮色 / 暗色 / 跟随系统 三个选项；偏好持久化保存，下次启动自动恢复。「跟随系统」模式下随系统深浅色实时切换。`⌘/` 可在三种模式间循环。

### 技术细节 Technical
- `main.js`：将菜单打开、拖拽、Dock、命令行入口统一收敛到 `openFile()`，新增 `pendingOpenPath` + `renderer-ready` 握手解决冷启动拖入丢失；新增 `set-native-theme` 同步 `nativeTheme.themeSource`。
- `renderer.js`：窗口 `drop` 事件取文件路径交主进程读盘；`themeMode`(light/dark/system) 持久化到 localStorage，监听 `matchMedia` 系统主题变化。
- `package.json`：新增 `build.fileAssociations` 声明文件类型关联。

---

## [1.0.1] - 2026-06-11

### 修复 Fixed
- 修复打开本地 `.md` 文件后编辑区一片空白的问题。根因是打开文件时通过 `vditor.destroy()` + `new Vditor()` 重建实例，而 Vditor 初始化是异步的，销毁旧实例会打断新实例渲染，导致内容已写入（`getValue()` 有值）但 DOM 不显示。改用 `setValue()` 更新内容，并引入 `vditorReady`/`pendingValue` 处理初始化期间的打开请求。

## [1.0.0] - 2026-06-11

### 新增 Added
- 首个版本：类 Typora 的所见即所得 Markdown 编辑器（Electron + Vditor）。
- 支持打开/新建/保存本地 Markdown 文件、大纲侧栏、字数统计、明暗主题。
- 提供 macOS arm64 / x64 双架构 DMG 安装包。
