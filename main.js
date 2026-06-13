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

  if (process.env.MARKPAD_DEBUG === '1') {
    mainWindow.webContents.openDevTools({ mode: 'right' });
  }


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
    const rawContent = fs.readFileSync(fp, 'utf-8');
    currentFilePath = fp;
    setTitle(fp, false);
    // 把相对路径的图片展开为 file:// 绝对路径（仅用于编辑器内显示，磁盘里不变）
    const content = expandImagePaths(rawContent, fp);
    mainWindow.webContents.send('file-opened', { path: fp, content });
    app.addRecentDocument(fp);
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  } catch (err) {
    dialog.showErrorBox('打开失败', String(err));
  }
}

function writeFile(fp, content) {
  // 把图片的 file:// 绝对路径转成相对 md 文件的相对路径（前提是同盘且在 assets/ 内）
  // ——这样图片可随 md 文件迁移，移到别的电脑也不会失效
  const normalized = normalizeImagePaths(content, fp);
  fs.writeFileSync(fp, normalized, 'utf-8');
  currentFilePath = fp;
  setTitle(fp, false);
  app.addRecentDocument(fp);
  // 命名文件保存后，清掉未命名草稿
  clearDraftIfAny();
}

// 把 markdown 里 file:// 绝对路径形式的图片，转成相对 md 文件的相对路径
// 用于"未命名 → 另存为"或"图片粘贴时还没保存过"的情况
function normalizeImagePaths(content, mdPath) {
  if (!content || !mdPath) return content;
  const mdDir = path.dirname(mdPath);
  const convert = (url) => {
    if (!/^file:\/\//i.test(url)) return null;
    try {
      const abs = decodeURI(url.replace(/^file:\/\//i, ''));
      if (!path.isAbsolute(abs)) return null;
      const rel = path.relative(mdDir, abs);
      if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
      return './' + rel.split(path.sep).join('/');
    } catch (_) { return null; }
  };
  // Markdown: ![alt](url "title")
  content = content.replace(/(!\[[^\]]*\]\()([^)\s]+)((?:\s+"[^"]*")?\))/g,
    (m, head, url, tail) => { const r = convert(url); return r ? head + r + tail : m; });
  // HTML: <img ... src="url" ...>
  content = content.replace(/(<img\b[^>]*?\ssrc=["'])([^"']+)(["'][^>]*>)/gi,
    (m, head, url, tail) => { const r = convert(url); return r ? head + r + tail : m; });
  return content;
}

// 反向：把 md 里的相对路径图片转成 file:// 绝对路径用于编辑器内显示
function expandImagePaths(content, mdPath) {
  if (!content || !mdPath) return content;
  const mdDir = path.dirname(mdPath);
  const convert = (url) => {
    if (/^(file:|https?:|data:)/i.test(url)) return null;
    if (url.startsWith('#') || url.startsWith('//')) return null;
    try {
      const abs = path.resolve(mdDir, url);
      if (!/\.(png|jpe?g|gif|svg|webp|bmp|ico|avif)$/i.test(abs)) return null;
      return 'file://' + abs.split(path.sep).join('/');
    } catch (_) { return null; }
  };
  content = content.replace(/(!\[[^\]]*\]\()([^)\s]+)((?:\s+"[^"]*")?\))/g,
    (m, head, url, tail) => { const r = convert(url); return r ? head + r + tail : m; });
  content = content.replace(/(<img\b[^>]*?\ssrc=["'])([^"']+)(["'][^>]*>)/gi,
    (m, head, url, tail) => { const r = convert(url); return r ? head + r + tail : m; });
  return content;
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
    // 快照存的是磁盘上的归一化版本（相对路径），保证版本恢复后路径仍然有效
    snapshotVersion(fp, normalizeImagePaths(content, fp));
    return { saved: true, path: fp };
  } catch (err) {
    dialog.showErrorBox('保存失败', String(err));
    return { saved: false };
  }
});

// ============ 自动保存与版本历史 ============
// 命名文件：自动保存到原路径 + 打快照到历史区
// 未命名文件：把内容存到 drafts/ 目录的临时草稿（崩溃恢复）
ipcMain.handle('auto-save', async (event, { content }) => {
  try {
    if (currentFilePath) {
      // 命名文件：直接保存（writeFile 内部已做相对路径归一化）
      writeFile(currentFilePath, content);
      snapshotVersion(currentFilePath, normalizeImagePaths(content, currentFilePath));
      return { saved: true, autoSaved: true, path: currentFilePath };
    } else {
      // 未命名：写到草稿目录
      saveDraft(content);
      return { saved: false, draft: true };
    }
  } catch (err) {
    console.error('[auto-save]', err);
    return { saved: false, error: String(err) };
  }
});

// 版本历史：列出指定文件的快照
ipcMain.handle('list-versions', async (event, { filePath } = {}) => {
  const fp = filePath || currentFilePath;
  if (!fp) return [];
  try {
    const dir = versionDirFor(fp);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter(n => n.endsWith('.md'))
      .map(n => {
        const full = path.join(dir, n);
        const stat = fs.statSync(full);
        // 文件名格式：YYYYMMDD-HHmmss.md
        return { name: n, path: full, time: stat.mtimeMs, size: stat.size };
      })
      .sort((a, b) => b.time - a.time);
  } catch (_) { return []; }
});

// 读取某个快照内容
ipcMain.handle('read-version', async (event, { versionPath }) => {
  try {
    const raw = fs.readFileSync(versionPath, 'utf-8');
    // 版本快照里是相对路径，恢复到编辑器前要展开成 file:// 让图片可见
    const content = currentFilePath ? expandImagePaths(raw, currentFilePath) : raw;
    return { ok: true, content };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

// 启动时检查草稿目录里是否有未命名草稿，有就提示恢复
ipcMain.handle('check-draft', async () => {
  try {
    const draftDir = getDraftDir();
    if (!fs.existsSync(draftDir)) return { has: false };
    const files = fs.readdirSync(draftDir).filter(n => n.endsWith('.md'));
    if (!files.length) return { has: false };
    // 取最新的
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

// ====== 历史/草稿存储辅助 ======
const MAX_VERSIONS_PER_FILE = 10;

function appDataDir() {
  return path.join(app.getPath('userData'), 'history');
}
function getDraftDir() {
  return path.join(app.getPath('userData'), 'drafts');
}
function hashPath(fp) {
  // 简单稳定哈希：取 path 的 djb2，保留 8 hex
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
    // 与上一个快照内容相同则跳过
    const existing = fs.readdirSync(dir).filter(n => n.endsWith('.md')).sort();
    if (existing.length) {
      const last = path.join(dir, existing[existing.length - 1]);
      try {
        const lastContent = fs.readFileSync(last, 'utf-8');
        if (lastContent === content) return;
      } catch (_) {}
    }
    const file = path.join(dir, `${timestamp()}.md`);
    fs.writeFileSync(file, content, 'utf-8');
    // 超出上限淘汰最旧
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
    // 单一草稿文件（未命名只保留最新），如需多窗口可扩展为按窗口 id
    const file = path.join(dir, 'unsaved-draft.md');
    fs.writeFileSync(file, content, 'utf-8');
  } catch (err) { console.error('[draft]', err); }
}
// 命名文件成功保存后，清空未命名草稿
function clearDraftIfAny() {
  try {
    const file = path.join(getDraftDir(), 'unsaved-draft.md');
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch (_) {}
}

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

// ============ 导出 ============
// 缺省文件名（去扩展名）
function exportStem() {
  return currentFilePath
    ? path.basename(currentFilePath, path.extname(currentFilePath))
    : '未命名';
}
// 文档同目录（用来解析 ./assets/xx 的相对路径）
function docBaseDir() {
  return currentFilePath ? path.dirname(currentFilePath) : null;
}
// 把 html 中 <img src="./assets/xx"> 转成 file:// 绝对路径
// PDF/长图/Word 渲染时图片必须可解析
function absolutizeImageSrc(html, baseDir) {
  if (!baseDir) return html;
  return html.replace(/<img\b([^>]*?)\ssrc=(["'])([^"']+)\2/gi, (m, pre, q, src) => {
    if (/^(https?:|file:|data:)/i.test(src)) return m;
    try {
      const abs = path.resolve(baseDir, src);
      const url = 'file://' + abs.split(path.sep).join('/');
      return `<img${pre} src=${q}${url}${q}`;
    } catch (_) { return m; }
  });
}
// 加载 vditor 预览样式（一次性缓存）
let cachedVditorCss = null;
function loadVditorCss() {
  if (cachedVditorCss !== null) return cachedVditorCss;
  try {
    const cssPath = path.join(__dirname, 'node_modules', 'vditor', 'dist', 'index.css');
    cachedVditorCss = fs.readFileSync(cssPath, 'utf-8');
  } catch (_) { cachedVditorCss = ''; }
  return cachedVditorCss;
}
// 通用 HTML 包装：注入 vditor 样式 + 基础排版 + 打印优化
function wrapExportHtml(title, bodyHtml, opts = {}) {
  const css = loadVditorCss();
  const baseCss = `
body{margin:0;padding:40px;background:#fff;color:#24292e;
  font-family:-apple-system,"PingFang SC","Helvetica Neue","Microsoft YaHei",sans-serif;
  line-height:1.7;font-size:16px;-webkit-font-smoothing:antialiased;}
.vditor-reset{max-width:820px;margin:0 auto;}
.vditor-reset img{max-width:100%;height:auto;}
.vditor-reset pre{background:#f6f8fa;padding:16px;border-radius:6px;overflow:auto;
  font-family:"SF Mono",Menlo,Consolas,monospace;font-size:14px;}
.vditor-reset code{background:rgba(175,184,193,.2);padding:.2em .4em;border-radius:4px;
  font-family:"SF Mono",Menlo,Consolas,monospace;font-size:.9em;}
.vditor-reset pre code{background:transparent;padding:0;}
.vditor-reset table{border-collapse:collapse;margin:16px 0;}
.vditor-reset table td,.vditor-reset table th{border:1px solid #d0d7de;padding:6px 12px;}
.vditor-reset blockquote{border-left:4px solid #d0d7de;margin:16px 0;padding:0 16px;color:#57606a;}
.vditor-reset h1,.vditor-reset h2{border-bottom:1px solid #eaecef;padding-bottom:.3em;}
@media print{
  body{padding:0;}
  .vditor-reset{max-width:none;}
  pre,blockquote,table,img{page-break-inside:avoid;}
  h1,h2,h3,h4{page-break-after:avoid;}
}
`;
  return `<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><title>${title}</title><style>${css}\n${baseCss}\n${opts.extraCss || ''}</style></head><body><div class="vditor-reset">${bodyHtml}</div></body></html>`;
}

// ---- HTML 导出 ----
ipcMain.handle('export-html', async (event, { html }) => {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    defaultPath: exportStem() + '.html',
    filters: [{ name: 'HTML', extensions: ['html'] }]
  });
  if (canceled || !filePath) return { saved: false };
  try {
    const finalHtml = wrapExportHtml(path.basename(filePath), absolutizeImageSrc(html, docBaseDir()));
    fs.writeFileSync(filePath, finalHtml, 'utf-8');
    return { saved: true, path: filePath };
  } catch (err) {
    dialog.showErrorBox('导出 HTML 失败', String(err));
    return { saved: false };
  }
});

// ---- PDF 导出（Electron printToPDF，零额外依赖）----
ipcMain.handle('export-pdf', async (event, { html }) => {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    defaultPath: exportStem() + '.pdf',
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  });
  if (canceled || !filePath) return { saved: false };
  let pdfWin = null;
  try {
    const fullHtml = wrapExportHtml(path.basename(filePath), absolutizeImageSrc(html, docBaseDir()));
    pdfWin = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
    const dataUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(fullHtml);
    await pdfWin.loadURL(dataUrl);
    await new Promise(r => setTimeout(r, 250)); // 等字体/图片就位
    const data = await pdfWin.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: { marginType: 'custom', top: 0.6, bottom: 0.6, left: 0.6, right: 0.6 }
    });
    fs.writeFileSync(filePath, data);
    return { saved: true, path: filePath };
  } catch (err) {
    dialog.showErrorBox('导出 PDF 失败', String(err));
    return { saved: false };
  } finally {
    if (pdfWin) try { pdfWin.destroy(); } catch (_) {}
  }
});

// ---- Word (.docx) 导出 ----
// 渲染层用 html-docx-js 生成 Blob 字节数组传过来；主进程负责选路径 + 写盘
ipcMain.handle('export-docx', async (event, { buffer }) => {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    defaultPath: exportStem() + '.docx',
    filters: [{ name: 'Word 文档', extensions: ['docx'] }]
  });
  if (canceled || !filePath) return { saved: false };
  try {
    fs.writeFileSync(filePath, Buffer.from(buffer));
    return { saved: true, path: filePath };
  } catch (err) {
    dialog.showErrorBox('导出 Word 失败', String(err));
    return { saved: false };
  }
});

