const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow = null;
// 记录每个窗口当前打开的文件路径
let currentFilePath = null;

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
  });

  // 拦截关闭：若有未保存内容，提示
  mainWindow.on('close', (e) => {
    // 关闭确认交由渲染进程处理（通过菜单/快捷键流程），这里保持简单
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
  const fp = filePaths[0];
  try {
    const content = fs.readFileSync(fp, 'utf-8');
    currentFilePath = fp;
    setTitle(fp, false);
    mainWindow.webContents.send('file-opened', { path: fp, content });
    app.addRecentDocument(fp);
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
  setTitle(currentFilePath, dirty);
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
        { label: '切换主题（亮/暗）', accelerator: 'CmdOrCtrl+/', click: () => mainWindow.webContents.send('toggle-theme') },
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

// 打开最近文件（macOS Dock）
app.on('open-file', (event, fp) => {
  event.preventDefault();
  if (mainWindow) {
    try {
      const content = fs.readFileSync(fp, 'utf-8');
      currentFilePath = fp;
      setTitle(fp, false);
      mainWindow.webContents.send('file-opened', { path: fp, content });
    } catch (e) {}
  }
});

app.whenReady().then(() => {
  createWindow();
  buildMenu();
  setTitle(null, false);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
