const { app, BrowserWindow, Menu, dialog, ipcMain, shell, nativeTheme, protocol } = require('electron');
const path = require('path');
const fs = require('fs');

// ============ 多窗口状态管理 ============
// 每个窗口维护独立的文件上下文
const windowContexts = new Map(); // winId -> { currentFilePath, currentCodeMode, currentDirty, rendererReady, allowClose, closingInProgress }

function getContext(winId) { return windowContexts.get(winId); }
function setContext(winId, ctx) { windowContexts.set(winId, ctx); }
function deleteContext(winId) { windowContexts.delete(winId); }

function createDefaultContext() {
  return {
    currentFilePath: null,
    currentCodeMode: null,
    currentDirty: false,
    rendererReady: false,
    allowClose: false,
    closingInProgress: false,
  };
}

function getWin(id) { return BrowserWindow.getAllWindows().find(w => w.id === id); }

// ============ 创建窗口 ============
let pendingOpenPath = null;

function createWindow(initialTab) {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 600,
    minHeight: 400,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const ctx = createDefaultContext();
  // 如果新窗口要加载初始 tab
  if (initialTab) {
    ctx._initialTab = initialTab;
  }
  setContext(win.id, ctx);

  win.loadFile(path.join(__dirname, 'src', 'index.html'));

  if (process.env.MARKPAD_DEBUG === '1') {
    win.webContents.openDevTools({ mode: 'right' });
  }

  win.on('closed', () => {
    deleteContext(win.id);
  });

  win.on('close', (e) => {
    const ctx = getContext(win.id);
    if (!ctx) return;
    if (ctx.allowClose) return;
    if (!ctx.currentDirty) return;
    if (ctx.closingInProgress) { e.preventDefault(); return; }
    e.preventDefault();
    ctx.closingInProgress = true;
    if (win.webContents) {
      win.webContents.send('confirm-close');
    } else {
      ctx.allowClose = true;
      ctx.closingInProgress = false;
      win.close();
    }
  });

  return win;
}

// ============ 代码文件支持 ============
const CODE_LANG_BY_EXT = {
  '.xml': 'xml', '.json': 'json', '.jsonl': 'jsonl', '.yml': 'yaml', '.yaml': 'yaml',
};
const CODE_EXT_LIST = Object.keys(CODE_LANG_BY_EXT).map(e => e.slice(1));
function detectCodeLang(fp) {
  if (!fp) return null;
  const ext = path.extname(fp).toLowerCase();
  return CODE_LANG_BY_EXT[ext] || null;
}

function formatCodeText(raw, codeLang) {
  const src = raw == null ? '' : String(raw);
  try {
    if (codeLang === 'json') {
      const obj = JSON.parse(src);
      const out = JSON.stringify(obj, null, 2) + '\n';
      return { ok: true, text: out, changed: out !== src };
    }
    if (codeLang === 'jsonl') {
      const lines = src.split(/\r?\n/);
      const out = lines.map(line => {
        const t = line.trim();
        if (!t) return '';
        try { return JSON.stringify(JSON.parse(t)); }
        catch (_) { return line; }
      }).filter((v, i, arr) => !(v === '' && i === arr.length - 1)).join('\n') + '\n';
      return { ok: true, text: out, changed: out !== src };
    }
    if (codeLang === 'xml') {
      const flat = src.replace(/>\s+</g, '><').trim();
      if (!flat) return { ok: true, text: '', changed: false };
      let indent = 0;
      const out = flat.replace(/<[^>]+>[^<]*/g, (chunk) => {
        const tagEnd = chunk.indexOf('>') + 1;
        const tag = chunk.slice(0, tagEnd);
        const text = chunk.slice(tagEnd);
        const isClose = /^<\//.test(tag);
        const isVoid = /\/>$/.test(tag) || /^<\?/.test(tag) || /^<!/.test(tag);
        if (isClose) indent = Math.max(0, indent - 1);
        const line = '  '.repeat(indent) + tag + text + '\n';
        if (!isClose && !isVoid) indent += 1;
        return line;
      });
      return { ok: true, text: out, changed: out !== src };
    }
    if (codeLang === 'yaml') {
      return { ok: false, text: src, changed: false, error: 'YAML 暂不支持自动格式化（避免引入额外依赖），可手动整理' };
    }
    return { ok: false, text: src, changed: false, error: '不支持该语言的格式化' };
  } catch (err) {
    return { ok: false, text: src, changed: false, error: err && err.message || String(err) };
  }
}

// ============ 文件操作 ============
function setTitle(win, filePath, dirty) {
  if (!win || win.isDestroyed()) return;
  const name = filePath ? path.basename(filePath) : '未命名';
  win.setTitle(`${dirty ? '• ' : ''}${name} — MarkPad`);
  const absPath = filePath && path.isAbsolute(filePath) ? filePath : (filePath ? path.resolve(filePath) : '');
  win.setRepresentedFilename(absPath);
  win.setDocumentEdited(!!dirty);
}

// 从 IPC event 中找到对应的窗口上下文
function ctxFromEvent(event) {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return { ctx: null, win: null };
  return { ctx: getContext(win.id), win };
}

async function doOpen() {
  const focusedWin = BrowserWindow.getFocusedWindow();
  if (!focusedWin) return;
  const { canceled, filePaths } = await dialog.showOpenDialog(focusedWin, {
    properties: ['openFile'],
    filters: [
      { name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'txt'] },
      { name: '代码/配置文件', extensions: CODE_EXT_LIST },
      { name: '所有文件', extensions: ['*'] }
    ]
  });
  if (canceled || !filePaths.length) return;
  openFileInWindow(focusedWin, filePaths[0]);
}

