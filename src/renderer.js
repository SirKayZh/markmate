// MarkPad 渲染进程逻辑
let vditor = null;
let vditorReady = false;
let pendingValue = null;
let isDirty = false;
let outlineVisible = false;
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

一款 **类 Typora** 的所见即所得 Markdown 编辑器。直接在这里输入，内容会实时渲染。

## 快速上手

- 输入 \`# 标题\` 自动变成大号标题
- 输入 \`**粗体**\`、\`*斜体*\`、\`~~删除线~~\`
- 输入 \`-\` 或 \`1.\` 创建列表
- 输入 \`>\` 创建引用块
- 输入三个反引号创建代码块

## 代码高亮

\`\`\`javascript
function hello(name) {
  console.log(\`Hello, \${name}!\`);
}
hello('MarkPad');
\`\`\`

## 表格

| 功能 | 快捷键 |
| --- | --- |
| 新建 | ⌘N |
| 打开 | ⌘O |
| 保存 | ⌘S |
| 切换大纲 | ⌘\\\\ |
| 切换源码 | ⌘E |
| 切换主题 | ⌘/ |

## 数学公式

行内公式 $E = mc^2$，块级公式：

$$\\int_{-\\infty}^{\\infty} e^{-x^2} dx = \\sqrt{\\pi}$$

## 任务列表

- [x] 实时渲染
- [x] 大纲导航
- [x] 源码视图
- [x] 暗色主题
- [ ] 你的下一篇文档

> 提示：⌘S 保存，⌘\\\\ 打开大纲，⌘E 打开源码，⌘/ 切换暗色模式。

---

开始你的创作吧 ✍️
`;

function loadContent(value) {
  // 实例已就绪时，直接 setValue（Vditor 会正确重渲染 DOM）；
  // 避免 destroy + new 的异步竞态导致内容拿得到却渲染不出来。
  if (vditor && vditorReady) {
    syncingFromSource = true;
    vditor.setValue(value || '');
    syncingFromSource = false;
    markDirty(false);
    updateStats();
    refreshOutline();
    syncSourceFromVditor(true);
    return;
  }
  // 实例尚未就绪：记下待加载内容，等 after 回调里再 setValue
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
    mode: 'ir', // 即时渲染 = Typora 体验
    value: value || '',
    theme: darkMode ? 'dark' : 'classic',
    cache: { enable: false },
    toolbar: [], // 隐藏工具栏，纯净写作
    counter: { enable: false },
    preview: {
      theme: { current: darkMode ? 'dark' : 'light' },
      hljs: { style: darkMode ? 'native' : 'github', lineNumber: false },
      math: { engine: 'KaTeX' }
    },
    outline: { enable: true, position: 'left' },
    placeholder: '开始输入…',
    input: () => {
      // 用户在中间渲染区编辑：标脏 + 刷新大纲 + 同步到右侧源码
      if (!syncingFromSource) {
        markDirty(true);
        updateStats();
        refreshOutline();
        syncSourceFromVditor();
      }
    },
    after: () => {
      vditorReady = true;
      // 若有挂起的待加载内容（实例初始化期间收到的打开请求），此时写入
      if (pendingValue !== null) {
        syncingFromSource = true;
        vditor.setValue(pendingValue);
        syncingFromSource = false;
        pendingValue = null;
        markDirty(false);
      }
      updateStats();
      refreshOutline();
      applyEditorTheme();
      syncSourceFromVditor(true);
    }
  });
}

function markDirty(dirty) {
  isDirty = dirty;
  window.markpad.setDirty(dirty);
}

function updateStats() {
  if (!vditor) return;
  const text = vditor.getValue() || '';
  // 中文按字符，英文按单词粗略统计
  const cn = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const en = (text.match(/[a-zA-Z]+/g) || []).length;
  statusWords.textContent = `${cn + en} 字`;
}

// ========= 大纲：从内容解析标题 → 与 DOM 中真实 h 元素按顺序绑定 =========
let parsedHeadings = []; // [{level, text, slug}]

