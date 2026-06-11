const { app, BrowserWindow, Menu, dialog, ipcMain, shell, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow = null;
// 记录每个窗口当前打开的文件路径
let currentFilePath = null;
// 当前是否脏（渲染层告知，主进程缓存一份供关闭确认使用）
let currentDirty = false;
// 冷启动时（窗口/渲染进程尚未就绪）通过 open-file / 命令行传入的待打开文件
let pendingOpenPath = null;
// 渲染进程是否已准备好接收 file-opened
let rendererReady = false;
// 关闭流程状态：是否已经被用户/渲染层确认可放行
let allowClose = false;
// 是否正在等待渲染层回复
let closingInProgress = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 600,
    minHeight: 400,
    titleBarStyle: 'hiddenInset', // macOS 风格：红绿灯按钮内嵌
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
    rendererReady = false;
    allowClose = false;
    closingInProgress = false;
  });

  // 拦截关闭：未保存时让渲染层走一遍确认流程
  mainWindow.on('close', (e) => {
    if (allowClose) return;          // 已经确认过，放行
    if (!currentDirty) return;       // 没有未保存改动，放行
    if (closingInProgress) {         // 正在等回复，避免重复弹
      e.preventDefault();
      return;
    }
    e.preventDefault();
    closingInProgress = true;
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send('confirm-close');
    } else {
      // 渲染层不可用，安全起见放行
      allowClose = true;
      closingInProgress = false;
      mainWindow && mainWindow.close();
    }
  });
}

// ============ 文件操作辅助 ============
function setTitle(filePath, dirty) {
  if (!mainWindow) return;
  const name = filePath ? path.basename(filePath) : '未命名';
  mainWindow.setTitle(`${dirty ? '• ' : ''}${name} — MarkPad`);
  mainWindow.setRepresentedFilename(filePath || '');
  mainWindow.setDocumentEdited(!!dirty);
}

async function doOpen() {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'txt'] },
      { name: '所有文件', extensions: ['*'] }
    ]
  });
  if (canceled || !filePaths.length) return;
  openFile(filePaths[0]);
}

// 统一的打开文件入口：菜单打开、拖拽、Dock、命令行都走这里
function openFile(fp) {
  if (!fp) return;
  // 窗口/渲染进程还没就绪：先记下，待 renderer-ready 后再打开（解决冷启动拖入丢失）
  if (!mainWindow || !rendererReady) {
    pendingOpenPath = fp;
    // app 尚未 ready 时不能建窗口（macOS open-file 可能早于 ready 触发），交给 whenReady 处理
    if (!mainWindow && app.isReady()) createWindow();
    return;
  }
  try {
    const content = fs.readFileSync(fp, 'utf-8');
    currentFilePath = fp;
    setTitle(fp, false);
    mainWindow.webContents.send('file-opened', { path: fp, content });
    app.addRecentDocument(fp);
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  } catch (err) {
    dialog.showErrorBox('打开失败', String(err));
  }
}

function writeFile(fp, content) {
  fs.writeFileSync(fp, content, 'utf-8');
  currentFilePath = fp;
  setTitle(fp, false);
  app.addRecentDocument(fp);
}

async function doSave() {
  // 向渲染进程请求当前内容
  mainWindow.webContents.send('request-save', { saveAs: false });
}

async function doSaveAs() {
  mainWindow.webContents.send('request-save', { saveAs: true });
}

// 渲染进程把内容回传，主进程真正写盘
ipcMain.handle('save-content', async (event, { content, saveAs }) => {
  let fp = currentFilePath;
  if (saveAs || !fp) {
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      defaultPath: fp || '未命名.md',
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    });
    if (canceled || !filePath) return { saved: false };
    fp = filePath;
  }
  try {
    writeFile(fp, content);
    return { saved: true, path: fp };
  } catch (err) {
    dialog.showErrorBox('保存失败', String(err));
    return { saved: false };
  }
});

// 渲染进程通知脏状态
ipcMain.on('set-dirty', (event, dirty) => {
  currentDirty = !!dirty;
  setTitle(currentFilePath, currentDirty);
});

// 关闭确认：弹原生对话框，返回用户选择
ipcMain.handle('ask-close-confirm', async () => {
  if (!mainWindow) return 'cancel';
  const name = currentFilePath ? path.basename(currentFilePath) : '未命名';
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    buttons: ['保存', '不保存', '取消'],
    defaultId: 0,
    cancelId: 2,
    title: '未保存的更改',
    message: `“${name}” 有尚未保存的更改`,
    detail: '关闭前是否要保存？'
  });
  if (response === 0) return 'save';
  if (response === 1) return 'discard';
  return 'cancel';
});

// 渲染层告知关闭流程的最终决定
ipcMain.on('confirm-close-reply', (event, payload) => {
  const action = payload && payload.action;
  closingInProgress = false;
  if (action === 'discard') {
    allowClose = true;
    if (mainWindow) mainWindow.close();
  } else {
    // cancel：保持窗口
    allowClose = false;
  }
});

// 新建
function doNew() {
  currentFilePath = null;
  setTitle(null, false);
  mainWindow.webContents.send('file-new');
}

