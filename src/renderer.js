// MarkPad 渲染进程逻辑
let vditor = null;
let vditorReady = false;
let pendingValue = null;
let isDirty = false;
let outlineVisible = true;
let sourceVisible = false;
let focusMode = false;
let typewriterMode = false;
let styleTheme = localStorage.getItem('markpad-style-theme') || 'default';
let syncingFromVditor = false;
let syncingFromSource = false;
let sourceSyncTimer = null;
let themeMode = localStorage.getItem('markpad-theme') || 'system';
let darkMode = false;
const systemDark = window.matchMedia('(prefers-color-scheme: dark)');

function computeDark() {
  return themeMode === 'dark' || (themeMode === 'system' && systemDark.matches);
}

let currentFilePath = null;
let currentCodeMode = null;

const statusFile = document.getElementById('status-file');
const statusWords = document.getElementById('status-words');
const statusCursor = document.getElementById('status-cursor');
const outlineEl = document.getElementById('outline');
const sourceEl = document.getElementById('source-pane');
const sourceEditor = document.getElementById('source-editor');
const codeEditor = document.getElementById('code-editor');

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

// ============ 多 Tab 管理 ============
let tabs = [];
let activeTabId = null;
let tabIdCounter = 0;

function generateTabId() {
  return 'tab-' + (++tabIdCounter) + '-' + Date.now();
}

function getTabById(id) {
  return tabs.find(t => t.id === id);
}

function getTabByFilePath(fp) {
  return fp ? (tabs.find(t => t.filePath === fp) || null) : null;
}

function getActiveTab() {
  return activeTabId ? getTabById(activeTabId) : null;
}

// 保存当前 tab 的编辑器状态到 tab 对象
function saveCurrentTabState() {
  const tab = getActiveTab();
  if (!tab) return;
  // 仅脏状态才重新读取内容（vditor.getValue() 对大文件很慢）
  if (isDirty) tab.content = getEditorContent();
  tab.dirty = isDirty;
  tab.codeMode = currentCodeMode;
  tab.filePath = currentFilePath;
  tab.displayName = currentFilePath ? currentFilePath.split('/').pop() : '未命名';
  if (currentCodeMode && codeEditor) {
    tab.scrollTop = codeEditor.scrollTop;
    tab.cursorPos = codeEditor.selectionStart;
  } else if (!currentCodeMode) {
    // md 模式记录 vditor 滚动位置
    const scroller = document.querySelector('.vditor-ir pre.vditor-reset, .vditor-wysiwyg pre.vditor-reset');
    tab.scrollTop = scroller ? scroller.scrollTop : 0;
    tab.cursorPos = 0;
  } else {
    tab.scrollTop = 0;
    tab.cursorPos = 0;
  }
}

// 创建新 tab 并切换过去
function createTab(filePath, content, codeMode, options = {}) {
  // 如果该文件已经在某个 tab 打开了，直接切换
  if (filePath) {
    const existing = getTabByFilePath(filePath);
    if (existing) {
      switchToTab(existing.id);
      return existing;
    }
  }
  const displayName = filePath ? filePath.split('/').pop() : '未命名';
  const tab = {
    id: generateTabId(),
    filePath: filePath || null,
    displayName,
    codeMode: codeMode || null,
    content: content || '',
    dirty: false,
    scrollTop: 0,
    cursorPos: 0,
  };
  tabs.push(tab);
  renderTabBar();
  if (options.noSwitch) return tab;
  switchToTab(tab.id);
  return tab;
}

// 切换到指定 tab
function switchToTab(tabId) {
  if (tabId === activeTabId) {
    renderTabBar();
    return;
  }
  // 保存当前 tab 状态
  saveCurrentTabState();
  activeTabId = tabId;
  const tab = getTabById(tabId);
  if (!tab) return;

  // 恢复 tab 状态
  currentFilePath = tab.filePath;
  currentCodeMode = tab.codeMode;
  isDirty = tab.dirty;

  applyCodeMode(tab.codeMode);
  if (tab.codeMode) {
    loadCodeContent(tab.content);
    if (codeEditor) {
      codeEditor.scrollTop = tab.scrollTop || 0;
      codeEditor.selectionStart = codeEditor.selectionEnd = tab.cursorPos || 0;
    }
  } else {
    loadContent(tab.content);
    // 恢复 md 模式滚动位置（vditor 异步渲染完成后执行）
    if (tab.scrollTop) {
      setTimeout(() => {
        const scroller = document.querySelector('.vditor-ir pre.vditor-reset, .vditor-wysiwyg pre.vditor-reset');
        if (scroller) scroller.scrollTop = tab.scrollTop;
      }, 60);
    }
  }

  // 静默设置脏状态（不触发 renderTabBar，末尾统一渲染）
  isDirty = tab.dirty;
  window.markpad.setDirty(tab.dirty);
  statusFile.textContent = tab.displayName;
  updateFavoriteBtn();
  // 文件列表用防抖刷新，快速切换 tab 时不反复 IPC
  debouncedRefreshFileList();
  scheduleOutlineRefresh();

  // 通知主进程
  window.markpad.tabActivated({ filePath: tab.filePath, codeMode: tab.codeMode, dirty: tab.dirty });

  renderTabBar();
}

// 关闭指定 tab
async function closeTab(tabId) {
  const tab = getTabById(tabId);
  if (!tab) return;

  // 脏文件确认
  if (tab.dirty) {
    const action = await window.markpad.askCloseConfirm();
    if (action === 'cancel') return;
    if (action === 'save') {
      // 先切到该 tab 保存
      const prevTabId = activeTabId;
      if (activeTabId !== tabId) switchToTab(tabId);
      const content = getEditorContent();
      const res = await window.markpad.saveContent(content, false);
      if (!res.saved) return;
      markDirty(false);
      if (res.path) {
        currentFilePath = res.path;
        tab.filePath = res.path;
        tab.displayName = res.path.split('/').pop();
        tab.content = content;
        tab.dirty = false;
      }
    }
    // discard: 直接关
  }

  const idx = tabs.findIndex(t => t.id === tabId);
  tabs.splice(idx, 1);

  if (tabId === activeTabId) {
    if (tabs.length === 0) {
      // 没有其他 tab 了，创建一个新的空 tab
      createTab(null, '', null);
      return;
    }
    const newIdx = Math.min(idx, tabs.length - 1);
    switchToTab(tabs[newIdx].id);
  }
  renderTabBar();
}

// 关闭其他 tab
function closeOtherTabs(keepTabId) {
  const toClose = tabs.filter(t => t.id !== keepTabId && !t.dirty);
  toClose.forEach(t => {
    const idx = tabs.indexOf(t);
    tabs.splice(idx, 1);
  });
  if (activeTabId !== keepTabId) switchToTab(keepTabId);
  renderTabBar();
}

// 关闭右侧 tab
function closeRightTabs(tabId) {
  const idx = tabs.findIndex(t => t.id === tabId);
  const toClose = tabs.slice(idx + 1).filter(t => !t.dirty);
  toClose.forEach(t => {
    const i = tabs.indexOf(t);
    if (i >= 0) tabs.splice(i, 1);
  });
  renderTabBar();
}

// 渲染 Tab 栏
function renderTabBar() {
  const container = document.getElementById('tab-bar-content');
  if (!container) return;
  container.innerHTML = tabs.map(tab => {
    const active = tab.id === activeTabId;
    const dirty = tab.dirty;
    const icon = tab.codeMode ? fileIconForCode(tab.codeMode.lang) : '📝';
    return `<div class="tab-item ${active ? 'active' : ''} ${dirty ? 'dirty' : ''}"
                 data-tab-id="${escapeAttr(tab.id)}"
                 title="${escapeAttr(tab.filePath || '未命名')}">
      <span class="tab-icon">${icon}</span>
      <span class="tab-name">${escapeHtml(tab.displayName)}</span>
      <span class="tab-close" data-action="close">×</span>
    </div>`;
  }).join('');
}

function fileIconForCode(lang) {
  const map = { json: '📊', jsonl: '📊', xml: '📋', yaml: '⚙️', yml: '⚙️' };
  return map[lang] || '📄';
}

// Tab 栏事件
document.getElementById('tab-bar-content').addEventListener('click', (e) => {
  // 关闭按钮
  const closeBtn = e.target.closest('[data-action="close"]');
  if (closeBtn) {
    e.stopPropagation();
    const tabEl = closeBtn.closest('.tab-item');
    if (tabEl) closeTab(tabEl.dataset.tabId);
    return;
  }
  // 切换 tab
  const tabEl = e.target.closest('.tab-item');
  if (tabEl) {
    switchToTab(tabEl.dataset.tabId);
  }
});

// Tab 中键关闭
document.getElementById('tab-bar-content').addEventListener('mousedown', (e) => {
  if (e.button !== 1) return; // 中键
  const tabEl = e.target.closest('.tab-item');
  if (tabEl) {
    e.preventDefault();
    closeTab(tabEl.dataset.tabId);
  }
});

// 新建 tab 按钮
document.getElementById('tab-new-btn').addEventListener('click', () => {
  createTab(null, '', null);
});

// Tab 右键菜单
let tabContextMenuTarget = null;
const tabContextMenu = document.getElementById('tab-context-menu');

document.getElementById('tab-bar-content').addEventListener('contextmenu', (e) => {
  const tabEl = e.target.closest('.tab-item');
  if (!tabEl) return;
  e.preventDefault();
  tabContextMenuTarget = tabEl.dataset.tabId;

  // 在 Finder 中显示：仅对已保存文件可用
  const tab = getTabById(tabContextMenuTarget);
  const revealBtn = document.getElementById('tab-ctx-reveal');
  if (revealBtn) revealBtn.style.display = (tab && tab.filePath) ? '' : 'none';

  tabContextMenu.classList.remove('hidden');
  tabContextMenu.style.left = e.clientX + 'px';
  tabContextMenu.style.top = e.clientY + 'px';
  // 边界修正
  const rect = tabContextMenu.getBoundingClientRect();
  if (rect.right > window.innerWidth) tabContextMenu.style.left = (window.innerWidth - rect.width - 4) + 'px';
  if (rect.bottom > window.innerHeight) tabContextMenu.style.top = (window.innerHeight - rect.height - 4) + 'px';
});

