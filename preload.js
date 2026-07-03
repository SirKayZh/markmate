const { contextBridge, ipcRenderer, webUtils } = require('electron');

function pathForFile(file) {
  if (!file) return '';
  try {
    if (webUtils && typeof webUtils.getPathForFile === 'function') {
      const p = webUtils.getPathForFile(file);
      if (p) return p;
    }
  } catch (_) { /* ignore */ }
  return file.path || '';
}

contextBridge.exposeInMainWorld('markmate', {
  // 平台信息（供渲染层适配 macOS / Windows 差异）
  platform: process.platform,

  // 主进程 -> 渲染进程
  onFileOpened: (cb) => ipcRenderer.on('file-opened', (e, data) => cb(data)),
  onFileNew: (cb) => ipcRenderer.on('file-new', () => cb()),
  onRequestSave: (cb) => ipcRenderer.on('request-save', (e, data) => cb(data)),
  onToggleOutline: (cb) => ipcRenderer.on('toggle-outline', () => cb()),
  onToggleSource: (cb) => ipcRenderer.on('toggle-source', () => cb()),
  onToggleTheme: (cb) => ipcRenderer.on('toggle-theme', () => cb()),
  onSetTheme: (cb) => ipcRenderer.on('set-theme', (e, mode) => cb(mode)),
  onToggleFocusMode: (cb) => ipcRenderer.on('toggle-focus-mode', () => cb()),
  onToggleTypewriterMode: (cb) => ipcRenderer.on('toggle-typewriter-mode', () => cb()),
  onNextStyleTheme: (cb) => ipcRenderer.on('next-style-theme', () => cb()),
  onSetStyleTheme: (cb) => ipcRenderer.on('set-style-theme', (e, name) => cb(name)),
  onQuickOpen: (cb) => ipcRenderer.on('quick-open', () => cb()),
  onToggleFavorite: (cb) => ipcRenderer.on('toggle-favorite', () => cb()),
  onShowFind: (cb) => ipcRenderer.on('show-find', () => cb()),
  onShowVersions: (cb) => ipcRenderer.on('show-versions', () => cb()),
  onRequestExport: (cb) => ipcRenderer.on('request-export', (e, kind) => cb(kind)),
  onRequestExportHtml: (cb) => ipcRenderer.on('request-export', (e, kind) => { if (kind === 'html') cb(); }),
  onRevealAssetsDir: (cb) => ipcRenderer.on('reveal-assets-dir', () => cb()),
  onConfirmClose: (cb) => ipcRenderer.on('confirm-close', () => cb()),

  // 渲染进程 -> 主进程
  saveContent: (content, saveAs) => ipcRenderer.invoke('save-content', { content, saveAs }),
  saveTextAs: (content, defaultName, ext) => ipcRenderer.invoke('save-text-as', { content, defaultName, ext }),
  autoSave: (content) => ipcRenderer.invoke('auto-save', { content }),
  listVersions: (filePath) => ipcRenderer.invoke('list-versions', { filePath }),
  readVersion: (versionPath) => ipcRenderer.invoke('read-version', { versionPath }),
  checkDraft: () => ipcRenderer.invoke('check-draft'),
  discardDraft: (draftPath) => ipcRenderer.invoke('discard-draft', { draftPath }),
  exportHtml: (html) => ipcRenderer.invoke('export-html', { html }),
  exportPdf: (html) => ipcRenderer.invoke('export-pdf', { html }),
  exportDocx: async (blob) => {
    const buf = await blob.arrayBuffer();
    return ipcRenderer.invoke('export-docx', { buffer: Array.from(new Uint8Array(buf)) });
  },
  exportPng: (pixelRatio) => ipcRenderer.invoke('export-png', { pixelRatio }),
  onRequestPngHtml: (cb) => ipcRenderer.on('request-png-html', () => cb()),
  sendPngHtml: (html) => ipcRenderer.send('export-png-html', { html }),
  getExportResources: () => ipcRenderer.invoke('get-export-resources'),
  revealAssetsDir: () => ipcRenderer.invoke('reveal-assets-dir'),
  setDirty: (dirty) => ipcRenderer.send('set-dirty', dirty),
  openDroppedFile: (filePath) => ipcRenderer.send('open-dropped-file', filePath),
  openDroppedFileFromFile: (file) => {
    const p = pathForFile(file);
    if (p) ipcRenderer.send('open-dropped-file', p);
    return p;
  },
  rendererReady: () => ipcRenderer.send('renderer-ready'),
  setNativeTheme: (mode) => ipcRenderer.send('set-native-theme', mode),
  askCloseConfirm: () => ipcRenderer.invoke('ask-close-confirm'),
  askChatEditsConfirm: (count) => ipcRenderer.invoke('ask-chat-edits-confirm', { count }),
  confirmCloseReply: (payload) => ipcRenderer.send('confirm-close-reply', payload),
  confirmOverwrite: (message) => ipcRenderer.invoke('confirm-overwrite', { message }),
  saveUploadedImage: async (file) => {
    const buf = await file.arrayBuffer();
    return ipcRenderer.invoke('save-uploaded-image', {
      name: file.name, type: file.type, size: file.size,
      buffer: Array.from(new Uint8Array(buf))
    });
  },
  // 保存已有 buffer 数据的图片（由 openImageDialog 返回）
  saveImageFromBuffer: (name, type, size, buffer) => ipcRenderer.invoke('save-uploaded-image', { name, type, size, buffer }),
  openFileByPath: (fp) => ipcRenderer.send('open-dropped-file', fp),
  getRecentFiles: () => ipcRenderer.invoke('get-recent-files'),
  listDirectory: (dirPath) => ipcRenderer.invoke('list-directory', dirPath),
  formatCode: (content) => ipcRenderer.invoke('format-code', { content }),
  // Electron 原生图片选择对话框（替代浏览器 <input type="file">）
  openImageDialog: () => ipcRenderer.invoke('open-image-dialog'),

  // ---- 多 Tab / 多窗口 新增 IPC ----
  // 渲染层通知主进程：当前激活的 tab 变了
  tabActivated: (info) => ipcRenderer.send('tab-activated', info),
  // 渲染层请求：把当前 tab 移到新窗口
  openInNewWindow: (info) => ipcRenderer.send('open-in-new-window', info),
  // 主进程 -> 渲染层：新窗口收到初始内容
  onLoadInitialTab: (cb) => ipcRenderer.on('load-initial-tab', (e, data) => cb(data)),
  // 在文件夹中显示文件
  revealFileInFinder: (filePath) => ipcRenderer.send('reveal-file-in-finder', filePath),
  // 持久化数据：渲染进程同步到主进程 JSON 文件
  syncAppData: (key, items) => ipcRenderer.send('sync-app-data', { key, items }),
  // 持久化数据：渲染进程从主进程 JSON 文件读取
  readAppData: () => ipcRenderer.invoke('read-app-data'),
});
