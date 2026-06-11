# 更新日志 / Changelog

本项目遵循[语义化版本 SemVer](https://semver.org/lang/zh-CN/)。

版本号规则：`主版本.次版本.修订号`
- **修订号（patch）**：bug 修复，向下兼容 — `npm run release:patch`
- **次版本（minor）**：新增功能，向下兼容 — `npm run release:minor`
- **主版本（major）**：破坏性改动 — `npm run release:major`

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
