# MarkPad ⚡

> 一款类 Typora 的 macOS 所见即所得 Markdown 编辑器，基于 Electron + Vditor 构建。

![platform](https://img.shields.io/badge/platform-macOS-blue)
![electron](https://img.shields.io/badge/Electron-31-47848F?logo=electron)
![license](https://img.shields.io/badge/license-MIT-green)

[English](README.md) · **简体中文**

<p align="center">
  <img src="build/preview-icon.png" width="128" alt="MarkPad icon">
</p>

## ✨ 功能特性

- **所见即所得**：边写 Markdown 边即时渲染（IR 即时渲染模式，体验如 Typora）
- **丰富内容**：标题、粗体/斜体、列表、引用、表格、代码高亮、KaTeX 数学公式、任务列表
- **大纲导航**：可开关的侧边栏（⌘\），点击标题快速跳转
- **拖拽打开**：把 `.md` 文件拖到窗口或 Dock 图标即可打开（应用未启动时拖入也会在启动后自动打开）
- **用 MarkPad 打开**：已注册为 `.md` / `.markdown` / `.mdown` / `.mkd` / `.mdtext` / `.txt` 的处理程序，可在 Finder 中设为默认编辑器
- **主题：亮色 / 暗色 / 跟随系统**：在「视图 → 主题」中选择；偏好会被记住并在下次启动时恢复，「跟随系统」模式会随系统深浅色实时切换（⌘/ 在三种模式间循环）
- **文件操作**：新建 ⌘N · 打开 ⌘O · 保存 ⌘S · 另存为 ⌘⇧S
- **导出 HTML**：文件 → 导出 HTML
- **原生 macOS 体验**：内嵌红绿灯按钮、文档修改标记、最近打开、状态栏字数统计

## 📦 安装

从 [Releases](https://github.com/SirKayZh/markpad/releases) 页面下载最新的 `.dmg`：

- Apple 芯片（M1/M2/M3…）：`MarkPad-1.1.0-arm64.dmg`
- Intel：`MarkPad-1.1.0-x64.dmg`

> 应用**未经过代码签名 / 公证**。首次打开时请右键点击应用 → **打开**，或运行：
> ```bash
> xattr -cr /Applications/MarkPad.app
> ```

### 设为默认 Markdown 编辑器

安装后，在 Finder 中右键任意 `.md` 文件 → **打开方式** → 选择 **MarkPad**；若想长期生效，选择 **始终以此方式打开** 或在「显示简介」中设置默认应用。

## 🛠 开发

```bash
git clone https://github.com/SirKayZh/markpad.git
cd markpad
npm install
npm start
```

### 打包 DMG

```bash
npm run dmg            # 仅打包当前版本，输出到 release/
npm run release:patch # bug 修复：bump 版本 + 打包 + 提交 + 打 tag
npm run release:minor # 新增功能
npm run release:major # 破坏性改动
```

> 注意：在 Apple 芯片上，`electron-builder` 内部的 `hdiutil` 打 DMG 步骤可能因 macOS 沙箱限制（自动挂载卷）失败。本项目的打包脚本改用 `hdiutil makehybrid` + `convert` 绕开该限制。

## ⌨️ 快捷键

| 操作 | 快捷键 |
| --- | --- |
| 新建 | ⌘N |
| 打开 | ⌘O |
| 保存 | ⌘S |
| 另存为 | ⌘⇧S |
| 切换大纲 | ⌘\ |
| 切换主题（亮 → 暗 → 跟随系统） | ⌘/ |

## 🧱 技术栈

- **[Electron](https://www.electronjs.org/) 31** —— 桌面外壳
- **[Vditor](https://github.com/Vanessa219/vditor) 3** —— Markdown IR（即时渲染）引擎
- 主进程 `main.js`（菜单 / 文件 IO）+ `preload.js`（安全的 contextBridge IPC）+ `src/`（界面）

## 🤝 参与贡献

欢迎提交 Issue 和 PR！路线图设想：

- [ ] 图片粘贴与上传
- [ ] 多标签页
- [ ] 源码/预览分栏
- [ ] 自定义 CSS 主题

## 📄 许可证

[MIT](LICENSE) © 2026 MarkPad Contributors
