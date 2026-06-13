# MarkPad ⚡

> 一款轻快专注的 macOS Markdown 编辑器 — 所见即所得 + 强大导航 + 永不丢稿。

![platform](https://img.shields.io/badge/platform-macOS-blue)
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
- **文件管理面板**：侧栏三区合一 — ⭐ 收藏夹 · 🕐 最近打开（最多 20 个）· 📂 当前文件夹；各分区可折叠，支持关键词搜索过滤
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
- **扩展 Markdown 语法**：`==高亮==` · `[^1]` 脚注 · `[toc]` 自动目录 · 中英文自动空格 · 术语自动修正
- **代码行号**：语法高亮的代码块左侧显示行号

### 🍎 macOS 深度集成

- **拖拽打开**：`.md` 文件拖到窗口 / Dock 图标 / 应用未启动时拖入均可打开
- **文件关联**：已注册 `.md` `.markdown` `.mdown` `.mkd` `.mdtext` `.txt` 的处理程序，可在 Finder 中设为默认编辑器
- **原生体验**：内嵌红绿灯按钮、文档修改标记、最近打开菜单、状态栏字数统计
- **隐私友好**：首次打开 md 文件不会触发 macOS「允许访问桌面」权限弹窗

---

## 📦 安装

从 [Releases](https://github.com/SirKayZh/markpad/releases) 页面下载最新的 `.dmg`：

- Apple 芯片（M1/M2/M3/M4…）：`MarkPad-1.6.3-arm64.dmg`
- Intel：`MarkPad-1.6.3-x64.dmg`

> 应用**未经过代码签名 / 公证**。首次打开时请右键点击应用 → **打开**，或运行：
> ```bash
> xattr -cr /Applications/MarkPad.app
> ```

### 设为默认 Markdown 编辑器

安装后，在 Finder 中右键任意 `.md` 文件 → **打开方式** → 选择 **MarkPad**；若想长期生效，选择 **始终以此方式打开** 或在「显示简介」中设置默认应用。

---

## ⌨️ 快捷键

| 操作 | 快捷键 |
| --- | --- |
| 新建 | ⌘N |
| 打开 | ⌘O |
| 快速打开 | ⌘P |
| 保存 | ⌘S |
| 另存为 | ⌘⇧S |
| 收藏当前文件 | ⌘D |
| 文档内搜索 | ⌘F |
| 切换大纲 | ⌘\ |
| 切换源码面板 | ⌘E |
| 专注模式 | ⌘⇧F |
| 打字机模式 | ⌘⇧T |
| 循环外观（亮 → 暗 → 跟随系统） | ⌘/ |
| 循环排版主题 | ⌘⇧/ |

---

## 🛠 开发

```bash
git clone https://github.com/SirKayZh/markpad.git
cd markpad
npm install
npm start            # 启动开发
MARKPAD_DEBUG=1 npm start  # 启动并打开 DevTools
```

### 打包 DMG

```bash
npm run dmg            # 仅打包当前版本，输出到 release/
npm run release:patch  # bump 版本 + 打包 + 提交 + 打 tag
npm run release:minor  # 新增功能
npm run release:major  # 破坏性改动
```

> 注意：在 Apple 芯片上，`electron-builder` 内部的 `hdiutil` 打 DMG 步骤可能因 macOS 沙箱限制（自动挂载卷）失败。本项目的打包脚本改用 `hdiutil makehybrid` + `convert` 绕开该限制。

---

## 🧱 技术栈

- **[Electron](https://www.electronjs.org/) 31** —— 桌面外壳
- **[Vditor](https://github.com/Vanessa219/vditor) 3** —— Markdown IR（即时渲染）引擎
- 主进程 `main.js`（菜单 / 文件 IO / 自动保存 / 版本快照）+ `preload.js`（安全的 contextBridge IPC）+ `src/`（界面）

---

## 🤝 参与贡献

欢迎提交 Issue 和 PR！路线图设想：

- [ ] 多标签页 / 多窗口
- [ ] 自定义 CSS 主题
- [ ] PDF 导出
- [ ] Vim 键绑定

---

## 📄 许可证

[MIT](LICENSE) © 2026 MarkPad Contributors
