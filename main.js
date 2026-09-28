const { app, BrowserWindow, Menu, dialog, ipcMain, shell, nativeTheme, protocol, session } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

// ============ 平台检测 ============
const isMac = process.platform === 'darwin';

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
// 仅用于"app 未就绪 + 无窗口"场景的全局临时变量；
// 窗口已存在时，待打开路径存在对应 ctx.pendingOpenPath 上，避免多窗口竞态。
let _pendingOpenPathGlobal = null;

// 用户是否发起过退出（⌘Q / 菜单退出 / Dock 退出）。
// before-quit 会先 preventDefault 去走保存确认，窗口全关后靠这个标记补发 app.quit()。
let quitRequested = false;

function createWindow(initialTab) {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 600,
    minHeight: 400,
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
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

  // ============ 外链一律交给系统浏览器，绝不在应用内加载 ============
  // 不设这两个 handler 的话：vditor 内部对 Markdown 链接会调 window.open(href)，
  // Electron 默认行为是新建一个 BrowserWindow 加载远程页面 —— 用户会得到一个
  // 没有地址栏、看不到真实域名、也没有前进后退的窗口（钓鱼面），
  // 而且这个窗口还会被我们注入的 CSP 打残，显示错乱。
  const openExternalIfSafe = (url) => {
    // 只放行正常的网页协议，挡掉 file:/javascript:/data: 等
    if (/^https?:\/\//i.test(url) || /^mailto:/i.test(url)) {
      shell.openExternal(url).catch((err) => console.warn('[MarkMate:openExternal]', err));
    }
  };
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalIfSafe(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    // 应用自身页面只会是 file://（loadFile），其余一切导航都是外链
    if (!/^file:\/\//i.test(url)) {
      e.preventDefault();
      openExternalIfSafe(url);
    }
  });

  win.loadFile(path.join(__dirname, 'src', 'index.html'));

  // Windows 上给 body 打 platform 标记（用于 CSS 隐藏 drag-bar 等）
  if (!isMac) {
    win.webContents.on('did-finish-load', () => {
      win.webContents.executeJavaScript(`document.body.setAttribute('data-platform','${process.platform}')`).catch(() => {});
    });
  }

  if (process.env.MARKMATE_DEBUG === '1') {
    win.webContents.openDevTools({ mode: 'right' });
  }

  win.on('closed', () => {
    // 必须先摘定时器：走 allowClose 路径关窗时，那个 30 秒的兜底定时器仍持有
    // ctx 与 win 的引用，要等到超时才释放（有 isDestroyed 兜底所以不崩，但是确定性的滞留）。
    const c = getContext(win.id);
    if (c && c._closeTimer) { clearTimeout(c._closeTimer); c._closeTimer = null; }
    deleteContext(win.id);
  });

  // 渲染进程崩溃兜底。close 流程依赖渲染层回 confirm-close-reply，渲染进程一崩就没人回，
  // 窗口会硬挂到 30 秒定时器超时才关。代码注释里一直声称"由 crashed 事件额外兜底"，
  // 但全文并不存在这个监听器 —— 这里把它补上。
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error('[MarkMate] 渲染进程异常退出:', details && details.reason);
    const c = getContext(win.id);
    if (c) {
      c.allowClose = true;
      if (c._closeTimer) { clearTimeout(c._closeTimer); c._closeTimer = null; }
    }
    if (!win.isDestroyed()) win.destroy();
  });

  win.on('close', (e) => {
    const ctx = getContext(win.id);
    if (!ctx) return;
    if (ctx.allowClose) return;
    // 不再用 ctx.currentDirty 做捷径判断——多 Tab 下单个 dirty 标志不反映全局。
    // 始终走 confirm-close 流程，由渲染层根据所有 Tab 的脏状态决定。
    if (ctx.closingInProgress) { e.preventDefault(); return; }
    e.preventDefault();
    ctx.closingInProgress = true;
    // 30 秒超时回退：渲染进程崩溃/挂起时强制关闭，防止窗口永久死锁。
    // 此前为 3 秒——但用户面对"未保存的更改"三态确认框思考超过 3 秒就会被强关丢数据。
    // 30 秒足够覆盖正常思考 + 用户主动离开的场景；崩溃场景由 webContents crashed 事件额外兜底。
    ctx._closeTimer = setTimeout(() => {
      ctx.allowClose = true;
      ctx.closingInProgress = false;
      if (!win.isDestroyed()) win.close();
    }, 30000);
    if (win.webContents) {
      win.webContents.send('confirm-close');
    } else {
      clearTimeout(ctx._closeTimer);
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
        catch (_) { return line; }  // 行级 JSON 解析失败：保留原行（JSONL 格式化逐行容错，量大不刷日志）
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
  // filePath 可能来自渲染层传上来的任意对象（open-in-new-window 的 tab.filePath），
  // 非字符串会让 path.basename 抛 "Path must be a string"，在同步 IPC 监听器里
  // 抛出就是主进程未捕获异常。这里统一降级成"未命名"。
  if (filePath != null && typeof filePath !== 'string') filePath = null;
  const name = filePath ? path.basename(filePath) : '未命名';
  win.setTitle(`${dirty ? '• ' : ''}${name} — MarkMate`);
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

async function openFileInWindow(win, fp) {
  if (!fp) return;
  const ctx = getContext(win.id);
  if (!ctx || !ctx.rendererReady) {
    if (ctx) ctx.pendingOpenPath = fp;  // 按窗口隔离，避免多窗口竞态
    if (!win && app.isReady()) createWindow();
    return;
  }
  try {
    // 异步读取，避免大文件冻结主进程（窗口可继续响应）
    const rawContent = await fs.promises.readFile(fp, 'utf-8');
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
    // 没有任何窗口时，临时记到全局；whenReady 回调创建窗口后消费
    _pendingOpenPathGlobal = fp;
    if (app.isReady()) createWindow();
  }
}

// 原子写：先写临时文件 + fsync，再 rename 覆盖目标。
// 直接 writeFileSync 是 O_TRUNC 语义（先清空再写），自动保存期间进程被杀 / 断电 / 磁盘满
// 都会留下 0 字节或半截文件，且原内容不可恢复。文件越大窗口期越长。
// 同分区 rename 是原子操作，所以目标文件要么是旧内容、要么是完整新内容，不存在中间态。
function atomicWrite(fp, data, enc) {
  const tmp = fp + '.markmate.tmp';
  // 记下原文件权限，rename 后补回（rename 会带走临时文件的默认权限）
  let mode = null;
  try { mode = fs.statSync(fp).mode; } catch { /* 新文件，无原权限 */ }
  let fd;
  try {
    fd = fs.openSync(tmp, 'w');
    fs.writeFileSync(fd, data, enc ? { encoding: enc } : undefined);
    fs.fsyncSync(fd);          // 确保真正落盘，不只是进 page cache
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch (err) { console.warn('[MarkMate]', err); } }
  }
  try {
    fs.renameSync(tmp, fp);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch { /* 清理失败不影响主流程 */ }
    throw err;
  }
  if (mode != null) { try { fs.chmodSync(fp, mode); } catch (err) { console.warn('[MarkMate]', err); } }
}

function writeFile(fp, content, ctx) {
  if (currentCodeModeFromCtx(ctx)) {
    atomicWrite(fp, content == null ? '' : String(content), 'utf-8');
    ctx.currentFilePath = fp;
    setTitle(getWinByCtx(ctx), fp, false);
    app.addRecentDocument(fp);
    clearDraftIfAny(ctx);
    return;
  }
  const normalized = normalizeImagePaths(content, fp);
  atomicWrite(fp, normalized, 'utf-8');
  ctx.currentFilePath = fp;
  setTitle(getWinByCtx(ctx), fp, false);
  app.addRecentDocument(fp);
  clearDraftIfAny(ctx);
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
// 本地路径 ↔ mpmedia:// / file:// URL 的唯一转换入口。
// 此前生成端和 4 个解析端各写各的，在 macOS 上侥幸自洽（绝对路径天然以 / 开头），
// 到 Windows 上彻底错位：C:\Users\x\a.png → mpmedia://C:/Users/x/a.png → 解析端强补 /
// → /C:/Users/x/a.png → path.win32.resolve 得到 \C:\Users\x\a.png → 过不了 home 校验，
// 所有本地图片 403。统一约定：URL 路径部分永远以 / 开头，Windows 盘符前多一个 /。
function pathToMpmediaUrl(absPath) {
  let posix = String(absPath).split(path.sep).join('/');
  if (!posix.startsWith('/')) posix = '/' + posix;   // C:/x → /C:/x
  // 逐段 encodeURIComponent（而非整体 encodeURI），让 # ? : 等保留字符也被编码，URL 本身合法。
  // 注：实测旧写法（encodeURI 不编码 #）在 Electron 的 protocol.handle 下对「notes #1/pic.png」
  // 这类路径也能正常加载 —— 之前在 Node 里用 new URL() 模拟得出的「# 会被当锚点剥掉」不成立，
  // 这里不是在修 bug，只是不去依赖这个行为。盘符段 C: 会被编码成 C%3A，由 urlToLocalPath 还原。
  return 'mpmedia://' + posix.split('/').map(encodeURIComponent).join('/');
}
function urlToLocalPath(url) {
  let p = String(url).replace(/^(file|mpmedia):\/\//i, '');
  // decodeURIComponent 才能还原 %23 / %3F / %3A（decodeURI 会保留它们不解码）；
  // 对旧版 encodeURI 生成的 URL 同样兼容（未编码的保留字符原样通过）
  try { p = decodeURIComponent(p); } catch { /* 含非法 % 序列时按原样处理 */ }
  // /C:/x 或 /C:\x → C:/x（兼容新格式 mpmedia:///C:/ 与 file:///C:/）
  if (/^\/[a-zA-Z]:[\/\\]/.test(p)) p = p.slice(1);
  // 兼容 v2.1.1 及之前在 macOS 上生成的 URL；posix 下绝对路径必须以 / 开头
  if (process.platform !== 'win32' && !p.startsWith('/')) p = '/' + p;
  return path.resolve(p);
}
// 导出 HTML/PDF/PNG 时用的 file:// URL。pathToFileURL 会正确处理 Windows 盘符
// 以及路径中的空格 / # / ? 等字符（手工拼接遇到 # 会被当成锚点截断）。
function localPathToFileUrl(absPath) {
  return pathToFileURL(absPath).href;
}

function normalizeImagePaths(content, mdPath) {
  if (!content || !mdPath) return content;
  const mdDir = path.dirname(mdPath);
  const convert = (url) => {
    if (!/^(file|mpmedia):\/\//i.test(url)) return null;
    try {
      const abs = urlToLocalPath(url);
      if (!path.isAbsolute(abs)) return null;
      const rel = path.relative(mdDir, abs);
      if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
      return './' + rel.split(path.sep).join('/');
    } catch (err) { console.error('[MarkMate:io]', err); return null; }
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
      return pathToMpmediaUrl(abs);
    } catch (err) { console.error('[MarkMate:io]', err); return null; }
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

ipcMain.handle('save-content', async (event, { content, saveAs } = {}) => {
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

// ============ 导出任意文本到指定路径（如筛选后的 JSONL 子集） ============
ipcMain.handle('save-text-as', async (event, { content, defaultName, ext } = {}) => {
  const { win } = ctxFromEvent(event);
  if (!win) return { saved: false };
  const e = (ext || 'jsonl').replace(/^\./, '');
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: defaultName || ('export.' + e),
    filters: [{ name: e.toUpperCase(), extensions: [e] }, { name: '所有文件', extensions: ['*'] }],
  });
  if (canceled || !filePath) return { saved: false };
  try {
    atomicWrite(filePath, content, 'utf-8');
    return { saved: true, path: filePath };
  } catch (err) {
    dialog.showErrorBox('导出失败', String(err));
    return { saved: false, error: String(err) };
  }
});

// ============ 自动保存 ============
ipcMain.handle('auto-save', async (event, { content } = {}) => {
  const { ctx } = ctxFromEvent(event);
  if (!ctx) return { saved: false };
  try {
    if (ctx.currentFilePath) {
      writeFile(ctx.currentFilePath, content, ctx);
      const snapText = ctx.currentCodeMode ? String(content || '') : normalizeImagePaths(content, ctx.currentFilePath);
      snapshotVersion(ctx.currentFilePath, snapText);
      return { saved: true, autoSaved: true, path: ctx.currentFilePath };
    } else {
      saveDraft(content, ctx);
      return { saved: false, draft: true };
    }
  } catch (err) {
    console.error('[auto-save]', err);
    return { saved: false, error: String(err) };
  }
});

// ============ 大文件覆盖确认 ============
ipcMain.handle('confirm-overwrite', async (event, { message } = {}) => {
  const { win } = ctxFromEvent(event);
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['取消', '仍然保存'],
    defaultId: 0,
    cancelId: 0,
    message: '确认覆盖整个文件？',
    detail: message || '',
  });
  return response === 1; // true = 用户确认保存
});

// ============ 格式化 ============
ipcMain.handle('format-code', async (event, { content } = {}) => {
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
  } catch (err) { console.error('[MarkMate]', err); return []; }
});

// 安全校验：确保路径在 userData 内，防止路径穿越读取/删除任意文件
function isPathInsideUserData(p) {
  if (!p || typeof p !== 'string') return false;
  const resolved = path.resolve(p);
  const userDataPath = path.resolve(app.getPath('userData'));
  return resolved.startsWith(userDataPath + path.sep);
}

ipcMain.handle('read-version', async (event, { versionPath } = {}) => {
  const { ctx } = ctxFromEvent(event);
  if (!isPathInsideUserData(versionPath)) return { ok: false, error: 'Invalid version path' };
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

ipcMain.handle('check-draft', async (event) => {
  try {
    const draftDir = getDraftDir();
    if (!fs.existsSync(draftDir)) return { has: false };
    // 排除「其他仍然打开着的窗口」正在写的草稿。
    // 原先是全局取 mtime 最新的一份，不管请求者是谁：窗口 1 正在编辑未命名文档时开窗口 2，
    // 窗口 2 会被提示"恢复"窗口 1 的实时草稿 —— 内容串台，恢复后两个窗口还会互相覆盖。
    // 真正需要恢复的只有"没有任何活窗口认领"的草稿（上次崩溃遗留的）。
    const self = BrowserWindow.fromWebContents(event.sender);
    const liveOthers = new Set(
      BrowserWindow.getAllWindows()
        .filter(w => !w.isDestroyed() && (!self || w.id !== self.id))
        .map(w => draftFilename(w.id))
    );
    const files = fs.readdirSync(draftDir)
      .filter(n => n.startsWith('unsaved-draft') && n.endsWith('.md'))
      .filter(n => !liveOthers.has(n));
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

ipcMain.handle('discard-draft', async (event, { draftPath } = {}) => {
  if (!isPathInsideUserData(draftPath)) return { ok: false, error: 'Invalid draft path' };
  try { if (draftPath && fs.existsSync(draftPath)) fs.unlinkSync(draftPath); return { ok: true }; }
  catch (err) { console.error('[MarkMate:autoSave]', err); return { ok: false }; }
});

// ============ 历史/草稿存储 ============
const MAX_VERSIONS_PER_FILE = 10;
// 超过这个体积就不做版本快照（见 snapshotVersion 注释）
const MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024;
// 每个快照目录里记一份源文件绝对路径，用来判断「源文件还在不在」
const HISTORY_SOURCE_MARKER = '.source';
// 没有 .source 标记的旧目录（本版本之前创建的）无法反查源路径，只能按时间兜底；
// 阈值刻意取得很长 —— 源文件仍在编辑的目录，下一次快照就会补上标记，不会走到这里。
const LEGACY_HISTORY_MAX_DAYS = 180;
// 草稿是「从未保存过的内容」，宁可多留：超过这个天数才清
const DRAFT_RETENTION_DAYS = 90;
function appDataDir() { return path.join(app.getPath('userData'), 'history'); }
function getDraftDir() { return path.join(app.getPath('userData'), 'drafts'); }

// 启动时回收 userData。此前 versionDirFor 生成的目录永不回收：
// 用户删除 / 改名源文件后快照仍留在磁盘上，userData 只增不减。
//
// 刻意【不】按「多久没动过」删历史：两个月后重新打开一篇老文档，版本历史应该还在。
// 只清两类确定无用的东西：源文件已不存在的孤儿目录、空目录。
function pruneUserData() {
  const DAY = 24 * 60 * 60 * 1000;
  const now = Date.now();

  // 1) 快照目录
  try {
    const root = appDataDir();
    if (fs.existsSync(root)) {
      for (const name of fs.readdirSync(root)) {
        const dir = path.join(root, name);
        try {
          const st = fs.statSync(dir);
          if (!st.isDirectory()) continue;
          const snaps = fs.readdirSync(dir).filter(n => n.endsWith('.md'));
          if (snaps.length === 0) { fs.rmSync(dir, { recursive: true, force: true }); continue; }

          const marker = path.join(dir, HISTORY_SOURCE_MARKER);
          if (fs.existsSync(marker)) {
            const src = fs.readFileSync(marker, 'utf-8').trim();
            // 源文件已被删除 / 改名 → 孤儿，清掉
            if (src && !fs.existsSync(src)) fs.rmSync(dir, { recursive: true, force: true });
          } else if (now - st.mtimeMs > LEGACY_HISTORY_MAX_DAYS * DAY) {
            fs.rmSync(dir, { recursive: true, force: true });
          }
        } catch (err) { console.warn('[MarkMate] prune history', err); }
      }
    }
  } catch (err) { console.warn('[MarkMate] prune history', err); }

  // 2) 草稿：窗口 id 每次冷启动重新分配，历史会话的草稿不会再被任何窗口「认领」，
  //    不清的话 drafts 只增不减，还可能在启动时弹出几个月前的陈旧草稿。
  try {
    const dir = getDraftDir();
    if (fs.existsSync(dir)) {
      for (const name of fs.readdirSync(dir)) {
        if (!name.startsWith('unsaved-draft')) continue;
        const f = path.join(dir, name);
        try {
          if (now - fs.statSync(f).mtimeMs > DRAFT_RETENTION_DAYS * DAY) fs.unlinkSync(f);
        } catch (err) { console.warn('[MarkMate] prune drafts', err); }
      }
    }
  } catch (err) { console.warn('[MarkMate] prune drafts', err); }
}

// ============ 持久化数据（不依赖 localStorage origin） ============
const APP_DATA_FILE = path.join(app.getPath('userData'), 'markmate-data.json');
function readAppData() {
  try {
    if (fs.existsSync(APP_DATA_FILE)) {
      const d = JSON.parse(fs.readFileSync(APP_DATA_FILE, 'utf-8'));
      // 文件内容可能是合法 JSON 但不是对象（null / 数组 / 字符串）——JSON.parse 不抛，
      // 原样返回后 replaceAppData 里 data[key] = items 会对 null 抛 TypeError，
      // 而 sync-app-data 是同步 ipcMain.on，没 try/catch → 主进程未捕获异常。
      if (d && typeof d === 'object' && !Array.isArray(d)) return d;
      console.warn('[MarkMate] markmate-data.json 结构异常，已忽略');
    }
  } catch (err) { console.warn('[MarkMate]', err); }
  return { recentFiles: [], favorites: [] };
}
function writeAppData(data) {
  try {
    // 原子写入：先写临时文件再 rename，避免写中断导致 JSON 文件损坏
    const tmp = APP_DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmp, APP_DATA_FILE);
  } catch (err) { console.warn('[MarkMate]', err); }
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
  // 毫秒直接拼在秒后面、不加分隔符：这样旧的无毫秒文件名（…115505）恰好是新文件名
  // （…115505123）的前缀，字典序仍然等于时间序，snapshotVersion 的淘汰逻辑不受影响。
  // 只到秒的话，同一秒内手动保存 + 自动保存会生成同名文件而互相覆盖，用户丢一个中间版本。
  return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}${String(d.getMilliseconds()).padStart(3, '0')}`;
}
function snapshotVersion(fp, content) {
  // 只限份数不限体积的话，一个 100MB 的 JSONL 数据集自动保存几轮就会在 userData 里
  // 堆 10 份副本 = 1GB。大文件的版本历史价值低、代价高，直接跳过。
  if (content != null && Buffer.byteLength(String(content), 'utf-8') > MAX_SNAPSHOT_BYTES) return;
  try {
    const dir = versionDirFor(fp);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    // 记录源文件路径，供 pruneUserData 判断是否成了孤儿（旧目录会在这里被自动补上标记）
    const marker = path.join(dir, HISTORY_SOURCE_MARKER);
    if (!fs.existsSync(marker)) {
      try { fs.writeFileSync(marker, path.resolve(fp), 'utf-8'); } catch (err) { console.warn('[MarkMate]', err); }
    }
    const existing = fs.readdirSync(dir).filter(n => n.endsWith('.md')).sort();
    if (existing.length) {
      const last = path.join(dir, existing[existing.length - 1]);
      try { const lastContent = fs.readFileSync(last, 'utf-8'); if (lastContent === content) return; } catch (err) { console.warn('[MarkMate]', err); }
    }
    const file = path.join(dir, `${timestamp()}.md`);
    fs.writeFileSync(file, content, 'utf-8');
    const all = fs.readdirSync(dir).filter(n => n.endsWith('.md')).sort();
    while (all.length > MAX_VERSIONS_PER_FILE) {
      const oldest = all.shift();
      try { fs.unlinkSync(path.join(dir, oldest)); } catch (err) { console.warn('[MarkMate]', err); }
    }
  } catch (err) { console.error('[snapshot]', err); }
}
function draftFilename(winId) {
  const suffix = winId && winId > 0 ? `-w${winId}` : '';
  return `unsaved-draft${suffix}.md`;
}
function saveDraft(content, ctx) {
  try {
    const dir = getDraftDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const winId = ctx ? getWinByCtx(ctx)?.id : 0;
    const file = path.join(dir, draftFilename(winId));
    fs.writeFileSync(file, content, 'utf-8');
  } catch (err) { console.error('[draft]', err); }
}
function clearDraftIfAny(ctx) {
  try { const winId = ctx ? getWinByCtx(ctx)?.id : 0; const file = path.join(getDraftDir(), draftFilename(winId)); if (fs.existsSync(file)) fs.unlinkSync(file); } catch (err) { console.warn('[MarkMate]', err); }
}

// ============ 脏标记 / 关闭确认 ============
ipcMain.on('set-dirty', (event, dirty) => {
  const { ctx, win } = ctxFromEvent(event);
  if (!ctx || !win) return;
  ctx.currentDirty = !!dirty;
  setTitle(win, ctx.currentFilePath, ctx.currentDirty);
});

ipcMain.handle('ask-close-confirm', async (event, { names } = {}) => {
  const { ctx, win } = ctxFromEvent(event);
  if (!win) return 'cancel';
  // 由渲染层告知「到底哪些文件有未保存改动」。原先一律取 ctx.currentFilePath（当前激活 tab）：
  //   - 关闭后台的脏 tab 时，对话框显示的是另一个文件的名字；
  //   - 关窗时多个 tab 都脏，只显示激活那一个，用户以为只有一个文件有改动就点了「不保存」。
  let list = Array.isArray(names) ? names.filter(n => typeof n === 'string' && n).map(n => n.slice(0, 120)) : [];
  if (!list.length) list = [(ctx && ctx.currentFilePath) ? path.basename(ctx.currentFilePath) : '未命名'];
  const MAX_SHOW = 8;
  const message = list.length === 1
    ? `"${list[0]}" 有尚未保存的更改`
    : `${list.length} 个文件有尚未保存的更改`;
  const detail = list.length === 1
    ? '关闭前是否要保存？'
    : list.slice(0, MAX_SHOW).map(n => '• ' + n).join('\n')
      + (list.length > MAX_SHOW ? `\n…等共 ${list.length} 个` : '')
      + '\n\n选择「不保存」将丢弃以上全部改动。';
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: [list.length === 1 ? '保存' : '全部保存', list.length === 1 ? '不保存' : '全部不保存', '取消'],
    defaultId: 0, cancelId: 2,
    title: '未保存的更改',
    message,
    detail
  });
  if (response === 0) return 'save';
  if (response === 1) return 'discard';
  return 'cancel';
});

ipcMain.on('confirm-close-reply', (event, payload) => {
  const { ctx, win } = ctxFromEvent(event);
  if (ctx) {
    if (ctx._closeTimer) { clearTimeout(ctx._closeTimer); ctx._closeTimer = null; }
    ctx.closingInProgress = false;
  }
  const action = payload && payload.action;
  if (action === 'discard') {
    if (ctx) ctx.allowClose = true;
    if (win) win.close();
  } else {
    if (ctx) ctx.allowClose = false;
    // 用户在关闭确认里点了"取消" → 这次退出意图作废，
    // 否则之后随手关掉最后一个窗口会被误当成 ⌘Q 而把整个 App 退掉。
    quitRequested = false;
  }
});

// 对话视图切 Tab 时，若有未保存标注，弹三态确认（保存/放弃/取消）
ipcMain.handle('ask-chat-edits-confirm', async (event, { count } = {}) => {
  const { win } = ctxFromEvent(event);
  if (!win) return 'cancel';
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['保存', '放弃修改', '取消'],
    defaultId: 0, cancelId: 2,
    title: '未保存的标注',
    message: `当前对话视图有 ${count} 条未保存的标注修改`,
    detail: '切换标签页前是否要保存？选择"放弃修改"将丢失这些编辑。'
  });
  if (response === 0) return 'save';
  if (response === 1) return 'discard';
  return 'cancel';
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
    if (/^mpmedia:\/\//i.test(src)) {
      try { return `<img${pre} src=${q}${localPathToFileUrl(urlToLocalPath(src))}${q}`; }
      catch (err) { console.warn('[MarkMate:img-rewrite]', err); return m; }
    }
    if (/^(https?:|file:|data:)/i.test(src)) return m;
    if (!baseDir) return m;
    try {
      // HTML 里的相对路径可能已是 URL 编码（my%20pic.png），先解码再转，否则 pathToFileURL 会二次编码成 %2520
      let rel = src;
      try { rel = decodeURI(src); } catch { /* 保持原样 */ }
      return `<img${pre} src=${q}${localPathToFileUrl(path.resolve(baseDir, rel))}${q}`;
    } catch (err) { console.warn('[MarkMate:img-rewrite]', err); return m; }
  });
}
let cachedVditorCss = null;
function loadVditorCss() {
  if (cachedVditorCss !== null) return cachedVditorCss;
  try { const cssPath = path.join(__dirname, 'node_modules', 'vditor', 'dist', 'index.css'); cachedVditorCss = fs.readFileSync(cssPath, 'utf-8'); } catch (err) { console.warn('[MarkMate:vditor-css]', err); cachedVditorCss = ''; }
  return cachedVditorCss;
}
function wrapExportHtml(title, bodyHtml, opts = {}) {
  const css = loadVditorCss();
  const baseCss = `body{margin:0;padding:40px;background:#fff;color:#24292e;font-family:-apple-system,"PingFang SC","Helvetica Neue","Microsoft YaHei",sans-serif;line-height:1.7;font-size:16px;-webkit-font-smoothing:antialiased;}.vditor-reset{max-width:820px;margin:0 auto;}.vditor-reset img{max-width:100%;height:auto;}.vditor-reset pre{background:#f6f8fa;padding:16px;border-radius:6px;overflow:auto;font-family:"SF Mono",Menlo,Consolas,monospace;font-size:14px;}.vditor-reset code{background:rgba(175,184,193,.2);padding:.2em .4em;border-radius:4px;font-family:"SF Mono",Menlo,Consolas,monospace;font-size:.9em;}.vditor-reset pre code{background:transparent;padding:0;}.vditor-reset table{border-collapse:collapse;margin:16px 0;font-size:14px;}.vditor-reset table td,.vditor-reset table th{border:1px solid #d0d7de;padding:4px 6px;word-wrap:break-word;overflow-wrap:break-word;}.vditor-reset blockquote{border-left:4px solid #d0d7de;margin:16px 0;padding:0 16px;color:#57606a;}.vditor-reset h1,.vditor-reset h2{border-bottom:1px solid #eaecef;padding-bottom:.3em;}@media print{body{padding:0;}.vditor-reset{max-width:none;}.vditor-reset table{display:table !important;width:100% !important;table-layout:auto !important;overflow:visible !important;font-size:11px;word-break:normal !important;}.vditor-reset table td,.vditor-reset table th{padding:3px 4px;white-space:normal !important;word-break:break-word !important;overflow-wrap:anywhere !important;overflow:visible !important;}.vditor-reset table thead{display:table-header-group;}.vditor-reset table tr{display:table-row !important;}pre,blockquote,img{page-break-inside:avoid;}tr{page-break-inside:avoid;}h1,h2,h3,h4{page-break-after:avoid;}}`;
  return `<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><title>${title}</title><style>${css}\n${baseCss}\n${opts.extraCss || ''}</style></head><body><div class="vditor-reset">${bodyHtml}</div></body></html>`;
}

ipcMain.handle('export-html', async (event, { html } = {}) => {
  const { ctx, win } = ctxFromEvent(event);
  if (!win) return { saved: false };
  const { canceled, filePath } = await dialog.showSaveDialog(win, { defaultPath: exportStem(ctx) + '.html', filters: [{ name: 'HTML', extensions: ['html'] }] });
  if (canceled || !filePath) return { saved: false };
  try { const finalHtml = wrapExportHtml(path.basename(filePath), absolutizeImageSrc(html, docBaseDir(ctx))); fs.writeFileSync(filePath, finalHtml, 'utf-8'); return { saved: true, path: filePath }; }
  catch (err) { dialog.showErrorBox('导出 HTML 失败', String(err)); return { saved: false }; }
});

ipcMain.handle('export-pdf', async (event, { html } = {}) => {
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
  finally { if (pdfWin) try { pdfWin.destroy(); } catch (err) { console.warn('[MarkMate]', err); } }
});

ipcMain.handle('export-docx', async (event, { buffer } = {}) => {
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
  // 不能用 ipcMain.once：
  // 1) 超时后 once 监听器不会被摘掉。下一次导出时，这个陈旧的监听器会抢先消费掉回复
  //    并被移除，本次的 Promise 永远没人 resolve → 又走超时。从此每次导出都失败，只能重启。
  // 2) once 不区分发送方。两个窗口几乎同时导出时，A 的监听器会吃掉 B 的回复，
  //    A 导出的是 B 的文档内容，B 永远超时 —— 静默生成错误文件。
  const html = await new Promise((resolve) => {
    if (!win || win.isDestroyed()) return resolve('');
    const wc = win.webContents;
    let settled = false;
    let timer = null;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      ipcMain.removeListener('export-png-html', onReply);
      if (timer) clearTimeout(timer);
      resolve(value);
    };
    function onReply(e, payload) {
      if (e.sender !== wc) return;          // 只认本窗口的回复
      finish((payload && payload.html) || '');
    }
    ipcMain.on('export-png-html', onReply);
    timer = setTimeout(() => finish(''), 5000);
    wc.send('request-png-html');
  });
  if (!html) { dialog.showErrorBox('导出长图失败', '获取页面内容超时'); return { saved: false }; }
  let expWin = null;
  try {
    const ratio = Math.max(1, Math.min(4, Number(pixelRatio) || 2));
    const baseWidth = 820; const winWidth = baseWidth + 80;
    expWin = new BrowserWindow({
      show: false, x: -10000, y: -10000, width: winWidth, height: 800,
      useContentSize: true, enableLargerThanScreen: isMac,  // macOS only，Windows 上无效
      webPreferences: { sandbox: true, offscreen: false, zoomFactor: ratio },
    });
    const fullHtml = wrapExportHtml('export', absolutizeImageSrc(html, docBaseDir(ctx)), {
      extraCss: `html,body{overflow:visible !important;}body{padding:30px 40px;}.vditor-reset{max-width:${baseWidth}px;margin:0 auto;}*{-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;}.vditor-reset pre{overflow:visible;white-space:pre-wrap;word-break:break-word;}`
    });
    const dataUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(fullHtml);
    const EXPORT_PNG_TIMEOUT = 15000;  // 15 秒总超时，避免长文档导出永久挂起
    const startedAt = Date.now();
    function checkTimeout() { if (Date.now() - startedAt > EXPORT_PNG_TIMEOUT) throw new Error('导出超时（文档可能过长，建议改用 PDF 导出）'); }
    await expWin.loadURL(dataUrl);
    await new Promise(r => setTimeout(r, 400));
    checkTimeout();
    const docSize = await expWin.webContents.executeJavaScript(`(() => { const b = document.body, d = document.documentElement; const imgs = Array.from(document.images || []); return Promise.all(imgs.map(i => i.complete ? Promise.resolve() : new Promise(r => { i.onload = i.onerror = r; }))).then(() => ({ w: Math.max(b.scrollWidth, d.scrollWidth, b.clientWidth, d.clientWidth), h: Math.max(b.scrollHeight, d.scrollHeight, b.clientHeight, d.clientHeight) })); })()`);
    const targetW = Math.max(winWidth, Math.ceil(docSize.w));
    const targetH = Math.ceil(docSize.h) + 4;
    expWin.setContentSize(targetW, targetH);
    await new Promise(r => setTimeout(r, 350));
    checkTimeout();
    const [actualW, actualH] = expWin.getContentSize();
    const fits = actualH >= targetH - 2;
    let buf;
    if (fits) {
      const image = await expWin.webContents.capturePage({ x: 0, y: 0, width: targetW, height: targetH });
      buf = image.toPNG();
    } else {
      // 窗口被系统 clamp 了（Windows 无 enableLargerThanScreen）
      console.warn('[export-png] window clamped, retry @1x');
      try { expWin.webContents.setZoomFactor(1); } catch (err) { console.warn('[MarkMate]', err); }
      await new Promise(r => setTimeout(r, 150));
      checkTimeout();
      expWin.setContentSize(targetW, targetH);
      await new Promise(r => setTimeout(r, 350));
      checkTimeout();
      const [w2, h2] = expWin.getContentSize();
      if (h2 >= targetH - 2) {
        const image = await expWin.webContents.capturePage({ x: 0, y: 0, width: targetW, height: targetH });
        buf = image.toPNG();
      } else if (!isMac) {
        // Windows: 尝试逐级降低 zoom 适配内容
        let winFit = false;
        for (const z of [0.7, 0.5, 0.35]) {
          try { expWin.webContents.setZoomFactor(z); } catch (err) { console.warn('[MarkMate:zoom]', err); break; }
          await new Promise(r => setTimeout(r, 150));
          checkTimeout();
          expWin.setContentSize(targetW, targetH);
          await new Promise(r => setTimeout(r, 350));
          checkTimeout();
          const [wz, hz] = expWin.getContentSize();
          if (hz >= targetH - 2) {
            const image = await expWin.webContents.capturePage({ x: 0, y: 0, width: targetW, height: targetH });
            buf = image.toPNG();
            winFit = true;
            break;
          }
        }
        if (!winFit) {
          throw new Error(`文档过长（需 ${targetH}px / 屏幕高 ${h2}px）。\nWindows 上导出超长文档 PNG 受限，建议改用 PDF 导出。`);
        }
      } else {
        throw new Error(`文档过长（需 ${targetH}px / 实 ${h2}px）。`);
      }
    }
    fs.writeFileSync(filePath, buf);
    return { saved: true, path: filePath };
  } catch (err) { dialog.showErrorBox('导出长图失败', String(err)); return { saved: false }; }
  finally { if (expWin) try { expWin.destroy(); } catch (err) { console.warn('[MarkMate]', err); } }
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
  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about', label: '关于 MarkMate' },
        { type: 'separator' },
        { role: 'hide', label: '隐藏 MarkMate' },
        { role: 'hideOthers', label: '隐藏其他' },
        { role: 'unhide', label: '全部显示' },
        { type: 'separator' },
        { role: 'quit', label: '退出 MarkMate' }
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
        { label: isMac ? '在 Finder 中显示历史目录' : '在文件夹中显示历史目录', click: () => shell.openPath(path.join(app.getPath('userData'), 'history')) },
        { label: isMac ? '在 Finder 中显示图片目录' : '在文件夹中显示图片目录', click: () => { const w = BrowserWindow.getFocusedWindow(); if (w) w.webContents.send('reveal-assets-dir'); } },
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

// ============ IPC: 文件拖入 / 双击打开 ============
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); } else {
  app.on('second-instance', (_event, argv) => {
    // 用户尝试打开第二个实例 → 在当前实例中打开文件
    const fp = fileFromArgv(argv);
    if (fp) openFile(fp);
    // 聚焦已有窗口
    const win = BrowserWindow.getAllWindows()[0];
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
}

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

  // 冷启动待打开文件（两个来源：全局待定 / 本窗口 ctx 上待定）
  const pendingPath = ctx.pendingOpenPath || _pendingOpenPathGlobal;
  if (pendingPath) {
    ctx.pendingOpenPath = null;
    _pendingOpenPathGlobal = null;
    openFileInWindow(win, pendingPath);
  }
});

ipcMain.on('set-native-theme', (event, mode) => {
  if (mode === 'light' || mode === 'dark' || mode === 'system') nativeTheme.themeSource = mode;
});

// ============ IPC: Tab 激活通知 ============
ipcMain.on('tab-activated', (event, { filePath, codeMode, dirty } = {}) => {
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

// ============ IPC: 在文件夹中显示文件 ============
ipcMain.on('reveal-file-in-finder', (event, filePath) => {
  if (typeof filePath !== 'string' || !filePath) return;
  if (!fs.existsSync(filePath)) return;
  shell.showItemInFolder(filePath);   // 只是在 Finder 里揭示，不会执行文件
});

// ============ IPC: 在 Finder 中打开文件夹 ============
ipcMain.on('open-folder', (event, dirPath) => {
  if (typeof dirPath !== 'string' || !dirPath) return;
  // 必须确认是目录：shell.openPath 是"用系统默认程序打开任意路径"，
  // 对 .app / .exe / .command / .bat 来说就等于**执行**。
  // 只校验"存在"的话，渲染层一旦被注入就能借这个通道运行任意本地程序，
  // 把 contextIsolation + nodeIntegration:false 的沙箱边界绕过去。
  let st;
  try { st = fs.statSync(dirPath); } catch (err) { return; }
  if (!st.isDirectory()) return;
  shell.openPath(dirPath);
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
  } catch (err) { console.error('[MarkMate]', err); return []; }
});

ipcMain.handle('get-recent-files', async () => {
  const data = readAppData();
  return data.recentFiles || [];
});

// 渲染进程同步历史/收藏数据到主进程（持久化到 JSON 文件）
ipcMain.on('sync-app-data', (event, { key, items } = {}) => {
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

ipcMain.handle('save-uploaded-image', async (event, { name, type, size, buffer } = {}) => {
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
    const fileUrl = pathToMpmediaUrl(fullPath);
    const relPath = (ctx && ctx.currentFilePath) ? './assets/' + filename : '';
    return { url: fileUrl, relPath, path: fullPath };
  } catch (err) {
    console.error('[MarkMate] 图片保存失败:', err);
    return { url: '', path: '' };
  }
});

// ============ 命令行参数 ============
function fileFromArgv(argv) {
  // 不硬编码 argv 索引（不同打包方式/启动方式下 argv 布局不同），
  // 直接过滤出存在的文件路径
  const codeExtRe = new RegExp(`\\.(${CODE_EXT_LIST.join('|')})$`, 'i');
  for (const a of argv) {
    if (a.startsWith('-')) continue;
    if (a === '.' || a === __dirname || a === process.execPath) continue;
    try { if (!fs.existsSync(a)) continue; } catch (err) { console.warn('[MarkMate:argv]', err); continue; }
    // 排除明显的非文件路径（目录、Electron 内部路径）
    try { if (fs.statSync(a).isDirectory()) continue; } catch (err) { console.warn('[MarkMate:argv]', err); continue; }
    if ((/\.(md|markdown|mdown|txt)$/i.test(a) || codeExtRe.test(a))) return a;
  }
  return null;
}

// ============ 自定义协议 ============
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
  { scheme: 'mpmedia', privileges: { standard: false, secure: true, supportFetchAPI: true, stream: true } }
]);

app.whenReady().then(() => {
  // 回收 userData 里超期 / 失效的快照与草稿（见 pruneUserData 注释）
  pruneUserData();

  // ============ Content Security Policy ============
  // 渐进式 CSP：先收紧 connect-src（防数据外泄）与 object-src（防插件），
  // script-src 暂时放行 'unsafe-inline'（vditor/prism 等第三方库依赖），
  // 后续可逐步收紧到 nonce-based。
  // 注：file:// 协议下 'self' 含义不稳，显式补 file:/data:/blob:/mpmedia:。
  const csp = [
    "default-src 'self' file: data: blob: mpmedia:",
    "script-src 'self' file: 'unsafe-inline'",
    "style-src 'self' file: 'unsafe-inline'",
    "img-src 'self' file: data: blob: mpmedia: https:",
    "connect-src 'self' file: data: https://api.github.com https://github.com https://*.githubusercontent.com",
    "font-src 'self' file: data:",
    "worker-src 'self' file: blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'"
  ].join('; ');
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp]
      }
    });
  });

  // ============ 版本升级（electron-updater）============
  // 懒加载，避免在 app ready 前访问 app.getVersion()
  const { autoUpdater } = require('electron-updater');
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  function sendToAll(channel, data) {
    BrowserWindow.getAllWindows().forEach(w => {
      if (!w.isDestroyed()) w.webContents.send(channel, data);
    });
  }

  autoUpdater.on('checking-for-update', () => {
    sendToAll('update-status', { status: 'checking' });
  });
  autoUpdater.on('update-available', (info) => {
    sendToAll('update-status', { status: 'available', version: info.version });
  });
  autoUpdater.on('update-not-available', () => {
    sendToAll('update-status', { status: 'up-to-date' });
  });
  autoUpdater.on('download-progress', (p) => {
    sendToAll('update-status', { status: 'downloading', percent: p.percent, transferred: p.transferred, total: p.total });
  });
  autoUpdater.on('update-downloaded', () => {
    sendToAll('update-status', { status: 'downloaded' });
  });
  autoUpdater.on('error', (err) => {
    sendToAll('update-status', { status: 'error', error: err && err.message || String(err) });
  });

  ipcMain.handle('check-update', async () => {
    try {
      const result = await autoUpdater.checkForUpdates();
      return { hasUpdate: !!(result && result.updateInfo && result.updateInfo.version !== app.getVersion()), version: result && result.updateInfo && result.updateInfo.version };
    } catch (err) {
      return { hasUpdate: false, error: err && err.message || String(err) };
    }
  });

  ipcMain.on('start-download-update', () => {
    autoUpdater.downloadUpdate().catch(() => {});
  });

  ipcMain.on('install-update', () => {
    autoUpdater.quitAndInstall();
  });

  // ============ 自定义协议 ============
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
    } catch (err) { console.warn('[MarkMate:mpmedia]', err); return new Response('Not Found', { status: 404 }); }
  });

  protocol.handle('mpmedia', (request) => {
    try {
      // urlToLocalPath 内部用 path.resolve 解析 .. 并归一化，再校验在用户 home 目录内，防路径穿越
      const resolved = urlToLocalPath(request.url);
      const homeDir = path.resolve(require('os').homedir());
      // Windows 文件系统大小写不敏感，盘符 / 用户目录大小写可能与 os.homedir() 不一致
      const norm = (s) => process.platform === 'win32' ? s.toLowerCase() : s;
      if (!norm(resolved).startsWith(norm(homeDir + path.sep)) && norm(resolved) !== norm(homeDir)) {
        return new Response('Forbidden', { status: 403 });
      }
      if (!/\.(png|jpe?g|gif|svg|webp|bmp|ico|avif)$/i.test(resolved)) {
        return new Response('Forbidden', { status: 403 });
      }
      const data = fs.readFileSync(resolved);
      const ext = path.extname(resolved).toLowerCase();
      const mime = {
        '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
        '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
        '.bmp': 'image/bmp', '.ico': 'image/x-icon', '.avif': 'image/avif',
      }[ext] || 'application/octet-stream';
      return new Response(data, { headers: { 'Content-Type': mime } });
    } catch (err) { console.warn('[MarkMate:mpmedia]', err); return new Response('Not Found', { status: 404 }); }
  });

  createWindow();
  buildMenu();

  const argFile = fileFromArgv(process.argv);
  if (argFile) _pendingOpenPathGlobal = argFile;

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', (e) => {
  const wins = BrowserWindow.getAllWindows();
  let anyNeedsConfirm = false;
  // 不再依赖 ctx.currentDirty（单文件脏标记），让每个窗口的 close 事件走 confirm-close 流程
  // 由渲染层判定。这里对所有尚未确认关闭的窗口都触发 close（而非只处理第一个），
  // 否则多窗口退出时只有一个窗口弹确认，其余窗口的未保存内容可能被静默丢弃。
  for (const win of wins) {
    const ctx = getContext(win.id);
    if (ctx && !ctx.allowClose) {
      anyNeedsConfirm = true;
      if (!win.isDestroyed()) win.close();
    }
  }
  if (anyNeedsConfirm) {
    // 记住"用户确实想退出"。preventDefault 只是为了先走完各窗口的保存确认流程，
    // 等窗口全部关掉后必须由 window-all-closed 把 quit 重新发起一次。
    // 少了这个标记，macOS 上 ⌘Q 的表现是"窗口全关了、App 还在 Dock 里"，得按第二次才真退出。
    quitRequested = true;
    e.preventDefault();
  }
});

app.on('window-all-closed', () => {
  // darwin 下平时关掉所有窗口不退出（macOS 习惯），但如果这次是用户主动 ⌘Q 触发的，就必须退出
  if (quitRequested || process.platform !== 'darwin') app.quit();
});