// 导出 HTML
ipcMain.handle('export-html', async (event, { html }) => {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    defaultPath: (currentFilePath ? path.basename(currentFilePath, path.extname(currentFilePath)) : '未命名') + '.html',
    filters: [{ name: 'HTML', extensions: ['html'] }]
  });
  if (canceled || !filePath) return { saved: false };
  const full = `<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><title>${path.basename(filePath)}</title>
<style>body{max-width:800px;margin:40px auto;padding:0 20px;font-family:-apple-system,'PingFang SC',sans-serif;line-height:1.7;color:#333}pre{background:#f6f8fa;padding:12px;border-radius:6px;overflow:auto}code{background:#f0f0f0;padding:2px 4px;border-radius:3px}table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:6px 12px}blockquote{border-left:4px solid #ddd;margin:0;padding-left:16px;color:#666}img{max-width:100%}</style></head><body>${html}</body></html>`;
  fs.writeFileSync(filePath, full, 'utf-8');
  return { saved: true, path: filePath };
});

// ============ 菜单 ============
function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about', label: '关于 MarkPad' },
        { type: 'separator' },
        { role: 'hide', label: '隐藏 MarkPad' },
        { role: 'hideOthers', label: '隐藏其他' },
        { role: 'unhide', label: '全部显示' },
        { type: 'separator' },
        { role: 'quit', label: '退出 MarkPad' }
      ]
    }] : []),
    {
      label: '文件',
      submenu: [
        { label: '新建', accelerator: 'CmdOrCtrl+N', click: doNew },
        { label: '打开…', accelerator: 'CmdOrCtrl+O', click: doOpen },
        { type: 'separator' },
        { label: '保存', accelerator: 'CmdOrCtrl+S', click: doSave },
        { label: '另存为…', accelerator: 'CmdOrCtrl+Shift+S', click: doSaveAs },
        { type: 'separator' },
        { label: '导出 HTML…', click: () => mainWindow.webContents.send('request-export-html') }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' }
      ]
    },
    {
      label: '视图',
      submenu: [
        { label: '切换大纲', accelerator: 'CmdOrCtrl+\\', click: () => mainWindow.webContents.send('toggle-outline') },
        { label: '切换源码面板', accelerator: 'CmdOrCtrl+E', click: () => mainWindow.webContents.send('toggle-source') },
        {
          label: '主题',
          submenu: [
            { label: '亮色', type: 'radio', click: () => mainWindow.webContents.send('set-theme', 'light') },
            { label: '暗色', type: 'radio', click: () => mainWindow.webContents.send('set-theme', 'dark') },
            { label: '跟随系统', type: 'radio', click: () => mainWindow.webContents.send('set-theme', 'system') }
          ]
        },
        { label: '切换亮/暗', accelerator: 'CmdOrCtrl+/', click: () => mainWindow.webContents.send('toggle-theme') },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
        { role: 'toggleDevTools', label: '开发者工具' }
      ]
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'zoom', label: '缩放' },
        { role: 'close', label: '关闭窗口' }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// 打开最近文件（macOS Dock 拖拽到图标、Finder 双击、"打开方式"）
app.on('open-file', (event, fp) => {
  event.preventDefault();
  openFile(fp);
});

// 渲染进程把窗口内拖入的文件路径回传，主进程读取内容并打开
ipcMain.on('open-dropped-file', (event, fp) => {
  openFile(fp);
});

// 渲染进程初始化完成，可接收 file-opened；若有挂起的待打开文件，此时投递
ipcMain.on('renderer-ready', () => {
  rendererReady = true;
  if (pendingOpenPath) {
    const fp = pendingOpenPath;
    pendingOpenPath = null;
    openFile(fp);
  }
});

// 主题持久化：渲染进程通知当前是否暗色，主进程同步原生 vibrancy/背景与窗口外观
ipcMain.on('set-native-theme', (event, mode) => {
  // mode: 'light' | 'dark' | 'system'
  if (mode === 'light' || mode === 'dark' || mode === 'system') {
    nativeTheme.themeSource = mode;
  }
});

// 从命令行参数中提取可能的待打开文件（非 macOS 的 Finder/资源管理器双击、"打开方式"）
function fileFromArgv(argv) {
  // 跳过可执行文件本身与 electron 的 flag 参数
  const args = argv.slice(app.isPackaged ? 1 : 2);
  for (const a of args) {
    if (a.startsWith('-')) continue;
    if (/\.(md|markdown|mdown|txt)$/i.test(a) && fs.existsSync(a)) return a;
  }
  return null;
}

app.whenReady().then(() => {
  createWindow();
  buildMenu();
  setTitle(null, false);

  // 冷启动命令行带文件（macOS 由 open-file 处理，这里兜底其它平台）
  const argFile = fileFromArgv(process.argv);
  if (argFile) pendingOpenPath = argFile;

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// 拦截退出：若窗口仍存在且脏，让 close 流程先走完
app.on('before-quit', (e) => {
  if (mainWindow && currentDirty && !allowClose) {
    e.preventDefault();
    // 触发窗口 close 流程，它会发 confirm-close 给渲染层
    mainWindow.close();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
