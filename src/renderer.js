// MarkPad 渲染进程逻辑
let vditor = null;
let vditorReady = false;
let pendingValue = null;
let isDirty = false;
let outlineVisible = true;
let sourceVisible = false;
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
    outline: { enable: true, position: 'left' },
    placeholder: '开始输入…',
    input: () => {
      if (!syncingFromSource) {
        markDirty(true);
        updateStats();
        syncSourceFromVditor();
        moveVditorOutline();
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
      moveVditorOutline();
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

// ========= 大纲：使用 vditor 自带 outline，只把它搬进我们的侧边栏 =========

function moveVditorOutline() {
  const container = document.getElementById('outline-content');
  if (!container) return;
  // 如果已经在容器里了就不动
  if (container.querySelector('.vditor-outline')) return;

  // 找到 vditor 生成的 outline DOM（在 .vditor-content 里）
  const vdOutline = document.querySelector('.vditor-outline');
  if (!vdOutline) return;

  // 搬进我们的侧边栏
  container.innerHTML = '';
  container.appendChild(vdOutline);

  // vditor 的默认标题（"大纲"）我们用自己的 .outline-title 替代，隐藏它的
  const titleEl = vdOutline.querySelector('.vditor-outline__title');
  if (titleEl) titleEl.style.display = 'none';
}

// 委托点击：拦截 vditor outline 的点击，用我们自己的滚动
document.getElementById('outline-content').addEventListener('click', (e) => {
  const span = e.target.closest('[data-target-id]');
  if (!span) return;

  e.preventDefault();
  e.stopPropagation();

  const targetId = span.getAttribute('data-target-id');
  const heading = document.getElementById(targetId);
  if (!heading) return;

  // 核心：浏览器原生 scrollIntoView —— 不管滚动容器嵌套多深都对
  try {
    heading.scrollIntoView({ block: 'start', inline: 'nearest', behavior: 'auto' });
  } catch (_) {}

  // Toast 反馈（顶部居中提示，用户绝不可能看不到）
  showJumpToast(span);

  // 闪烁高亮目标标题
  flashHeading(heading);

  // 高亮当前大纲项
  document.querySelectorAll('#outline-content [data-target-id]').forEach(s => {
    s.style.background = '';
    s.style.borderRadius = '';
  });
  span.style.background = 'rgba(76, 139, 245, 0.20)';
  span.style.borderRadius = '4px';
}, true); // capture 阶段拦截，比 vditor 自己的 handler 先跑

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
  if (outlineVisible) moveVditorOutline();
}

// ========= 源码面板 ↔ 渲染编辑器 双向同步 =========

function markDirty(dirty) {
  isDirty = dirty;
  window.markpad.setDirty(dirty);
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
  const btn = document.getElementById('source-toggle');
  if (btn) btn.classList.toggle('active', sourceVisible);
  if (sourceVisible) syncSourceFromVditor(true);
}

// ============ IPC 事件绑定 ============

window.markpad.onFileOpened(({ path, content }) => {
  loadContent(content);
  statusFile.textContent = path.split('/').pop();
  markDirty(false);
});

window.markpad.onFileNew(() => {
  loadContent('');
  statusFile.textContent = '未命名';
  markDirty(false);
});

window.markpad.onRequestSave(async ({ saveAs }) => {
  const content = vditor ? vditor.getValue() : '';
  const res = await window.markpad.saveContent(content, saveAs);
  if (res.saved) {
    markDirty(false);
    if (res.path) statusFile.textContent = res.path.split('/').pop();
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

// 右上角主题切换按钮
const themeToggleBtn = document.getElementById('theme-toggle');
function updateThemeBtnTitle() {
  if (!themeToggleBtn) return;
  const cur  = { light:'亮色', dark:'暗色', system:'跟随系统' }[themeMode] || '';
  const next = { light:'暗色', dark:'跟随系统', system:'亮色' }[themeMode] || '主题';
  themeToggleBtn.title = `当前：${cur} · 点击切到 ${next}（⌘/）`;
}
if (themeToggleBtn) {
  themeToggleBtn.addEventListener('click', (e) => {
    e.preventDefault();
    toggleTheme();
  });
}

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