// ---- 长图（PNG）导出 ----
// 用 offscreen BrowserWindow 加载完整 HTML，让 Chromium 原生渲染管线截全图。
// 比渲染层 html2canvas 质量高得多：中文字体、KaTeX、代码块、emoji 全部 1:1 还原。
ipcMain.handle('export-png', async (event, { pixelRatio } = {}) => {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    defaultPath: exportStem() + '.png',
    filters: [{ name: 'PNG 图片', extensions: ['png'] }]
  });
  if (canceled || !filePath) return { saved: false };

  // 先向渲染层要一份"和编辑器一致"的 HTML（含 vditor 渲染后的 DOM）
  const html = await new Promise((resolve) => {
    if (!mainWindow) return resolve('');
    ipcMain.once('export-png-html', (_e, payload) => resolve(payload && payload.html || ''));
    mainWindow.webContents.send('request-png-html');
    // 5 秒超时兜底
    setTimeout(() => resolve(''), 5000);
  });
  if (!html) {
    dialog.showErrorBox('导出长图失败', '获取页面内容超时');
    return { saved: false };
  }

  let win = null;
  try {
    const ratio = Math.max(1, Math.min(4, Number(pixelRatio) || 2));
    const baseWidth = 820;        // 文档可视宽度（和编辑器接近）
    const winWidth = baseWidth + 80; // 留点 padding

    win = new BrowserWindow({
      show: false,
      width: winWidth,
      height: 800,
      useContentSize: true,
      webPreferences: {
        sandbox: true,
        offscreen: false,
        zoomFactor: ratio,       // 让 Chromium 按倍率渲染（更清晰，胜过事后放大）
      },
    });

    const fullHtml = wrapExportHtml('export', absolutizeImageSrc(html, docBaseDir()), {
      // 长图专用：去掉编辑器 max-width / padding 限制由外层 body 控制
      extraCss: `body{padding:30px 40px;}
.vditor-reset{max-width:${baseWidth}px;margin:0 auto;}
/* 字体平滑：在 retina 下细字更清晰 */
*{ -webkit-font-smoothing:antialiased; text-rendering:optimizeLegibility; }
/* 别让代码块横向滚动条出现在截图里 */
.vditor-reset pre{ overflow:visible; white-space:pre-wrap; word-break:break-word; }`
    });

    const dataUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(fullHtml);
    await win.loadURL(dataUrl);
    // 等字体/图片就绪 + 任何动画落定
    await new Promise(r => setTimeout(r, 400));

    // 量一下文档实际高度（CSS 像素），然后把窗口 resize 成整页高度
    const docSize = await win.webContents.executeJavaScript(`
      (() => {
        const b = document.body, d = document.documentElement;
        // 等所有图片加载完
        const imgs = Array.from(document.images || []);
        return Promise.all(imgs.map(i => i.complete ? Promise.resolve() : new Promise(r => { i.onload = i.onerror = r; })))
          .then(() => ({
            w: Math.max(b.scrollWidth, d.scrollWidth, b.clientWidth, d.clientWidth),
            h: Math.max(b.scrollHeight, d.scrollHeight, b.clientHeight, d.clientHeight)
          }));
      })()
    `);

    // 把窗口扩到能装下整篇文档
    win.setContentSize(
      Math.max(winWidth, Math.ceil(docSize.w)),
      Math.ceil(docSize.h) + 4
    );
    await new Promise(r => setTimeout(r, 250)); // 等 resize 后重新布局

    const image = await win.webContents.capturePage();
    // capturePage 在 zoomFactor > 1 时返回的是物理像素，刚好就是我们要的高清
    const buf = image.toPNG();
    fs.writeFileSync(filePath, buf);
    return { saved: true, path: filePath };
  } catch (err) {
    dialog.showErrorBox('导出长图失败', String(err));
    return { saved: false };
  } finally {
    if (win) try { win.destroy(); } catch (_) {}
  }
});

