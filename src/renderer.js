// MarkPad 渲染进程逻辑
let vditor = null;
let vditorReady = false;
let pendingValue = null;
let isDirty = false;
let outlineVisible = true;
let sourceVisible = false;
// 专注模式：仅高亮当前段落
let focusMode = false;
// 打字机模式：光标始终居中
let typewriterMode = false;
// 样式主题：'default' | 'github' | 'night' | 'sepia' | 'slate'，持久化到 localStorage
let styleTheme = localStorage.getItem('markpad-style-theme') || 'default';
// 源码↔渲染双向同步时用来抑制回环
let syncingFromVditor = false;
let syncingFromSource = false;
let sourceSyncTimer = null;
// 主题模式：'light' | 'dark' | 'system'，持久化到 localStorage
let themeMode = localStorage.getItem('markpad-theme') || 'system';
// 当前是否实际处于暗色（system 模式下由系统决定）
let darkMode = false;
const systemDark = window.matchMedia('(prefers-color-scheme: dark)');

function computeDark() {
  return themeMode === 'dark' || (themeMode === 'system' && systemDark.matches);
}

let currentFilePath = null;

const statusFile = document.getElementById('status-file');
const statusWords = document.getElementById('status-words');
const statusCursor = document.getElementById('status-cursor');
const outlineEl = document.getElementById('outline');
const sourceEl = document.getElementById('source-pane');
const sourceEditor = document.getElementById('source-editor');

const WELCOME = `# 欢迎使用 MarkPad

一款 **类 Typora** 的所见即所得 Markdown 编辑器。直接在这里输入，内容会即时渲染。

## 基础格式

**粗体**、*斜体*、~~删除线~~、\`行内代码\`、==Markdown 高亮（导出生效）==

## 列表与引用

- 无序列表项
  1. 有序子列表
  2. 有序子列表
- 另一个列表项

> 这是一级引用
> > 这是二级嵌套引用

## 任务清单

- [x] 已完成任务
- [x] 另一个已完成
- [ ] 待办任务
- [ ] 另一项待办

## 链接

[MarkPad GitHub](https://github.com/SirKayZh/markpad)

## 图片

直接拖拽图片或粘贴截图到编辑器，自动保存到文档同目录的 assets/ 子文件夹。

## 表格

| 功能 | 快捷键 | 说明 |
| --- | --- | --- |
| 新建 | ⌘N | 创建空白文档 |
| 打开 | ⌘O | 打开 .md 文件 |
| 保存 | ⌘S | 保存当前文档 |
| 大纲 | ⌘\\ | 左侧目录展开/收起 |
| 源码 | ⌘E | 右侧 Markdown 源码 |
| 主题 | ⌘/ | 亮色 / 暗色 / 系统 |

## 代码块（行号 + 100+ 语言高亮）

\`\`\`javascript
function fibonacci(n) {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}
console.log(fibonacci(10)); // 55
\`\`\`

\`\`\`python
def greet(name):
    """向用户问好"""
    return f"你好, {name}!"

print(greet("MarkPad"))
\`\`\`

## 数学公式（LaTeX / KaTeX）

行内公式：$E = mc^2$

块级公式：
$$
\\\\int_{-\\\\infty}^{\\\\infty} e^{-x^2} dx = \\\\sqrt{\\\\pi}
$$

## 脚注与目录

脚注[^1] 和 \`[toc]\` 目录在导出 HTML 时完整渲染，IR 编辑模式下显示为 Markdown 源码。

[^1]: MarkPad 基于 Vditor 即时渲染引擎 + Electron 桌面框架。

---

开始你的创作吧 ✍️
`;

function loadContent(value) {
  if (vditor && vditorReady) {
    syncingFromSource = true;
    vditor.setValue(value || '');
    syncingFromSource = false;
    markDirty(false);
    updateStats();
    syncSourceFromVditor(true);
    return;
  }
  pendingValue = value || '';
  if (!vditor) initVditor(pendingValue);
}

function initVditor(value) {
  if (vditor) {
    vditor.destroy();
    document.getElementById('vditor').innerHTML = '';
  }
  vditorReady = false;
  vditor = new Vditor('vditor', {
    mode: 'ir',
    value: value || '',
    theme: darkMode ? 'dark' : 'classic',
    cache: { enable: false },
    toolbar: [],
    counter: { enable: false },
    // 扩展 Markdown 语法全支持
    markdown: {
      mark: true,           // ==高亮==
      toc: true,            // [toc] 自动生成目录
      footnotes: true,      // 脚注 [^1]
      autoSpace: true,      // 中英文间自动空格
      fixTermTypo: true,    // 自动术语修正
    },
    preview: {
      theme: { current: darkMode ? 'dark' : 'light' },
      hljs: { style: darkMode ? 'native' : 'github', lineNumber: true },  // 代码行号
      math: { engine: 'KaTeX' }
    },
    // 图片拖拽/粘贴 → 保存到文档同目录的 assets/ 子目录
    upload: {
      max: 10 * 1024 * 1024,
      accept: 'image/*',
      handler(files) {
        return handleImageUpload(files);
      }
    },
    outline: { enable: false },
    placeholder: '开始输入…',
    input: () => {
      if (!syncingFromSource) {
        markDirty(true);
        updateStats();
        syncSourceFromVditor();
        scheduleOutlineRefresh();
      }
    },
    after: () => {
      vditorReady = true;
      if (pendingValue !== null) {
        syncingFromSource = true;
        vditor.setValue(pendingValue);
        syncingFromSource = false;
        pendingValue = null;
        markDirty(false);
      }
      updateStats();
      applyEditorTheme();
      syncSourceFromVditor(true);
      scheduleOutlineRefresh();
    }
  });
}

// ========= 图片上传：拖拽/粘贴 → 保存到 assets/ 子目录 =========
async function handleImageUpload(files) {
  const results = [];
  for (const file of files) {
    try {
      const result = await window.markpad.saveUploadedImage(file);
      // vditor 期望返回的格式是 URL；我们返回相对路径
      results.push(result.url);
    } catch (err) {
      console.error('[MarkPad] 图片上传失败:', err);
      return ''; // 失败返回空字符串，vditor 不会插入任何内容
    }
  }
  // vditor handler 期望返回 Promise<string>。多文件时返回 JSON 字符串会被 vditor 认识？
  // 单文件最稳，多文件 vditor 会逐个调用 handler，所以这里直接返回第一个结果
  if (results.length === 1) return results[0];
  // 多文件兜底：暂时只处理第一个（vditor IR 模式多为单文件拖入）
  return results[0] || '';
}

// ========= 大纲：自绘树形结构（多级缩进 + 折叠展开），不再依赖 vditor 自带 outline =========