function slugify(text) {
  // 用文本+顺序生成稳定 id；GitHub 风格 slug 不一定够稳定，这里用顺序保险
  return 'mp-h-' + text.toLowerCase()
    .replace(/[#*`~_>]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^\w\u4e00-\u9fa5\-]/g, '')
    .slice(0, 60);
}

function refreshOutline() {
  if (!vditor) return;
  const value = vditor.getValue() || '';
  const lines = value.split('\n');
  const headings = [];
  let inCode = false;
  lines.forEach((line) => {
    if (line.trim().startsWith('```')) { inCode = !inCode; return; }
    if (inCode) return;
    const m = line.match(/^(#{1,6})\s+(.+)/);
    if (m) {
      const text = m[2].replace(/[#*`]/g, '').trim();
      headings.push({ level: m[1].length, text, slug: slugify(text) });
    }
  });
  parsedHeadings = headings;

  // 给编辑器里真实 h 元素挂 id，方便 scrollIntoView
  tagHeadingsInDom();

  const container = document.getElementById('outline-content');
  if (!headings.length) {
    container.innerHTML = '<div style="padding:8px 16px;font-size:12px;color:var(--status-text)">暂无标题</div>';
    return;
  }
  container.innerHTML = headings.map((h, i) =>
    `<div class="vditor-outline__item" style="padding-left:${16 + (h.level - 1) * 12}px" data-idx="${i}">${escapeHtml(h.text)}</div>`
  ).join('');
  // 点击跳转：按"第 i 个标题"对应到 DOM 里的第 i 个 h
  container.querySelectorAll('.vditor-outline__item').forEach((el, i) => {
    el.onclick = () => scrollToHeadingByIndex(i);
  });
}

function getEditorRoot() {
  // Vditor IR 模式的实际滚动容器是 .vditor-ir > .vditor-ir__content（外层），内容渲染区是 .vditor-reset
  return document.querySelector('.vditor-ir .vditor-reset')
      || document.querySelector('.vditor-reset')
      || document.querySelector('.vditor-ir__content');
}

function getEditorHeadings() {
  const root = getEditorRoot();
  if (!root) return [];
  // Vditor IR 模式下，标题的 wrapper 通常是 .vditor-ir__node 包着原生 h1~h6
  return Array.from(root.querySelectorAll('h1, h2, h3, h4, h5, h6'));
}

function tagHeadingsInDom() {
  const hs = getEditorHeadings();
  hs.forEach((h, i) => {
    if (parsedHeadings[i]) {
      h.dataset.mpIdx = String(i);
      h.id = parsedHeadings[i].slug;
    }
  });
}

function scrollToHeadingByIndex(idx) {
  // 先 tag 一遍，避免内容刚变 DOM 还没贴 id
  tagHeadingsInDom();
  const hs = getEditorHeadings();
  const target = hs[idx];
  if (!target) return;
  // 编辑器实际滚动容器：Vditor IR 模式下是 .vditor-ir__content
  const scroller = target.closest('.vditor-ir__content')
    || target.closest('.vditor-reset')
    || getEditorRoot();
  if (scroller && scroller.scrollTo) {
    // 用 offset 计算更可靠：scrollIntoView 在虚拟父级里有时不准
    const top = target.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 12;
    scroller.scrollTo({ top, behavior: 'smooth' });
  } else {
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  // 高亮当前项
  document.querySelectorAll('#outline-content .vditor-outline__item').forEach((el, i) => {
    el.classList.toggle('active', i === idx);
  });
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ========= 源码面板 ↔ 渲染编辑器 双向同步 =========
function syncSourceFromVditor(immediate) {
  if (!vditor || !vditorReady) return;
  if (syncingFromSource) return;
  if (sourceEditor.matches(':focus')) return; // 用户正在编辑源码，不要被覆盖
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
  // 记录光标在源码里的相对位置（行号）以便不被打断
  vditor.setValue(val);
  syncingFromSource = false;
  markDirty(true);
  updateStats();
  refreshOutline();
}

// 源码侧输入：节流同步到 vditor，避免每个按键都重渲染
sourceEditor.addEventListener('input', () => {
  if (syncingFromVditor) return;
  // 标脏立即生效
  markDirty(true);
  clearTimeout(sourceSyncTimer);
  sourceSyncTimer = setTimeout(() => {
    syncVditorFromSource();
  }, 220);
});

// 失焦时立即同步一次（避免长时间 pending）
sourceEditor.addEventListener('blur', () => {
  clearTimeout(sourceSyncTimer);
  syncVditorFromSource();
});

function applyEditorTheme() {
  document.body.classList.toggle('dark', darkMode);
  // 同步右上角主题按钮的图标与提示
  document.body.setAttribute('data-theme-mode', themeMode);
  if (typeof updateThemeBtnTitle === 'function') updateThemeBtnTitle();
}

// 应用主题模式：重新计算暗色、刷新编辑器与原生外观，并持久化
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
  // 同步原生主题（影响窗口标题栏/滚动条等）
  window.markpad.setNativeTheme(themeMode);
  if (persist) localStorage.setItem('markpad-theme', themeMode);
}

function setTheme(mode) {
  if (!['light', 'dark', 'system'].includes(mode)) return;
  themeMode = mode;
  applyThemeMode();
}

function toggleOutline() {
  outlineVisible = !outlineVisible;
  outlineEl.classList.toggle('hidden', !outlineVisible);
  if (outlineVisible) refreshOutline();
}

function toggleSource() {
  sourceVisible = !sourceVisible;
  sourceEl.classList.toggle('hidden', !sourceVisible);
  const btn = document.getElementById('source-toggle');
  if (btn) btn.classList.toggle('active', sourceVisible);
  if (sourceVisible) syncSourceFromVditor(true);
}

// ⌘/ 快捷键：在 亮 → 暗 → 跟随系统 之间循环
function toggleTheme() {
  const order = ['light', 'dark', 'system'];
  const next = order[(order.indexOf(themeMode) + 1) % order.length];
  setTheme(next);
}

// 跟随系统模式下，监听系统亮/暗变化实时切换
systemDark.addEventListener('change', () => {
  if (themeMode === 'system') applyThemeMode(false);
});

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

// 关闭窗口前主进程问询：当前是否脏 + 同步保存
window.markpad.onConfirmClose(async () => {
  if (!isDirty) {
    window.markpad.confirmCloseReply({ action: 'discard' });
    return;
  }
  // 由主进程弹原生对话框，渲染进程只负责按命令保存
  const action = await window.markpad.askCloseConfirm();
  if (action === 'cancel') {
    window.markpad.confirmCloseReply({ action: 'cancel' });
    return;
  }
  if (action === 'discard') {
    window.markpad.confirmCloseReply({ action: 'discard' });
    return;
  }
  // save
  const content = vditor ? vditor.getValue() : '';
  const res = await window.markpad.saveContent(content, false);
  if (res.saved) {
    markDirty(false);
    if (res.path) statusFile.textContent = res.path.split('/').pop();
    window.markpad.confirmCloseReply({ action: 'discard' });
  } else {
    // 用户在保存对话框里取消了 → 把"关闭"也取消，避免误丢
    window.markpad.confirmCloseReply({ action: 'cancel' });
  }
});

// 右上角主题切换按钮：点击循环 亮 → 暗 → 跟随系统
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
// 阻止默认行为（否则 Electron 会用文件替换整个页面），改为读取路径交给主进程打开。
// 用 capture 阶段在窗口最外层抢先处理，避免被 Vditor 等内部组件的 drop 监听吞掉。
function isFileDrag(e) {
  const types = e.dataTransfer && e.dataTransfer.types;
  if (!types) return false;
  // DataTransferItemList 既可能是数组也可能是 DOMStringList，统一遍历
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
  // 只有真正离开窗口才清除高亮
  if (e.target === document.documentElement || !e.relatedTarget) {
    document.body.classList.remove('drag-over');
  }
}, true);

window.addEventListener('drop', (e) => {
  if (!isFileDrag(e)) return;
  e.preventDefault();
  e.stopPropagation();
  document.body.classList.remove('drag-over');
  const files = Array.from(e.dataTransfer.files || []);
  // 优先 markdown/文本文件
  const f = files.find((x) => /\.(md|markdown|mdown|mkd|mdtext|txt)$/i.test(x.name)) || files[0];
  if (!f) return;
  // Electron 32+ 已移除 File.path，统一走 preload 里的 webUtils 解析
  const p = window.markpad.openDroppedFileFromFile(f);
  if (!p && f.path) window.markpad.openDroppedFile(f.path);
}, true);

// 兜底：拖拽过程中如果离开窗口（dragend）也清掉高亮
window.addEventListener('dragend', () => {
  document.body.classList.remove('drag-over');
}, true);

// ============ 启动 ============
darkMode = computeDark();          // 先根据持久化的主题模式确定亮/暗
initVditor(WELCOME);               // 用正确主题初始化编辑器
applyThemeMode(false);             // 同步 body class 与原生主题（不重复持久化）
markDirty(false);
window.markpad.rendererReady();    // 通知主进程：可以投递待打开文件了
