# MarkMate ⚡

> **Your AI files deserve better than a text editor.** MarkMate is the **LLM-era file workbench** — one clean desktop app that handles the three files you touch every day: **Markdown** (specs, docs, prompts), **JSON** (configs, outputs), and **JSONL** (datasets, logs). WYSIWYG editing, conversation bubble browsing, one-click formatting, batch annotation, and multi-format export — all in a beautiful, local-first UI. macOS & Windows.
>
> **你的 AI 文件，不该只用文本编辑器打开。** MarkMate 是为大模型工作流量身打造的桌面文件编辑器。一个应用打通 MD 写作、JSONL 数据浏览、JSON 修复、数据标注、多格式导出全链路。

![platform](https://img.shields.io/badge/platform-macOS%20|%20Windows-blue)
![electron](https://img.shields.io/badge/Electron-31-47848F?logo=electron)
![license](https://img.shields.io/badge/license-MIT-green)
![release](https://img.shields.io/badge/release-v2.0.0-3b82f6)

**English** · [简体中文](README.zh-CN.md) · [🌐 Documentation](https://sirkyzh.github.io/markmate)

<p align="center">
  <img src="build/preview-icon.png" width="128" alt="MarkMate icon">
</p>

<p align="center">
  <a href="https://github.com/SirKayZh/markmate/releases"><img src="https://img.shields.io/badge/⬇️_Download-Latest_Release-3b82f6?style=for-the-badge" alt="Download"></a>
  &nbsp;
  <a href="https://github.com/SirKayZh/markmate/issues/new"><img src="https://img.shields.io/badge/🐛_Report_Bug-gray?style=for-the-badge" alt="Report Bug"></a>
  &nbsp;
  <a href="https://sirkyzh.github.io/markmate/feedback"><img src="https://img.shields.io/badge/📝_Feedback_Survey-gray?style=for-the-badge" alt="Feedback"></a>
</p>

---

### 🎯 One Editor, Three File Types

<p align="center">
  <img src="build/screenshots/hero-macos-light.png" width="360" alt="MarkMate editing interface">&nbsp;
  <img src="build/screenshots/jsonl-conversation.png" width="360" alt="JSONL conversation bubble view">
</p>

<p align="center">
  <em>Write beautiful Markdown (left) · Browse JSONL datasets as chat bubbles (right)</em>
</p>

<p align="center">
  <img src="build/screenshots/json-syntax-error.png" width="360" alt="JSON parse error with line/column fix">&nbsp;
  <img src="build/screenshots/annotation-editing.png" width="360" alt="Batch annotation editing">
</p>

<p align="center">
  <em>Fix broken JSON with line/column pinpointing (left) · Batch-annotate training data inline (right)</em>
</p>

---

## ✨ Why MarkMate?

MarkMate is built for the **modern AI workflow**. You're not just writing docs anymore — you're browsing datasets, fixing broken JSON, annotating training data, and exporting results. Most tools force you to juggle 3–4 different apps. MarkMate puts it all in one place.

| | **MarkMate** | **Typora** | **VS Code** |
|---|:---:|:---:|:---:|
| **Price** | ✅ Free & Open Source | ❌ $14.99 | ✅ Free |
| **WYSIWYG Markdown** | ✅ Instant render | ✅ Instant render | ❌ Split preview |
| **macOS + Windows** | ✅ Both | ✅ Both | ✅ Both |
| **JSONL Dataset Viewer** | ✅ Chat bubbles + stats | ❌ None | ❌ |
| **JSON / YAML / XML Editor** | ✅ Syntax highlight + format | ❌ None | ✅ |
| **Batch Annotation** | ✅ Inline editing + batch save | ❌ None | ❌ |
| **PDF / HTML / Word / PNG Export** | ✅ One-click | ✅ | ❌ Plugins needed |
| **Version Snapshots** | ✅ 10 per file | ❌ None | ✅ (via Git) |
| **Built-in File Manager** | ✅ Favorites / Recent / Folder | ❌ None | ✅ Explorer |
| **Auto-update** | ✅ Built-in | ❌ | ❌ |
| **Privacy (local-first)** | ✅ No uploads | ✅ | ✅ |
| **Open Source** | ✅ MIT | ❌ Proprietary | ✅ MIT |
| **Startup Speed** | ✅ Fast | ✅ Fast | ❌ Slower |

---

## ✨ Features

### ✍️ Markdown Writing

- **WYSIWYG editing** — type Markdown, see it rendered instantly (Vditor IR mode, just like Typora)
- **Focus mode** (⌘⇧F) — dims everything except the current paragraph, zero distractions
- **Typewriter mode** (⌘⇧T) — keeps the cursor vertically centered for long writing sessions
- **Rich content** — headings, bold/italic/strikethrough/highlight, lists, blockquotes, tables, code with line numbers, KaTeX math, task lists, footnotes, auto-generated `[toc]`
- **5 style presets** — Default · GitHub · Night · Sepia (warm paper) · Slate (⌘⇧/ cycles); auto-adjusts light/dark base
- **Three-column layout** — Outline ↔ Editor ↔ Source; drag any divider to resize
- **Source panel** (⌘E) — side-by-side rendered view + raw Markdown with **bidirectional scroll sync**
- **Outline tree** (⌘\) — collapsible heading tree with auto-highlight as you scroll; click to jump with toast + flash feedback

### 📂 File Management

- **File manager panel** — ⭐ Favorites · 🕐 Recent (up to 10) · 📂 Current Folder; collapsible sections with keyword search
- **Quick Open** (⌘P) — fuzzy-search across favorites & recent files
- **Favorites** (⌘D) — star frequently-used files; one-click toggle
- **Smart folder listing** — sidebar shows all files (not just `.md`); right-click folder to open in Finder
- **Document search** (⌘F) — real-time highlighting, prev/next navigation, match counter

<p align="center">
  <img src="build/screenshots/file-manager.png" width="720" alt="File manager sidebar with favorites, recent files, and current folder">
</p>

### 🧠 JSONL Dataset Viewer & Editor

- **Conversation bubble rendering** — auto-detects OpenAI Messages, Alpaca, ShareGPT formats; role-colored bubbles (`system` gray · `user` blue · `assistant` green · `tool` yellow)
- **Dataset statistics** — turn count, role distribution, token estimation at a glance
- **Inline annotation editing** — click any bubble to edit; changed rows marked with yellow badge; batch-save all edits with one click
- **Save & next page** — finish editing one page, save and auto-advance; ideal for batch annotation workflows
- **JSON parse errors with line/column** — broken JSON shows red error banner with exact location; one-click jump to fix

### 💻 JSON / YAML / XML Viewer & Editor

- **Syntax highlighting** — Prism.js-powered with dual light/dark theme color schemes
- **One-click format** — ⌥⌘L to beautify JSON/JSONL/XML
- **File type icons** — distinct emoji badges per format (📝 .md · 📊 .json · 📋 .xml · ⚙️ .yml/.yaml)
- **Zero overhead** — files stay as plain `.json` / `.xml` / `.yaml` on disk; no extra metadata

<p align="center">
  <img src="build/screenshots/json-viewer.png" width="720" alt="JSON viewer with Prism syntax highlighting">
</p>

### 🛡️ Never Lose Your Work

- **Auto-save** — saves to disk 1.5 s after you stop typing; status bar shows timestamp
- **Version history** — up to 10 snapshots per file; browse, preview, restore, or copy any version
- **Draft recovery** — unsaved documents backed up; recovery banner on next launch
- **Close confirmation** — native dialog when closing with unsaved changes

<p align="center">
  <img src="build/screenshots/version-history.png" width="720" alt="Version history dialog with timeline and preview">
</p>

### 📤 Multi-format Export

- **PDF** (⌘⇧P) — page-break friendly, zero extra dependencies
- **HTML** — single-file with full styling
- **Word (.docx)** — opens natively in Word/Pages/WPS
- **Long image (PNG)** — 2x DPI snapshot for social sharing

<p align="center">
  <img src="build/screenshots/export-formats.png" width="720" alt="Export to PDF/HTML/Word/PNG">
</p>

### 🍎 macOS Integration (also runs on Windows)

- **Drag & drop to open** — drag files onto the window, Dock icon, or closed app
- **File association** — registered handler for `.md` `.json` `.jsonl` `.yml` `.yaml` `.xml` `.txt`; set as default in Finder
- **Native feel** — inset traffic lights, document-dirty dot, recent files menu, word count in status bar
- **Auto-update** — built-in version check via GitHub Releases; one-click download + restart (v2.0.0+)

---

## 📦 Install

Download from [Releases](https://github.com/SirKayZh/markmate/releases):

**macOS:**
- Apple Silicon (M1/M2/M3/M4…): `MarkMate-2.0.0-arm64.dmg`
- Intel: `MarkMate-2.0.0-x64.dmg`

**Windows:**
- `MarkMate-2.0.0-x64-setup.exe` — NSIS installer (recommended)
- `MarkMate-2.0.0-x64-portable.exe` — standalone, no install needed

> The app is **not code-signed / notarized** on either platform.
>
> **macOS**: right-click app → **Open**, or run `xattr -cr /Applications/MarkMate.app`
>
> **Windows**: click **More info** → **Run anyway** when SmartScreen prompts

### Set as Default Editor

**macOS:** right-click `.md` → **Open With** → **MarkMate** → **Always Open With**.

**Windows:** right-click `.md` → **Open with** → **MarkMate** → **Always use this app**.

---

## ⌨️ Keyboard Shortcuts

| Action | macOS | Windows |
| --- | --- | --- |
| New | ⌘N | Ctrl+N |
| Open | ⌘O | Ctrl+O |
| Quick Open | ⌘P | Ctrl+P |
| Save | ⌘S | Ctrl+S |
| Save As | ⌘⇧S | Ctrl+⇧S |
| Toggle Favorite | ⌘D | Ctrl+D |
| Find in Document | ⌘F | Ctrl+F |
| Toggle Outline | ⌘\ | Ctrl+\ |
| Toggle Source Panel | ⌘E | Ctrl+E |
| Focus Mode | ⌘⇧F | Ctrl+⇧F |
| Typewriter Mode | ⌘⇧T | Ctrl+⇧T |
| Export PDF | ⌘⇧P | Ctrl+⇧P |
| Cycle Appearance | ⌘/ | Ctrl+/ |
| Cycle Style Theme | ⌘⇧/ | Ctrl+⇧/ |

---

## 🛠 Development

```bash
git clone https://github.com/SirKayZh/markmate.git
cd markmate
npm install
npm start            # launch dev
MARKMATE_DEBUG=1 npm start  # with DevTools
```

### Build

```bash
npm run dmg            # build macOS DMG → release/
npm run win            # build Windows (NSIS + portable) → release/
npm run release:patch  # bump patch + build + commit + tag
npm run release:minor  # bump minor + build + commit + tag
npm run release:major  # bump major + build + commit + tag
```

> **macOS note**: on Apple Silicon, `electron-builder`'s internal `hdiutil` DMG step may fail due to macOS sandbox restrictions. The project's build script uses `hdiutil makehybrid` + `convert` as a workaround. Windows builds work cross-platform from macOS (electron-builder auto-downloads Wine + NSIS).

---

## 🧱 Tech Stack

- **[Electron](https://www.electronjs.org/) 31** — cross-platform desktop shell (macOS + Windows)
- **[Vditor](https://github.com/Vanessa219/vditor) 3** — Markdown IR (instant rendering) engine
- `main.js` (menu / file IO / auto-save / version snapshots) + `preload.js` (contextBridge IPC) + `src/` (UI)

---

## 🔒 Privacy

MarkMate is **local-first** — your documents never leave your computer.

- No document content is ever uploaded to any server.
- No telemetry, no analytics, no tracking in the current version.
- Future versions may offer **opt-in** anonymous usage stats with a clear consent dialog.
- Full privacy policy: [sirkyzh.github.io/markmate/privacy](https://sirkyzh.github.io/markmate/privacy)

## 💬 Feedback & Community

- 🐛 [Report a bug / Request a feature](https://github.com/SirKayZh/markmate/issues/new)
- 📝 [Fill out the feedback survey](https://sirkyzh.github.io/markmate/feedback)
- 💡 [Join the discussion](https://github.com/SirKayZh/markmate/discussions)
- 🌐 [Visit documentation site](https://sirkyzh.github.io/markmate)

---

## 🤝 Contributing

Issues and PRs are welcome! Ideas for the roadmap:

- [x] Multiple tabs / windows (v1.6.0)
- [ ] Custom CSS themes
- [x] PDF / HTML / Word / Long image export (v1.4.0)
- [x] Windows support (v1.4.1)
- [x] Code / config file viewer with syntax highlighting (v1.5.0)
- [x] JSONL dataset viewer with conversation bubbles (v2.0.0)
- [x] Inline annotation editing for JSONL datasets (v2.0.0)
- [x] Auto-update via GitHub Releases (v2.0.0)
- [ ] Vim key bindings

---

## 📄 License

[MIT](LICENSE) © 2026 MarkMate Contributors
