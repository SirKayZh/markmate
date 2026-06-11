# MarkPad ⚡

> A Typora-like WYSIWYG Markdown editor for macOS — built with Electron + Vditor.
>
> 一款类 Typora 的 macOS 所见即所得 Markdown 编辑器。

![platform](https://img.shields.io/badge/platform-macOS-blue)
![electron](https://img.shields.io/badge/Electron-31-47848F?logo=electron)
![license](https://img.shields.io/badge/license-MIT-green)

<p align="center">
  <img src="build/preview-icon.png" width="128" alt="MarkPad icon">
</p>

## ✨ Features

- **WYSIWYG editing** — type Markdown and see it rendered instantly (IR mode, just like Typora)
- **Rich content** — headings, bold/italic, lists, blockquotes, tables, code highlighting, KaTeX math, task lists
- **Outline navigation** — togglable sidebar (⌘\), click to jump to any heading
- **Light / Dark theme** — switch instantly (⌘/)
- **File operations** — New ⌘N · Open ⌘O · Save ⌘S · Save As ⌘⇧S
- **Export to HTML** — File → Export HTML
- **Native macOS feel** — inset traffic lights, document dirty indicator, recent files, word count in the status bar

## 📦 Install

Download the latest `.dmg` from the [Releases](https://github.com/SirKayZh/markpad/releases) page:

- Apple Silicon (M1/M2/M3…): `MarkPad-1.0.0-arm64.dmg`
- Intel: `MarkPad-1.0.0-x64.dmg`

> The app is **not code-signed/notarized**. On first launch, right-click the app → **Open**, or run:
> ```bash
> xattr -cr /Applications/MarkPad.app
> ```

## 🛠 Development

```bash
git clone https://github.com/SirKayZh/markpad.git
cd markpad
npm install
npm start
```

### Build DMG

```bash
npm run dist        # produces .app under release/
```

> Note: on Apple Silicon, `electron-builder`'s internal `hdiutil` DMG step may fail due to macOS sandbox restrictions on auto-mounting volumes. If so, package the `.app` into a DMG manually:
> ```bash
> cd release && mkdir stage && cp -R mac-arm64/MarkPad.app stage/ && ln -s /Applications stage/Applications
> hdiutil makehybrid -hfs -hfs-volume-name "MarkPad" -o tmp.dmg stage
> hdiutil convert tmp.dmg -format UDZO -o MarkPad-1.0.0-arm64.dmg && rm tmp.dmg
> ```

## ⌨️ Shortcuts

| Action | Shortcut |
| --- | --- |
| New | ⌘N |
| Open | ⌘O |
| Save | ⌘S |
| Save As | ⌘⇧S |
| Toggle outline | ⌘\ |
| Toggle theme | ⌘/ |

## 🧱 Tech Stack

- **[Electron](https://www.electronjs.org/) 31** — desktop shell
- **[Vditor](https://github.com/Vanessa219/vditor) 3** — Markdown IR (instant rendering) engine
- Main process `main.js` (menu / file IO) + `preload.js` (secure contextBridge IPC) + `src/` (UI)

## 🤝 Contributing

Issues and PRs are welcome! Ideas for the roadmap:

- [ ] Image paste & upload
- [ ] Multiple tabs
- [ ] Split-pane source/preview
- [ ] Custom CSS themes

## 📄 License

[MIT](LICENSE) © 2026 MarkPad Contributors
