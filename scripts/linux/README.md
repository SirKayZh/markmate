# Linux 测试方案

Mac 上测过的功能，发版前要在一台已经登录桌面的 Ubuntu 上再跑一遍。这套脚本就是干这件事的。

日常开发改完，跑受影响的那一组。准备上线，跑默认回归。大文件和 Wayland 不在默认里，上线前单独跑一次。

## 一条命令

在开发机（当前这台 Mac）上：

```bash
npm run linux:test
```

它会把源码同步到测试机，再跑默认回归。只要有失败，命令就不是成功退出。

只跑某一组：

```bash
bash scripts/linux/run.sh smoke          # 已经在测试机上
bash scripts/linux/remote.sh smoke       # 从开发机同步后再跑
bash scripts/linux/remote.sh safety export
bash scripts/linux/remote.sh all         # 含大文件和 Wayland
```

测试机地址默认是 `ubuntu@106.52.211.86`。换机器时：

```bash
LINUX_HOST=ubuntu@新地址 LINUX_SSH_KEY=~/.ssh/id_ed25519 bash scripts/linux/remote.sh
```

认证只用 SSH 公钥。脚本里没有密码。

## 测试机要具备

- 已经登录的图形桌面，屏幕是 `:0`。云主机如果控制台不在这个屏幕上，脚本会先 `sudo chvt 7`。
- 源码目录里执行过 `npm install`，能找到 `node_modules/electron`。同步源码不会覆盖 `node_modules`。
- `xdotool`。拖放还要 `python3` 和 GTK。中文输入要 `ibus-libpinyin`。没有这些时，对应项记为跳过，不把整次回归判失败。
- 装了 deb 才会多测「从安装包打开文件」。没装就跳过。源码回归不依赖安装包。

程序启动必须带 `--no-sandbox --disable-gpu`，并且去掉 `ELECTRON_RUN_AS_NODE`。这三件事脚本已经做了，手工启动时不要漏。

## 分组

| 分组 | 什么时候跑 | 覆盖 |
| --- | --- | --- |
| `smoke` | 改完就跑 | 打开文件、软件已开着再打开另一个、专注模式不被搜索抢走、自动保存后退出再开还在 |
| `safety` | 改保存、关闭、历史时 | 外部改过不自动覆盖、只读、没有写权限的目录、草稿、历史版本 |
| `export` | 改导出时 | Word、HTML、空白文档四种导出、宽代码长图 |
| `input` | 改编辑、拖放、快捷键时 | 粘贴图片、拖入文件、拖入图片、格式化、中文输入 |
| `desk` | 改界面、主题、安装包时 | 分隔条、跟随系统、检查更新、安装包打开文件 |
| `heavy` | 上线前 | 约 1.5MB 的 Markdown、大 JSONL、嵌套 Wayland |

不带参数时跑前五组，不跑 `heavy`。

结果写在测试机的 `/tmp/markmate-linux-test/results.txt`。每一行是 `PASS`、`FAIL` 或 `SKIP`。

- `PASS`：这项做到了。
- `FAIL`：这项没做到，要修，修完再跑这一组。
- `SKIP`：这台机器做不到（没装输入法、没装 weston、没装 deb）。不算通过，也不挡住别的项。换一台具备条件的机器再补。

## 新功能怎么加

1. 在 `suite.js` 里写一个函数，只测这一件事。
2. 放进上面的某一组。跟保存有关放 `safety`，跟导出有关放 `export`。
3. 用 `pass` / `fail` / `skip` 结束。不要只打日志。
4. 发版前把新功能和默认回归一起跑。

页面里能直接调用的是全局函数和 `window.markmate`。`let` 声明的变量从外面读不到。

按键用 `key('ctrl+s')`，字用 `typeInto('...')`。保存框用 `fillSave(绝对路径)`。这三步是在真实窗口上操作的。

## 已经踩过、脚本里避开的坑

- 搜索的按键监听会把 `Ctrl+Shift+F` 当成搜索。回归里有一条专门看专注模式打开时搜索框还关着。
- Linux 上格式化是 `Ctrl+Shift+L`。`Alt+Ctrl+L` 会被桌面拿去锁屏。
- 保存失败的窗口标题是「保存失败」。只读文件、没有写权限的目录，都要看到这个窗口，并且磁盘上的原文不动。
- Word 的正文在压缩包里的 `word/afchunk.mht`，不在 `word/document.xml`。
- 空白文档导出长图时，正文是空的。空字符串是正常结果，不是超时。
- 超过约 512KB 的 Markdown 用纯文本打开。大文件这条要看到纯文本，并且能滚到结尾标记。
- 点编辑器要用页面里的坐标。用窗口左上角当原点会点到标题栏，字进不去。
- 从文件管理器拖图标，自动操作拉不起来。拖放用同目录的 `drag-src.py` 发真实拖拽。
- `xclip` 贴图片时不能等它退出，它会一直占着剪贴板。
- 切拼音输入法时，`ibus engine libpinyin` 可能返回失败，但当前引擎已经是它。要再查一次当前引擎。
- 跟随系统会改这台机器的主题，测完必须改回去。脚本用 `finally` 做了。
- 查进程要用完整命令行。被截断的进程列表会漏掉正在跑的程序，下一轮连到旧窗口上。

## 这台机器上仍然做不到的

- 没有系统浏览器，所以只检查导出的 HTML 文件，不在浏览器里打开。
- 不在文件管理器里模拟真双击。已安装 deb 时，用安装包直接打开文件来代替。
- Wayland 不是一套独立桌面。`heavy` 里是在当前桌面嵌一个 Weston，看程序能不能留下。