document.addEventListener('click', (e) => {
  if (!tabContextMenu.classList.contains('hidden') && !tabContextMenu.contains(e.target)) {
    tabContextMenu.classList.add('hidden');
  }
});

tabContextMenu.addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn || !tabContextMenuTarget) return;
  const action = btn.dataset.action;
  const tab = getTabById(tabContextMenuTarget);
  tabContextMenu.classList.add('hidden');

  if (action === 'close' && tab) closeTab(tabContextMenuTarget);
  if (action === 'close-others' && tab) closeOtherTabs(tabContextMenuTarget);
  if (action === 'close-right') closeRightTabs(tabContextMenuTarget);
  if (action === 'detach' && tab) detachTabToNewWindow(tab);
  if (action === 'reveal' && tab && tab.filePath) window.markpad.revealFileInFinder(tab.filePath);
  tabContextMenuTarget = null;
});

// 移到新窗口
function detachTabToNewWindow(tab) {
  // 保存当前编辑内容
  if (tab.id === activeTabId) tab.content = getEditorContent();
  window.markpad.openInNewWindow({
    filePath: tab.filePath,
    content: tab.content,
    codeMode: tab.codeMode,
    dirty: tab.dirty,
  });
  // 从当前窗口移除
  const idx = tabs.findIndex(t => t.id === tab.id);
  tabs.splice(idx, 1);
  if (tab.id === activeTabId) {
    if (tabs.length === 0) {
      createTab(null, '', null);
    } else {
      const newIdx = Math.min(idx, tabs.length - 1);
      switchToTab(tabs[newIdx].id);
    }
  }
  renderTabBar();
}

// ⌘T 新建标签页, ⌘W 关闭当前标签页
window.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 't' && !e.shiftKey) {
    e.preventDefault();
    e.stopPropagation();
    createTab(null, '', null);
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 'w' && !e.shiftKey) {
    e.preventDefault();
    e.stopPropagation();
    if (activeTabId) closeTab(activeTabId);
  }
  // ⌘ShiftW 关闭窗口（与系统默认不同，这里仅做 tab 关闭的补充）
}, true);

// ⌘1~9 切换 tab
window.addEventListener('keydown', (e) => {
  if (!(e.metaKey || e.ctrlKey)) return;
  const num = parseInt(e.key);
  if (num >= 1 && num <= 9) {
    e.preventDefault();
    e.stopPropagation();
    if (num === 9) {
      // Cmd+9 → 最后一个 tab
      if (tabs.length) switchToTab(tabs[tabs.length - 1].id);
    } else if (num <= tabs.length) {
      switchToTab(tabs[num - 1].id);
    }
  }
}, true);


// ============ Vditor 初始化 ============

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

let vditorNeedsRebuild = false;

