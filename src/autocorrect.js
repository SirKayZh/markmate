// ============ 全角符号自动纠正 ============
// 设计借鉴 Word 的 AutoCorrect（按语言外置规则文件）：规则是数据，不是代码。
//
// 核心安全约束：只转换「Markdown 语法字符的全角形态」。
// ，。！？；：「」【】（）—— 等是合法中文标点，绝不动。
// 转换分两档：
//   anywhere —— 中文正文中几乎不可能合法出现，任意位置都可安全转换
//   lineStart —— 正文中可能出现（如「1－2月」），只在行首语法位置转换
(function () {
  'use strict';

  // 规则表（想调整行为改这里，不动逻辑代码）
  const RULES = {
    anywhere: {
      '＊': '*',   // 全角星号 → 粗体/斜体标记
      '｀': '`',   // 全角反引号 → 行内代码/代码块
      '＃': '#',   // 全角井号 → 标题
      '＿': '_',   // 全角下划线 → 粗体/斜体标记
    },
    lineStart: {
      '－': '-',   // 全角连字符 → 列表（仅行首）
      '＞': '>',   // 全角大于号 → 引用（仅行首）
    },
  };
  const STORAGE_KEY = 'markmate-autocorrect';
  let enabled = localStorage.getItem(STORAGE_KEY) !== '0'; // 默认开启

  // IME 组合输入期间绝不能改 DOM/value（会打断输入法会话）。
  // Chrome 的事件顺序是 compositionend 先于最终的 input 事件，
  // 所以提交落地的那次 input 仍会被正常纠正。
  let composing = false;
  document.addEventListener('compositionstart', () => { composing = true; }, true);
  document.addEventListener('compositionend', () => { composing = false; }, true);

  const anywhereRe = new RegExp('[' + Object.keys(RULES.anywhere).join('') + ']', 'g');

  // 对一行文本应用全部规则（textarea 场景用，行首规则生效）
  function correctLine(line) {
    if (!line) return line;
    let out = line.replace(/^([ \t]*)([－＞]+)(?=[ \t]|$)/, (m, indent, syms) =>
      indent + syms.replace(/[－＞]/g, (c) => RULES.lineStart[c]));
    // 无匹配时 replace 原样返回，代价可忽略，不需要额外 test 短路
    out = out.replace(anywhereRe, (c) => RULES.anywhere[c]);
    return out;
  }

  // WYSIWYG 场景：只对光标所在的文本节点应用 anywhere 规则。
  // 不碰 DOM 结构（加粗/代码等内联标记是独立元素，改文本节点的 nodeValue 不会破坏它们），
  // 也不触发新的 input 事件（程序式改 nodeValue 不冒泡 input），无循环风险。
  // 修正后的语法字符会在用户下一次按键时被 vditor 重新解析成对应格式。
  function correctSelectionTextNode() {
    if (!enabled || composing) return false;
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return false;
    const node = sel.focusNode;
    if (!node || node.nodeType !== Node.TEXT_NODE) return false;
    const val = node.nodeValue;
    if (!val || !anywhereRe.test(val)) { anywhereRe.lastIndex = 0; return false; }
    anywhereRe.lastIndex = 0; // test 会推进 lastIndex，replace 前复位
    node.nodeValue = val.replace(anywhereRe, (c) => RULES.anywhere[c]);
    return true;
  }

  // textarea 场景（源码面板 / 代码文件编辑）：修正光标所在行，保持光标位置。
  // 只有确实发生替换时才写回 value（写回会打断原生撤销栈，只在用户真的输了全角符号时发生）。
  function correctTextareaLine(ta) {
    if (!enabled || composing || !ta) return false;
    const v = ta.value;
    if (!v) return false;
    const pos = ta.selectionStart;
    if (pos == null) return false;
    const lineStart = v.lastIndexOf('\n', pos - 1) + 1;
    let lineEnd = v.indexOf('\n', pos);
    if (lineEnd === -1) lineEnd = v.length;
    const line = v.slice(lineStart, lineEnd);
    const fixed = correctLine(line);
    if (fixed === line) return false;
    ta.value = v.slice(0, lineStart) + fixed + v.slice(lineEnd);
    // 光标相对行首的偏移加上前缀处发生的长度变化
    const delta = fixed.length - line.length;
    ta.selectionStart = ta.selectionEnd = Math.max(lineStart, Math.min(pos + delta, ta.value.length));
    return true;
  }

  function isEnabled() { return enabled; }
  function setEnabled(v) {
    enabled = !!v;
    try { localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0'); } catch (err) { /* 隐私模式等场景 */ }
    return enabled;
  }
  function toggle() { return setEnabled(!enabled); }

  window.AutoCorrect = { isEnabled, setEnabled, toggle, correctLine, correctSelectionTextNode, correctTextareaLine };
})();
