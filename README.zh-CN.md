# MarkPad ⚡

> 一款轻快专注的 **macOS / Windows** Markdown 编辑器 — 所见即所得 + 强大导航 + 永不丢稿。

![platform](https://img.shields.io/badge/platform-macOS%20|%20Windows-blue)
![electron](https://img.shields.io/badge/Electron-31-47848F?logo=electron)
![license](https://img.shields.io/badge/license-MIT-green)

[English](README.md) · **简体中文**

<p align="center">
  <img src="build/preview-icon.png" width="128" alt="MarkPad icon">
</p>

---

## ✨ 功能特性

### ✍️ 写作体验

- **所见即所得**：边写 Markdown 边即时渲染（Vditor IR 即时渲染模式，体验如 Typora）
- **专注模式**（⌘⇧F）：只高亮当前段落，其余内容自动变暗，零干扰沉浸写作
- **打字机模式**（⌘⇧T）：光标始终保持在屏幕中央，长时间写作更舒适
- **丰富内容**：标题、粗体/斜体/删除线/高亮、列表、引用、表格、代码高亮（带行号）、KaTeX 数学公式、任务清单、脚注、自动目录 `[toc]`

### 🧭 导航与文件管理

- **大纲树**（⌘\）：多级缩进的树形导航，折叠状态自动记忆；点击任意标题跳转，跳转时有 toast 提示 + 高亮闪烁反馈
- **文件管理面板**：侧栏三区合一 — ⭐ 收藏夹 · 🕐 最近打开（最多 10 个）· 📂 当前文件夹；各分区可折叠，支持关键词搜索过滤
- **快速打开**（⌘P）：模糊搜索收藏与最近文件，键盘导航，即搜即开
- **收藏**（⌘D）：一键收藏常用文件，星标切换，快速跳转
- **文档内搜索**（⌘F）：实时高亮所有匹配，上/下一个跳转，显示匹配计数

### 🛡️ 永不丢稿

- **自动保存**：停止输入 1.5 秒后自动落盘，状态栏实时显示保存时间
- **历史版本**：每次自动保存打一个快照（每个文件最多 10 个版本），可浏览、预览、一键恢复或复制任意版本
- **草稿恢复**：未命名文档意外退出后，下次启动自动弹出恢复提示
- **关闭确认**：有未保存改动时关闭窗口，弹出原生对话框（保存 / 不保存 / 取消）

### 🎨 主题与布局

- **外观模式**：亮色 · 暗色 · 跟随系统（⌘/ 循环）；跟随系统模式下随 macOS 深浅色实时切换
- **5 套排版主题**：默认 · GitHub · Night · Sepia（护眼米黄）· Slate（⌘⇧/ 循环）；自动切换对应亮暗基础模式
- **三栏可拖动布局**：大纲 ↔ 编辑器 ↔ 源码，拖动分隔条自由调整宽度
- **源码面板**（⌘E）：渲染视图 + Markdown 源码并排，双向实时同步，在哪边改都行

### 🖼️ 图片与扩展语法

- **图片拖拽 & 粘贴**：拖入或粘贴截图，自动保存到文档同目录的 `assets/` 子文件夹
- **图片目录入口**：文件菜单 → 「在 Finder 中显示图片目录」一键打开
- **扩展 Markdown 语法**：`==高亮==` · `[^1]` 脚注 · `[toc]` 自动目录 · 中英文自动空格 · 术语自动修正
- **代码行号**：语法高亮的代码块左侧显示行号

### 💻 轻量代码/配置文件查看器（v1.5.0+）

- **JSON / XML / YAML / JSONL** — 直接在 MarkPad 中打开这些文件，作为轻量查看器和编辑器使用
- **语法高亮** — Prism.js 提供着色，亮/暗双主题独立配色
- **一键格式化** — ⌥⌘L 美化 JSON/JSONL/XML 缩进；工具栏专用按钮，不可用时自动置灰并显示中文提示
- **文件类型图标** — 侧栏按格式显示不同 emoji 徽标（📝 .md · 📊 .json · 📋 .xml · ⚙️ .yml/.yaml）
- **大纲自动清空** — 查看代码文件时大纲区显示提示语，不再残留旧标题
- **零开销** — 磁盘上仍是纯净的 `.json` / `.xml` / `.yaml` 文件，无任何额外标记

### 📤 多格式导出（v1.4.0+）

- **PDF**（⌘⇧P）：跨页排版优化，标题不被切断，零外部依赖
- **HTML**：单文件含完整样式，邮件分享/上传都好用
- **Word（.docx）**：Word/Pages/WPS 直接打开
- **长图（PNG）**：2 倍精度截屏，社群分享神器
- 所有格式都保留与编辑器一致的字体、代码块、表格、引用、图片自适应

### 🍎 macOS 深度集成（Windows 也可用）

- **拖拽打开**：`.md` 文件拖到窗口 / Dock 图标 / 应用未启动时拖入均可打开
- **文件关联**：已注册 `.md` `.markdown` `.mdown` `.mkd` `.mdtext` `.txt` `.xml` `.json` `.jsonl` `.yml` `.yaml` 的处理程序，可在 Finder 中设为默认编辑器
- **原生体验**：内嵌红绿灯按钮、文档修改标记、最近打开菜单、状态栏字数统计
- **隐私友好**：首次打开 md 文件不会触发 macOS「允许访问桌面」权限弹窗

---

## 📦 安装

从 [Releases](https://github.com/SirKayZh/markpad/releases) 页面下载最新版本：

**macOS：**
- Apple 芯片（M1/M2/M3/M4…）：`MarkPad-1.5.0-arm64.dmg`
- Intel：`MarkPad-1.5.0-x64.dmg`

**Windows：**
- `MarkPad-1.5.0-x64-setup.exe` — 安装版（推荐）
- `MarkPad-1.5.0-x64-portable.exe` — 便携版，解压即用

> 两个平台的应用均**未经过代码签名/公证**。
>
> **macOS**：右键点击应用 → **打开**，或运行 `xattr -cr /Applications/MarkPad.app`
>
> **Windows**：SmartScreen 弹出时点击 **更多信息** → **仍要运行**

### 设为默认编辑器

**macOS**：在 Finder 中右键任意 `.md` 文件 → **打开方式** → 选择 **MarkPad**；若想长期生效，选择 **始终以此方式打开** 或在「显示简介」中设置默认应用。

**Windows**：右键任意 `.md` 文件 → **打开方式** → 选择 **MarkPad** → **始终使用此应用**。

MarkPad 也可直接打开 `.txt` 文件。

---

## ⌨️ 快捷键

| 操作 | macOS | Windows |
| --- | --- | --- |
| 新建 | ⌘N | Ctrl+N |
| 打开 | ⌘O | Ctrl+O |
| 快速打开 | ⌘P | Ctrl+P |
| 保存 | ⌘S | Ctrl+S |
| 另存为 | ⌘⇧S | Ctrl+⇧S |
| 收藏当前文件 | ⌘D | Ctrl+D |
| 文档内搜索 | ⌘F | Ctrl+F |
| 切换大纲 | ⌘\ | Ctrl+\ |
| 切换源码面板 | ⌘E | Ctrl+E |
| 专注模式 | ⌘⇧F | Ctrl+⇧F |
| 打字机模式 | ⌘⇧T | Ctrl+⇧T |
| 导出 PDF | ⌘⇧P | Ctrl+⇧P |
| 循环外观 | ⌘/ | Ctrl+/ |
| 循环排版主题 | ⌘⇧/ | Ctrl+⇧/ |

---

## 🛠 开发

```bash
git clone https://github.com/SirKayZh/markpad.git
cd markpad
npm install
npm start            # 启动开发
MARKPAD_DEBUG=1 npm start  # 启动并打开 DevTools
```

### 打包

```bash
npm run dmg            # 打 macOS DMG → release/
npm run win            # 打 Windows（安装版 + 便携版）→ release/
npm run release:patch  # bump 版本 + 打包 + 提交 + 打 tag
npm run release:minor  # 新增功能
npm run release:major  # 破坏性改动
```

> **macOS 注意**：在 Apple 芯片上，`electron-builder` 内部的 `hdiutil` 打 DMG 步骤可能因 macOS 沙箱限制（自动挂载卷）失败。本项目的打包脚本改用 `hdiutil makehybrid` + `convert` 绕开该限制。Windows 打包可在 macOS 上交叉编译（electron-builder 自动下载 Wine + NSIS）。

---

## 🧱 技术栈

- **[Electron](https://www.electronjs.org/) 31** —— 跨平台桌面外壳（macOS + Windows）
- **[Vditor](https://github.com/Vanessa219/vditor) 3** —— Markdown IR（即时渲染）引擎
- 主进程 `main.js`（菜单 / 文件 IO / 自动保存 / 版本快照）+ `preload.js`（安全的 contextBridge IPC）+ `src/`（界面）

---

## 🤝 参与贡献

欢迎提交 Issue 和 PR！路线图设想：

- [ ] 多标签页 / 多窗口
- [ ] 自定义 CSS 主题
- [x] PDF / HTML / Word / 长图 导出（v1.4.0）
- [x] Windows 支持（v1.4.1）
- [x] 代码/配置文件查看与语法高亮（v1.5.0）
- [ ] Vim 键绑定

---

## 📄 许可证

[MIT](LICENSE) © 2026 MarkPad Contributors