function openFileInWindow(win, fp) {
  if (!fp) return;
  const ctx = getContext(win.id);
  if (!ctx || !ctx.rendererReady) {
    pendingOpenPath = fp;
    if (!win && app.isReady()) createWindow();
    return;
  }
  try {
    const rawContent = fs.readFileSync(fp, 'utf-8');
    const codeLang = detectCodeLang(fp);
    ctx.currentFilePath = fp;
    ctx.currentCodeMode = codeLang ? { lang: codeLang } : null;
    setTitle(win, fp, false);
    const content = codeLang ? rawContent : expandImagePaths(rawContent, fp);
    win.webContents.send('file-opened', {
      path: fp,
      content,
      codeMode: ctx.currentCodeMode
    });
    app.addRecentDocument(fp);
    if (win.isMinimized()) win.restore();
    win.focus();
  } catch (err) {
    dialog.showErrorBox('打开失败', String(err));
  }
}

// 全局打开文件入口（open-file 事件 / 命令行参数）
function openFile(fp) {
  if (!fp) return;
  // 优先发送到聚焦窗口
  const focusedWin = BrowserWindow.getFocusedWindow();
  if (focusedWin) {
    openFileInWindow(focusedWin, fp);
  } else if (BrowserWindow.getAllWindows().length > 0) {
    openFileInWindow(BrowserWindow.getAllWindows()[0], fp);
  } else {
    pendingOpenPath = fp;
    if (app.isReady()) createWindow();
    // else: whenReady 回调会自动 createWindow() 并消费 pendingOpenPath
  }
}

function writeFile(fp, content, ctx) {
  if (currentCodeModeFromCtx(ctx)) {
    fs.writeFileSync(fp, content == null ? '' : String(content), 'utf-8');
    ctx.currentFilePath = fp;
    setTitle(getWinByCtx(ctx), fp, false);
    app.addRecentDocument(fp);
    clearDraftIfAny();
    return;
  }
  const normalized = normalizeImagePaths(content, fp);
  fs.writeFileSync(fp, normalized, 'utf-8');
  ctx.currentFilePath = fp;
  setTitle(getWinByCtx(ctx), fp, false);
  app.addRecentDocument(fp);
  clearDraftIfAny();
}

function currentCodeModeFromCtx(ctx) { return ctx ? ctx.currentCodeMode : null; }
function getWinByCtx(ctx) {
  if (!ctx) return null;
  for (const [winId, c] of windowContexts) {
    if (c === ctx) return getWin(winId);
  }
  return null;
}

