# MarkMate v2.2.2

这一版让 Linux 能下载、能打开，并修了 Windows 安装包一点就退出，以及写文档时会碰到的几件事。

## Linux

- 正式提供 AppImage、deb，以及没装 FUSE 时用的 `.run`
- Ubuntu 24.04 一类系统上可以直接打开，不用再手动加参数
- 从文件管理器双击 Markdown，会在 MarkMate 里打开
- 菜单里补了「退出」

## Windows

- 安装包不再一启动就崩溃。以前给当前用户找安装目录时把内存读穿了
- 快捷键提示显示 `Ctrl+F`，不再黏成 `CtrlF`
- 便携版检查到新版本时去下载页，不会下载安装包再弹出安装程序
- 笔记放在盘符根目录时，「当前文件夹」能列出这个盘里的文件

## 写作

- 比窗口高的文档可以导出一整张长图
- 超过 512KB 的 Markdown 改为纯文本打开，不再一打开就卡死
- `Ctrl+W` 只关当前标签，关窗口改成 `Ctrl+Shift+W`
- 文件在编辑器外面被改过时，再保存会停下来问你，不再悄悄盖掉

---

- ⬆️ Windows 安装版和 Linux AppImage 会提示更新。macOS 和 Windows 便携版请到[下载页](https://sirkayzh.github.io/markmate/download.html)自行下载
- 📖 历史版本改动见 [CHANGELOG](https://github.com/SirKayZh/markmate/blob/main/CHANGELOG.md)
