const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('markpad', {
  // 主进程 -> 渲染进程
  onFileOpened: (cb) => ipcRenderer.on('file-opened', (e, data) => cb(data)),
  onFileNew: (cb) => ipcRenderer.on('file-new', () => cb()),
  onRequestSave: (cb) => ipcRenderer.on('request-save', (e, data) => cb(data)),
  onToggleOutline: (cb) => ipcRenderer.on('toggle-outline', () => cb()),
  onToggleTheme: (cb) => ipcRenderer.on('toggle-theme', () => cb()),
  onRequestExportHtml: (cb) => ipcRenderer.on('request-export-html', () => cb()),

  // 渲染进程 -> 主进程
  saveContent: (content, saveAs) => ipcRenderer.invoke('save-content', { content, saveAs }),
  exportHtml: (html) => ipcRenderer.invoke('export-html', { html }),
  setDirty: (dirty) => ipcRenderer.send('set-dirty', dirty)
});