// 折叠状态（按标题文本+层级记忆）
const outlineCollapseKey = 'markpad-outline-collapsed';
function getCollapsed() {
  try { return new Set(JSON.parse(localStorage.getItem(outlineCollapseKey) || '[]')); }
  catch (_) { return new Set(); }
}
function saveCollapsed(set) {
  localStorage.setItem(outlineCollapseKey, JSON.stringify([...set]));
}

// 从 vditor 编辑区扫描所有标题，构建 [{id, level, text, children}] 树
function buildHeadingTree() {
  const editArea = document.querySelector('.vditor-ir');
  if (!editArea) return [];
  const headings = editArea.querySelectorAll('h1[data-block], h2[data-block], h3[data-block], h4[data-block], h5[data-block], h6[data-block]');
  // 给每个标题确保有 id（vditor 会生成，但兜底）
  const flat = [];
  headings.forEach((h, i) => {
    if (!h.id) h.id = 'mp-h-' + i;
    const lv = parseInt(h.tagName.substring(1));
    // 标题文本（去掉编辑标记符）
    const span = h.querySelector('[data-render="1"]') || h;
    const text = (span.innerText || h.innerText || '').replace(/^#+\s*/, '').trim() || '(无标题)';
    flat.push({ id: h.id, level: lv, text, el: h });
  });
  // 构造树
  const root = { level: 0, children: [] };
  const stack = [root];
  flat.forEach(node => {
    node.children = [];
    while (stack.length > 1 && stack[stack.length - 1].level >= node.level) stack.pop();
    stack[stack.length - 1].children.push(node);
    stack.push(node);
  });
  return root.children;
}

function renderOutlineTree() {
  const tree = document.getElementById('outline-tree');
  const empty = document.getElementById('outline-empty');
  if (!tree) return;
  const headings = buildHeadingTree();
  if (!headings.length) {
    tree.innerHTML = '';
    if (empty) empty.style.display = 'block';
    return;
  }
  if (empty) empty.style.display = 'none';
  const collapsed = getCollapsed();

  function nodeHtml(n, depth) {
    const hasKids = n.children && n.children.length > 0;
    const key = n.id;
    const isCollapsed = collapsed.has(key);
    const chevron = hasKids
      ? `<span class="ol-chevron ${isCollapsed ? 'collapsed' : ''}" data-toggle="${escapeAttr(key)}">▾</span>`
      : `<span class="ol-chevron ol-leaf"></span>`;
    let html = `<div class="ol-item ol-lv-${n.level}" data-id="${escapeAttr(n.id)}" style="padding-left:${depth * 14 + 6}px" title="${escapeAttr(n.text)}">
      ${chevron}<span class="ol-text">${escapeHtml(n.text)}</span>
    </div>`;
    if (hasKids && !isCollapsed) {
      html += `<div class="ol-children">${n.children.map(c => nodeHtml(c, depth + 1)).join('')}</div>`;
    }
    return html;
  }
  tree.innerHTML = headings.map(n => nodeHtml(n, 0)).join('');
}

// 节流刷新（输入时不频繁重渲）
let outlineRefreshTimer = null;
function scheduleOutlineRefresh() {
  if (outlineRefreshTimer) clearTimeout(outlineRefreshTimer);
  outlineRefreshTimer = setTimeout(() => {
    outlineRefreshTimer = null;
    renderOutlineTree();
  }, 200);
}

// 点击处理：折叠展开 + 跳转
document.getElementById('outline-content').addEventListener('click', (e) => {
  // 折叠展开
  const chev = e.target.closest('[data-toggle]');
  if (chev) {
    e.preventDefault();
    e.stopPropagation();
    const id = chev.getAttribute('data-toggle');
    const c = getCollapsed();
    if (c.has(id)) c.delete(id); else c.add(id);
    saveCollapsed(c);
    renderOutlineTree();
    return;
  }
  // 点击条目跳转
  const item = e.target.closest('.ol-item');
  if (!item) return;
  e.preventDefault();
  e.stopPropagation();
  const targetId = item.dataset.id;
  const heading = document.getElementById(targetId);
  if (!heading) return;
  try {
    heading.scrollIntoView({ block: 'start', inline: 'nearest', behavior: 'auto' });
  } catch (_) {}
  showJumpToast({ textContent: item.querySelector('.ol-text')?.textContent || '' });
  flashHeading(heading);
  // 高亮当前项
  document.querySelectorAll('#outline-tree .ol-item').forEach(el => el.classList.remove('active'));
  item.classList.add('active');
}, true);


// Toast 提示
let jumpToastEl = null;
let jumpToastTimer = null;
function showJumpToast(span) {
  const txt = (span.textContent || '').trim().slice(0, 40);
  if (!jumpToastEl) {
    jumpToastEl = document.createElement('div');
    jumpToastEl.id = 'mp-jump-toast';
    document.body.appendChild(jumpToastEl);
  }
  jumpToastEl.textContent = '已跳转到：' + txt;
  jumpToastEl.classList.remove('show');
  void jumpToastEl.offsetWidth;
  jumpToastEl.classList.add('show');
  clearTimeout(jumpToastTimer);
  jumpToastTimer = setTimeout(() => {
    jumpToastEl && jumpToastEl.classList.remove('show');
  }, 1400);
}

// 通用轻量 toast（收藏等操作反馈）
function showQuickToast(msg) {
  if (!jumpToastEl) {
    jumpToastEl = document.createElement('div');
    jumpToastEl.id = 'mp-jump-toast';
    document.body.appendChild(jumpToastEl);
  }
  jumpToastEl.textContent = msg;
  jumpToastEl.classList.remove('show');
  void jumpToastEl.offsetWidth;
  jumpToastEl.classList.add('show');
  clearTimeout(jumpToastTimer);
  jumpToastTimer = setTimeout(() => {
    jumpToastEl && jumpToastEl.classList.remove('show');
  }, 1400);
}

// 闪烁高亮
function flashHeading(el) {
  if (!el) return;
  el.classList.remove('mp-heading-flash');
  void el.offsetWidth;
  el.classList.add('mp-heading-flash');
  setTimeout(() => el.classList.remove('mp-heading-flash'), 1700);
}

// ========= 大纲折叠/展开 =========

function toggleOutline() {
  outlineVisible = !outlineVisible;
  outlineEl.classList.toggle('hidden', !outlineVisible);
  if (outlineVisible) {
    // 恢复用户拖动设置的宽度或默认值
    const w = outlineEl.dataset.userWidth || '240';
    outlineEl.style.width = w + 'px';
    moveVditorOutline();
  } else {
    // 收起时必须清除 inline width，否则 CSS 的 width:0 被覆盖
    outlineEl.style.width = '';
  }
}

// 大纲标题栏里的折叠按钮
document.getElementById('outline-toggle').addEventListener('click', (e) => {
  e.preventDefault();
  toggleOutline();
});

// ========= 侧栏 Tab 切换（文件 / 大纲）=========
let sidebarTab = 'files'; // 默认显示文件管理
const outlineContent = document.getElementById('outline-content');
const filesContent = document.getElementById('files-content');

function switchSidebarTab(tab) {
  sidebarTab = tab;
  document.querySelectorAll('.outline-tab').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
  // 用 display 强制控制，避免被其他 class 干扰
  if (outlineContent) {
    outlineContent.classList.toggle('hidden', tab !== 'outline');
    outlineContent.style.display = tab === 'outline' ? '' : 'none';
  }
  if (filesContent) {
    filesContent.classList.toggle('hidden', tab !== 'files');
    filesContent.style.display = tab === 'files' ? '' : 'none';
  }
  if (tab === 'outline') renderOutlineTree();
  if (tab === 'files') refreshFileList();
}
document.querySelectorAll('.outline-tab').forEach(btn => {
  btn.addEventListener('click', () => switchSidebarTab(btn.dataset.tab));
});

// ========= 文件管理：分区折叠 + 关键词搜索 =========
const FILES_COLLAPSE_KEY = 'markpad-files-collapsed-sections';
let filesSearchQuery = '';

function getCollapsedSections() {
  try { return new Set(JSON.parse(localStorage.getItem(FILES_COLLAPSE_KEY) || '[]')); }
  catch (_) { return new Set(); }
}
function saveCollapsedSections(set) {
  localStorage.setItem(FILES_COLLAPSE_KEY, JSON.stringify([...set]));
}
function isSectionCollapsed(name) { return getCollapsedSections().has(name); }
function toggleSection(name) {
  const c = getCollapsedSections();
  if (c.has(name)) c.delete(name); else c.add(name);
  saveCollapsedSections(c);
  applySectionCollapsed();
}
function applySectionCollapsed() {
  document.querySelectorAll('#files-content .files-section').forEach(sec => {
    const name = sec.dataset.section;
    const collapsed = isSectionCollapsed(name);
    sec.classList.toggle('collapsed', collapsed);
    const chev = sec.querySelector('.fs-chevron');
    if (chev) chev.textContent = collapsed ? '▸' : '▾';
  });
}
// 标题点击折叠/展开
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-toggle]');
  if (!t || !t.classList.contains('files-section-title')) return;
  toggleSection(t.dataset.toggle);
}, false);
// 搜索框输入
document.addEventListener('input', (e) => {
  if (e.target && e.target.id === 'files-search-input') {
    filesSearchQuery = e.target.value.trim().toLowerCase();
    refreshFileList();
  }
});
// ESC 清空搜索
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && e.target && e.target.id === 'files-search-input') {
    e.target.value = '';
    filesSearchQuery = '';
    refreshFileList();
  }
});
// ========= 文件列表渲染 =========
function matchQuery(file) {
  if (!filesSearchQuery) return true;
  const q = filesSearchQuery;
  return (file.name || '').toLowerCase().includes(q) || (file.path || '').toLowerCase().includes(q);
}