// ============ 图片路径处理 ============
function normalizeImagePaths(content, mdPath) {
  if (!content || !mdPath) return content;
  const mdDir = path.dirname(mdPath);
  const convert = (url) => {
    if (!/^(file|mpmedia):\/\//i.test(url)) return null;
    try {
      const abs = decodeURI(url.replace(/^(file|mpmedia):\/\//i, ''));
      if (!path.isAbsolute(abs)) return null;
      const rel = path.relative(mdDir, abs);
      if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
      return './' + rel.split(path.sep).join('/');
    } catch (_) { return null; }
  };
  content = content.replace(/(!\[[^\]]*\]\()([^)\s]+)((?:\s+"[^"]*")?\))/g,
    (m, head, url, tail) => { const r = convert(url); return r ? head + r + tail : m; });
  content = content.replace(/(<img\b[^>]*?\ssrc=["'])([^"']+)(["'][^>]*>)/gi,
    (m, head, url, tail) => { const r = convert(url); return r ? head + r + tail : m; });
  return content;
}

function expandImagePaths(content, mdPath) {
  if (!content || !mdPath) return content;
  const mdDir = path.dirname(mdPath);
  const convert = (url) => {
    if (/^(file:|mpmedia:|https?:|data:)/i.test(url)) return null;
    if (url.startsWith('#') || url.startsWith('//')) return null;
    try {
      const abs = path.resolve(mdDir, url);
      if (!/\.(png|jpe?g|gif|svg|webp|bmp|ico|avif)$/i.test(abs)) return null;
      return 'mpmedia://' + encodeURI(abs.split(path.sep).join('/'));
    } catch (_) { return null; }
  };
  content = content.replace(/(!\[[^\]]*\]\()([^)\s]+)((?:\s+"[^"]*")?\))/g,
    (m, head, url, tail) => { const r = convert(url); return r ? head + r + tail : m; });
  content = content.replace(/(<img\b[^>]*?\ssrc=["'])([^"']+)(["'][^>]*>)/gi,
    (m, head, url, tail) => { const r = convert(url); return r ? head + r + tail : m; });
  return content;
}

// ============ 保存 ============
async function doSave() {
  const win = BrowserWindow.getFocusedWindow();
  if (win) win.webContents.send('request-save', { saveAs: false });
}
async function doSaveAs() {
  const win = BrowserWindow.getFocusedWindow();
  if (win) win.webContents.send('request-save', { saveAs: true });
}

ipcMain.handle('save-content', async (event, { content, saveAs }) => {
  const { ctx, win } = ctxFromEvent(event);
  if (!ctx || !win) return { saved: false };
  let fp = ctx.currentFilePath;
  if (saveAs || !fp) {
    const isCode = !!ctx.currentCodeMode;
    const defaultExt = isCode ? path.extname(ctx.currentFilePath || '') || '.txt' : '.md';
    const defaultName = fp ? path.basename(fp) : ('未命名' + defaultExt);
    const filters = isCode
      ? [{ name: '代码/配置文件', extensions: CODE_EXT_LIST }, { name: '所有文件', extensions: ['*'] }]
      : [{ name: 'Markdown', extensions: ['md'] }];
    const { canceled, filePath } = await dialog.showSaveDialog(win, { defaultPath: defaultName, filters });
    if (canceled || !filePath) return { saved: false };
    fp = filePath;
  }
  try {
    writeFile(fp, content, ctx);
    const snapText = ctx.currentCodeMode ? String(content || '') : normalizeImagePaths(content, fp);
    snapshotVersion(fp, snapText);
    return { saved: true, path: fp };
  } catch (err) {
    dialog.showErrorBox('保存失败', String(err));
    return { saved: false };
  }
});

// ============ 自动保存 ============
ipcMain.handle('auto-save', async (event, { content }) => {
  const { ctx } = ctxFromEvent(event);
  if (!ctx) return { saved: false };
  try {
    if (ctx.currentFilePath) {
      writeFile(ctx.currentFilePath, content, ctx);
      const snapText = ctx.currentCodeMode ? String(content || '') : normalizeImagePaths(content, ctx.currentFilePath);
      snapshotVersion(ctx.currentFilePath, snapText);
      return { saved: true, autoSaved: true, path: ctx.currentFilePath };
    } else {
      saveDraft(content);
      return { saved: false, draft: true };
    }
  } catch (err) {
    console.error('[auto-save]', err);
    return { saved: false, error: String(err) };
  }
});

// ============ 格式化 ============
ipcMain.handle('format-code', async (event, { content }) => {
  const { ctx } = ctxFromEvent(event);
  if (!ctx || !ctx.currentCodeMode) return { ok: false, error: '当前不是代码文件' };
  const r = formatCodeText(content, ctx.currentCodeMode.lang);
  if (!r.ok) return { ok: false, error: r.error || '格式化失败' };
  return { ok: true, content: r.text, changed: r.changed };
});

// ============ 版本历史 ============
ipcMain.handle('list-versions', async (event, { filePath } = {}) => {
  const { ctx } = ctxFromEvent(event);
  const fp = filePath || (ctx ? ctx.currentFilePath : null);
  if (!fp) return [];
  try {
    const dir = versionDirFor(fp);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter(n => n.endsWith('.md'))
      .map(n => {
        const full = path.join(dir, n);
        const stat = fs.statSync(full);
        return { name: n, path: full, time: stat.mtimeMs, size: stat.size };
      })
      .sort((a, b) => b.time - a.time);
  } catch (_) { return []; }
});

ipcMain.handle('read-version', async (event, { versionPath }) => {
  const { ctx } = ctxFromEvent(event);
  try {
    const raw = fs.readFileSync(versionPath, 'utf-8');
    let content;
    if (ctx && ctx.currentCodeMode) {
      content = raw;
    } else if (ctx && ctx.currentFilePath) {
      content = expandImagePaths(raw, ctx.currentFilePath);
    } else {
      content = raw;
    }
    return { ok: true, content };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

ipcMain.handle('check-draft', async () => {
  try {
    const draftDir = getDraftDir();
    if (!fs.existsSync(draftDir)) return { has: false };
    const files = fs.readdirSync(draftDir).filter(n => n.endsWith('.md'));
    if (!files.length) return { has: false };
    const items = files.map(n => {
      const full = path.join(draftDir, n);
      const stat = fs.statSync(full);
      return { path: full, time: stat.mtimeMs, size: stat.size };
    }).sort((a, b) => b.time - a.time);
    const newest = items[0];
    const content = fs.readFileSync(newest.path, 'utf-8');
    return { has: true, path: newest.path, time: newest.time, content };
  } catch (err) {
    return { has: false, error: String(err) };
  }
});

ipcMain.handle('discard-draft', async (event, { draftPath }) => {
  try { if (draftPath && fs.existsSync(draftPath)) fs.unlinkSync(draftPath); return { ok: true }; }
  catch (_) { return { ok: false }; }
});

// ============ 历史/草稿存储 ============
const MAX_VERSIONS_PER_FILE = 10;
function appDataDir() { return path.join(app.getPath('userData'), 'history'); }
function getDraftDir() { return path.join(app.getPath('userData'), 'drafts'); }

// ============ 持久化数据（不依赖 localStorage origin） ============
const APP_DATA_FILE = path.join(app.getPath('userData'), 'markpad-data.json');
function readAppData() {
  try {
    if (fs.existsSync(APP_DATA_FILE)) {
      return JSON.parse(fs.readFileSync(APP_DATA_FILE, 'utf-8'));
    }
  } catch (_) {}
  return { recentFiles: [], favorites: [] };
}
function writeAppData(data) {
  try {
    fs.writeFileSync(APP_DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (_) {}
}
// 首次启动时，如果 JSON 文件不存在但 localStorage 有数据（app:// origin 旧数据），
// 尝试从 LevelDB 迁移（通过渲染进程在首次检测到空 localStorage 时从 IPC 拉取）
function mergeAppData(key, items) {
  const data = readAppData();
  // 去重合并：以 path 为主键
  const existing = new Map((data[key] || []).map(f => [f.path, f]));
  for (const item of items) {
    if (!existing.has(item.path)) {
      existing.set(item.path, item);
    }
  }
  data[key] = Array.from(existing.values());
  writeAppData(data);
  return data[key];
}
function replaceAppData(key, items) {
  const data = readAppData();
  data[key] = items;
  writeAppData(data);
  return items;
}
function hashPath(fp) {
  let h = 5381;
  for (let i = 0; i < fp.length; i++) h = ((h << 5) + h + fp.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, '0');
}
function versionDirFor(fp) {
  const base = path.basename(fp).replace(/[^a-zA-Z0-9\u4e00-\u9fa5._-]/g, '_').slice(0, 40);
  return path.join(appDataDir(), `${base}-${hashPath(fp)}`);
}
function pad(n) { return String(n).padStart(2, '0'); }
function timestamp() {
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}
function snapshotVersion(fp, content) {
  try {
    const dir = versionDirFor(fp);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const existing = fs.readdirSync(dir).filter(n => n.endsWith('.md')).sort();
    if (existing.length) {
      const last = path.join(dir, existing[existing.length - 1]);
      try { const lastContent = fs.readFileSync(last, 'utf-8'); if (lastContent === content) return; } catch (_) {}
    }
    const file = path.join(dir, `${timestamp()}.md`);
    fs.writeFileSync(file, content, 'utf-8');
    const all = fs.readdirSync(dir).filter(n => n.endsWith('.md')).sort();
    while (all.length > MAX_VERSIONS_PER_FILE) {
      const oldest = all.shift();
      try { fs.unlinkSync(path.join(dir, oldest)); } catch (_) {}
    }
  } catch (err) { console.error('[snapshot]', err); }
}
function saveDraft(content) {
  try {
    const dir = getDraftDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'unsaved-draft.md');
    fs.writeFileSync(file, content, 'utf-8');
  } catch (err) { console.error('[draft]', err); }
}
function clearDraftIfAny() {
  try { const file = path.join(getDraftDir(), 'unsaved-draft.md'); if (fs.existsSync(file)) fs.unlinkSync(file); } catch (_) {}
}

// ============ 脏标记 / 关闭确认 ============
ipcMain.on('set-dirty', (event, dirty) => {
  const { ctx, win } = ctxFromEvent(event);
  if (!ctx || !win) return;
  ctx.currentDirty = !!dirty;
  setTitle(win, ctx.currentFilePath, ctx.currentDirty);
});

ipcMain.handle('ask-close-confirm', async (event) => {
  const { ctx, win } = ctxFromEvent(event);
  if (!win) return 'cancel';
  const name = (ctx && ctx.currentFilePath) ? path.basename(ctx.currentFilePath) : '未命名';
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['保存', '不保存', '取消'],
    defaultId: 0, cancelId: 2,
    title: '未保存的更改',
    message: `"${name}" 有尚未保存的更改`,
    detail: '关闭前是否要保存？'
  });
  if (response === 0) return 'save';
  if (response === 1) return 'discard';
  return 'cancel';
});

ipcMain.on('confirm-close-reply', (event, payload) => {
  const { ctx, win } = ctxFromEvent(event);
  const action = payload && payload.action;
  if (ctx) ctx.closingInProgress = false;
  if (action === 'discard') {
    if (ctx) ctx.allowClose = true;
    if (win) win.close();
  } else {
    if (ctx) ctx.allowClose = false;
  }
});

// ============ 新建 ============
function doNew() {
  const win = BrowserWindow.getFocusedWindow();
  if (win) {
    const ctx = getContext(win.id);
    if (ctx) { ctx.currentFilePath = null; ctx.currentCodeMode = null; }
    setTitle(win, null, false);
    win.webContents.send('file-new');
  }
}

// ============ 导出 ============
function exportStem(ctx) {
  return ctx && ctx.currentFilePath
    ? path.basename(ctx.currentFilePath, path.extname(ctx.currentFilePath))
    : '未命名';
}
function docBaseDir(ctx) {
  return ctx && ctx.currentFilePath ? path.dirname(ctx.currentFilePath) : null;
}
function absolutizeImageSrc(html, baseDir) {
  return html.replace(/<img\b([^>]*?)\ssrc=(["'])([^"']+)\2/gi, (m, pre, q, src) => {
    if (/^mpmedia:\/\//i.test(src)) { const abs = decodeURI(src.replace(/^mpmedia:\/\//i, '')); return `<img${pre} src=${q}file://${abs}${q}`; }
    if (/^(https?:|file:|data:)/i.test(src)) return m;
    if (!baseDir) return m;
    try { const abs = path.resolve(baseDir, src); const url = 'file://' + abs.split(path.sep).join('/'); return `<img${pre} src=${q}${url}${q}`; } catch (_) { return m; }
  });
}
let cachedVditorCss = null;
function loadVditorCss() {
  if (cachedVditorCss !== null) return cachedVditorCss;
  try { const cssPath = path.join(__dirname, 'node_modules', 'vditor', 'dist', 'index.css'); cachedVditorCss = fs.readFileSync(cssPath, 'utf-8'); } catch (_) { cachedVditorCss = ''; }
  return cachedVditorCss;
}
function wrapExportHtml(title, bodyHtml, opts = {}) {
  const css = loadVditorCss();
  const baseCss = `body{margin:0;padding:40px;background:#fff;color:#24292e;font-family:-apple-system,"PingFang SC","Helvetica Neue","Microsoft YaHei",sans-serif;line-height:1.7;font-size:16px;-webkit-font-smoothing:antialiased;}.vditor-reset{max-width:820px;margin:0 auto;}.vditor-reset img{max-width:100%;height:auto;}.vditor-reset pre{background:#f6f8fa;padding:16px;border-radius:6px;overflow:auto;font-family:"SF Mono",Menlo,Consolas,monospace;font-size:14px;}.vditor-reset code{background:rgba(175,184,193,.2);padding:.2em .4em;border-radius:4px;font-family:"SF Mono",Menlo,Consolas,monospace;font-size:.9em;}.vditor-reset pre code{background:transparent;padding:0;}.vditor-reset table{border-collapse:collapse;margin:16px 0;}.vditor-reset table td,.vditor-reset table th{border:1px solid #d0d7de;padding:6px 12px;}.vditor-reset blockquote{border-left:4px solid #d0d7de;margin:16px 0;padding:0 16px;color:#57606a;}.vditor-reset h1,.vditor-reset h2{border-bottom:1px solid #eaecef;padding-bottom:.3em;}@media print{body{padding:0;}.vditor-reset{max-width:none;}pre,blockquote,table,img{page-break-inside:avoid;}h1,h2,h3,h4{page-break-after:avoid;}}`;
  return `<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><title>${title}</title><style>${css}\n${baseCss}\n${opts.extraCss || ''}</style></head><body><div class="vditor-reset">${bodyHtml}</div></body></html>`;
}

ipcMain.handle('export-html', async (event, { html }) => {
  const { ctx, win } = ctxFromEvent(event);
  if (!win) return { saved: false };
  const { canceled, filePath } = await dialog.showSaveDialog(win, { defaultPath: exportStem(ctx) + '.html', filters: [{ name: 'HTML', extensions: ['html'] }] });
  if (canceled || !filePath) return { saved: false };
  try { const finalHtml = wrapExportHtml(path.basename(filePath), absolutizeImageSrc(html, docBaseDir(ctx))); fs.writeFileSync(filePath, finalHtml, 'utf-8'); return { saved: true, path: filePath }; }
  catch (err) { dialog.showErrorBox('导出 HTML 失败', String(err)); return { saved: false }; }
});

ipcMain.handle('export-pdf', async (event, { html }) => {
  const { ctx, win } = ctxFromEvent(event);
  if (!win) return { saved: false };
  const { canceled, filePath } = await dialog.showSaveDialog(win, { defaultPath: exportStem(ctx) + '.pdf', filters: [{ name: 'PDF', extensions: ['pdf'] }] });
  if (canceled || !filePath) return { saved: false };
  let pdfWin = null;
  try {
    const fullHtml = wrapExportHtml(path.basename(filePath), absolutizeImageSrc(html, docBaseDir(ctx)));
    pdfWin = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
    const dataUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(fullHtml);
    await pdfWin.loadURL(dataUrl);
    await new Promise(r => setTimeout(r, 250));
    const data = await pdfWin.webContents.printToPDF({ printBackground: true, pageSize: 'A4', margins: { marginType: 'custom', top: 0.6, bottom: 0.6, left: 0.6, right: 0.6 } });
    fs.writeFileSync(filePath, data);
    return { saved: true, path: filePath };
  } catch (err) { dialog.showErrorBox('导出 PDF 失败', String(err)); return { saved: false }; }
  finally { if (pdfWin) try { pdfWin.destroy(); } catch (_) {} }
});

ipcMain.handle('export-docx', async (event, { buffer }) => {
  const { ctx, win } = ctxFromEvent(event);
  if (!win) return { saved: false };
  const { canceled, filePath } = await dialog.showSaveDialog(win, { defaultPath: exportStem(ctx) + '.docx', filters: [{ name: 'Word 文档', extensions: ['docx'] }] });
  if (canceled || !filePath) return { saved: false };
  try { fs.writeFileSync(filePath, Buffer.from(buffer)); return { saved: true, path: filePath }; }
  catch (err) { dialog.showErrorBox('导出 Word 失败', String(err)); return { saved: false }; }
});

ipcMain.handle('export-png', async (event, { pixelRatio } = {}) => {
  const { ctx, win } = ctxFromEvent(event);
  if (!win) return { saved: false };
  const { canceled, filePath } = await dialog.showSaveDialog(win, { defaultPath: exportStem(ctx) + '.png', filters: [{ name: 'PNG 图片', extensions: ['png'] }] });
  if (canceled || !filePath) return { saved: false };
  const html = await new Promise((resolve) => {
    if (!win) return resolve('');
    ipcMain.once('export-png-html', (_e, payload) => resolve(payload && payload.html || ''));
    win.webContents.send('request-png-html');
    setTimeout(() => resolve(''), 5000);
  });
  if (!html) { dialog.showErrorBox('导出长图失败', '获取页面内容超时'); return { saved: false }; }
  let expWin = null;
  try {
    const ratio = Math.max(1, Math.min(4, Number(pixelRatio) || 2));
    const baseWidth = 820; const winWidth = baseWidth + 80;
    expWin = new BrowserWindow({
      show: false, x: -10000, y: -10000, width: winWidth, height: 800,
      useContentSize: true, enableLargerThanScreen: true,
      webPreferences: { sandbox: true, offscreen: false, zoomFactor: ratio },
    });
    const fullHtml = wrapExportHtml('export', absolutizeImageSrc(html, docBaseDir(ctx)), {
      extraCss: `html,body{overflow:visible !important;}body{padding:30px 40px;}.vditor-reset{max-width:${baseWidth}px;margin:0 auto;}*{-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;}.vditor-reset pre{overflow:visible;white-space:pre-wrap;word-break:break-word;}`
    });
    const dataUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(fullHtml);
    await expWin.loadURL(dataUrl);
    await new Promise(r => setTimeout(r, 400));
    const docSize = await expWin.webContents.executeJavaScript(`(() => { const b = document.body, d = document.documentElement; const imgs = Array.from(document.images || []); return Promise.all(imgs.map(i => i.complete ? Promise.resolve() : new Promise(r => { i.onload = i.onerror = r; }))).then(() => ({ w: Math.max(b.scrollWidth, d.scrollWidth, b.clientWidth, d.clientWidth), h: Math.max(b.scrollHeight, d.scrollHeight, b.clientHeight, d.clientHeight) })); })()`);
    const targetW = Math.max(winWidth, Math.ceil(docSize.w));
    const targetH = Math.ceil(docSize.h) + 4;
    expWin.setContentSize(targetW, targetH);
    await new Promise(r => setTimeout(r, 350));
    const [actualW, actualH] = expWin.getContentSize();
    const fits = actualH >= targetH - 2;
    let buf;
    if (fits) {
      const image = await expWin.webContents.capturePage({ x: 0, y: 0, width: targetW, height: targetH });
      buf = image.toPNG();
    } else {
      console.warn('[export-png] window clamped, retry @1x');
      try { expWin.webContents.setZoomFactor(1); } catch (_) {}
      await new Promise(r => setTimeout(r, 150));
      expWin.setContentSize(targetW, targetH);
      await new Promise(r => setTimeout(r, 350));
      const [w2, h2] = expWin.getContentSize();
      if (h2 < targetH - 2) throw new Error(`文档过长（需 ${targetH}px / 实 ${h2}px）。`);
      const image = await expWin.webContents.capturePage({ x: 0, y: 0, width: targetW, height: targetH });
      buf = image.toPNG();
    }
    fs.writeFileSync(filePath, buf);
    return { saved: true, path: filePath };
  } catch (err) { dialog.showErrorBox('导出长图失败', String(err)); return { saved: false }; }
  finally { if (expWin) try { expWin.destroy(); } catch (_) {} }
});

ipcMain.handle('get-export-resources', async (event) => {
  const { ctx } = ctxFromEvent(event);
  return { vditorCss: loadVditorCss(), baseDir: docBaseDir(ctx) };
});

ipcMain.handle('reveal-assets-dir', async (event) => {
  const { ctx } = ctxFromEvent(event);
  const baseDir = (ctx && ctx.currentFilePath) ? path.dirname(ctx.currentFilePath) : app.getPath('temp');
  const assetsDir = path.join(baseDir, 'assets');
  try { if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true }); shell.openPath(assetsDir); return { ok: true, path: assetsDir }; }
  catch (err) { return { ok: false, error: String(err) }; }
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
        { label: '新建标签页', accelerator: 'CmdOrCtrl+T', click: () => { const w = BrowserWindow.getFocusedWindow(); if (w) w.webContents.send('file-new'); } },
        { label: '打开…', accelerator: 'CmdOrCtrl+O', click: doOpen },
        { label: '快速打开…', accelerator: 'CmdOrCtrl+P', click: () => { const w = BrowserWindow.getFocusedWindow(); if (w) w.webContents.send('quick-open'); } },
        { type: 'separator' },
        { label: '保存', accelerator: 'CmdOrCtrl+S', click: doSave },
        { label: '另存为…', accelerator: 'CmdOrCtrl+Shift+S', click: doSaveAs },
        { type: 'separator' },
        { label: '关闭标签页', accelerator: 'CmdOrCtrl+W', click: () => { const w = BrowserWindow.getFocusedWindow(); if (w) w.webContents.send('close-active-tab'); } },
        { type: 'separator' },
        { label: '加入收藏', accelerator: 'CmdOrCtrl+D', click: () => { const w = BrowserWindow.getFocusedWindow(); if (w) w.webContents.send('toggle-favorite'); } },
        { type: 'separator' },
        { label: '历史版本…', click: () => { const w = BrowserWindow.getFocusedWindow(); if (w) w.webContents.send('show-versions'); } },
        { label: '在 Finder 中显示历史目录', click: () => shell.openPath(path.join(app.getPath('userData'), 'history')) },
        { label: '在 Finder 中显示图片目录', click: () => { const w = BrowserWindow.getFocusedWindow(); if (w) w.webContents.send('reveal-assets-dir'); } },
        { type: 'separator' },
        {
          label: '导出',
          submenu: [
            { label: 'PDF…', accelerator: 'CmdOrCtrl+Shift+P', click: () => { const w = BrowserWindow.getFocusedWindow(); if (w) w.webContents.send('request-export', 'pdf'); } },
            { label: 'HTML…', click: () => { const w = BrowserWindow.getFocusedWindow(); if (w) w.webContents.send('request-export', 'html'); } },
            { label: 'Word…', click: () => { const w = BrowserWindow.getFocusedWindow(); if (w) w.webContents.send('request-export', 'docx'); } },
            { label: '长图（PNG）…', click: () => { const w = BrowserWindow.getFocusedWindow(); if (w) w.webContents.send('request-export', 'png'); } }
          ]
        }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' }, { role: 'redo', label: '重做' }, { type: 'separator' },
        { role: 'cut', label: '剪切' }, { role: 'copy', label: '复制' }, { role: 'paste', label: '粘贴' }, { role: 'selectAll', label: '全选' }
      ]
    },
    {
      label: '视图',
      submenu: [
        { label: '内容搜索…', accelerator: 'CmdOrCtrl+F', click: () => { const w = BrowserWindow.getFocusedWindow(); if (w) w.webContents.send('show-find'); } },
        { type: 'separator' },
        { label: '切换大纲', accelerator: 'CmdOrCtrl+\\', click: () => { const w = BrowserWindow.getFocusedWindow(); if (w) w.webContents.send('toggle-outline'); } },
        { label: '切换源码面板', accelerator: 'CmdOrCtrl+E', click: () => { const w = BrowserWindow.getFocusedWindow(); if (w) w.webContents.send('toggle-source'); } },
        { type: 'separator' },
        { label: '专注模式', accelerator: 'CmdOrCtrl+Shift+F', click: () => { const w = BrowserWindow.getFocusedWindow(); if (w) w.webContents.send('toggle-focus-mode'); } },
        { label: '打字机模式', accelerator: 'CmdOrCtrl+Shift+T', click: () => { const w = BrowserWindow.getFocusedWindow(); if (w) w.webContents.send('toggle-typewriter-mode'); } },
        { type: 'separator' },
        {
          label: '外观主题',
          submenu: [
            { label: '亮色', type: 'radio', click: () => { const w = BrowserWindow.getFocusedWindow(); if (w) w.webContents.send('set-theme', 'light'); } },
            { label: '暗色', type: 'radio', click: () => { const w = BrowserWindow.getFocusedWindow(); if (w) w.webContents.send('set-theme', 'dark'); } },
            { label: '跟随系统', type: 'radio', click: () => { const w = BrowserWindow.getFocusedWindow(); if (w) w.webContents.send('set-theme', 'system'); } }
          ]
        },
        { label: '切换亮/暗', accelerator: 'CmdOrCtrl+/', click: () => { const w = BrowserWindow.getFocusedWindow(); if (w) w.webContents.send('toggle-theme'); } },
        {
          label: '样式主题',
          submenu: [
            { label: '默认', type: 'radio', click: () => { const w = BrowserWindow.getFocusedWindow(); if (w) w.webContents.send('set-style-theme', 'default'); } },
            { label: 'GitHub', type: 'radio', click: () => { const w = BrowserWindow.getFocusedWindow(); if (w) w.webContents.send('set-style-theme', 'github'); } },
            { label: 'Night', type: 'radio', click: () => { const w = BrowserWindow.getFocusedWindow(); if (w) w.webContents.send('set-style-theme', 'night'); } },
            { label: 'Sepia', type: 'radio', click: () => { const w = BrowserWindow.getFocusedWindow(); if (w) w.webContents.send('set-style-theme', 'sepia'); } },
            { label: 'Slate', type: 'radio', click: () => { const w = BrowserWindow.getFocusedWindow(); if (w) w.webContents.send('set-style-theme', 'slate'); } }
          ]
        },
        { label: '下一个样式主题', accelerator: 'CmdOrCtrl+Shift+/', click: () => { const w = BrowserWindow.getFocusedWindow(); if (w) w.webContents.send('next-style-theme'); } },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' }, { role: 'zoomIn', label: '放大' }, { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' }, { role: 'toggleDevTools', label: '开发者工具' }
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

// ============ IPC: 文件拖入 ============
app.on('open-file', (event, fp) => { event.preventDefault(); openFile(fp); });
ipcMain.on('open-dropped-file', (event, fp) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) openFileInWindow(win, fp);
});

// ============ IPC: 渲染进程就绪 ============
ipcMain.on('renderer-ready', (event) => {
  const { ctx, win } = ctxFromEvent(event);
  if (!ctx || !win) return;
  ctx.rendererReady = true;

  // 如果有初始 tab（从 detach/新窗口创建），发送给渲染层
  if (ctx._initialTab) {
    const tab = ctx._initialTab;
    win.webContents.send('file-opened', {
      path: tab.filePath || '',
      content: tab.content || '',
      codeMode: tab.codeMode || null,
    });
    if (tab.filePath) {
      ctx.currentFilePath = tab.filePath;
      ctx.currentCodeMode = tab.codeMode;
      setTitle(win, tab.filePath, !!tab.dirty);
    }
    delete ctx._initialTab;
  }

  // 冷启动待打开文件
  if (pendingOpenPath) {
    const fp = pendingOpenPath;
    pendingOpenPath = null;
    openFileInWindow(win, fp);
  }
});

ipcMain.on('set-native-theme', (event, mode) => {
  if (mode === 'light' || mode === 'dark' || mode === 'system') nativeTheme.themeSource = mode;
});

// ============ IPC: Tab 激活通知 ============
ipcMain.on('tab-activated', (event, { filePath, codeMode, dirty }) => {
  const { ctx, win } = ctxFromEvent(event);
  if (!ctx || !win) return;
  ctx.currentFilePath = filePath || null;
  ctx.currentCodeMode = codeMode || null;
  ctx.currentDirty = !!dirty;
  setTitle(win, ctx.currentFilePath, ctx.currentDirty);
});

// ============ IPC: 移到新窗口 ============
ipcMain.on('open-in-new-window', (event, info) => {
  const newWin = createWindow(info);
  if (newWin) newWin.focus();
});

// ============ IPC: 在 Finder 中显示文件 ============
ipcMain.on('reveal-file-in-finder', (event, filePath) => {
  if (!filePath || !fs.existsSync(filePath)) return;
  shell.showItemInFolder(filePath);
});

// ============ IPC: 目录列表 / 最近文件 ============
ipcMain.handle('list-directory', async (event, dirPath) => {
  try {
    if (!dirPath || !fs.existsSync(dirPath)) return [];
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const codeExtRe = new RegExp(`\\.(${CODE_EXT_LIST.join('|')})$`, 'i');
    return entries
      .filter(e => e.isDirectory() || /\.(md|markdown|mdown|mkd|txt)$/i.test(e.name) || codeExtRe.test(e.name))
      .map(e => ({ name: e.name, isDir: e.isDirectory(), path: path.join(dirPath, e.name) }))
      .sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : (a.isDir ? -1 : 1)));
  } catch (_) { return []; }
});

ipcMain.handle('get-recent-files', async () => {
  const data = readAppData();
  return data.recentFiles || [];
});

// 渲染进程同步历史/收藏数据到主进程（持久化到 JSON 文件）
ipcMain.on('sync-app-data', (event, { key, items }) => {
  if (key === 'recentFiles' || key === 'favorites') {
    replaceAppData(key, items);
  }
});

// 渲染进程启动时拉取主进程持久化数据（用于恢复 localStorage）
ipcMain.handle('read-app-data', async () => {
  return readAppData();
});

// ============ IPC: 图片上传 ============
// 使用 Electron 原生对话框选择图片（替代浏览器 <input type="file">，避免 Electron 中不弹出）
ipcMain.handle('open-image-dialog', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender) || BrowserWindow.getFocusedWindow();
  if (!win) return { canceled: true, files: [] };
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: '选择图片',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'tiff', 'ico'] }]
  });
  if (canceled || !filePaths.length) return { canceled: true, files: [] };
  const files = filePaths.map(fp => {
    try {
      const buf = fs.readFileSync(fp);
      return { name: path.basename(fp), type: `image/${(path.extname(fp) || 'png').replace('.', '')}`, size: buf.length, buffer: Array.from(buf) };
    } catch (e) { return null; }
  }).filter(Boolean);
  return { canceled: false, files };
});