function initVditor(value) {
  if (vditor) {
    vditor.destroy();
    document.getElementById('vditor').innerHTML = '';
  }
  vditorReady = false;
  vditor = new Vditor('vditor', {
    mode: 'wysiwyg',
    value: value || '',
    theme: darkMode ? 'dark' : 'classic',
    cache: { enable: false },
    i18n: {
      alignCenter: '居中', alignLeft: '居左', alignRight: '居右',
      alternateText: '替代文本', bold: '粗体', both: '编辑 & 预览',
      cancelUpload: '取消上传', check: '任务列表', close: '关闭',
      code: '代码块', column: '列', comment: '评论', confirm: '确定',
      copied: '已复制', copy: '复制', 'delete-column': '删除列',
      'delete-row': '删除行', down: '下', downloadTip: '该浏览器不支持下载功能',
      edit: '编辑', 'edit-mode': '切换编辑模式', emoji: '表情',
      export: '导出', fileTypeError: '文件类型不允许上传',
      footnoteRef: '脚注标识', fullscreen: '全屏切换',
      generate: '生成中', headings: '标题', heading1: '一级标题',
      heading2: '二级标题', heading3: '三级标题', heading4: '四级标题',
      heading5: '五级标题', heading6: '六级标题', help: '帮助',
      imageURL: '图片地址', indent: '列表缩进', info: '关于',
      'inline-code': '行内代码', 'insert-after': '末尾插入行',
      'insert-before': '起始插入行', insertColumnLeft: '在左边插入一列',
      insertColumnRight: '在右边插入一列', insertRowAbove: '在上方插入一行',
      insertRowBelow: '在下方插入一行', italic: '斜体', language: '语言',
      line: '分隔线', link: '链接', linkRef: '引用标识',
      list: '无序列表', more: '更多', 'ordered-list': '有序列表',
      outdent: '列表反向缩进', outline: '大纲', over: '超过',
      preview: '预览', quote: '引用', redo: '重做', remove: '删除',
      row: '行', spin: '旋转', strike: '删除线', table: '表格',
      textIsNotEmpty: '文本（不能为空）', title: '标题',
      tooltipText: '提示文本', undo: '撤销', up: '上', update: '更新',
      upload: '上传图片或文件', uploadError: '上传错误',
      uploading: '上传中...', wysiwyg: '所见即所得',
    },
    toolbar: [
      'headings', 'bold', 'italic', 'strike', '|',
      'list', 'ordered-list', 'check', 'quote', 'line', 'code', 'inline-code', '|',
      {
        name: 'insert-link',
        tip: '插入链接',
        tipPosition: 'n',
        icon: '<svg><use xlink:href="#vditor-icon-link"></use></svg>',
        click() { handleInsertLink(); }
      },
      'table',
      {
        name: 'insert-image',
        tip: '上传图片',
        tipPosition: 'n',
        icon: '<svg><use xlink:href="#vditor-icon-upload"></use></svg>',
        async click() { await handleImageUploadFromDialog(); }
      },
      '|',
      'undo', 'redo',
    ],
    counter: { enable: false },
    markdown: {
      mark: true, toc: true, footnotes: true,
      autoSpace: true, fixTermTypo: true,
    },
    preview: {
      theme: { current: darkMode ? 'dark' : 'light' },
      hljs: { style: darkMode ? 'native' : 'github', lineNumber: true },
      math: { engine: 'KaTeX' }
    },
    upload: {
      max: 10 * 1024 * 1024,
      accept: 'image/*',
      handler(files) { return handleImageUpload(files); }
    },
    // 图片粘贴/拖拽仍走 Vditor 原生 upload handler
    outline: { enable: false },
    placeholder: '开始输入…',
    input: () => {
      if (!syncingFromSource) {
        markDirty(true);
        scheduleUpdateStats();
        scheduleSyncSourceFromVditor();
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

// ========= 插入链接 =========
// Electron 禁用了 window.prompt()（调用会抛 "prompt() is and will not be supported."），
// 因此用自定义弹窗收集 URL / 文字。若有选中文字，预填为链接文字。
function handleInsertLink() {
  try {
    let selected = '';
    if (vditor && typeof vditor.getSelection === 'function') {
      selected = (vditor.getSelection() || '').trim();
    }
    openLinkDialog(selected, (text, url) => {
      const md = `[${text || url}](${url})`;
      if (vditor && typeof vditor.insertValue === 'function') {
        vditor.insertValue(md);
        markDirty(true);
        scheduleUpdateStats();
        scheduleSyncSourceFromVditor();
      }
    });
  } catch (err) {
    console.error('[MarkPad] 插入链接失败:', err);
  }
}

// 自定义链接弹窗：textInit 预填链接文字，onConfirm(text, url) 回调
function openLinkDialog(textInit, onConfirm) {
  const overlay = document.getElementById('link-dialog-overlay');
  const textInput = document.getElementById('link-dialog-text');
  const urlInput = document.getElementById('link-dialog-url');
  const okBtn = document.getElementById('link-dialog-ok');
  const cancelBtn = document.getElementById('link-dialog-cancel');
  if (!overlay || !textInput || !urlInput) return;

  textInput.value = textInit || '';
  urlInput.value = '';
  overlay.classList.remove('hidden');
  // 有选中文字则聚焦 URL（文字已填好），否则先填文字
  (textInit ? urlInput : textInput).focus();

  const close = () => {
    overlay.classList.add('hidden');
    okBtn.removeEventListener('click', onOk);
    cancelBtn.removeEventListener('click', close);
    overlay.removeEventListener('mousedown', onBackdrop);
    document.removeEventListener('keydown', onKey, true);
  };
  const onOk = () => {
    const url = urlInput.value.trim();
    if (!url) { urlInput.focus(); return; }
    const text = textInput.value.trim();
    close();
    onConfirm(text, url);
  };
  const onBackdrop = (e) => { if (e.target === overlay) close(); };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Enter') { e.preventDefault(); onOk(); }
  };
  okBtn.addEventListener('click', onOk);
  cancelBtn.addEventListener('click', close);
  overlay.addEventListener('mousedown', onBackdrop);
  document.addEventListener('keydown', onKey, true);
}

// ========= 图片上传 =========
// 工具栏按钮点击：调用 Electron 原生文件对话框选择图片
async function handleImageUploadFromDialog() {
  try {
    const result = await window.markpad.openImageDialog();
    if (!result || result.canceled || !result.files || !result.files.length) return;
    const fragments = [];
    for (const f of result.files) {
      if (f.type && !f.type.startsWith('image/')) continue;
      const saveResult = await window.markpad.saveImageFromBuffer(f.name, f.type, f.size, f.buffer);
      if (!saveResult || !saveResult.url) continue;
      const alt = (f.name ? f.name.replace(/\.[^.]+$/, '') : 'image').replace(/[\[\]]/g, '');
      fragments.push(`![${alt}](${saveResult.url})`);
    }
    if (!fragments.length) return;
    const md = fragments.join('\n\n');
    if (vditor && typeof vditor.insertValue === 'function') {
      vditor.insertValue(md, true);
      markDirty(true);
      scheduleUpdateStats();
      scheduleSyncSourceFromVditor();
    }
  } catch (err) {
    console.error('[MarkPad] 图片上传失败:', err);
  }
}

async function handleImageUpload(files) {
  if (!files || !files.length) return null;
  try {
    const fragments = [];
    for (const file of files) {
      if (file && file.type && !file.type.startsWith('image/')) continue;
      const result = await window.markpad.saveUploadedImage(file);
      if (!result || !result.url) continue;
      const alt = (file && file.name ? file.name.replace(/\.[^.]+$/, '') : 'image').replace(/[\[\]]/g, '');
      fragments.push(`![${alt}](${result.url})`);
    }
    if (!fragments.length) return null;
    const md = fragments.join('\n\n');
    if (vditor && typeof vditor.insertValue === 'function') {
      vditor.insertValue(md, true);
      markDirty(true);
      scheduleUpdateStats();
      scheduleSyncSourceFromVditor();
    }
    return null;
  } catch (err) {
    console.error('[MarkPad] 图片上传失败:', err);
    return `图片插入失败：${err && err.message || err}`;
  }
}

// ========= 大纲 =========
const outlineCollapseKey = 'markpad-outline-collapsed';
function getCollapsed() {
  try { return new Set(JSON.parse(localStorage.getItem(outlineCollapseKey) || '[]')); }
  catch (_) { return new Set(); }
}
function saveCollapsed(set) {
  localStorage.setItem(outlineCollapseKey, JSON.stringify([...set]));
}

function buildHeadingTree() {
  const editArea = document.querySelector('.vditor-ir, .vditor-wysiwyg');
  if (!editArea) return [];
  const headings = editArea.querySelectorAll('h1[data-block], h2[data-block], h3[data-block], h4[data-block], h5[data-block], h6[data-block]');
  const flat = [];
  headings.forEach((h, i) => {
    if (!h.id) h.id = 'mp-h-' + i;
    const lv = parseInt(h.tagName.substring(1));
    const span = h.querySelector('[data-render="1"]') || h;
    const text = (span.innerText || h.innerText || '').replace(/^#+\s*/, '').trim() || '(无标题)';
    flat.push({ id: h.id, level: lv, text, el: h });
  });
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
  if (currentCodeMode) {
    tree.innerHTML = '';
    if (empty) { empty.style.display = 'block'; empty.textContent = '当前文件为代码/配置文件，无章节大纲'; }
    return;
  } else if (empty) {
    empty.textContent = '暂无标题，先在文档中添加 # / ## 标题';
  }
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

let outlineRefreshTimer = null;
function scheduleOutlineRefresh() {
  if (outlineRefreshTimer) clearTimeout(outlineRefreshTimer);
  outlineRefreshTimer = setTimeout(() => { outlineRefreshTimer = null; renderOutlineTree(); }, 200);
}

document.getElementById('outline-content').addEventListener('click', (e) => {
  const chev = e.target.closest('[data-toggle]');
  if (chev) {
    e.preventDefault(); e.stopPropagation();
    const id = chev.getAttribute('data-toggle');
    const c = getCollapsed();
    if (c.has(id)) c.delete(id); else c.add(id);
    saveCollapsed(c);
    renderOutlineTree();
    return;
  }
  const item = e.target.closest('.ol-item');
  if (!item) return;
  e.preventDefault(); e.stopPropagation();
  const targetId = item.dataset.id;
  const heading = document.getElementById(targetId);
  if (!heading) return;
  try { heading.scrollIntoView({ block: 'start', inline: 'nearest', behavior: 'auto' }); } catch (_) {}
  showJumpToast({ textContent: item.querySelector('.ol-text')?.textContent || '' });
  flashHeading(heading);
  document.querySelectorAll('#outline-tree .ol-item').forEach(el => el.classList.remove('active'));
  item.classList.add('active');
}, true);

let jumpToastEl = null;
let jumpToastTimer = null;
function showJumpToast(span) {
  const txt = (span.textContent || '').trim().slice(0, 40);
  if (!jumpToastEl) { jumpToastEl = document.createElement('div'); jumpToastEl.id = 'mp-jump-toast'; document.body.appendChild(jumpToastEl); }
  jumpToastEl.textContent = '已跳转到：' + txt;
  jumpToastEl.classList.remove('show'); void jumpToastEl.offsetWidth; jumpToastEl.classList.add('show');
  clearTimeout(jumpToastTimer);
  jumpToastTimer = setTimeout(() => { jumpToastEl && jumpToastEl.classList.remove('show'); }, 1400);
}
function showQuickToast(msg) {
  if (!jumpToastEl) { jumpToastEl = document.createElement('div'); jumpToastEl.id = 'mp-jump-toast'; document.body.appendChild(jumpToastEl); }
  jumpToastEl.textContent = msg;
  jumpToastEl.classList.remove('show'); void jumpToastEl.offsetWidth; jumpToastEl.classList.add('show');
  clearTimeout(jumpToastTimer);
  jumpToastTimer = setTimeout(() => { jumpToastEl && jumpToastEl.classList.remove('show'); }, 1400);
}
function flashHeading(el) {
  if (!el) return;
  el.classList.remove('mp-heading-flash'); void el.offsetWidth; el.classList.add('mp-heading-flash');
  setTimeout(() => el.classList.remove('mp-heading-flash'), 1700);
}

function moveVditorOutline() {
  const container = document.getElementById('outline-content');
  if (!container) return;
  if (container.querySelector('.vditor-outline')) return;
  const vdOutline = document.querySelector('.vditor-outline');
  if (!vdOutline) return;
  container.innerHTML = '';
  container.appendChild(vdOutline);
  const titleEl = vdOutline.querySelector('.vditor-outline__title');
  if (titleEl) titleEl.style.display = 'none';
}

function toggleOutline() {
  outlineVisible = !outlineVisible;
  outlineEl.classList.toggle('hidden', !outlineVisible);
  if (outlineVisible) {
    const w = outlineEl.dataset.userWidth || '240';
    outlineEl.style.width = w + 'px';
    moveVditorOutline();
  } else {
    outlineEl.style.width = '';
  }
}
document.getElementById('outline-toggle').addEventListener('click', (e) => { e.preventDefault(); toggleOutline(); });

// ========= 侧栏 Tab 切换 =========
const RECENT_KEY = 'markpad-recent-files';
const FAV_KEY = 'markpad-favorites';
const MAX_RECENT = 10;
let sidebarTab = 'outline';
const outlineContent = document.getElementById('outline-content');
const filesContent = document.getElementById('files-content');

function switchSidebarTab(tab) {
  sidebarTab = tab;
  document.querySelectorAll('.outline-tab').forEach(b => { b.classList.toggle('active', b.dataset.tab === tab); });
  if (outlineContent) { outlineContent.classList.toggle('hidden', tab !== 'outline'); outlineContent.style.display = tab === 'outline' ? '' : 'none'; }
  if (filesContent) { filesContent.classList.toggle('hidden', tab !== 'files'); filesContent.style.display = tab === 'files' ? '' : 'none'; }
  if (tab === 'outline') renderOutlineTree();
  if (tab === 'files') refreshFileList();
}
document.querySelectorAll('.outline-tab').forEach(btn => { btn.addEventListener('click', () => switchSidebarTab(btn.dataset.tab)); });

// ========= 文件管理 =========
const FILES_COLLAPSE_KEY = 'markpad-files-collapsed-sections';
const FILES_COLLAPSE_INIT_KEY = 'markpad-files-collapsed-initialized';
let filesSearchQuery = '';

// 文件列表防抖刷新（快速切 tab 时不会反复 IPC 读目录）
let _fileListTimer = null;
function debouncedRefreshFileList() {
  if (sidebarTab !== 'files') return;
  if (_fileListTimer) clearTimeout(_fileListTimer);
  _fileListTimer = setTimeout(() => { _fileListTimer = null; refreshFileList(); }, 150);
}

// 目录缓存（同一目录不重复 IPC）
let _dirCache = { dir: null, entries: null, time: 0 };
function getCachedDirectory(dir) {
  const now = Date.now();
  if (_dirCache.dir === dir && (now - _dirCache.time) < 2000) return _dirCache.entries;
  return null;
}
function setCachedDirectory(dir, entries) {
  _dirCache = { dir, entries, time: Date.now() };
}

function getCollapsedSections() {
  try {
    if (!localStorage.getItem(FILES_COLLAPSE_INIT_KEY)) {
      localStorage.setItem(FILES_COLLAPSE_INIT_KEY, '1');
      localStorage.setItem(FILES_COLLAPSE_KEY, JSON.stringify(['folder']));
      return new Set(['folder']);
    }
    return new Set(JSON.parse(localStorage.getItem(FILES_COLLAPSE_KEY) || '[]'));
  } catch (_) { return new Set(); }
}
function saveCollapsedSections(set) { localStorage.setItem(FILES_COLLAPSE_KEY, JSON.stringify([...set])); }
function isSectionCollapsed(name) { return getCollapsedSections().has(name); }
function toggleSection(name) {
  const c = getCollapsedSections(); const wasCollapsed = c.has(name);
  if (wasCollapsed) c.delete(name); else c.add(name);
  saveCollapsedSections(c); applySectionCollapsed();
  if (name === 'folder' && wasCollapsed && currentFilePath) refreshFileList();
}
function applySectionCollapsed() {
  document.querySelectorAll('#files-content .files-section').forEach(sec => {
    const name = sec.dataset.section; const collapsed = isSectionCollapsed(name);
    sec.classList.toggle('collapsed', collapsed);
    const chev = sec.querySelector('.fs-chevron');
    if (chev) chev.textContent = collapsed ? '▸' : '▾';
  });
}
document.addEventListener('click', (e) => { const t = e.target.closest('[data-toggle]'); if (!t || !t.classList.contains('files-section-title')) return; toggleSection(t.dataset.toggle); }, false);
document.addEventListener('input', (e) => { if (e.target && e.target.id === 'files-search-input') { filesSearchQuery = e.target.value.trim().toLowerCase(); refreshFileList(); } });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && e.target && e.target.id === 'files-search-input') { e.target.value = ''; filesSearchQuery = ''; refreshFileList(); } });

// ============ 编辑区锚点链接拦截（[toc] 目录 / #anchor 跳转）============
// Vditor wysiwyg 模式下 .vditor-toc a[href="#xxx"] 和其他锚点链接默认会触发
// Electron 异常导航（打开空白页/新窗口）。这里拦截并转为文档内 scrollIntoView。
document.addEventListener('click', (e) => {
  const anchorLink = e.target.closest('a[href^="#"]');
  if (!anchorLink) return;
  const href = anchorLink.getAttribute('href');
  if (!href || href === '#') return;
  // 只处理指向同页内 id 的锚点链接
  const targetId = href.slice(1);
  if (!targetId) return;
  e.preventDefault();
  e.stopPropagation();
  // 在编辑器区域内查找目标元素
  let targetEl;
  try {
    targetEl = document.getElementById(targetId);
    if (!targetEl) {
      // fallback: 通过 name 属性查找
      targetEl = document.querySelector('[name="' + CSS.escape(targetId) + '"]');
    }
  } catch (_) {}
  // fallback 2: Vditor wysiwyg 的 heading id 与 toc href 不一致（slugify 规则不同或无 id）
  // 改用链接文本匹配编辑区内的 <h> 元素
  if (!targetEl) {
    const linkText = (anchorLink.textContent || '').trim();
    if (linkText) {
      const editArea = document.querySelector('.vditor-ir, .vditor-wysiwyg');
      if (editArea) {
        const headings = editArea.querySelectorAll('h1[data-block], h2[data-block], h3[data-block], h4[data-block], h5[data-block], h6[data-block]');
        for (const h of headings) {
          // 取 heading 的纯文本内容（去掉子元素如语法标记）
          const span = h.querySelector('[data-render="1"]') || h;
          const ht = (span.innerText || h.innerText || '').replace(/^#+\s*/, '').trim();
          if (ht === linkText || ht.includes(linkText) || linkText.includes(ht)) {
            targetEl = h; break;
          }
        }
      }
    }
  }
  if (!targetEl) {
    showQuickToast('未找到目标章节：' + targetId);
    return;
  }
  try { targetEl.scrollIntoView({ block: 'start', inline: 'nearest', behavior: 'auto' }); } catch (_) {}
  const linkText = (anchorLink.textContent || '').trim().slice(0, 40);
  showJumpToast({ textContent: linkText || targetId });
  flashHeading(targetEl);
}, true);

function matchQuery(file) {
  if (!filesSearchQuery) return true;
  const q = filesSearchQuery;
  return (file.name || '').toLowerCase().includes(q) || (file.path || '').toLowerCase().includes(q);
}

async function refreshFileList() {
  const favs = getFavorites().filter(matchQuery);
  renderFileSection('fav-list', favs.map(f => ({ ...f, isFav: true })), true);
  const favCountEl = document.getElementById('fav-count');
  if (favCountEl) favCountEl.textContent = favs.length ? favs.length : '';
  const recent = getRecentFiles().filter(matchQuery);
  renderFileSection('recent-list', recent.map(f => ({ ...f, isFav: isFavorited(f.path) })), false);
  const recentCountEl = document.getElementById('recent-count');
  if (recentCountEl) recentCountEl.textContent = recent.length ? recent.length : '';
  const folderEl = document.getElementById('folder-list');
  const folderCountEl = document.getElementById('folder-count');
  if (!currentFilePath) {
    folderEl.innerHTML = '<div class="file-item" style="opacity:0.5;font-size:11px">打开文件后显示</div>';
    if (folderCountEl) folderCountEl.textContent = '';
  } else if (isSectionCollapsed('folder')) {
    folderEl.innerHTML = '<div class="file-item" style="opacity:0.5;font-size:11px">展开后加载同目录文件…</div>';
    if (folderCountEl) folderCountEl.textContent = '';
  } else {
    const dir = currentFilePath.substring(0, currentFilePath.lastIndexOf('/'));
    try {
      // 优先用缓存，避免每次切 tab 都 IPC 读目录
      let entries = getCachedDirectory(dir);
      if (!entries) {
        entries = await window.markpad.listDirectory(dir);
        setCachedDirectory(dir, entries);
      }
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
  }
  updateFavoriteBtn();
  applySectionCollapsed();
}

function fileIconFor(file) {
  if (file.isDir) return '📁';
  const ext = (file.name || '').split('.').pop().toLowerCase();
  if (ext === 'md') return '📝';
  if (ext === 'json' || ext === 'jsonl') return '📊';
  if (ext === 'xml') return '📋';
  if (ext === 'yml' || ext === 'yaml') return '⚙️';
  return '📄';
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
    const star = starOn ? '★' : '☆';
    const starTitle = starOn ? '取消收藏' : '加入收藏';
    return `<div class="file-item ${isCur ? 'current' : ''}" data-path="${escapeAttr(f.path)}" title="${escapeAttr(f.path)}">
      <span class="fi-icon">${fileIconFor(f)}</span>
      <span class="fi-name">${escapeHtml(f.name)}</span>
      <span class="fi-star ${starOn ? 'favorited' : ''}" data-action="fav" title="${starTitle}">${star}</span>
    </div>`;
  }).join('');
  // 事件委托已在 files-content 上统一绑定，不再逐元素加监听器
}

function escapeAttr(s) { return String(s).replace(/[&"'<>]/g, ''); }
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
}

// 文件列表事件委托（不再逐元素绑监听器，大幅减少 DOM 操作）
document.getElementById('files-content').addEventListener('click', (e) => {
  const favStar = e.target.closest('[data-action="fav"]');
  if (favStar) {
    e.stopPropagation();
    const fileItem = favStar.closest('.file-item');
    if (!fileItem) return;
    const fp = fileItem.dataset.path;
    const name = fileItem.querySelector('.fi-name')?.textContent || fp.split('/').pop();
    if (!fp) return;
    const nowFav = toggleFavorite(fp, name);
    showQuickToast(nowFav ? '★ 已加入收藏' : '已取消收藏');
    refreshFileList();
    return;
  }
  const fileItem = e.target.closest('.file-item');
  if (fileItem && fileItem.dataset.path) {
    window.markpad.openFileByPath(fileItem.dataset.path);
  }
});

function updateFavoriteBtn() {
  const btn = document.getElementById('favorite-toggle');
  if (!btn) return;
  const fav = currentFilePath && isFavorited(currentFilePath);
  btn.classList.toggle('favorited', !!fav);
  btn.title = !currentFilePath ? '请先打开一个文件' : (fav ? '取消收藏（⌘D）' : '收藏当前文件（⌘D）');
}

switchSidebarTab('outline');
// 启动时先从主进程 JSON 恢复数据（如果 localStorage 为空），再刷新列表
restoreAppDataIfNeeded().then(() => refreshFileList());

// ========= 拖拽分隔条 =========
function initResizers() {
  const outlineResizer = document.getElementById('outline-resizer');
  const sourceResizer = document.getElementById('source-resizer');
  const sourcePane = document.getElementById('source-pane');
  let dragging = null; let startX = 0; let startW = 0;

  function onDown(e, which) {
    dragging = which; startX = e.clientX;
    const target = which === 'outline' ? outlineEl : sourcePane;
    startW = target.getBoundingClientRect().width;
    const resizer = which === 'outline' ? outlineResizer : sourceResizer;
    resizer.classList.add('dragging');
    document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none';
    e.preventDefault();
  }
  function onMove(e) {
    if (!dragging) return;
    const delta = e.clientX - startX;
    const newW = dragging === 'outline' ? startW + delta : startW - delta;
    const clamped = Math.max(120, Math.min(520, newW));
    const target = dragging === 'outline' ? outlineEl : sourcePane;
    const num = Math.round(clamped);
    target.style.width = num + 'px';
    target.dataset.userWidth = num;
  }
  function onUp() {
    if (!dragging) return;
    const resizer = dragging === 'outline' ? outlineResizer : sourceResizer;
    resizer.classList.remove('dragging');
    document.body.style.cursor = ''; document.body.style.userSelect = '';
    dragging = null;
  }
  outlineResizer.addEventListener('mousedown', (e) => onDown(e, 'outline'));
  outlineResizer.addEventListener('click', (e) => { if (outlineEl.classList.contains('hidden')) toggleOutline(); });
  sourceResizer.addEventListener('mousedown', (e) => onDown(e, 'source'));
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}
initResizers();

// ========= 源码面板双向同步 =========
function markDirty(dirty) {
  const prevDirty = isDirty;
  isDirty = dirty;
  window.markpad.setDirty(dirty);
  if (dirty) scheduleAutoSave();
  // 仅脏状态变化时才更新 tab 栏（避免频繁 innerHTML）
  const tab = getActiveTab();
  if (tab) {
    tab.dirty = dirty;
    if (prevDirty !== dirty) renderTabBar();
  }
}

const AUTO_SAVE_DEBOUNCE = 1500;
let autoSaveTimer = null;
let lastSavedContent = null;
function scheduleAutoSave() {
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(doAutoSave, AUTO_SAVE_DEBOUNCE);
}
function getEditorContent() {
  if (currentCodeMode) return codeEditor ? codeEditor.value : '';
  if (vditor && vditorReady) return vditor.getValue() || '';
  return '';
}

async function doAutoSave() {
  autoSaveTimer = null;
  if (!currentCodeMode && (!vditor || !vditorReady)) return;
  const content = getEditorContent();
  if (content === lastSavedContent) return;
  try {
    const res = await window.markpad.autoSave(content);
    if (res && res.saved) {
      lastSavedContent = content;
      markDirty(false);
      setAutoSaveStatus('已自动保存 · ' + nowHM());
    } else if (res && res.draft) {
      setAutoSaveStatus('草稿已暂存 · ' + nowHM());
    }
  } catch (err) {
    setAutoSaveStatus('自动保存失败');
  }
}
function nowHM() { const d = new Date(); return String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0') + ':' + String(d.getSeconds()).padStart(2,'0'); }
function setAutoSaveStatus(text) { const el = document.getElementById('status-autosave'); if (el) el.textContent = text; }

function updateStats() {
  if (currentCodeMode) { updateStatsForCode(); return; }
  if (!vditor) return;
  const text = getEditorContent();
  const cn = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const en = (text.match(/[a-zA-Z]+/g) || []).length;
  statusWords.textContent = `${cn + en} 字`;
}

// 字数统计无需实时，按键时 debounce，避免每个字符跑两次全文正则
let statsDebounceTimer = null;
function scheduleUpdateStats() {
  if (statsDebounceTimer) clearTimeout(statsDebounceTimer);
  statsDebounceTimer = setTimeout(() => { statsDebounceTimer = null; updateStats(); }, 300);
}

function syncSourceFromVditor(immediate) {
  if (!vditor || !vditorReady) return;
  if (syncingFromSource) return;
  // 源码面板没显示时，没必要序列化全文同步（切到源码面板时会补一次 immediate）
  if (!sourceVisible && !immediate) return;
  if (sourceEditor.matches(':focus')) return;
  const val = getEditorContent();
  if (sourceEditor.value === val) return;
  syncingFromVditor = true;
  sourceEditor.value = val;
  syncingFromVditor = false;
}
let syncSourceDebounceTimer = null;
function scheduleSyncSourceFromVditor() {
  if (!sourceVisible) return; // 面板隐藏时彻底跳过
  if (syncSourceDebounceTimer) clearTimeout(syncSourceDebounceTimer);
  syncSourceDebounceTimer = setTimeout(() => { syncSourceDebounceTimer = null; syncSourceFromVditor(); }, 300);
}
function syncVditorFromSource() {
  if (!vditor || !vditorReady) return;
  if (syncingFromVditor) return;
  const val = sourceEditor.value;
  if (getEditorContent() === val) return;
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
  sourceSyncTimer = setTimeout(() => { syncVditorFromSource(); }, 220);
});
sourceEditor.addEventListener('blur', () => { clearTimeout(sourceSyncTimer); syncVditorFromSource(); });

// ========= 主题 =========
function applyEditorTheme() {
  document.body.classList.toggle('dark', darkMode);
  document.body.setAttribute('data-theme-mode', themeMode);
  if (typeof updateThemeBtnTitle === 'function') updateThemeBtnTitle();
}
function applyThemeMode(persist = true) {
  darkMode = computeDark();
  applyEditorTheme();
  if (vditor && vditorReady) { vditor.setTheme(darkMode ? 'dark' : 'classic', darkMode ? 'dark' : 'light', darkMode ? 'native' : 'github'); }
  window.markpad.setNativeTheme(themeMode);
  if (persist) localStorage.setItem('markpad-theme', themeMode);
}
function setTheme(mode) { if (!['light', 'dark', 'system'].includes(mode)) return; themeMode = mode; applyThemeMode(); }
function toggleTheme() {
  const order = ['light', 'dark', 'system'];
  const next = order[(order.indexOf(themeMode) + 1) % order.length];
  setTheme(next);
  if (styleTheme !== 'default') { styleTheme = 'default'; document.body.removeAttribute('data-style-theme'); localStorage.setItem('markpad-style-theme', 'default'); }
}
systemDark.addEventListener('change', () => { if (themeMode === 'system') applyThemeMode(false); });

function toggleSource() {
  if (currentCodeMode) return;
  sourceVisible = !sourceVisible;
  sourceEl.classList.toggle('hidden', !sourceVisible);
  document.getElementById('source-resizer').classList.toggle('hidden', !sourceVisible);
  const btn = document.getElementById('source-toggle');
  if (btn) btn.classList.toggle('active', sourceVisible);
  if (sourceVisible) syncSourceFromVditor(true);
}

// ========= 专注模式 =========
function toggleFocusMode() {
  focusMode = !focusMode;
  document.body.classList.toggle('focus-mode', focusMode);
  if (focusMode) updateFocusActive();
  else document.querySelectorAll('.focus-active').forEach(el => el.classList.remove('focus-active'));
}
function updateFocusActive() {
  if (!focusMode) return;
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const node = sel.getRangeAt(0).startContainer;
  const block = node.closest
    ? (node.closest('p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, table, .vditor-ir__node, .vditor-wysiwyg__block') || (node.nodeType === 3 ? node.parentElement : node))
    : (node.nodeType === 3 ? node.parentElement : node);
  if (!block) return;
  document.querySelectorAll('.focus-active').forEach(el => el.classList.remove('focus-active'));
  block.classList.add('focus-active');
  const parentBlock = block.closest('li, blockquote');
  if (parentBlock) parentBlock.classList.add('focus-active');
}

// ========= 打字机模式 =========
let twTimer = null;
function toggleTypewriterMode() { typewriterMode = !typewriterMode; if (typewriterMode) typewriterScroll(); }
function typewriterScroll() {
  if (!typewriterMode || !vditorReady) return;
  const scroller = document.querySelector('.vditor-ir pre.vditor-reset, .vditor-wysiwyg pre.vditor-reset');
  if (!scroller) return;
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  if (!range.collapsed) return;
  const rect = range.getClientRects()[0];
  if (!rect) return;
  const scrollerRect = scroller.getBoundingClientRect();
  const targetRatio = 0.45;
  const currentPos = rect.top - scrollerRect.top + scroller.scrollTop;
  const targetPos = currentPos - scrollerRect.height * targetRatio;
  if (Math.abs(scroller.scrollTop - targetPos) > 30) scroller.scrollTop = Math.max(0, targetPos);
}

document.addEventListener('selectionchange', () => {
  if (focusMode) {
    if (!focusMode._pending) { focusMode._pending = true; requestAnimationFrame(() => { focusMode._pending = false; updateFocusActive(); }); }
  }
  if (typewriterMode) { clearTimeout(twTimer); twTimer = setTimeout(typewriterScroll, 60); }
});

// ========= 样式主题 =========
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
  const preset = STYLE_THEMES[name];
  if (preset.base && themeMode !== preset.base) { themeMode = preset.base; darkMode = preset.base === 'dark'; applyThemeMode(true); }
  localStorage.setItem('markpad-style-theme', name);
}
function nextStyleTheme() { const keys = Object.keys(STYLE_THEMES); const idx = keys.indexOf(styleTheme); setStyleTheme(keys[(idx + 1) % keys.length]); }

// ============ IPC 事件绑定 ============

// 文件打开：创建新 tab（而非替换当前内容）
window.markpad.onFileOpened(({ path, content, codeMode }) => {
  // 切换到新目录时需要失效缓存
  if (currentFilePath) {
    const oldDir = currentFilePath.substring(0, currentFilePath.lastIndexOf('/'));
    const newDir = path.substring(0, path.lastIndexOf('/'));
    if (oldDir !== newDir) _dirCache = { dir: null, entries: null, time: 0 };
  }
  createTab(path, content, codeMode);
  // switchToTab 内已触发 debouncedRefreshFileList + scheduleOutlineRefresh
  addRecentFile(path);
  updateFavoriteBtn();
  // 强制立即刷新一次文件列表（打开新文件需要立刻反映在列表中）
  refreshFileList();
});

window.markpad.onFileNew(() => {
  createTab(null, '', null);
});

function applyCodeMode(mode) {
  const wasCodeMode = !!currentCodeMode;
  currentCodeMode = mode;
  const isCode = !!mode;
  document.body.classList.toggle('code-mode', isCode);
  if (isCode) document.body.setAttribute('data-code-lang', mode.lang);
  else document.body.removeAttribute('data-code-lang');
  const tag = document.getElementById('status-codelang');
  if (tag) { tag.textContent = isCode ? mode.lang.toUpperCase() : ''; tag.style.display = isCode ? '' : 'none'; }
  const fmtBtn = document.getElementById('format-code-btn');
  if (fmtBtn) { fmtBtn.disabled = !isCode; fmtBtn.title = isCode ? '格式化代码（⌥⌘L）' : '格式化（仅 JSON/XML/YAML 等代码文件可用）'; }
  const srcBtn = document.getElementById('source-toggle');
  if (srcBtn) { srcBtn.disabled = isCode; srcBtn.title = isCode ? '切换源码面板（仅 Markdown 文件可用）' : '切换源码面板（⌘E）'; }
  const codeWrap = document.getElementById('code-editor-wrap');
  if (codeWrap) { codeWrap.style.display = isCode ? '' : 'none'; if (!isCode && codeEditor) codeEditor.value = ''; }
  if (isCode) vditorNeedsRebuild = true;
  if (wasCodeMode && !isCode && vditorNeedsRebuild) {
    const vditorEl = document.getElementById('vditor');
    vditorEl.style.display = '';
    vditorEl.offsetHeight;
    if (vditor) { try { vditor.destroy(); } catch (_) {} vditor = null; vditorReady = false; }
    vditorEl.innerHTML = '';
    vditorNeedsRebuild = false;
  }
  try { renderOutlineTree(); } catch (_) {}
}

function loadCodeContent(value) {
  if (!codeEditor) return;
  codeEditor.value = value == null ? '' : String(value);
  codeEditor.scrollTop = 0;
  codeEditor.selectionStart = codeEditor.selectionEnd = 0;
  markDirty(false);
  updateStatsForCode();
  highlightCode();
}

if (typeof Prism !== 'undefined') Prism.manual = true;
const PRISM_LANG_MAP = { json: 'json', jsonl: 'json', xml: 'markup', yaml: 'yaml', yml: 'yaml' };

function highlightCode() {
  if (!currentCodeMode || !codeEditor) return;
  const highlight = document.getElementById('code-highlight');
  const codeEl = highlight && highlight.querySelector('code');
  if (!codeEl) return;
  const lang = PRISM_LANG_MAP[currentCodeMode.lang] || 'json';
  const raw = codeEditor.value;
  try { const html = Prism.highlight(raw, Prism.languages[lang], lang); codeEl.className = 'language-' + lang; codeEl.innerHTML = html; }
  catch (_) { codeEl.className = ''; codeEl.textContent = raw; }
  highlight.scrollTop = codeEditor.scrollTop;
  highlight.scrollLeft = codeEditor.scrollLeft;
}

// Prism.highlight 对大文件是 CPU 密集操作，打字时 debounce 避免每键全文重算
let highlightDebounceTimer = null;
function scheduleHighlightCode() {
  if (highlightDebounceTimer) clearTimeout(highlightDebounceTimer);
  highlightDebounceTimer = setTimeout(() => { highlightDebounceTimer = null; highlightCode(); }, 150);
}

if (codeEditor) {
  codeEditor.addEventListener('scroll', () => {
    if (!currentCodeMode) return;
    const highlight = document.getElementById('code-highlight');
    if (highlight) { highlight.scrollTop = codeEditor.scrollTop; highlight.scrollLeft = codeEditor.scrollLeft; }
  });
}

function updateStatsForCode() {
  if (!codeEditor) return;
  const v = codeEditor.value || '';
  if (statusWords) statusWords.textContent = `${v.length} 字符`;
  if (statusCursor) {
    const upto = v.slice(0, codeEditor.selectionStart);
    const line = upto.split('\n').length;
    const col = upto.length - upto.lastIndexOf('\n');
    statusCursor.textContent = `行 ${line}, 列 ${col}`;
  }
}

if (codeEditor) {
  codeEditor.addEventListener('input', () => {
    if (!currentCodeMode) return;
    markDirty(true);
    updateStatsForCode();
    scheduleHighlightCode();
    scheduleAutoSave();
  });
  codeEditor.addEventListener('keyup', () => { if (currentCodeMode) updateStatsForCode(); });
  codeEditor.addEventListener('click', () => { if (currentCodeMode) updateStatsForCode(); });
  codeEditor.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      const s = codeEditor.selectionStart, en = codeEditor.selectionEnd;
      const v = codeEditor.value;
      codeEditor.value = v.slice(0, s) + '  ' + v.slice(en);
      codeEditor.selectionStart = codeEditor.selectionEnd = s + 2;
      markDirty(true);
      scheduleHighlightCode();
      scheduleAutoSave();
    }
  });
}

window.markpad.onRequestSave(async ({ saveAs }) => {
  const content = getEditorContent();
  const res = await window.markpad.saveContent(content, saveAs);
  if (res.saved) {
    markDirty(false);
    if (res.path) {
      currentFilePath = res.path;
      const tab = getActiveTab();
      if (tab) { tab.filePath = res.path; tab.displayName = res.path.split('/').pop(); renderTabBar(); }
      statusFile.textContent = res.path.split('/').pop();
      addRecentFile(res.path);
      if (sidebarTab === 'files') refreshFileList();
    }
  }
  return res;
});

window.markpad.onRequestExport(async (kind) => { await runExport(kind); });
window.markpad.onRevealAssetsDir(async () => { await window.markpad.revealAssetsDir(); });
window.markpad.onRequestPngHtml(() => { const html = vditor ? vditor.getHTML() : ''; window.markpad.sendPngHtml(html); });

// ========= 导出 =========
function getRenderedHtml() { if (!vditor) return ''; return vditor.getHTML(); }
function absolutizeImgsInHtml(html, baseDir) {
  return html.replace(/<img\b([^>]*?)\ssrc=(["'])([^"']+)\2/gi, (m, pre, q, src) => {
    if (/^mpmedia:\/\//i.test(src)) { const abs = decodeURIComponent(src.replace(/^mpmedia:\/\//i, '')); return `<img${pre} src=${q}file://${abs}${q}`; }
    if (/^(https?:|file:|data:)/i.test(src)) return m;
    if (!baseDir) return m;
    try { let abs = src; if (abs.startsWith('./')) abs = abs.slice(2); const sep = baseDir.endsWith('/') ? '' : '/'; const url = 'file://' + baseDir + sep + abs; return `<img${pre} src=${q}${url}${q}`; }
    catch (_) { return m; }
  });
}
function buildFullHtml(bodyHtml, vditorCss) {
  const baseCss = `body{margin:0;padding:40px;background:#fff;color:#24292e;font-family:-apple-system,"PingFang SC","Helvetica Neue","Microsoft YaHei",sans-serif;line-height:1.7;font-size:16px;-webkit-font-smoothing:antialiased;}.vditor-reset{max-width:820px;margin:0 auto;}.vditor-reset img{max-width:100%;height:auto;}.vditor-reset pre{background:#f6f8fa;padding:16px;border-radius:6px;overflow:auto;font-family:"SF Mono",Menlo,Consolas,monospace;font-size:14px;}.vditor-reset code{background:rgba(175,184,193,.2);padding:.2em .4em;border-radius:4px;font-family:"SF Mono",Menlo,Consolas,monospace;font-size:.9em;}.vditor-reset pre code{background:transparent;padding:0;}.vditor-reset table{border-collapse:collapse;margin:16px 0;}.vditor-reset table td,.vditor-reset table th{border:1px solid #d0d7de;padding:6px 12px;}.vditor-reset blockquote{border-left:4px solid #d0d7de;margin:16px 0;padding:0 16px;color:#57606a;}.vditor-reset h1,.vditor-reset h2{border-bottom:1px solid #eaecef;padding-bottom:.3em;}`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${vditorCss}\n${baseCss}</style></head><body><div class="vditor-reset">${bodyHtml}</div></body></html>`;
}

async function runExport(kind) {
  if (!vditor) return;
  showQuickToast(`正在导出 ${kind.toUpperCase()}…`);
  try {
    const html = getRenderedHtml();
    if (kind === 'pdf') { const r = await window.markpad.exportPdf(html); showQuickToast(r.saved ? `✅ 已导出 ${r.path.split('/').pop()}` : ''); return; }
    if (kind === 'html') { const r = await window.markpad.exportHtml(html); showQuickToast(r.saved ? `✅ 已导出 ${r.path.split('/').pop()}` : ''); return; }
    const res = await window.markpad.getExportResources();
    const baseDir = res.baseDir || '';
    const absoluteHtml = absolutizeImgsInHtml(html, baseDir);
    if (kind === 'docx') {
      if (typeof htmlDocx === 'undefined' || !htmlDocx.asBlob) { showQuickToast('❌ html-docx-js 未加载'); return; }
      const full = buildFullHtml(absoluteHtml, res.vditorCss || '');
      const blob = htmlDocx.asBlob(full);
      const r = await window.markpad.exportDocx(blob);
      showQuickToast(r.saved ? `✅ 已导出 ${r.path.split('/').pop()}` : '');
      return;
    }
    if (kind === 'png') { const r = await window.markpad.exportPng(2); showQuickToast(r.saved ? `✅ 已导出 ${r.path.split('/').pop()}` : ''); return; }
  } catch (err) { console.error('[export]', err); showQuickToast(`❌ 导出失败：${err.message || err}`); }
}

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
  // 逐 tab 检查脏状态，有未保存则确认
  const dirtyTabs = tabs.filter(t => t.dirty);
  if (!dirtyTabs.length) {
    window.markpad.confirmCloseReply({ action: 'discard' });
    return;
  }
  const action = await window.markpad.askCloseConfirm();
  if (action === 'cancel') { window.markpad.confirmCloseReply({ action: 'cancel' }); return; }
  if (action === 'discard') { window.markpad.confirmCloseReply({ action: 'discard' }); return; }
  // save: 保存当前 tab
  const content = getEditorContent();
  const res = await window.markpad.saveContent(content, false);
  if (res.saved) {
    markDirty(false);
    if (res.path) {
      currentFilePath = res.path;
      const tab = getActiveTab();
      if (tab) { tab.filePath = res.path; tab.displayName = res.path.split('/').pop(); renderTabBar(); }
      statusFile.textContent = res.path.split('/').pop();
    }
    window.markpad.confirmCloseReply({ action: 'discard' });
  } else {
    window.markpad.confirmCloseReply({ action: 'cancel' });
  }
});

// ========= 文件管理 =========

// 启动时从主进程 JSON 文件恢复数据到 localStorage（解决 origin 变更导致 localStorage 丢失的问题）
// 同时，如果 JSON 文件没有数据但 localStorage 有，说明是老用户升级，需要把 localStorage 数据同步到 JSON
async function restoreAppDataIfNeeded() {
  try {
    const data = await window.markpad.readAppData();
    if (!data) return;
    const hasJsonRecent = data.recentFiles && data.recentFiles.length > 0;
    const hasJsonFav = data.favorites && data.favorites.length > 0;
    const lsRecent = localStorage.getItem(RECENT_KEY);
    const lsFav = localStorage.getItem(FAV_KEY);
    const hasLsRecent = lsRecent && lsRecent !== '[]';
    const hasLsFav = lsFav && lsFav !== '[]';

    // JSON 有数据但 localStorage 为空 → 恢复到 localStorage
    if (hasJsonRecent && !hasLsRecent) {
      localStorage.setItem(RECENT_KEY, JSON.stringify(data.recentFiles));
    }
    if (hasJsonFav && !hasLsFav) {
      localStorage.setItem(FAV_KEY, JSON.stringify(data.favorites));
    }
    // localStorage 有数据但 JSON 为空 → 同步到 JSON（老用户升级场景）
    if (hasLsRecent && !hasJsonRecent) {
      try { window.markpad.syncAppData('recentFiles', JSON.parse(lsRecent)); } catch (_) {}
    }
    if (hasLsFav && !hasJsonFav) {
      try { window.markpad.syncAppData('favorites', JSON.parse(lsFav)); } catch (_) {}
    }
  } catch (_) {}
}

function getRecentFiles() {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    if (Array.isArray(list) && list.length > MAX_RECENT) { list.length = MAX_RECENT; try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch (_) {} }
    return Array.isArray(list) ? list : [];
  } catch (_) { return []; }
}
function saveRecentFiles(list) {
  localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  try { window.markpad.syncAppData('recentFiles', list); } catch (_) {}
}
function addRecentFile(fp) {
  if (!fp) return;
  const list = getRecentFiles().filter(f => f.path !== fp);
  list.unshift({ path: fp, name: fp.split('/').pop(), time: Date.now() });
  if (list.length > MAX_RECENT) list.length = MAX_RECENT;
  saveRecentFiles(list);
}
function getFavorites() { try { return JSON.parse(localStorage.getItem(FAV_KEY) || '[]'); } catch (_) { return []; } }
function saveFavorites(list) {
  localStorage.setItem(FAV_KEY, JSON.stringify(list));
  try { window.markpad.syncAppData('favorites', list); } catch (_) {}
}
function isFavorited(fp) { return getFavorites().some(f => f.path === fp); }
function toggleFavorite(fp, name) {
  if (!fp) return false;
  const list = getFavorites();
  const idx = list.findIndex(f => f.path === fp);
  if (idx >= 0) { list.splice(idx, 1); saveFavorites(list); return false; }
  else { list.push({ path: fp, name: name || fp.split('/').pop() }); saveFavorites(list); return true; }
}

// ========= 快速打开 =========
let quickOpenActive = false;
let quickOpenIndex = 0;
const qoOverlay = document.getElementById('quick-open-overlay');
const qoInput = document.getElementById('quick-open-input');
const qoResults = document.getElementById('quick-open-results');

function showQuickOpen() {
  quickOpenActive = true; quickOpenIndex = 0;
  if (qoOverlay) { qoOverlay.classList.remove('hidden'); if (qoOverlay.classList.contains('hidden')) qoOverlay.style.display = 'flex'; }
  if (qoInput) { qoInput.value = ''; qoInput.focus(); }
  renderQuickResults('');
}
function hideQuickOpen() {
  quickOpenActive = false;
  if (qoOverlay) { qoOverlay.classList.add('hidden'); qoOverlay.style.display = ''; }
  if (qoInput) qoInput.value = '';
}
function renderQuickResults(query) {
  const q = query.toLowerCase();
  const items = [];
  const favs = getFavorites().filter(f => !q || f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q));
  if (favs.length) { items.push({ type: 'section', label: '收藏夹' }); favs.forEach(f => items.push({ type: 'fav', ...f })); }
  const recent = getRecentFiles().filter(f => !q || f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q));
  if (recent.length) { items.push({ type: 'section', label: '最近打开' }); recent.forEach(f => items.push({ type: 'recent', ...f })); }
  quickOpenIndex = 0;
  qoResults.innerHTML = '';
  if (!items.length) { qoResults.innerHTML = '<div class="qoi-empty">没有匹配的文件</div>'; return; }
  items.forEach((item, i) => {
    if (item.type === 'section') { const div = document.createElement('div'); div.className = 'qoi-section'; div.textContent = item.label; qoResults.appendChild(div); }
    else {
      const div = document.createElement('div');
      div.className = 'quick-open-item'; div.dataset.idx = i;
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
  items.forEach((el, i) => { const listIdx = Array.from(qoResults.querySelectorAll('.quick-open-item')).indexOf(el); el.classList.toggle('active', listIdx === quickOpenIndex); });
}
function openQuickItem(item) { if (!item || item.type === 'section') return; hideQuickOpen(); window.markpad.openFileByPath(item.path); }
qoInput.addEventListener('input', () => renderQuickResults(qoInput.value));
qoInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { hideQuickOpen(); return; }
  const items = qoResults.querySelectorAll('.quick-open-item');
  if (!items.length) return;
  if (e.key === 'ArrowDown') { e.preventDefault(); quickOpenIndex = Math.min(quickOpenIndex + 1, items.length - 1); highlightQuickItem(); items[quickOpenIndex]?.scrollIntoView({ block: 'nearest' }); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); quickOpenIndex = Math.max(quickOpenIndex - 1, 0); highlightQuickItem(); items[quickOpenIndex]?.scrollIntoView({ block: 'nearest' }); }
  else if (e.key === 'Enter') {
    e.preventDefault();
    const allData = []; getFavorites().forEach(f => allData.push({ type: 'fav', ...f })); getRecentFiles().forEach(f => allData.push({ type: 'recent', ...f }));
    const q = qoInput.value.toLowerCase();
    const filtered = allData.filter(f => !q || f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q));
    if (filtered[quickOpenIndex]) openQuickItem(filtered[quickOpenIndex]);
  }
});
qoOverlay.addEventListener('click', (e) => { if (e.target === qoOverlay) hideQuickOpen(); });
window.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'p') { e.preventDefault(); e.stopPropagation(); showQuickOpen(); } }, true);
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && quickOpenActive) { if (!qoInput.matches(':focus')) hideQuickOpen(); } }, true);

var themeToggleBtn = document.getElementById('theme-toggle');
function updateThemeBtnTitle() {
  if (!themeToggleBtn) return;
  const cur = { light:'☀️ 亮色', dark:'🌙 暗色', system:'💻 跟随系统' }[themeMode] || '';
  const next = { light:'暗色', dark:'跟随系统', system:'亮色' }[themeMode] || '主题';
  const tip = `当前：${cur} · 点击切到 ${next}（⌘/）`;
  themeToggleBtn.title = tip;
  themeToggleBtn.setAttribute('data-tip', tip);
}
if (themeToggleBtn) {
  themeToggleBtn.addEventListener('click', (e) => { e.preventDefault(); toggleTheme(); });
  themeToggleBtn.addEventListener('mouseenter', () => { showThemeTip(themeToggleBtn); });
  themeToggleBtn.addEventListener('mouseleave', hideThemeTip);
}
let themeTipEl = null;
function showThemeTip(anchor) {
  const cur = { light:'☀️ 亮色', dark:'🌙 暗色', system:'💻 跟随系统（' + (systemDark.matches ? '暗' : '亮') + '色）' }[themeMode] || '';
  if (!themeTipEl) { themeTipEl = document.createElement('div'); themeTipEl.id = 'mp-theme-tip'; document.body.appendChild(themeTipEl); }
  themeTipEl.textContent = '当前：' + cur;
  themeTipEl.classList.add('show');
  const r = anchor.getBoundingClientRect();
  themeTipEl.style.right = (window.innerWidth - r.right) + 'px';
  themeTipEl.style.top = (r.bottom + 6) + 'px';
}
function hideThemeTip() { themeTipEl && themeTipEl.classList.remove('show'); }

const findBtn = document.getElementById('find-btn');
if (findBtn) findBtn.addEventListener('click', (e) => { e.preventDefault(); showFind(); });
const favBtn = document.getElementById('favorite-toggle');
if (favBtn) {
  favBtn.addEventListener('click', (e) => {
    e.preventDefault();
    if (!currentFilePath) { showQuickToast('请先打开一个文件'); return; }
    const name = currentFilePath.split('/').pop();
    const nowFav = toggleFavorite(currentFilePath, name);
    showQuickToast(nowFav ? '★ 已加入收藏' : '已取消收藏');
    updateFavoriteBtn();
    if (sidebarTab === 'files') refreshFileList();
  });
}
window.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && (e.key === 'd' || e.key === 'D')) { e.preventDefault(); e.stopPropagation(); favBtn && favBtn.click(); } }, true);

// 格式化
async function formatCurrentCode() {
  if (!currentCodeMode || !codeEditor) { showQuickToast('当前文件不支持格式化'); return; }
  const content = codeEditor.value || '';
  try {
    const r = await window.markpad.formatCode(content);
    if (!r || !r.ok) { showQuickToast('❌ ' + (r && r.error || '格式化失败')); return; }
    if (!r.changed) { showQuickToast('✓ 已是规范格式'); return; }
    codeEditor.value = r.content;
    codeEditor.scrollTop = 0;
    codeEditor.selectionStart = codeEditor.selectionEnd = 0;
    markDirty(true);
    updateStatsForCode();
    highlightCode();
    scheduleAutoSave();
    showQuickToast('✅ 已格式化');
  } catch (err) { showQuickToast('❌ 格式化失败：' + (err.message || err)); }
}
const formatBtn = document.getElementById('format-code-btn');
if (formatBtn) formatBtn.addEventListener('click', (e) => { e.preventDefault(); formatCurrentCode(); });
window.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.altKey && (e.key === 'l' || e.key === 'L')) { e.preventDefault(); e.stopPropagation(); formatCurrentCode(); } }, true);

const sourceToggleBtn = document.getElementById('source-toggle');
if (sourceToggleBtn) sourceToggleBtn.addEventListener('click', (e) => { e.preventDefault(); toggleSource(); });
const sourceCloseBtn = document.getElementById('source-close');
if (sourceCloseBtn) sourceCloseBtn.addEventListener('click', (e) => { e.preventDefault(); if (sourceVisible) toggleSource(); });

// ============ 窗口内拖拽打开文件 ============
function isFileDrag(e) { const types = e.dataTransfer && e.dataTransfer.types; if (!types) return false; for (let i = 0; i < types.length; i++) { if (types[i] === 'Files') return true; } return false; }
window.addEventListener('dragover', (e) => { if (!isFileDrag(e)) return; e.preventDefault(); e.stopPropagation(); document.body.classList.add('drag-over'); }, true);
window.addEventListener('dragleave', (e) => { if (!isFileDrag(e)) return; e.preventDefault(); e.stopPropagation(); if (e.target === document.documentElement || !e.relatedTarget) document.body.classList.remove('drag-over'); }, true);
window.addEventListener('drop', (e) => {
  if (!isFileDrag(e)) return;
  const files = Array.from(e.dataTransfer.files || []);
  const allImages = files.every((f) => /\.(png|jpg|jpeg|gif|svg|webp|bmp|ico)$/i.test(f.name));
  if (allImages) return;
  e.preventDefault(); e.stopPropagation();
  document.body.classList.remove('drag-over');
  const f = files.find((x) => /\.(md|markdown|mdown|mkd|mdtext|txt|xml|json|jsonl|ya?ml)$/i.test(x.name)) || files[0];
  if (!f) return;
  const p = window.markpad.openDroppedFileFromFile(f);
  if (!p && f.path) window.markpad.openDroppedFile(f.path);
}, true);
window.addEventListener('dragend', () => document.body.classList.remove('drag-over'), true);

// ============ 启动 ============
darkMode = computeDark();
// 创建初始 tab
createTab(null, WELCOME, null);
applyThemeMode(false);
if (styleTheme && styleTheme !== 'default') {
  document.body.setAttribute('data-style-theme', styleTheme);
  const preset = STYLE_THEMES[styleTheme];
  if (preset && preset.base && themeMode !== preset.base) {
    themeMode = preset.base; darkMode = preset.base === 'dark';
    applyEditorTheme();
    if (vditor && vditorReady) vditor.setTheme(darkMode ? 'dark' : 'classic', darkMode ? 'dark' : 'light', darkMode ? 'native' : 'github');
    window.markpad.setNativeTheme(themeMode);
  }
}
markDirty(false);
window.markpad.rendererReady();

// ============ 文档内搜索 ============
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

function showFind() { if (!findBar) return; findBar.classList.remove('hidden'); findActive = true; setTimeout(() => { findInput.focus(); findInput.select(); }, 0); }
function hideFind() { if (!findBar) return; findBar.classList.add('hidden'); findActive = false; clearFindHighlights(); findMatches = []; findIndex = -1; if (findCount) findCount.textContent = '0/0'; }
function clearFindHighlights() {
  findHighlightMarks.forEach(m => { const parent = m.parentNode; if (!parent) return; while (m.firstChild) parent.insertBefore(m.firstChild, m); parent.removeChild(m); parent.normalize(); });
  findHighlightMarks = [];
}
function performFind() {
  clearFindHighlights(); findMatches = []; findIndex = -1;
  const q = (findInput.value || '').trim();
  if (!q) { if (findCount) findCount.textContent = '0/0'; return; }
  const root = document.querySelector('.vditor-ir, .vditor-wysiwyg') || document.getElementById('vditor');
  if (!root) return;
  const lower = q.toLowerCase();
  const textNodes = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      let p = n.parentElement;
      while (p && p !== root) { if (p.classList && (p.classList.contains('vditor-ir__marker') || p.classList.contains('vditor-toolbar') || p.classList.contains('vditor-wysiwyg__marker'))) return NodeFilter.FILTER_REJECT; p = p.parentElement; }
      return n.nodeValue && n.nodeValue.length ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    }
  });
  let n;
  while ((n = walker.nextNode())) textNodes.push(n);
  textNodes.forEach(tn => {
    const text = tn.nodeValue; const tl = text.toLowerCase();
    let from = 0; let idx; const segments = [];
    while ((idx = tl.indexOf(lower, from)) !== -1) { segments.push([idx, idx + q.length]); from = idx + q.length; }
    if (!segments.length) return;
    const frag = document.createDocumentFragment();
    let cur = 0;
    segments.forEach(([s, e]) => {
      if (s > cur) frag.appendChild(document.createTextNode(text.slice(cur, s)));
      const mk = document.createElement('mark'); mk.className = 'mp-find-mark'; mk.textContent = text.slice(s, e);
      frag.appendChild(mk); findHighlightMarks.push(mk); findMatches.push(mk); cur = e;
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
  findInput.addEventListener('input', () => { if (findDebounce) clearTimeout(findDebounce); findDebounce = setTimeout(performFind, 120); });
  findInput.addEventListener('keydown', (e) => { if (e.key === 'Escape') { hideFind(); return; } if (e.key === 'Enter') { e.preventDefault(); if (e.shiftKey) jumpToFindMatch(findIndex - 1); else jumpToFindMatch(findIndex + 1); } });
}
if (findPrev) findPrev.addEventListener('click', () => jumpToFindMatch(findIndex - 1));
if (findNext) findNext.addEventListener('click', () => jumpToFindMatch(findIndex + 1));
if (findCloseBtn) findCloseBtn.addEventListener('click', hideFind);
window.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && (e.key === 'f' || e.key === 'F')) { e.preventDefault(); e.stopPropagation(); showFind(); } if (e.key === 'Escape' && findActive && findInput && !findInput.matches(':focus')) hideFind(); }, true);
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
  if (!currentFilePath) { showQuickToast('请先打开或保存一个文件，才能查看历史版本'); return; }
  versionsOverlay.classList.remove('hidden');
  versionsList.innerHTML = '<div class="ver-empty">加载中…</div>';
  versionsPreviewMeta.textContent = ''; versionsPreviewContent.textContent = '';
  versionsRestoreBtn.disabled = true; versionsCopyBtn.disabled = true;
  currentVersionContent = null;
  const list = await window.markpad.listVersions(currentFilePath);
  if (!list.length) { versionsList.innerHTML = '<div class="ver-empty">还没有历史版本，编辑后会自动产生。</div>'; return; }
  versionsList.innerHTML = list.map((v, i) => {
    const d = new Date(v.time);
    const time = d.getFullYear() + '-' + pad2(d.getMonth()+1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
    const kb = (v.size / 1024).toFixed(1);
    return '<div class="ver-item" data-path="' + escapeAttr(v.path) + '"><div class="ver-time">' + time + '</div><div class="ver-meta">' + kb + ' KB · ' + (i === 0 ? '最新' : '第 ' + (i + 1) + ' 个') + '</div></div>';
  }).join('');
  versionsList.querySelectorAll('.ver-item').forEach(el => {
    el.addEventListener('click', async () => {
      versionsList.querySelectorAll('.ver-item').forEach(x => x.classList.remove('active'));
      el.classList.add('active');
      const p = el.dataset.path;
      const res = await window.markpad.readVersion(p);
      if (res && res.ok) { currentVersionContent = res.content; versionsPreviewMeta.textContent = p.split('/').pop(); versionsPreviewContent.textContent = res.content; versionsRestoreBtn.disabled = false; versionsCopyBtn.disabled = false; }
    });
  });
  const first = versionsList.querySelector('.ver-item');
  if (first) first.click();
}
function hideVersions() { if (versionsOverlay) versionsOverlay.classList.add('hidden'); }
if (versionsCloseBtn) versionsCloseBtn.addEventListener('click', hideVersions);
if (versionsOverlay) versionsOverlay.addEventListener('click', (e) => { if (e.target === versionsOverlay) hideVersions(); });
if (versionsRestoreBtn) versionsRestoreBtn.addEventListener('click', () => {
  if (currentVersionContent == null) return;
  if (!confirm('恢复后会覆盖当前编辑区内容（当前内容会作为一个新版本保留），确定吗？')) return;
  loadContent(currentVersionContent); markDirty(true); hideVersions(); showQuickToast('已恢复，正在自动保存…');
});
if (versionsCopyBtn) versionsCopyBtn.addEventListener('click', async () => {
  if (currentVersionContent == null) return;
  try { await navigator.clipboard.writeText(currentVersionContent); showQuickToast('已复制到剪贴板'); } catch (_) { showQuickToast('复制失败'); }
});
window.markpad.onShowVersions(() => showVersions());

// ============ 草稿恢复 ============
const draftBanner = document.getElementById('draft-banner');
const draftRestoreBtn = document.getElementById('draft-restore');
const draftDiscardBtn = document.getElementById('draft-discard');
let pendingDraft = null;

(async function checkDraftOnStartup() {
  try {
    const res = await window.markpad.checkDraft();
    if (res && res.has && res.content) { pendingDraft = res; if (draftBanner) draftBanner.classList.remove('hidden'); }
  } catch (_) {}
})();

if (draftRestoreBtn) draftRestoreBtn.addEventListener('click', () => {
  if (!pendingDraft) return;
  loadContent(pendingDraft.content); markDirty(true);
  draftBanner.classList.add('hidden'); showQuickToast('已恢复未保存草稿');
});
if (draftDiscardBtn) draftDiscardBtn.addEventListener('click', async () => {
  if (pendingDraft && pendingDraft.path) await window.markpad.discardDraft(pendingDraft.path);
  pendingDraft = null; draftBanner.classList.add('hidden');
});