async function refreshFileList() {
  // 收藏夹
  const favs = getFavorites().filter(matchQuery);
  renderFileSection('fav-list', favs.map(f => ({ ...f, isFav: true })), true);
  const favCountEl = document.getElementById('fav-count');
  if (favCountEl) favCountEl.textContent = favs.length ? favs.length : '';
  // 最近文件
  const recent = getRecentFiles().filter(matchQuery);
  renderFileSection('recent-list', recent.map(f => ({ ...f, isFav: isFavorited(f.path) })), false);
  const recentCountEl = document.getElementById('recent-count');
  if (recentCountEl) recentCountEl.textContent = recent.length ? recent.length : '';
  // 当前文件夹
  const folderEl = document.getElementById('folder-list');
  const folderCountEl = document.getElementById('folder-count');
  if (currentFilePath) {
    const dir = currentFilePath.substring(0, currentFilePath.lastIndexOf('/'));
    try {
      const entries = await window.markpad.listDirectory(dir);
      const mdFiles = entries.filter(e => !e.isDir).filter(matchQuery);
      if (folderCountEl) folderCountEl.textContent = mdFiles.length ? mdFiles.length : '';
      if (!mdFiles.length) {
        folderEl.innerHTML = `<div class="file-item" style="opacity:0.5;font-size:11px">${filesSearchQuery ? '没有匹配的文件' : '此目录下没有 md 文件'}</div>`;
      } else {
        renderFileSection('folder-list', mdFiles.map(f => ({ ...f, isFav: isFavorited(f.path) })), false);
      }
    } catch (err) {
      folderEl.innerHTML = '<div class="file-item" style="opacity:0.5">无法读取目录</div>';
      if (folderCountEl) folderCountEl.textContent = '';
    }
  } else {
    folderEl.innerHTML = '<div class="file-item" style="opacity:0.5;font-size:11px">打开文件后显示</div>';
    if (folderCountEl) folderCountEl.textContent = '';
  }
  // 同步顶部收藏按钮状态
  updateFavoriteBtn();
  // 应用分区折叠状态（首次渲染或刷新后都要应用）
  applySectionCollapsed();
}

function renderFileSection(containerId, files, isFavSection) {
  const container = document.getElementById(containerId);
  if (!files.length) {
    container.innerHTML = `<div class="file-item" style="opacity:0.4;font-size:11px">${isFavSection ? '暂无收藏（点击文件右侧 ☆ 收藏）' : '暂无文件'}</div>`;
    return;
  }
  container.innerHTML = files.map(f => {
    const starOn = f.isFav;
    const isCur = currentFilePath && f.path === currentFilePath;
    // 星标图标：实心★=已收藏，空心☆=未收藏
    const star = starOn ? '★' : '☆';
    const starTitle = starOn ? '取消收藏' : '加入收藏';
    return `<div class="file-item ${isCur ? 'current' : ''}" data-path="${escapeAttr(f.path)}" title="${escapeAttr(f.path)}">
      <span class="fi-icon">${f.isDir ? '📁' : '📄'}</span>
      <span class="fi-name">${escapeHtml(f.name)}</span>
      <span class="fi-star ${starOn ? 'favorited' : ''}" data-action="fav" title="${starTitle}">${star}</span>
    </div>`;
  }).join('');

  // 点击打开文件
  container.querySelectorAll('.file-item').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-action="fav"]')) return;
      const fp = el.dataset.path;
      if (fp) window.markpad.openFileByPath(fp);
    });
  });
  // 收藏星标切换
  container.querySelectorAll('[data-action="fav"]').forEach(star => {
    star.addEventListener('click', (e) => {
      e.stopPropagation();
      const fp = star.parentElement.dataset.path;
      const name = star.parentElement.querySelector('.fi-name')?.textContent || fp.split('/').pop();
      if (!fp) return;
      const nowFav = toggleFavorite(fp, name);
      showQuickToast(nowFav ? '★ 已加入收藏' : '已取消收藏');
      // 整体刷新（让"收藏夹"区出现/消失该文件）
      refreshFileList();
    });
  });
}

