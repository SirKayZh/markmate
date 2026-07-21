# 更新日志 / Changelog

本项目遵循[语义化版本 SemVer](https://semver.org/lang/zh-CN/)。

版本号规则：`主版本.次版本.修订号`
- **修订号（patch）**：bug 修复，向下兼容
- **次版本（minor）**：新增功能，向下兼容
- **主版本（major）**：破坏性改动

---

---

## [2.1.0] - 2026-07-21

### 重构 Refactor
- **Tab 状态管理封装（消除「改 4 处」维护债）**：此前每个 Tab 的状态字段（filePath / content / dirty / codeMode / jsonView / jsonlPage / scrollTop / cursorPos / 标注缓存）散落在 3 个同步点——对象字面量创建、`saveCurrentTabState` 序列化、`switchToTab` 反序列化——加一个字段要同步改 3 处，漏一处就是「切 Tab 丢数据」类 bug（v2.0.0 已修过多例）。现收敛为单一事实来源：
  - `makeTab()` 工厂函数定义完整字段 schema，所有 Tab 一律经此创建（禁止散落对象字面量）。
  - `captureTabState()`（活动态 → tab 对象）与 `restoreTabState()`（tab 对象 → 活动态）成为唯一双向同步点。
  - 今后新增 per-tab 字段只需改 2 处：`makeTab` 加默认值 + capture/restore 加一行同步。
  - 行为完全等价，CDP 真机验证 per-tab 的 dirty / content / codeMode / jsonView 隔离全部正确、JSONL 数据集打开正常、全程 0 未捕获异常。

### 定位更新
- **MarkPad 正式升级为「大模型时代的文本编辑器」**：从 v1.0 的「轻量 Markdown 编辑器」到 v2.0 的「Markdown + JSON/YAML/XML 查看 + LLM 数据集标注」，定位漂移已是事实。v2.1.0 起明确承认这一升级——单应用打通 MD 写作、JSONL 数据浏览、JSON 修复、数据标注、多格式导出全链路，**LLM 数据集标注功能不再单独拆出**。
- 体积预算随定位同步放宽（详见内部 `markpad-dev/DESIGN_PRINCIPLES.md §0.1`）：自有源码 2500 行 → 9000 行；运行时依赖 3 个 → 7 个。**反臃肿原则不撤销**，只是适用范围扩大。

### 安全 Security
- **新增 Content Security Policy**：通过 `session.defaultSession.webRequest.onHeadersReceived` 在主进程注入 CSP，限制 `connect-src` 仅允许 GitHub（autoUpdater）、`object-src 'none'` 禁用插件、`script-src 'self' file: 'unsafe-inline'`（不再允许 `unsafe-eval`）。此前渲染进程无 CSP，存在 XSS 风险。
- **Vditor 改用本地 lute 引擎**：`initVditor` 显式配置 `cdn: '../node_modules/vditor'`，从本地加载 lute.min.js，不再走 `https://unpkg.com/vditor@x/dist/js/lute/lute.min.js`。修复 CSP 收紧后 vditor 因无法加载 CDN 脚本而部分功能不可用的问题；离线场景也稳定。
- **JSON viewer 去内联 `onclick`**：8 处内联 `onclick="switchJsonView/jsonCollapseAll/jsonExpandAll/changeJsonlPage/jumpToJsonlPage"` 改为在 `bindJsonViewerEvents()` 中统一 `addEventListener`。便于后续 CSP 收紧到 nonce-based 严格策略。

### 修复 Fixed
- **🔴 Windows 顶部 5 按钮全部丢失**：此前 `body:not([data-platform="darwin"]) #drag-bar { display: none !important; }` 把整个 `#drag-bar` 隐藏，连带其中的 5 个按钮（搜索 / 收藏 / 源码切换 / 格式化 / 主题切换）也消失，Windows 用户只能从菜单栏访问。现把 `#drag-bar` 拆为纯拖拽区 + 独立的 `#toolbar` 按钮容器，Windows 上隐藏拖拽区但保留按钮区作为顶部工具条。
- **🟠 关闭窗口超时太短导致丢数据**：渲染进程未响应超时回退从 3 秒拉长到 30 秒。此前用户面对「未保存的更改」三态确认框思考超过 3 秒会被强制关闭，等于绕过保存确认丢数据。
- **静默吞错改为记录日志**：`main.js` 和 `renderer.js` 中 50 余处 `catch (_) {}` / `catch (_) { /* ignore */ }` 改为 `catch (err) { console.warn/error('[MarkMate:context]', err); ... }`。关键 IO/解析失败用 `console.error`，资源清理/探测失败用 `console.warn`，JSONL 行级容错保留 `catch (_)`（量大不刷日志）并加注释说明。

---

## [2.0.0] - 2026-07-14

### 新增 Added
- **支持 OpenAI Messages 格式数据集对话视图**：现可识别 `{"messages":[{"role","content"}]}` 这一业界通用的微调/标注格式（OpenAI fine-tuning、vLLM 等），自动进入对话气泡视图，按 `system / user / assistant / tool` 角色着色展示，并支持点选编辑、统计（轮次/角色分布/Token）。此前只支持 Alpaca 与 ShareGPT，messages 格式会退化成树形且被截断看不全。
  - `content` 为多模态数组（`[{type:"text",...},{type:"image_url",...}]`）时只读展示，图片部分以 `[图片]` 占位。
- **JSON 解析错误定位**：打开格式错误的 `.json` 文件时，顶部显示醒目错误条，标出具体**出错行号、列号**与原因（如「第 3 行，第 10 列：Unexpected token」），并提供「定位」按钮一键跳转到原始视图的出错位置。此前解析失败会静默回退到原始文本、不给任何提示，体验上像 bug。
- **对话视图标注编辑 + 批量保存**：JSONL 数据集的「对话视图」气泡现在可直接点选编辑（Alpaca 指令/输入/输出、ShareGPT 各轮 value）。支持一次改多条、攒成待保存集合，顶栏「💾 保存 (N)」一键整文件回写；「↩ 放弃」可撤销全部未保存修改。已改条目带黄色「已改」标记，保存失败条目红框高亮并自动滚动定位。
  - 编辑以全量行下标为键缓存，翻页/筛选往返不丢；保存按行下标精确回写整文件，从根本上避免多页 JSONL「当前页覆盖整文件」的数据丢失。
  - ⌘S 在对话视图自动改走标注回写逻辑；关窗时未保存标注会触发确认。
- **保存并下一页**：多页 JSONL 对话视图新增「保存并下一页 ▶」按钮，标完一页一键存盘并自动跳到下一页继续标注；无改动时退化为纯翻页，末页自动禁用。
  - 切换标签页时若当前对话视图有未保存标注，弹三态确认（保存/放弃/取消），避免标注丢失。
- **编辑器 ↔ 源码面板双向滚动同步**：打开源码面板（⌘E）后，编辑器滚动时源码面板按比例跟随滚动，反之亦然；光标在编辑器中移动时源码面板自动定位到对应行；大纲点击跳转也会同步源码滚动位置。
- **大纲随滚动自动高亮**：滚动文档时，左侧大纲自动高亮当前所在标题，并自动滚动到可见区域。不再需要手动找「读到哪了」。
- **内置版本升级（electron-updater）**：启动 3 秒后静默检查 GitHub Release 是否有新版本；发现新版后弹出横幅提示，支持一键下载、进度显示、下载完一键重启安装。静默检查不阻塞启动，用户可随时关闭提示。
- **文件列表增强**：当前文件夹列表不再只显示 md 文件——所有文件与文件夹一览无余；文件夹条目可右键菜单「在 Finder 中打开」或直接单击在 Finder 中打开。
- **大纲刷新优化**：Vditor 快捷语法（`###` / `>` / ` ``` ` 等）转换完成后，大纲通过 `keyup` 兜底 + `requestAnimationFrame` 确保不漏项、不闪烁。

### 优化 Performance
- **大 JSON 异步解析**：打开超过 512KB 的 `.json` 文件时，解析改在后台 Web Worker 进行，不再阻塞主线程，避免大文件打开瞬间的 UI 冻结。快速切换标签页时会丢弃过期解析结果，不会用旧文件内容覆盖当前视图。

### 修复 Fixed
- **树形视图长字符串看不全也滚不动**：JSON/JSONL 树形视图中超过 200 字的字符串值此前被硬截断为 `…`、无法查看完整内容（大 `content` 字段尤其明显）。现在长字符串旁出现「展开（N 字）」按钮，点击在下方完整展开全文（可换行、可滚动，最高占半屏），再次点击收起。
- **Windows 平台多项适配修复**（P0~P3，共 12 项）：
  - 🔴 **双标题栏**：`titleBarStyle: hiddenInset` 在 Windows 上失效，改为平台判断 + CSS 隐藏自定义 drag-bar。
  - 🟠 **长文档 PNG 导出截断**：`enableLargerThanScreen` 仅 macOS 有效，Windows 上改为逐级降低 zoom 适配。
  - 🟠 **菜单/按钮文案**：「在 Finder 中显示」改为平台感知（Windows 显示「在文件夹中显示」）。
  - 🟠 **快捷键提示全显示 ⌘**：preload 暴露 `platform`，renderer 动态生成 `Ctrl+` 文案。
  - 🟠 **正文字体**：font-family 加 `Segoe UI` / `Microsoft YaHei`，Windows 上不再回退到 sans-serif。
  - 🟡 **package.json description**：`for macOS` → `for macOS & Windows`。
  - 🟡 **欢迎页快捷键表**：表格快捷键平台适配。
  - 🔵 **`second-instance` 处理**：注册 `app.requestSingleInstanceLock()`，防多实例启动。
  - 🔵 **`open-file` 安全守卫**：已有 `app.isReady()` 判断（经审查，无 race condition）。
- **JSONL 格式化读取旧文件内容**（Batch4 C06 预存 Bug）：在 JSONL 的树或对话视图下按格式化快捷键（⌥⌘L），`codeEditor.value` 仍存留上一个代码文件（如 XML）的旧内容，导致格式化用错源数据。现在进入格式化前先用 `jsonlEntries` 重新填充 `codeEditor`，确保源数据正确。
- 对话视图有未保存标注编辑时点「导出」，导出内容现在包含这些未保存修改（所见即所得），此前会导出旧内容。
- **多 Tab 关闭数据丢失**：关闭窗口/退出时遍历保存所有脏 Tab（而非仅当前激活 Tab），避免其他 Tab 修改静默丢失。
- **切到干净 Tab 后关窗跳过确认**：移除 main.js `close` 事件的 `ctx.currentDirty` 捷径，始终走 `confirm-close` 流程由渲染层根据所有 Tab 脏状态判定。
- **多窗口草稿互相覆盖**：草稿文件名加入窗口 ID 后缀，多窗口同时编辑互不踩踏。
- **分页 JSONL raw 视图关窗覆盖整文件**：关闭确认流程加入 `confirmOverwrite` 保护。
- **`fileFromArgv` 健壮性**：改为遍历全 argv 找存在的文件路径，兼容不同打包启动方式。
- **`export-png` 超时兜底**：加入 15s 总超时与每步 `checkTimeout`。
- **`closeOtherTabs/closeRightTabs`**：跳过脏 Tab 时给 toast 提示保留数量。
- 三个功能段补专属 README 截图：文件管理、JSON/YAML/XML 查看器、历史版本。
- 下载页 `download.html` 与首页 `index.html` 版本号、文件名、大小全部更新至 v2.0.0。

---

## [1.6.1] - 2026-06-19

### 优化 Performance
- **异步文件读取**：`openFileInWindow` 改用 `fs.promises.readFile`，打开大文件不再冻结主进程。
- **输入回调瘦身**：vditor input 回调中字数统计与源码面板同步改为 300ms debounce；源码面板隐藏时彻底跳过序列化，消除 IR 模式打字掉帧。
- **Prism 高亮 debounce**：代码编辑器 input 高亮改为 150ms debounce，大 JSON/XML 文件每键不再全文重算。
- 内部同步路径统一使用 `getEditorContent()`，降低重复序列化。

### 修复 Fixed
- 代码模式下 Tab 键缩进后未触发自动保存与高亮刷新。

---

## [1.6.0] - 2026-06-19

### 新增 Added
- **🪟 多窗口 / 多标签页（Tabs）**：单窗口内支持多个标签页，并可在多窗口间独立工作。
  - 渲染层 TabManager 管理标签数组与激活态，每个标签独立保存文件路径、内容、脏标记、滚动位置与光标。
  - 主进程改为按窗口维护独立上下文（windowContexts），告别全局单窗口状态。
  - 快捷键：⌘T 新建标签、⌘W 关闭标签、⌘1~9 切换标签。
  - 标签右键菜单：关闭 / 关闭其他 / 关闭右侧 / 移到新窗口 / 在 Finder 中显示。
  - 重复打开同一文件时自动聚焦已存在的标签，不再重复加载。
- **🖼 本地图片走自定义 `mpmedia://` 协议**：替代 `file://`，规避非 file 页面加载本地资源被 Chromium 拦截的问题，编辑器内本地图片稳定显示，保存时仍归一化为可移植的相对路径。
- **📎 原生图片选择对话框**：工具栏图片按钮改用 Electron 原生文件对话框选图，替代浏览器 `<input type=file>`。
- **💾 应用数据持久化到主进程**：收藏夹 / 最近打开等数据由主进程写入 JSON 文件，不再依赖渲染层 localStorage。

### 修复 Fixed
- **🔗 插入链接点击无反应**：根因是 Electron 渲染进程禁用了 `window.prompt()`（调用即抛异常被吞）。改为自定义弹窗收集链接文字与地址，支持选中文字自动预填、Enter 确认、Esc/点遮罩取消。
- **💬 工具栏 hover 提示看不见**：tooltip 默认朝上弹出，被祖先 `overflow:hidden` 容器的上边界裁掉。改为统一朝下弹出，确保始终可见。
- 关闭窗口确认逻辑改用 `BrowserWindow.fromWebContents(event.sender)` 获取窗口，窗口失焦时也能拿到正确实例。

---

## [1.5.0] - 2026-06-14

### 新增 Added
- **🎨 代码语法高亮**：JSON / XML / YAML 编辑区使用 Prism.js 提供语法着色（亮/暗双主题自适应）。
  - 采用 textarea + pre overlay 架构：高亮层在下铺底展示着色，输入层透明覆盖在上方接收键盘，无需替换为 contenteditable。
  - 字符串（绿）、数字（橙）、关键字（紫）、标签/键（蓝）、注释（灰斜体），双主题独立配色。
  - 编辑 / 格式化 / 滚动时实时刷新高亮，体验流畅。
- **📂 支持打开 xml / json / jsonl / yml / yaml 文件**：MarkMate 现可作为轻量代码/配置文件查看器使用。
  - **专用 textarea 编辑区**：代码模式不走 vditor，避免大型文件触发 IR 模式增量解析爆炸。
  - **一键格式化**：JSON / JSONL / XML 支持原生格式化（⌥⌘L 或顶部工具栏「格式化」按钮）。
  - **状态栏自适应**：右下角显示文件类型徽标（JSON/XML/YAML）；字数统计切换为"字符数"。
  - **新增文件关联**：`.xml` `.json` `.jsonl` `.yml` `.yaml`（Finder「打开方式」可选）。
- **📝 侧栏文件类型图标**：收藏夹/最近打开/当前文件夹中的文件按扩展名显示不同 emoji 图标（📝 .md / 📊 .json / 📋 .xml / ⚙️ .yml/.yaml）。
- **📌 侧栏标签与搜索框常驻**：文件/大纲标签和搜索框在滚动时固定不动，随时可切换。
- **🔘 工具栏按钮全常驻**：格式化和源码对比按钮在所有模式下可见，当前不可用时自动置灰并显示中文提示，视觉位置稳定不跳动。

### 优化 Improved
- 最近文档最多保留 10 条（原 20 条），旧数据自动裁剪。
- 侧栏字体层级修正：分组标题（收藏夹/最近打开/当前文件夹）12px bold > 文件名 11px，层级关系清晰。
- 文件名左侧缩进 12px，与分组标题视觉区隔。
- 代码模式下大纲自动清空并显示提示语。

### 修复 Fixed
- 格式化按钮误跑到左上角红绿灯旁边（CSS 缺 right 定位）。
- 格式化按钮文字被挤成竖排（父级 width:22px 未覆盖）。
- md ↔ 代码文件切换时大纲残留旧标题。

---

## [1.4.1] - 2026-06-13

### 新增 Added
- **🪟 Windows 支持**：MarkMate 现在可在 Windows x64 上运行。
  - 两种分发格式：`-setup.exe`（NSIS 安装版，可选安装路径、桌面快捷方式）和 `-portable.exe`（免安装即用）。
  - 在 macOS 上交叉编译，electron-builder 自动下载 Wine + NSIS，无需本机安装 Windows。
  - 文件关联：`.md` `.markdown` `.mdown` `.mkd` `.mdtext` `.txt`。
  - 快捷键自动适配 Windows 风格（Ctrl 取代 ⌘），README 已同步更新双栏快捷键表。

### 修复 Fixed
- **长图导出底部被截断**：超过屏幕物理高度的长文档，导出 PNG 末段被齐刷刷裁掉。修复后任意长度文档完整 1:1 截全。
  - 根因：macOS 上 `BrowserWindow.setContentSize` 默认受屏幕物理高度限制，多余高度被静默裁掉；同时 `capturePage()` 不传 rect 时只截当前可视区。
  - 修复：截图窗口启用 `enableLargerThanScreen`（macOS 必需），`capturePage` 显式传入完整 rect，并在 resize 后做高度二次校验，无法装下时退化重试或显式报错——不再静默截断。

---

## [1.4.0] - 2026-06-13

### 新增 Added
- **📄 多格式导出**（文件 → 导出）：支持 PDF（⌘⇧P）、HTML、Word（.docx）、长图（PNG）四种格式，全部保留编辑器排版（字体、代码块、表格、引用、图片）。
  - PDF：Electron 内置 `printToPDF`，零外部依赖，跨页排版优化。
  - HTML：内联完整 Vditor 预览样式，单文件可直接发邮件/上传。
  - Word：`html-docx-js` 转换，Word/Pages/WPS 直接打开。
  - 长图：主进程 `BrowserWindow.capturePage`，`zoomFactor=2` 保证 retina 锐利。
- **🖼️ 图片管理**：拖拽或 ⌘V 图片到编辑器，自动保存到文档同目录 `assets/` 子文件夹，正文插入相对路径。
  - 编辑器内用 `file://` 绝对路径显示，保存到 md 时自动转回相对路径，保证可移植。
  - 打开已有 md 文件时，主进程自动展开相对路径为 `file://` 给编辑器。
- **文件 → 在 Finder 中显示图片目录**：一键打开 `assets/` 目录。

### 优化 Improved
- 移除 `html2canvas` 依赖（~194KB），长图改用 Chromium 原生截图。
- 长图自动测量整篇文档高度，等图片加载完再截，避免空白。
- 长代码块自动 `white-space: pre-wrap`，防止横向滚动条出现在截图里。

### 修复 Fixed
- 图片粘贴/拖拽插入不再弹出红色错误提示（vditor upload handler 返回 null 而非路径字符串）。
- 相对路径图片在 IR 模式下正确显示（不再裂图）。

---

## [1.3.0] - 2026-06-12

### 新增 Added

#### 大纲面板 · 多级树形导航
- 自绘大纲树，按标题层级缩进显示，H1/H2/H3-H6 字号粗细微调。
- ▾ 折叠按钮展开/收起段落，折叠状态本地持久化。
- 点击大纲项跳转目标位置 + toast「已跳转到：xxx」+ 蓝色高亮闪烁。

#### 文件管理面板
- ⭐ 收藏按钮（⌘D）：收藏/取消收藏当前文件，已收藏时按钮金色实心。
- 收藏夹区固定置顶，快速跳转。
- 最近打开自动记录最近 20 个文件。
- 当前文件夹自动列出同目录下所有 md 文件。
- 分区块可折叠（收藏/最近/当前文件夹），每段显示数量徽章，折叠本地持久化。
- 顶部搜索框实时过滤文件名与路径，Esc 清空。

#### 快速打开（⌘P）
- 模糊搜索收藏夹与最近文件，↑↓ 导航，Enter 打开。

#### 专注模式 · 打字机模式 · 排版主题
- 专注模式（⌘.）：自动隐藏侧栏。
- 打字机模式：当前编辑行保持屏幕中央。
- 5 套排版主题：Default / GitHub / Night / Sepia（护眼）/ Slate。

#### 文档搜索与安全
- 🔍 文档内搜索（⌘F）：实时高亮匹配，Enter / ⇧Enter 跳转，浮层显示「当前/总数」。
- 自动保存：停止输入 1.5 秒后自动落盘，状态栏显示时间戳。
- 历史版本（文件 → 历史版本…）：按文件保留最近 10 个快照，可预览/恢复/复制。
- 意外关闭恢复：崩溃/断电后下次启动自动提示恢复草稿。

#### Markdown 扩展语法
- `==高亮==` / 脚注 `[^1]` / 自动目录 `[toc]` / 中英文自动空格 / 术语修正。
- 代码块左侧行号，CSS 适配明暗主题。

#### 三栏可拖动
- 大纲 ↔ 编辑器 ↔ 源码三栏分隔条可拖动调整宽度。
- 大纲可隐藏（⌘\\），隐藏后左侧保留窄入口条，悬停展开。

### 优化 Improved
- 文件操作菜单：新建窗口、打开最近。
- 状态栏显示文件名、字数、行列号。
- 主题切换按钮 hover 气泡提示当前模式。
- 首次打开 md 不再弹「允许访问桌面」（默认折叠当前文件夹分区，展开后才 readdir）。

### 修复 Fixed
- 大纲跳转经过多轮架构优化：最终方案是复用 vditor 自身大纲 DOM + capture 点击委托 + `scrollIntoView`，彻底避开 vditor 内部 `selectionchange` 干扰。
- 大纲侧栏默认可见（不再需要 ⌘\\ 才能看到）。
- 文件关联打开偶发内容不显示。
- 最近打开与当前文件夹列表刷新问题。
- 多处 UI 细节修复。

---

## [1.2.0] - 2026-06-11 ~ 12

### 新增 Added
- **大纲点击跳转**：左侧大纲点击标题平滑滚动到对应位置，当前项高亮。
- **三栏布局 / 源码同步面板**：右上角 ⌘E 切换，右侧源码与中间 WYSIWYG 双向同步（220ms 节流回写）。
- **关闭未保存提示**：⌘W / ⌘Q 时弹出原生对话框「保存/不保存/取消」，防止丢内容。

### 修复 Fixed
- 大纲跳转稳定性：从最初的 `textContent` 模糊匹配迭代到索引绑定 → vditor outline DOM 复用 → capture 委托 + `scrollIntoView` 方案，历时 5 轮修复彻底稳定。

---

## [1.1.0] - 2026-06-11

### 新增 Added
- **拖拽打开文件**：拖 `.md` 到窗口（显示遮罩提示）、拖到 Dock 图标、Finder 双击、冷启动拖入均支持。
- **文件关联**：可在 Finder「打开方式」选择 MarkMate 打开 `.md` / `.markdown` / `.mdown` / `.mkd` / `.mdtext` / `.txt`，支持设为默认编辑器。
- **三态主题**：亮色 / 暗色 / 跟随系统，⌘/ 循环切换，偏好持久化，跟随系统时实时响应深浅色变化。

### 修复 Fixed
- 拖拽文件打不开：修复 vditor 吞掉 drop 事件的问题——window 层 dragover/dragleave/drop 全部走捕获阶段，路径解析下沉 preload 用 `webUtils.getPathForFile()`。

---

## [1.0.0] - 2026-06-11

### 新增 Added
- 类 Typora 所见即所得 Markdown 编辑器（Electron + Vditor）。
- 打开/新建/保存本地 Markdown 文件。
- 大纲侧栏、字数统计、明暗主题。
- macOS arm64 / x64 双架构 DMG 安装包。

### 修复 Fixed
- 打开本地 `.md` 文件编辑区空白：改用 `setValue()` 更新内容替代 `destroy()+new Vditor()`，引入 `vditorReady`/`pendingValue` 机制处理初始化期间打开请求。