ipcMain.handle('save-uploaded-image', async (event, { name, type, size, buffer }) => {
  const { ctx } = ctxFromEvent(event);
  try {
    const baseDir = ctx && ctx.currentFilePath
      ? path.dirname(ctx.currentFilePath)
      : app.getPath('temp');
    const assetsDir = path.join(baseDir, 'assets');
    if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });
    const ext = path.extname(name) || '.png';
    const stem = path.basename(name, ext).replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, '_').slice(0, 40) || 'image';
    const ts = Date.now();
    let filename = `${stem}${ext}`;
    let fullPath = path.join(assetsDir, filename);
    if (fs.existsSync(fullPath)) { filename = `${stem}_${ts}${ext}`; fullPath = path.join(assetsDir, filename); }
    const buf = Buffer.from(buffer);
    fs.writeFileSync(fullPath, buf);
    const fileUrl = 'mpmedia://' + encodeURI(fullPath.split(path.sep).join('/'));
    const relPath = (ctx && ctx.currentFilePath) ? './assets/' + filename : '';
    return { url: fileUrl, relPath, path: fullPath };
  } catch (err) {
    console.error('[MarkPad] 图片保存失败:', err);
    return { url: '', path: '' };
  }
});

// ============ 命令行参数 ============
function fileFromArgv(argv) {
  const args = argv.slice(app.isPackaged ? 1 : 2);
  const codeExtRe = new RegExp(`\\.(${CODE_EXT_LIST.join('|')})$`, 'i');
  for (const a of args) {
    if (a.startsWith('-')) continue;
    if ((/\.(md|markdown|mdown|txt)$/i.test(a) || codeExtRe.test(a)) && fs.existsSync(a)) return a;
  }
  return null;
}