function escapeAttr(s) { return String(s).replace(/[&"'<>]/g, ''); }
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
}

// 顶部"收藏当前文件"按钮状态同步
function updateFavoriteBtn() {
  const btn = document.getElementById('favorite-toggle');
  if (!btn) return;
  const fav = currentFilePath && isFavorited(currentFilePath);
  btn.classList.toggle('favorited', !!fav);
  btn.title = !currentFilePath
    ? '请先打开一个文件'
    : (fav ? '取消收藏（⌘D）' : '收藏当前文件（⌘D）');
}

// 初始化默认显示文件tab
switchSidebarTab('files');

// ========= 拖拽分隔条（大纲/编辑器/源码三栏可拖动改变大小） =========
function initResizers() {
  const outlineResizer = document.getElementById('outline-resizer');
  const sourceResizer = document.getElementById('source-resizer');
  const sourcePane = document.getElementById('source-pane');

  let dragging = null;  // 'outline' | 'source'
  let startX = 0;
  let startW = 0;

  function onDown(e, which) {
    dragging = which;
    startX = e.clientX;
    const target = which === 'outline' ? outlineEl : sourcePane;
    // 取实际渲染宽度（getBoundingClientRect 比 style.width 准，前者含 border/padding）
    startW = target.getBoundingClientRect().width;
    const resizer = which === 'outline' ? outlineResizer : sourceResizer;
    resizer.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  }

  function onMove(e) {
    if (!dragging) return;
    const delta = e.clientX - startX;
    // 大纲向右拖 = 变宽，源码向右拖 = 变窄（源码在右边）
    const newW = dragging === 'outline' ? startW + delta : startW - delta;
    const clamped = Math.max(120, Math.min(520, newW));
    const target = dragging === 'outline' ? outlineEl : sourcePane;
    // 还原为纯数值（去掉可能存在的 px 后缀）
    const num = Math.round(clamped);
    target.style.width = num + 'px';
    // 同时也存到 data 属性，方便 toggle 时恢复
    target.dataset.userWidth = num;
  }

  function onUp() {
    if (!dragging) return;
    const resizer = dragging === 'outline' ? outlineResizer : sourceResizer;
    resizer.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    dragging = null;
  }

  outlineResizer.addEventListener('mousedown', (e) => onDown(e, 'outline'));
  // 大纲收起时点击分隔条 = 展开大纲
  outlineResizer.addEventListener('click', (e) => {
    if (outlineEl.classList.contains('hidden')) {
      toggleOutline();
    }
  });
  sourceResizer.addEventListener('mousedown', (e) => onDown(e, 'source'));
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

initResizers();

// ========= 源码面板 ↔ 渲染编辑器 双向同步 =========

function markDirty(dirty) {
  isDirty = dirty;
  window.markpad.setDirty(dirty);
  if (dirty) scheduleAutoSave();
}

// ========= 自动保存（停顿 1.5 秒后） =========
const AUTO_SAVE_DEBOUNCE = 1500;
let autoSaveTimer = null;
let lastSavedContent = null;
function scheduleAutoSave() {
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(doAutoSave, AUTO_SAVE_DEBOUNCE);
}
async function doAutoSave() {
  autoSaveTimer = null;
  if (!vditor || !vditorReady) return;
  const content = vditor.getValue();
  if (content === lastSavedContent) return;
  try {
    const res = await window.markpad.autoSave(content);
    if (res && res.saved) {
      lastSavedContent = content;
      markDirty(false);   // 落盘成功 → 清 dirty
      setAutoSaveStatus('已自动保存 · ' + nowHM());
    } else if (res && res.draft) {
      // 未命名：内容已暂存到草稿，dirty 保持
      setAutoSaveStatus('草稿已暂存 · ' + nowHM());
    }
  } catch (err) {
    setAutoSaveStatus('自动保存失败');
  }
}
function nowHM() {
  const d = new Date();
  return String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0') + ':' + String(d.getSeconds()).padStart(2,'0');
}
function setAutoSaveStatus(text) {
  const el = document.getElementById('status-autosave');
  if (el) el.textContent = text;
}

function updateStats() {
  if (!vditor) return;
  const text = vditor.getValue() || '';
  const cn = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const en = (text.match(/[a-zA-Z]+/g) || []).length;
  statusWords.textContent = `${cn + en} 字`;
}

function syncSourceFromVditor(immediate) {
  if (!vditor || !vditorReady) return;
  if (syncingFromSource) return;
  if (sourceEditor.matches(':focus')) return;
  const val = vditor.getValue() || '';
  if (sourceEditor.value === val) return;
  syncingFromVditor = true;
  sourceEditor.value = val;
  syncingFromVditor = false;
}

function syncVditorFromSource() {
  if (!vditor || !vditorReady) return;
  if (syncingFromVditor) return;
  const val = sourceEditor.value;
  if ((vditor.getValue() || '') === val) return;
  syncingFromSource = true;
  vditor.setValue(val);
  syncingFromSource = false;
  markDirty(true);
  updateStats();
}

sourceEditor.addEventListener('input', () => {
  if (syncingFromVditor) return;
  markDirty(true);
  clearTimeout(sourceSyncTimer);
  sourceSyncTimer = setTimeout(() => {
    syncVditorFromSource();
  }, 220);
});

sourceEditor.addEventListener('blur', () => {
  clearTimeout(sourceSyncTimer);
  syncVditorFromSource();
});

// ========= 主题 =========

function applyEditorTheme() {
  document.body.classList.toggle('dark', darkMode);
  document.body.setAttribute('data-theme-mode', themeMode);
  if (typeof updateThemeBtnTitle === 'function') updateThemeBtnTitle();
}

function applyThemeMode(persist = true) {
  darkMode = computeDark();
  applyEditorTheme();
  if (vditor && vditorReady) {
    vditor.setTheme(
      darkMode ? 'dark' : 'classic',
      darkMode ? 'dark' : 'light',
      darkMode ? 'native' : 'github'
    );
  }
  window.markpad.setNativeTheme(themeMode);
  if (persist) localStorage.setItem('markpad-theme', themeMode);
}

function setTheme(mode) {
  if (!['light', 'dark', 'system'].includes(mode)) return;
  themeMode = mode;
  applyThemeMode();
}

function toggleTheme() {
  const order = ['light', 'dark', 'system'];
  const next = order[(order.indexOf(themeMode) + 1) % order.length];
  setTheme(next);
}

systemDark.addEventListener('change', () => {
  if (themeMode === 'system') applyThemeMode(false);
});

function toggleSource() {
  sourceVisible = !sourceVisible;
  sourceEl.classList.toggle('hidden', !sourceVisible);
  document.getElementById('source-resizer').classList.toggle('hidden', !sourceVisible);
  const btn = document.getElementById('source-toggle');
  if (btn) btn.classList.toggle('active', sourceVisible);
  if (sourceVisible) syncSourceFromVditor(true);
}

// ========= 专注模式：仅高亮当前段落，其余变暗 =========
function toggleFocusMode() {
  focusMode = !focusMode;
  document.body.classList.toggle('focus-mode', focusMode);
  if (focusMode) {
    updateFocusActive();
  } else {
    // 清除所有高亮
    document.querySelectorAll('.focus-active').forEach(el => el.classList.remove('focus-active'));
  }
}

function updateFocusActive() {
  if (!focusMode) return;
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const node = sel.getRangeAt(0).startContainer;
  // 找最近的块级祖先（p, h1-h6, li, blockquote, pre 等）
  const block = node.closest ? node.closest('p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, table, .vditor-ir__node') : null
              || (node.nodeType === 3 ? node.parentElement : node);
  if (!block) return;
  document.querySelectorAll('.focus-active').forEach(el => el.classList.remove('focus-active'));
  block.classList.add('focus-active');
  // 也标记其父节点（比如 li 在 ul 里）
  const parentBlock = block.closest('li, blockquote');
  if (parentBlock) parentBlock.classList.add('focus-active');
}

// ========= 打字机模式：光标始终居中 =========
let twTimer = null;
function toggleTypewriterMode() {
  typewriterMode = !typewriterMode;
  if (typewriterMode) {
    typewriterScroll();
  }
}

function typewriterScroll() {
  if (!typewriterMode || !vditorReady) return;
  const scroller = document.querySelector('.vditor-ir pre.vditor-reset');
  if (!scroller) return;
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  if (!range.collapsed) return; // 有选区时不滚动
  const rect = range.getClientRects()[0];
  if (!rect) return;
  const scrollerRect = scroller.getBoundingClientRect();
  // 目标：光标在视口 45% 位置
  const targetRatio = 0.45;
  const currentPos = rect.top - scrollerRect.top + scroller.scrollTop;
  const targetPos = currentPos - scrollerRect.height * targetRatio;
  if (Math.abs(scroller.scrollTop - targetPos) > 30) {
    scroller.scrollTop = Math.max(0, targetPos);
  }
}

// 专注模式 + 打字机模式 共享光标变化监听
document.addEventListener('selectionchange', () => {
  if (focusMode) {
    // 节流：vditor 自身频繁操作 selection，用 rAF 避免卡顿
    if (!focusMode._pending) {
      focusMode._pending = true;
      requestAnimationFrame(() => {
        focusMode._pending = false;
        updateFocusActive();
      });
    }
  }
  if (typewriterMode) {
    clearTimeout(twTimer);
    twTimer = setTimeout(typewriterScroll, 60);
  }
});

// ========= 样式主题预设（GitHub/Night/Sepia/Slate） =========
const STYLE_THEMES = {
  default: { name: '默认' },
  github:  { name: 'GitHub', base: 'light' },
  night:   { name: 'Night', base: 'dark' },
  sepia:   { name: 'Sepia', base: 'light' },
  slate:   { name: 'Slate', base: 'dark' },
};

function setStyleTheme(name) {
  if (!STYLE_THEMES[name]) return;
  styleTheme = name;
  document.body.setAttribute('data-style-theme', name);
  // 切换基础亮暗（如果主题指定了 base）
  const preset = STYLE_THEMES[name];
  if (preset.base && themeMode !== preset.base) {
    themeMode = preset.base;
    darkMode = preset.base === 'dark';
    applyThemeMode(false);
  }
  localStorage.setItem('markpad-style-theme', name);
}

function nextStyleTheme() {
  const keys = Object.keys(STYLE_THEMES);
  const idx = keys.indexOf(styleTheme);
  setStyleTheme(keys[(idx + 1) % keys.length]);
}

// ============ IPC 事件绑定 ============

window.markpad.onFileOpened(({ path, content }) => {
  currentFilePath = path;
  loadContent(content);
  statusFile.textContent = path.split('/').pop();
  markDirty(false);
  addRecentFile(path);
  updateFavoriteBtn();
  // 文件列表无论 tab 在哪都刷一下（用户切回 tab 时也是新的）
  setTimeout(refreshFileList, 100);
  // 大纲也刷新（基于新内容）
  scheduleOutlineRefresh();
});

window.markpad.onFileNew(() => {
  currentFilePath = null;
  loadContent('');
  statusFile.textContent = '未命名';
  markDirty(false);
});

window.markpad.onRequestSave(async ({ saveAs }) => {
  const content = vditor ? vditor.getValue() : '';
  const res = await window.markpad.saveContent(content, saveAs);
  if (res.saved) {
    markDirty(false);
    if (res.path) {
      currentFilePath = res.path;
      statusFile.textContent = res.path.split('/').pop();
      addRecentFile(res.path);
      if (sidebarTab === 'files') refreshFileList();
    }
  }
  return res;
});

window.markpad.onRequestExportHtml(async () => {
  if (!vditor) return;
  const html = vditor.getHTML();
  await window.markpad.exportHtml(html);
});

window.markpad.onToggleOutline(() => toggleOutline());
window.markpad.onToggleSource(() => toggleSource());
window.markpad.onToggleTheme(() => toggleTheme());
window.markpad.onSetTheme((mode) => setTheme(mode));
window.markpad.onToggleFocusMode(() => toggleFocusMode());
window.markpad.onToggleTypewriterMode(() => toggleTypewriterMode());
window.markpad.onNextStyleTheme(() => nextStyleTheme());
window.markpad.onSetStyleTheme((name) => setStyleTheme(name));
window.markpad.onQuickOpen(() => showQuickOpen());
window.markpad.onToggleFavorite(() => {
  if (!currentFilePath) return;
  const nowFav = toggleFavorite(currentFilePath, currentFilePath.split('/').pop());
  showQuickToast(nowFav ? '★ 已加入收藏' : '已取消收藏');
});

window.markpad.onConfirmClose(async () => {
  if (!isDirty) {
    window.markpad.confirmCloseReply({ action: 'discard' });
    return;
  }
  const action = await window.markpad.askCloseConfirm();
  if (action === 'cancel') {
    window.markpad.confirmCloseReply({ action: 'cancel' });
    return;
  }
  if (action === 'discard') {
    window.markpad.confirmCloseReply({ action: 'discard' });
    return;
  }
  const content = vditor ? vditor.getValue() : '';
  const res = await window.markpad.saveContent(content, false);
  if (res.saved) {
    markDirty(false);
    if (res.path) statusFile.textContent = res.path.split('/').pop();
    window.markpad.confirmCloseReply({ action: 'discard' });
  } else {
    window.markpad.confirmCloseReply({ action: 'cancel' });
  }
});

// ========= 文件管理：最近文件 + 收藏夹 + 快速打开（⌘P） =========
const RECENT_KEY = 'markpad-recent-files';
const FAV_KEY = 'markpad-favorites';
const MAX_RECENT = 20;

function getRecentFiles() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch (_) { return []; }
}
function saveRecentFiles(list) {
  localStorage.setItem(RECENT_KEY, JSON.stringify(list));
}
function addRecentFile(fp) {
  if (!fp) return;
  const list = getRecentFiles().filter(f => f.path !== fp);
  list.unshift({ path: fp, name: fp.split('/').pop(), time: Date.now() });
  if (list.length > MAX_RECENT) list.length = MAX_RECENT;
  saveRecentFiles(list);
}

function getFavorites() {
  try { return JSON.parse(localStorage.getItem(FAV_KEY) || '[]'); } catch (_) { return []; }
}
function saveFavorites(list) {
  localStorage.setItem(FAV_KEY, JSON.stringify(list));
}
function isFavorited(fp) { return getFavorites().some(f => f.path === fp); }
function toggleFavorite(fp, name) {
  if (!fp) return false;
  const list = getFavorites();
  const idx = list.findIndex(f => f.path === fp);
  if (idx >= 0) { list.splice(idx, 1); saveFavorites(list); return false; }
  else { list.push({ path: fp, name: name || fp.split('/').pop() }); saveFavorites(list); return true; }
}

// ========= 快速打开面板（⌘P） =========
let quickOpenActive = false;
let quickOpenIndex = 0;
const qoOverlay = document.getElementById('quick-open-overlay');
const qoInput = document.getElementById('quick-open-input');
const qoResults = document.getElementById('quick-open-results');

function showQuickOpen() {
  quickOpenActive = true;
  quickOpenIndex = 0;
  if (qoOverlay) {
    qoOverlay.classList.remove('hidden');
    // 防御：如果 class 移除无效，直接设 style
    if (qoOverlay.classList.contains('hidden')) {
      qoOverlay.style.display = 'flex';
    }
  }
  if (qoInput) {
    qoInput.value = '';
    qoInput.focus();
  }
  renderQuickResults('');
}

function hideQuickOpen() {
  quickOpenActive = false;
  if (qoOverlay) {
    qoOverlay.classList.add('hidden');
    qoOverlay.style.display = '';
  }
  if (qoInput) qoInput.value = '';
}

function renderQuickResults(query) {
  const q = query.toLowerCase();
  const items = [];
  // 收藏文件
  const favs = getFavorites().filter(f => !q || f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q));
  if (favs.length) {
    items.push({ type: 'section', label: '收藏夹' });
    favs.forEach(f => items.push({ type: 'fav', ...f }));
  }
  // 最近文件
  const recent = getRecentFiles().filter(f => !q || f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q));
  if (recent.length) {
    items.push({ type: 'section', label: '最近打开' });
    recent.forEach(f => items.push({ type: 'recent', ...f }));
  }

  quickOpenIndex = 0;
  qoResults.innerHTML = '';
  if (!items.length) {
    qoResults.innerHTML = '<div class="qoi-empty">没有匹配的文件</div>';
    return;
  }
  items.forEach((item, i) => {
    if (item.type === 'section') {
      const div = document.createElement('div');
      div.className = 'qoi-section';
      div.textContent = item.label;
      qoResults.appendChild(div);
    } else {
      const div = document.createElement('div');
      div.className = 'quick-open-item';
      div.dataset.idx = i;
      // 短路径展示（去掉 /Users/xxx 前缀）
      const shortPath = item.path.replace(/^\/Users\/[^/]+/, '~');
      div.innerHTML = `<span class="qoi-name">${escapeHtml(item.name)}</span><span class="qoi-tag">${item.type === 'fav' ? '★' : ''}</span><span class="qoi-path">${escapeHtml(shortPath.replace(item.name, ''))}</span>`;
      div.addEventListener('click', () => openQuickItem(item));
      qoResults.appendChild(div);
    }
  });
  highlightQuickItem();
}