// ---- 渲染层导出 Word/长图时需要：完整 CSS + 文档目录 ----
ipcMain.handle('get-export-resources', async () => ({
  vditorCss: loadVditorCss(),
  baseDir: docBaseDir(),
}));

// 渲染层把 vditor.getHTML() 回传给主进程（长图导出用）
// 注：使用 ipcMain.on（一次性的），由 export-png 里 once 监听

// ---- 在 Finder 中显示图片目录 ----
ipcMain.handle('reveal-assets-dir', async () => {
  const baseDir = currentFilePath ? path.dirname(currentFilePath) : app.getPath('temp');
  const assetsDir = path.join(baseDir, 'assets');
  try {
    if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });
    shell.openPath(assetsDir);
    return { ok: true, path: assetsDir };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
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
        { label: '快速打开…', accelerator: 'CmdOrCtrl+P', click: () => mainWindow.webContents.send('quick-open') },
        { type: 'separator' },
        { label: '保存', accelerator: 'CmdOrCtrl+S', click: doSave },
        { label: '另存为…', accelerator: 'CmdOrCtrl+Shift+S', click: doSaveAs },
        { type: 'separator' },
        { label: '加入收藏', accelerator: 'CmdOrCtrl+D', click: () => mainWindow.webContents.send('toggle-favorite') },
        { type: 'separator' },
        { label: '历史版本…', click: () => mainWindow.webContents.send('show-versions') },
        { label: '在 Finder 中显示历史目录', click: () => shell.openPath(path.join(app.getPath('userData'), 'history')) },
        { label: '在 Finder 中显示图片目录', click: () => mainWindow.webContents.send('reveal-assets-dir') },
        { type: 'separator' },
        {
          label: '导出',
          submenu: [
            { label: 'PDF…', accelerator: 'CmdOrCtrl+Shift+P', click: () => mainWindow.webContents.send('request-export', 'pdf') },
            { label: 'HTML…', click: () => mainWindow.webContents.send('request-export', 'html') },
            { label: 'Word…', click: () => mainWindow.webContents.send('request-export', 'docx') },
            { label: '长图（PNG）…', click: () => mainWindow.webContents.send('request-export', 'png') }
          ]
        }
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
        { label: '内容搜索…', accelerator: 'CmdOrCtrl+F', click: () => mainWindow.webContents.send('show-find') },
        { type: 'separator' },
        { label: '切换大纲', accelerator: 'CmdOrCtrl+\\', click: () => mainWindow.webContents.send('toggle-outline') },
        { label: '切换源码面板', accelerator: 'CmdOrCtrl+E', click: () => mainWindow.webContents.send('toggle-source') },
        { type: 'separator' },
        { label: '专注模式', accelerator: 'CmdOrCtrl+Shift+F', click: () => mainWindow.webContents.send('toggle-focus-mode') },
        { label: '打字机模式', accelerator: 'CmdOrCtrl+Shift+T', click: () => mainWindow.webContents.send('toggle-typewriter-mode') },
        { type: 'separator' },
        {
          label: '外观主题',
          submenu: [
            { label: '亮色', type: 'radio', click: () => mainWindow.webContents.send('set-theme', 'light') },
            { label: '暗色', type: 'radio', click: () => mainWindow.webContents.send('set-theme', 'dark') },
            { label: '跟随系统', type: 'radio', click: () => mainWindow.webContents.send('set-theme', 'system') }
          ]
        },
        { label: '切换亮/暗', accelerator: 'CmdOrCtrl+/', click: () => mainWindow.webContents.send('toggle-theme') },
        {
          label: '样式主题',
          submenu: [
            { label: '默认', type: 'radio', click: () => mainWindow.webContents.send('set-style-theme', 'default') },
            { label: 'GitHub', type: 'radio', click: () => mainWindow.webContents.send('set-style-theme', 'github') },
            { label: 'Night', type: 'radio', click: () => mainWindow.webContents.send('set-style-theme', 'night') },
            { label: 'Sepia', type: 'radio', click: () => mainWindow.webContents.send('set-style-theme', 'sepia') },
            { label: 'Slate', type: 'radio', click: () => mainWindow.webContents.send('set-style-theme', 'slate') }
          ]
        },
        { label: '下一个样式主题', accelerator: 'CmdOrCtrl+Shift+/', click: () => mainWindow.webContents.send('next-style-theme') },
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

// 列出目录内容（返回 md/txt 文件）
ipcMain.handle('list-directory', async (event, dirPath) => {
  try {
    if (!dirPath || !fs.existsSync(dirPath)) return [];
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    return entries
      .filter(e => e.isDirectory() || /\.(md|markdown|mdown|mkd|txt)$/i.test(e.name))
      .map(e => ({ name: e.name, isDir: e.isDirectory(), path: path.join(dirPath, e.name) }))
      .sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : (a.isDir ? -1 : 1)));
  } catch (_) { return []; }
});

