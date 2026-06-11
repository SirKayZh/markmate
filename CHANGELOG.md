# 更新日志 / Changelog

本项目遵循[语义化版本 SemVer](https://semver.org/lang/zh-CN/)。

版本号规则：`主版本.次版本.修订号`
- **修订号（patch）**：bug 修复，向下兼容 — `npm run release:patch`
- **次版本（minor）**：新增功能，向下兼容 — `npm run release:minor`
- **主版本（major）**：破坏性改动 — `npm run release:major`

---

## [1.0.1] - 2026-06-11

### 修复 Fixed
- 修复打开本地 `.md` 文件后编辑区一片空白的问题。根因是打开文件时通过 `vditor.destroy()` + `new Vditor()` 重建实例，而 Vditor 初始化是异步的，销毁旧实例会打断新实例渲染，导致内容已写入（`getValue()` 有值）但 DOM 不显示。改用 `setValue()` 更新内容，并引入 `vditorReady`/`pendingValue` 处理初始化期间的打开请求。

## [1.0.0] - 2026-06-11

### 新增 Added
- 首个版本：类 Typora 的所见即所得 Markdown 编辑器（Electron + Vditor）。
- 支持打开/新建/保存本地 Markdown 文件、大纲侧栏、字数统计、明暗主题。
- 提供 macOS arm64 / x64 双架构 DMG 安装包。