function highlightQuickItem() {
  const items = qoResults.querySelectorAll('.quick-open-item');
  items.forEach((el, i) => {
    const listIdx = Array.from(qoResults.querySelectorAll('.quick-open-item')).indexOf(el);
    el.classList.toggle('active', listIdx === quickOpenIndex);
  });
}

function openQuickItem(item) {
  if (!item || item.type === 'section') return;
  hideQuickOpen();
  window.markpad.openFileByPath(item.path);
}

qoInput.addEventListener('input', () => renderQuickResults(qoInput.value));
qoInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { hideQuickOpen(); return; }
  const items = qoResults.querySelectorAll('.quick-open-item');
  if (!items.length) return;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    quickOpenIndex = Math.min(quickOpenIndex + 1, items.length - 1);
    highlightQuickItem();
    items[quickOpenIndex]?.scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    quickOpenIndex = Math.max(quickOpenIndex - 1, 0);
    highlightQuickItem();
    items[quickOpenIndex]?.scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const allData = [];
    getFavorites().forEach(f => allData.push({ type: 'fav', ...f }));
    getRecentFiles().forEach(f => allData.push({ type: 'recent', ...f }));
    const q = qoInput.value.toLowerCase();
    const filtered = allData.filter(f => !q || f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q));
    if (filtered[quickOpenIndex]) openQuickItem(filtered[quickOpenIndex]);
  }
});