// 获取最近文件（从 app 系统级 + 额外存储；这里简单返回空让渲染层从 localStorage 取）
ipcMain.handle('get-recent-files', async () => {
  return []; // 渲染层自己管理 localStorage
});

// 图片上传：渲染进程把图片数据给主进程保存到 assets/ 目录
ipcMain.handle('save-uploaded-image', async (event, { name, type, size, buffer }) => {
  try {
    // 确定图片保存目录：有已打开文件 → 同目录 assets/；否则 → 临时目录
    const baseDir = currentFilePath
      ? path.dirname(currentFilePath)
      : app.getPath('temp');
    const assetsDir = path.join(baseDir, 'assets');
    if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });

    // 生成唯一文件名，避免冲突
    const ext = path.extname(name) || '.png';
    const stem = path.basename(name, ext).replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, '_').slice(0, 40)
               || 'image';
    const ts = Date.now();
    let filename = `${stem}${ext}`;
    let fullPath = path.join(assetsDir, filename);
    // 文件名冲突时加时间戳后缀
    if (fs.existsSync(fullPath)) {
      filename = `${stem}_${ts}${ext}`;
      fullPath = path.join(assetsDir, filename);
    }

    const buf = Buffer.from(buffer);
    fs.writeFileSync(fullPath, buf);

    // 返回给渲染层的 URL：统一用 file:// 绝对路径
    // —— 这样编辑器内立即可见图片（相对路径在 IR 模式下不会渲染，会显示裂图）
    // 真正保存 md 时，由 save-content 的预处理把绝对路径转回相对路径，保证 md 文件可移植
    const fileUrl = 'file://' + fullPath.split(path.sep).join('/');
    // 同时返回相对路径，供需要的场景使用
    const relPath = currentFilePath ? './assets/' + filename : '';
    return { url: fileUrl, relPath, path: fullPath };
  } catch (err) {
    console.error('[MarkPad] 图片保存失败:', err);
    return { url: '', path: '' };
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
