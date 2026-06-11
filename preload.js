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
  onRequestExportHtml: (cb) => ipcRenderer.on('request-export-html', () => cb()),
  // 关闭前主进程问询
  onConfirmClose: (cb) => ipcRenderer.on('confirm-close', () => cb()),

  // 渲染进程 -> 主进程
  saveContent: (content, saveAs) => ipcRenderer.invoke('save-content', { content, saveAs }),
  exportHtml: (html) => ipcRenderer.invoke('export-html', { html }),
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
  confirmCloseReply: (payload) => ipcRenderer.send('confirm-close-reply', payload)
});