qoOverlay.addEventListener('click', (e) => { if (e.target === qoOverlay) hideQuickOpen(); });

// 全局快捷键 ⌘P（capture 阶段拦截，防止被 vditor contenteditable 吞掉）
window.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'p') {
    e.preventDefault();
    e.stopPropagation();
    showQuickOpen();
  }
}, true);

// ESC 关闭全局拦截
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && quickOpenActive) {
    if (!qoInput.matches(':focus')) hideQuickOpen();
  }
}, true);

// escapeHtml 已在上方定义

// 右上角主题切换按钮（用 var 是为了避免 TDZ：updateThemeBtnTitle 可能在声明前被 vditor after 回调调用）
var themeToggleBtn = document.getElementById('theme-toggle');
function updateThemeBtnTitle() {
  if (!themeToggleBtn) return;
  const cur  = { light:'☀️ 亮色', dark:'🌙 暗色', system:'💻 跟随系统' }[themeMode] || '';
  const next = { light:'暗色', dark:'跟随系统', system:'亮色' }[themeMode] || '主题';
  // 同时设置 title（系统 tooltip 兜底）和 data-tip（自绘气泡）
  const tip = `当前：${cur} · 点击切到 ${next}（⌘/）`;
  themeToggleBtn.title = tip;
  themeToggleBtn.setAttribute('data-tip', tip);
}
if (themeToggleBtn) {
  themeToggleBtn.addEventListener('click', (e) => {
    e.preventDefault();
    toggleTheme();
  });
  // 自绘 hover 气泡，比系统 title 反应快
  themeToggleBtn.addEventListener('mouseenter', () => {
    showThemeTip(themeToggleBtn);
  });
  themeToggleBtn.addEventListener('mouseleave', hideThemeTip);
}

