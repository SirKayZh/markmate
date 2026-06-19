# MarkPad ⚡

> A lightweight, distraction-free Markdown editor for **macOS & Windows** — WYSIWYG editing meets powerful navigation and never-lose-your-work safety.
>
> 一款轻快专注的 **macOS / Windows** Markdown 编辑器 — 所见即所得 + 强大导航 + 永不丢稿。

![platform](https://img.shields.io/badge/platform-macOS%20|%20Windows-blue)
![electron](https://img.shields.io/badge/Electron-31-47848F?logo=electron)
![license](https://img.shields.io/badge/license-MIT-green)

**English** · [简体中文](README.zh-CN.md)

<p align="center">
  <img src="build/preview-icon.png" width="128" alt="MarkPad icon">
</p>

---

## ✨ Features

### ✍️ Writing Experience

- **WYSIWYG editing** — type Markdown, see it rendered instantly (Vditor IR mode, just like Typora)
- **Focus mode** (⌘⇧F) — dims everything except the current paragraph, zero distractions
- **Typewriter mode** (⌘⇧T) — keeps the cursor vertically centered for long writing sessions
- **Rich content** — headings, bold/italic/strikethrough/highlight, lists, blockquotes, tables, code with line numbers, KaTeX math, task lists, footnotes, auto-generated `[toc]`

### 🧭 Navigation & File Management

- **Outline tree** (⌘\) — multi-level collapsible sidebar with persistent fold state; click any heading to jump with visual feedback (toast + flash highlight)
- **File manager panel** — three zones in one sidebar: ⭐ Favorites · 🕐 Recent (up to 10) · 📂 Current Folder; collapsible sections with keyword search
- **Quick Open** (⌘P) — fuzzy-search across favorites & recent files; keyboard-navigable results
- **Favorites** (⌘D) — star frequently-used files for instant access; one-click toggle
- **Document search** (⌘F) — find in document with real-time highlighting, prev/next navigation, match counter

### 🛡️ Never Lose Your Work

- **Auto-save** — saves to disk 1.5 s after you stop typing; status bar shows timestamp
- **Version history** — each auto-save creates a snapshot (up to 10 per file); browse, preview, restore, or copy any version
- **Draft recovery** — unsaved documents are backed up as drafts; next launch shows a recovery banner
- **Close confirmation** — native macOS dialog when closing with unsaved changes (Save / Don't Save / Cancel)

### 🎨 Themes & Layout

- **Appearance mode** — Light · Dark · Follow System (⌘/ cycles); syncs with macOS in real time
- **5 style presets** — Default · GitHub · Night · Sepia (warm paper) · Slate (⌘⇧/ cycles); each auto-adjusts the light/dark base
- **Three-column layout** — Outline ↔ Editor ↔ Source; drag any divider to resize
- **Source panel** (⌘E) — side-by-side rendered view + raw Markdown with bidirectional sync; edit either side

### 🖼️ Images & Extended Syntax

- **Image drag & paste** — drop or paste images into the editor; they auto-save to an `assets/` folder beside your document
- **Reveal images folder** — File → Show Images Folder in Finder
- **Extended Markdown** — `==highlight==` · `[^1]` footnotes · `[toc]` directory · CJK auto-spacing · term auto-correction
- **Code line numbers** — syntax-highlighted code blocks show line numbers on the left

### 💻 Lightweight Code & Config Viewer (v1.5.0+)

- **JSON / XML / YAML / JSONL** — open these files directly in MarkPad as a lightweight viewer/editor
- **Syntax highlighting** — Prism.js-powered highlighting with dual light/dark theme color schemes
- **One-click format** — ⌥⌘L to beautify JSON/JSONL/XML; dedicated toolbar button with disabled gray-out hints
- **File type icons** — sidebar shows distinct emoji badges per format (📝 .md · 📊 .json · 📋 .xml · ⚙️ .yml/.yaml)
- **Outline auto-clears** — when viewing code/config files, the outline panel shows a context-aware message
- **No overhead** — code files stay as plain `.json` / `.xml` / `.yaml` on disk; no extra markers or metadata

### 📤 Multi-format Export (v1.4.0+)

- **PDF** (⌘⇧P) — page-break friendly, zero extra dependencies (uses Electron's built-in `printToPDF`)
- **HTML** — single-file with full styling, perfect for email or upload
- **Word (.docx)** — opens natively in Word/Pages/WPS
- **Long image (PNG)** — 2x DPI snapshot, ideal for social sharing
- All formats preserve fonts, code blocks, tables, blockquotes and responsive images

### 🍎 macOS Integration (also runs on Windows)

- **Drag & drop to open** — drag `.md` files onto the window, Dock icon, or even onto a closed app
- **File association** — registered handler for `.md` `.markdown` `.mdown` `.mkd` `.mdtext` `.txt` `.xml` `.json` `.jsonl` `.yml` `.yaml`; set MarkPad as your default editor in Finder
- **Native feel** — inset traffic lights, document-dirty dot, recent files menu, word count in status bar
- **Privacy-aware** — won't trigger macOS "access Desktop/Downloads" permission dialogs on first use

---

## 📦 Install

Download the latest release from the [Releases](https://github.com/SirKayZh/markpad/releases) page:

**macOS:**
- Apple Silicon (M1/M2/M3/M4…): `MarkPad-1.6.0-arm64.dmg`
- Intel: `MarkPad-1.6.0-x64.dmg`

**Windows:**
- `MarkPad-1.6.0-x64-setup.exe` — NSIS installer (recommended)
- `MarkPad-1.6.0-x64-portable.exe` — standalone, no install needed

> The app is **not code-signed / notarized** on either platform.
>
> **macOS**: right-click app → **Open**, or run `xattr -cr /Applications/MarkPad.app`
>
> **Windows**: click **More info** → **Run anyway** when SmartScreen prompts

### Set as Default Editor

**macOS:** right-click any `.md` file in Finder → **Open With** → choose **MarkPad**. To make it permanent, select **Always Open With** or set it in **Get Info**.

**Windows:** right-click any `.md` file → **Open with** → choose **MarkPad** → **Always use this app**.

MarkPad also natively opens `.txt` files.

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
git clone https://github.com/SirKayZh/markpad.git
cd markpad
npm install
npm start            # launch dev
MARKPAD_DEBUG=1 npm start  # with DevTools
```

### Build

```bash
npm run dmg            # build macOS DMG → release/
npm run win            # build Windows (NSIS + portable) → release/
npm run release:patch  # bump patch + build + commit + tag
npm run release:minor  # bump minor + build + commit + tag
npm run release:major  # bump major + build + commit + tag
```

> **macOS note**: on Apple Silicon, `electron-builder`'s internal `hdiutil` DMG step may fail due to macOS sandbox restrictions on auto-mounting volumes. The project's build script uses `hdiutil makehybrid` + `convert` as a workaround. Windows builds work cross-platform from macOS (electron-builder auto-downloads Wine + NSIS).

---

## 🧱 Tech Stack

- **[Electron](https://www.electronjs.org/) 31** — cross-platform desktop shell (macOS + Windows)
- **[Vditor](https://github.com/Vanessa219/vditor) 3** — Markdown IR (instant rendering) engine
- Main process `main.js` (menu / file IO / auto-save / version snapshots) + `preload.js` (secure contextBridge IPC) + `src/` (UI)

---

## 🤝 Contributing

Issues and PRs are welcome! Ideas for the roadmap:

- [ ] Multiple tabs / windows
- [ ] Custom CSS themes
- [x] PDF / HTML / Word / Long image export (v1.4.0)
- [x] Windows support (v1.4.1)
- [x] Code / config file viewer with syntax highlighting (v1.5.0)
- [ ] Vim key bindings

---

## 📄 License

[MIT](LICENSE) © 2026 MarkPad Contributors