// ============ 自定义协议 ============
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
  { scheme: 'mpmedia', privileges: { standard: false, secure: true, supportFetchAPI: true, stream: true } }
]);

app.whenReady().then(() => {
  protocol.handle('app', (request) => {
    const reqUrl = new URL(request.url);
    const relativePath = reqUrl.pathname.replace(/^\//, '');
    const filePath = path.normalize(path.join(__dirname, relativePath));
    if (!filePath.startsWith(__dirname)) return new Response('Not Found', { status: 404 });
    try {
      const data = fs.readFileSync(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const mime = {
        '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
        '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
        '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
        '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff',
        '.ttf': 'font/ttf', '.eot': 'application/vnd.ms-fontobject', '.otf': 'font/otf',
        '.webp': 'image/webp', '.wasm': 'application/wasm', '.map': 'application/json',
      }[ext] || 'application/octet-stream';
      const isText = /^(text\/|application\/javascript|application\/json|image\/svg)/.test(mime);
      const ct = isText ? mime + '; charset=utf-8' : mime;
      return new Response(data, { headers: { 'Content-Type': ct } });
    } catch (_) { return new Response('Not Found', { status: 404 }); }
  });

  protocol.handle('mpmedia', (request) => {
    try {
      let p = request.url.replace(/^mpmedia:\/\//i, '');
      p = decodeURI(p);
      if (!p.startsWith('/')) p = '/' + p;
      const filePath = path.normalize(p);
      if (!/\.(png|jpe?g|gif|svg|webp|bmp|ico|avif|mp4|webm|mp3|wav|ogg)$/i.test(filePath)) {
        return new Response('Forbidden', { status: 403 });
      }
      const data = fs.readFileSync(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const mime = {
        '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
        '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
        '.bmp': 'image/bmp', '.ico': 'image/x-icon', '.avif': 'image/avif',
        '.mp4': 'video/mp4', '.webm': 'video/webm',
        '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
      }[ext] || 'application/octet-stream';
      return new Response(data, { headers: { 'Content-Type': mime } });
    } catch (_) { return new Response('Not Found', { status: 404 }); }
  });

  createWindow();
  buildMenu();

  const argFile = fileFromArgv(process.argv);
  if (argFile) pendingOpenPath = argFile;

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', (e) => {
  const wins = BrowserWindow.getAllWindows();
  for (const win of wins) {
    const ctx = getContext(win.id);
    if (ctx && ctx.currentDirty && !ctx.allowClose) {
      e.preventDefault();
      win.close();
      return;
    }
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