let themeTipEl = null;
function showThemeTip(anchor) {
  const cur  = { light:'☀️ 亮色', dark:'🌙 暗色', system:'💻 跟随系统（' + (systemDark.matches ? '暗' : '亮') + '色）' }[themeMode] || '';
  if (!themeTipEl) {
    themeTipEl = document.createElement('div');
    themeTipEl.id = 'mp-theme-tip';
    document.body.appendChild(themeTipEl);
  }
  themeTipEl.textContent = '当前：' + cur;
  themeTipEl.classList.add('show');
  // 定位到按钮下方
  const r = anchor.getBoundingClientRect();
  themeTipEl.style.right = (window.innerWidth - r.right) + 'px';
  themeTipEl.style.top = (r.bottom + 6) + 'px';
}
function hideThemeTip() {
  themeTipEl && themeTipEl.classList.remove('show');
}

// 右上角：文档内搜索按钮
const findBtn = document.getElementById('find-btn');
if (findBtn) {
  findBtn.addEventListener('click', (e) => {
    e.preventDefault();
    showFind();
  });
}

// 顶部"收藏当前文件"按钮
const favBtn = document.getElementById('favorite-toggle');
if (favBtn) {
  favBtn.addEventListener('click', (e) => {
    e.preventDefault();
    if (!currentFilePath) {
      showQuickToast('请先打开一个文件');
      return;
    }
    const name = currentFilePath.split('/').pop();
    const nowFav = toggleFavorite(currentFilePath, name);
    showQuickToast(nowFav ? '★ 已加入收藏' : '已取消收藏');
    updateFavoriteBtn();
    if (sidebarTab === 'files') refreshFileList();
  });
}

// ⌘D 收藏当前文件
window.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && (e.key === 'd' || e.key === 'D')) {
    e.preventDefault();
    e.stopPropagation();
    favBtn && favBtn.click();
  }
}, true);

// 右上角源码切换按钮
const sourceToggleBtn = document.getElementById('source-toggle');
if (sourceToggleBtn) {
  sourceToggleBtn.addEventListener('click', (e) => {
    e.preventDefault();
    toggleSource();
  });
}
const sourceCloseBtn = document.getElementById('source-close');
if (sourceCloseBtn) {
  sourceCloseBtn.addEventListener('click', (e) => {
    e.preventDefault();
    if (sourceVisible) toggleSource();
  });
}

// ============ 窗口内拖拽打开文件 ============
function isFileDrag(e) {
  const types = e.dataTransfer && e.dataTransfer.types;
  if (!types) return false;
  for (let i = 0; i < types.length; i++) {
    if (types[i] === 'Files') return true;
  }
  return false;
}

window.addEventListener('dragover', (e) => {
  if (!isFileDrag(e)) return;
  e.preventDefault();
  e.stopPropagation();
  document.body.classList.add('drag-over');
}, true);

window.addEventListener('dragleave', (e) => {
  if (!isFileDrag(e)) return;
  e.preventDefault();
  e.stopPropagation();
  if (e.target === document.documentElement || !e.relatedTarget) {
    document.body.classList.remove('drag-over');
  }
}, true);

window.addEventListener('drop', (e) => {
  if (!isFileDrag(e)) return;
  const files = Array.from(e.dataTransfer.files || []);
  // 图片文件放行给 vditor 自带的 upload handler 处理
  const allImages = files.every((f) => /\.(png|jpg|jpeg|gif|svg|webp|bmp|ico)$/i.test(f.name));
  if (allImages) return; // 不拦截，让 vditor 处理
  e.preventDefault();
  e.stopPropagation();
  document.body.classList.remove('drag-over');
  const f = files.find((x) => /\.(md|markdown|mdown|mkd|mdtext|txt)$/i.test(x.name)) || files[0];
  if (!f) return;
  const p = window.markpad.openDroppedFileFromFile(f);
  if (!p && f.path) window.markpad.openDroppedFile(f.path);
}, true);

window.addEventListener('dragend', () => {
  document.body.classList.remove('drag-over');
}, true);

// ============ 启动 ============
darkMode = computeDark();
initVditor(WELCOME);
applyThemeMode(false);
markDirty(false);
window.markpad.rendererReady();

// ============ 文档内搜索（⌘F） ============
let findActive = false;
let findMatches = [];
let findIndex = -1;
let findHighlightMarks = [];
const findBar = document.getElementById('find-bar');
const findInput = document.getElementById('find-input');
const findCount = document.getElementById('find-count');
const findPrev = document.getElementById('find-prev');
const findNext = document.getElementById('find-next');
const findCloseBtn = document.getElementById('find-close');

