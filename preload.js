const { contextBridge, ipcRenderer, webUtils } = require('electron');

// 兼容获取拖入文件的真实路径：
// Electron 32+ 已移除 File.path，需要走 webUtils.getPathForFile()。
// 这里做了兜底：优先用新 API，旧版本/异常时回退到 file.path。
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

contextBridge.exposeInMainWorld('markpad', {
  // 主进程 -> 渲染进程
  onFileOpened: (cb) => ipcRenderer.on('file-opened', (e, data) => cb(data)),
  onFileNew: (cb) => ipcRenderer.on('file-new', () => cb()),
  onRequestSave: (cb) => ipcRenderer.on('request-save', (e, data) => cb(data)),
  onToggleOutline: (cb) => ipcRenderer.on('toggle-outline', () => cb()),
  onToggleSource: (cb) => ipcRenderer.on('toggle-source', () => cb()),
  onToggleTheme: (cb) => ipcRenderer.on('toggle-theme', () => cb()),
  onSetTheme: (cb) => ipcRenderer.on('set-theme', (e, mode) => cb(mode)),
  // 专注模式 / 打字机模式 / 样式主题
  onToggleFocusMode: (cb) => ipcRenderer.on('toggle-focus-mode', () => cb()),
  onToggleTypewriterMode: (cb) => ipcRenderer.on('toggle-typewriter-mode', () => cb()),
  onNextStyleTheme: (cb) => ipcRenderer.on('next-style-theme', () => cb()),
  onSetStyleTheme: (cb) => ipcRenderer.on('set-style-theme', (e, name) => cb(name)),
  // 文件管理
  onQuickOpen: (cb) => ipcRenderer.on('quick-open', () => cb()),
  onToggleFavorite: (cb) => ipcRenderer.on('toggle-favorite', () => cb()),
  // 内容搜索 / 版本历史
  onShowFind: (cb) => ipcRenderer.on('show-find', () => cb()),
  onShowVersions: (cb) => ipcRenderer.on('show-versions', () => cb()),
  // 导出（统一入口：'pdf' | 'html' | 'docx' | 'png'）
  onRequestExport: (cb) => ipcRenderer.on('request-export', (e, kind) => cb(kind)),
  // 兼容旧入口（菜单还在用 onRequestExportHtml 的地方不会爆）
  onRequestExportHtml: (cb) => ipcRenderer.on('request-export', (e, kind) => { if (kind === 'html') cb(); }),
  onRevealAssetsDir: (cb) => ipcRenderer.on('reveal-assets-dir', () => cb()),
  // 关闭前主进程问询
  onConfirmClose: (cb) => ipcRenderer.on('confirm-close', () => cb()),

  // 渲染进程 -> 主进程
  saveContent: (content, saveAs) => ipcRenderer.invoke('save-content', { content, saveAs }),
  autoSave: (content) => ipcRenderer.invoke('auto-save', { content }),
  listVersions: (filePath) => ipcRenderer.invoke('list-versions', { filePath }),
  readVersion: (versionPath) => ipcRenderer.invoke('read-version', { versionPath }),
  checkDraft: () => ipcRenderer.invoke('check-draft'),
  discardDraft: (draftPath) => ipcRenderer.invoke('discard-draft', { draftPath }),
  exportHtml: (html) => ipcRenderer.invoke('export-html', { html }),
  exportPdf: (html) => ipcRenderer.invoke('export-pdf', { html }),
  // docx：渲染层用 html-docx-js 生成 Blob，转 Uint8Array 传过来
  exportDocx: async (blob) => {
    const buf = await blob.arrayBuffer();
    return ipcRenderer.invoke('export-docx', { buffer: Array.from(new Uint8Array(buf)) });
  },
  // png：现在改为主进程 capturePage 全页面截图（质量大幅提升）
  // 用法：渲染层只发起请求，pixelRatio 可选（默认 2，最大 4）
  exportPng: (pixelRatio) => ipcRenderer.invoke('export-png', { pixelRatio }),
  // 主进程长图导出过程中会向渲染层索取 html（保证用的是当前 vditor 渲染结果）
  onRequestPngHtml: (cb) => ipcRenderer.on('request-png-html', () => cb()),
  sendPngHtml: (html) => ipcRenderer.send('export-png-html', { html }),
  // 渲染层导出 Word/长图时需要的资源（CSS / 文档目录）
  getExportResources: () => ipcRenderer.invoke('get-export-resources'),
  // 在 Finder 中显示图片目录
  revealAssetsDir: () => ipcRenderer.invoke('reveal-assets-dir'),
  setDirty: (dirty) => ipcRenderer.send('set-dirty', dirty),
  openDroppedFile: (filePath) => ipcRenderer.send('open-dropped-file', filePath),
  // 渲染层只把 File 对象交给 preload，这里解析出真实路径再投递给主进程
  openDroppedFileFromFile: (file) => {
    const p = pathForFile(file);
    if (p) ipcRenderer.send('open-dropped-file', p);
    return p;
  },
  rendererReady: () => ipcRenderer.send('renderer-ready'),
  setNativeTheme: (mode) => ipcRenderer.send('set-native-theme', mode),
  // 关闭确认：渲染让主进程弹原生对话框，返回 'save'/'discard'/'cancel'
  askCloseConfirm: () => ipcRenderer.invoke('ask-close-confirm'),
  confirmCloseReply: (payload) => ipcRenderer.send('confirm-close-reply', payload),
  // 图片上传：把 File 的 buffer 交给主进程写盘，返回 { url: 相对路径 }
  saveUploadedImage: async (file) => {
    const buf = await file.arrayBuffer();
    return ipcRenderer.invoke('save-uploaded-image', {
      name: file.name,
      type: file.type,
      size: file.size,
      buffer: Array.from(new Uint8Array(buf))
    });
  },
  // 主动打开指定路径文件
  openFileByPath: (fp) => ipcRenderer.send('open-dropped-file', fp),
  // 获取最近文件列表（主进程存的）
  getRecentFiles: () => ipcRenderer.invoke('get-recent-files'),
  // 列出目录内容
  listDirectory: (dirPath) => ipcRenderer.invoke('list-directory', dirPath),
});
