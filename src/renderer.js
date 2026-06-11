// MarkPad 渲染进程逻辑
let vditor = null;
let vditorReady = false;
let pendingValue = null;
let isDirty = false;
let outlineVisible = false;
let darkMode = false;

const statusFile = document.getElementById('status-file');
const statusWords = document.getElementById('status-words');
const statusCursor = document.getElementById('status-cursor');
const outlineEl = document.getElementById('outline');

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
| 切换主题 | ⌘/ |

## 数学公式

行内公式 $E = mc^2$，块级公式：

$$\\int_{-\\infty}^{\\infty} e^{-x^2} dx = \\sqrt{\\pi}$$

## 任务列表

- [x] 实时渲染
- [x] 大纲导航
- [x] 暗色主题
- [ ] 你的下一篇文档

> 提示：⌘S 保存，⌘\\\\ 打开大纲，⌘/ 切换暗色模式。

---

开始你的创作吧 ✍️
`;

function loadContent(value) {
  // 实例已就绪时，直接 setValue（Vditor 会正确重渲染 DOM）；
  // 避免 destroy + new 的异步竞态导致内容拿得到却渲染不出来。
  if (vditor && vditorReady) {
    vditor.setValue(value || '');
    markDirty(false);
    updateStats();
    refreshOutline();
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
      markDirty(true);
      updateStats();
      refreshOutline();
    },
    after: () => {
      vditorReady = true;
      // 若有挂起的待加载内容（实例初始化期间收到的打开请求），此时写入
      if (pendingValue !== null) {
        vditor.setValue(pendingValue);
        pendingValue = null;
        markDirty(false);
      }
      updateStats();
      refreshOutline();
      applyEditorTheme();
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

// 从 vditor 自带 outline 同步到我们自己的侧栏
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
    if (m) headings.push({ level: m[1].length, text: m[2].replace(/[#*`]/g, '').trim() });
  });
  const container = document.getElementById('outline-content');
  if (!headings.length) {
    container.innerHTML = '<div style="padding:8px 16px;font-size:12px;color:var(--status-text)">暂无标题</div>';
    return;
  }
  container.innerHTML = headings.map((h, i) =>
    `<div class="vditor-outline__item" style="padding-left:${16 + (h.level - 1) * 12}px" data-idx="${i}">${escapeHtml(h.text)}</div>`
  ).join('');
  // 点击跳转
  container.querySelectorAll('.vditor-outline__item').forEach((el, i) => {
    el.onclick = () => scrollToHeading(headings[i].text);
  });
}

function scrollToHeading(text) {
  const editor = document.querySelector('.vditor-ir__content') || document.querySelector('.vditor-reset');
  if (!editor) return;
  const hs = editor.querySelectorAll('h1,h2,h3,h4,h5,h6');
  for (const h of hs) {
    if (h.textContent.trim().replace(/[#]/g, '').includes(text)) {
      h.scrollIntoView({ behavior: 'smooth', block: 'start' });
      break;
    }
  }
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function applyEditorTheme() {
  document.body.classList.toggle('dark', darkMode);
}

function toggleOutline() {
  outlineVisible = !outlineVisible;
  outlineEl.classList.toggle('hidden', !outlineVisible);
  if (outlineVisible) refreshOutline();
}

function toggleTheme() {
  darkMode = !darkMode;
  applyEditorTheme();
  if (vditor) {
    vditor.setTheme(
      darkMode ? 'dark' : 'classic',
      darkMode ? 'dark' : 'light',
      darkMode ? 'native' : 'github'
    );
  }
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
});

window.markpad.onRequestExportHtml(async () => {
  if (!vditor) return;
  const html = vditor.getHTML();
  await window.markpad.exportHtml(html);
});

window.markpad.onToggleOutline(() => toggleOutline());
window.markpad.onToggleTheme(() => toggleTheme());

// 启动：显示欢迎文档
initVditor(WELCOME);
markDirty(false);