function showFind() {
  if (!findBar) return;
  findBar.classList.remove('hidden');
  findActive = true;
  setTimeout(() => { findInput.focus(); findInput.select(); }, 0);
}
function hideFind() {
  if (!findBar) return;
  findBar.classList.add('hidden');
  findActive = false;
  clearFindHighlights();
  findMatches = [];
  findIndex = -1;
  if (findCount) findCount.textContent = '0/0';
}
function clearFindHighlights() {
  findHighlightMarks.forEach(m => {
    const parent = m.parentNode;
    if (!parent) return;
    while (m.firstChild) parent.insertBefore(m.firstChild, m);
    parent.removeChild(m);
    parent.normalize();
  });
  findHighlightMarks = [];
}
function performFind() {
  clearFindHighlights();
  findMatches = [];
  findIndex = -1;
  const q = (findInput.value || '').trim();
  if (!q) { if (findCount) findCount.textContent = '0/0'; return; }
  const root = document.querySelector('.vditor-ir') || document.getElementById('vditor');
  if (!root) return;
  const lower = q.toLowerCase();
  const textNodes = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      let p = n.parentElement;
      while (p && p !== root) {
        if (p.classList && (p.classList.contains('vditor-ir__marker') || p.classList.contains('vditor-toolbar'))) return NodeFilter.FILTER_REJECT;
        p = p.parentElement;
      }
      return n.nodeValue && n.nodeValue.length ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    }
  });
  let n;
  while ((n = walker.nextNode())) textNodes.push(n);

  textNodes.forEach(tn => {
    const text = tn.nodeValue;
    const tl = text.toLowerCase();
    let from = 0; let idx;
    const segments = [];
    while ((idx = tl.indexOf(lower, from)) !== -1) {
      segments.push([idx, idx + q.length]);
      from = idx + q.length;
    }
    if (!segments.length) return;
    const frag = document.createDocumentFragment();
    let cur = 0;
    segments.forEach(([s, e]) => {
      if (s > cur) frag.appendChild(document.createTextNode(text.slice(cur, s)));
      const mk = document.createElement('mark');
      mk.className = 'mp-find-mark';
      mk.textContent = text.slice(s, e);
      frag.appendChild(mk);
      findHighlightMarks.push(mk);
      findMatches.push(mk);
      cur = e;
    });
    if (cur < text.length) frag.appendChild(document.createTextNode(text.slice(cur)));
    tn.parentNode.replaceChild(frag, tn);
  });

  if (findCount) findCount.textContent = findMatches.length ? ('1/' + findMatches.length) : '0/0';
  if (findMatches.length) jumpToFindMatch(0);
}
function jumpToFindMatch(i) {
  if (!findMatches.length) return;
  findMatches.forEach(m => m.classList.remove('mp-find-current'));
  findIndex = ((i % findMatches.length) + findMatches.length) % findMatches.length;
  const m = findMatches[findIndex];
  m.classList.add('mp-find-current');
  m.scrollIntoView({ block: 'center', behavior: 'auto' });
  if (findCount) findCount.textContent = (findIndex + 1) + '/' + findMatches.length;
}
if (findInput) {
  let findDebounce = null;
  findInput.addEventListener('input', () => {
    if (findDebounce) clearTimeout(findDebounce);
    findDebounce = setTimeout(performFind, 120);
  });
  findInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { hideFind(); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) jumpToFindMatch(findIndex - 1);
      else jumpToFindMatch(findIndex + 1);
    }
  });
}
if (findPrev) findPrev.addEventListener('click', () => jumpToFindMatch(findIndex - 1));
if (findNext) findNext.addEventListener('click', () => jumpToFindMatch(findIndex + 1));
if (findCloseBtn) findCloseBtn.addEventListener('click', hideFind);
window.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && (e.key === 'f' || e.key === 'F')) {
    e.preventDefault(); e.stopPropagation();
    showFind();
  }
  if (e.key === 'Escape' && findActive && findInput && !findInput.matches(':focus')) {
    hideFind();
  }
}, true);
window.markpad.onShowFind(() => showFind());

// ============ 历史版本 ============
const versionsOverlay = document.getElementById('versions-overlay');
const versionsList = document.getElementById('versions-list');
const versionsPreviewMeta = document.getElementById('versions-preview-meta');
const versionsPreviewContent = document.getElementById('versions-preview-content');
const versionsRestoreBtn = document.getElementById('versions-restore');
const versionsCopyBtn = document.getElementById('versions-copy');
const versionsCloseBtn = document.getElementById('versions-close');
let currentVersionContent = null;

function pad2(n) { return String(n).padStart(2, '0'); }
async function showVersions() {
  if (!currentFilePath) {
    showQuickToast('请先打开或保存一个文件，才能查看历史版本');
    return;
  }
  versionsOverlay.classList.remove('hidden');
  versionsList.innerHTML = '<div class="ver-empty">加载中…</div>';
  versionsPreviewMeta.textContent = '';
  versionsPreviewContent.textContent = '';
  versionsRestoreBtn.disabled = true;
  versionsCopyBtn.disabled = true;
  currentVersionContent = null;

  const list = await window.markpad.listVersions(currentFilePath);
  if (!list.length) {
    versionsList.innerHTML = '<div class="ver-empty">还没有历史版本，编辑后会自动产生。</div>';
    return;
  }
  versionsList.innerHTML = list.map((v, i) => {
    const d = new Date(v.time);
    const time = d.getFullYear() + '-' + pad2(d.getMonth()+1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
    const kb = (v.size / 1024).toFixed(1);
    return '<div class="ver-item" data-path="' + escapeAttr(v.path) + '">' +
      '<div class="ver-time">' + time + '</div>' +
      '<div class="ver-meta">' + kb + ' KB · ' + (i === 0 ? '最新' : '第 ' + (i + 1) + ' 个') + '</div>' +
      '</div>';
  }).join('');
  versionsList.querySelectorAll('.ver-item').forEach(el => {
    el.addEventListener('click', async () => {
      versionsList.querySelectorAll('.ver-item').forEach(x => x.classList.remove('active'));
      el.classList.add('active');
      const p = el.dataset.path;
      const res = await window.markpad.readVersion(p);
      if (res && res.ok) {
        currentVersionContent = res.content;
        versionsPreviewMeta.textContent = p.split('/').pop();
        versionsPreviewContent.textContent = res.content;
        versionsRestoreBtn.disabled = false;
        versionsCopyBtn.disabled = false;
      }
    });
  });
  const first = versionsList.querySelector('.ver-item');
  if (first) first.click();
}
function hideVersions() {
  if (versionsOverlay) versionsOverlay.classList.add('hidden');
}
if (versionsCloseBtn) versionsCloseBtn.addEventListener('click', hideVersions);
if (versionsOverlay) versionsOverlay.addEventListener('click', (e) => {
  if (e.target === versionsOverlay) hideVersions();
});
if (versionsRestoreBtn) versionsRestoreBtn.addEventListener('click', () => {
  if (currentVersionContent == null) return;
  if (!confirm('恢复后会覆盖当前编辑区内容（当前内容会作为一个新版本保留），确定吗？')) return;
  loadContent(currentVersionContent);
  markDirty(true);
  hideVersions();
  showQuickToast('已恢复，正在自动保存…');
});
if (versionsCopyBtn) versionsCopyBtn.addEventListener('click', async () => {
  if (currentVersionContent == null) return;
  try { await navigator.clipboard.writeText(currentVersionContent); showQuickToast('已复制到剪贴板'); }
  catch (_) { showQuickToast('复制失败'); }
});
window.markpad.onShowVersions(() => showVersions());

// ============ 草稿恢复（启动时检查） ============
const draftBanner = document.getElementById('draft-banner');
const draftRestoreBtn = document.getElementById('draft-restore');
const draftDiscardBtn = document.getElementById('draft-discard');
let pendingDraft = null;

(async function checkDraftOnStartup() {
  try {
    const res = await window.markpad.checkDraft();
    if (res && res.has && res.content) {
      pendingDraft = res;
      if (draftBanner) draftBanner.classList.remove('hidden');
    }
  } catch (_) {}
})();

if (draftRestoreBtn) draftRestoreBtn.addEventListener('click', () => {
  if (!pendingDraft) return;
  loadContent(pendingDraft.content);
  markDirty(true);
  draftBanner.classList.add('hidden');
  showQuickToast('已恢复未保存草稿');
});
if (draftDiscardBtn) draftDiscardBtn.addEventListener('click', async () => {
  if (pendingDraft && pendingDraft.path) await window.markpad.discardDraft(pendingDraft.path);
  pendingDraft = null;
  draftBanner.classList.add('hidden');
});
