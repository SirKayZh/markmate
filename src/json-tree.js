/**
 * json-tree.js — 可折叠 JSON 树视图渲染器
 * 零依赖，纯 DOM 操作，支持类型标签、循环引用保护
 */

const JSONTree = (() => {
  // ── 类型判断 ──
  const TYPE = { STRING: 'string', NUMBER: 'number', BOOLEAN: 'boolean', NULL: 'null', ARRAY: 'array', OBJECT: 'object' };

  function getType(val) {
    if (val === null || val === undefined) return TYPE.NULL;
    if (Array.isArray(val)) return TYPE.ARRAY;
    if (typeof val === 'object') return TYPE.OBJECT;
    if (typeof val === 'string') return TYPE.STRING;
    if (typeof val === 'number') return TYPE.NUMBER;
    if (typeof val === 'boolean') return TYPE.BOOLEAN;
    return TYPE.STRING;
  }

  function typeLabel(type) {
    const labels = { string: 'string', number: 'number', boolean: 'boolean', null: 'null', array: 'array', object: 'object' };
    return labels[type] || type;
  }

  // 单个容器一次最多渲染的子节点数，超出用"加载更多"按钮分批（避免 5 万元素数组一次性建 DOM 冻结）
  const CHILD_BATCH = 100;

  // 默认展开深度：depth < expandDepth 的容器初始展开。render(opts.expandDepth) 可覆盖。
  // 普通大 JSON 用浅展开(2)防性能；JSONL 数据集用深展开让 messages→消息→content 默认可见。
  let expandDepth = 2;

  // 字符串预览截断长度：超过此值的字符串显示"…"+展开按钮。render(opts.stringPreviewLimit) 可覆盖。
  // 普通大 JSON 用 200；JSONL 树形视图用更低值让更多 content 出现展开按钮。
  let STRING_PREVIEW_LIMIT = 200;
  function formatValue(val, type) {
    if (type === TYPE.NULL) return 'null';
    if (type === TYPE.BOOLEAN) return String(val);
    if (type === TYPE.NUMBER) return String(val);
    if (type === TYPE.STRING) {
      const s = String(val);
      if (s.length > STRING_PREVIEW_LIMIT) return JSON.stringify(s.slice(0, STRING_PREVIEW_LIMIT) + '…');
      return JSON.stringify(s);
    }
    return '';
  }

  // ── 构建节点（懒加载：子节点仅在首次展开时构建，避免大数据一次性渲染冻结） ──
  function buildNode(key, val, depth, visited) {
    const type = getType(val);
    const wrapper = document.createElement('div');
    wrapper.className = 'json-node';
    wrapper.style.marginLeft = (depth * 18) + 'px';

    const line = document.createElement('div');
    line.className = 'json-line';
    // 长字符串展开时挂在 line 下方的全文容器（在叶节点分支里赋值）
    let pendingFullWrap = null;

    const isContainer = (type === TYPE.OBJECT || type === TYPE.ARRAY);
    // 默认展开深度由 expandDepth 控制（render 时设置）
    const startExpanded = depth < expandDepth;

    // 折叠三角（仅 object/array）
    if (isContainer) {
      const toggle = document.createElement('span');
      toggle.className = 'json-toggle ' + (startExpanded ? 'expanded' : '');
      toggle.innerHTML = startExpanded ? '▼' : '▶';
      line.appendChild(toggle);
    } else {
      const spacer = document.createElement('span');
      spacer.className = 'json-toggle-spacer';
      line.appendChild(spacer);
    }

    // key
    if (key !== null) {
      const keyEl = document.createElement('span');
      keyEl.className = 'json-key';
      keyEl.textContent = JSON.stringify(key);
      line.appendChild(keyEl);
      const colon = document.createElement('span');
      colon.className = 'json-colon';
      colon.textContent = ': ';
      line.appendChild(colon);
    }

    // 容器开头
    if (type === TYPE.OBJECT) {
      const bracket = document.createElement('span');
      bracket.className = 'json-bracket';
      bracket.textContent = '{ }   ' + Object.keys(val).length + ' 项';
      line.appendChild(bracket);
    } else if (type === TYPE.ARRAY) {
      const bracket = document.createElement('span');
      bracket.className = 'json-bracket';
      bracket.textContent = '[ ]   ' + val.length + ' 项';
      line.appendChild(bracket);
    } else {
      // 叶节点值
      const valEl = document.createElement('span');
      valEl.className = 'json-value json-type-' + type;
      const isLongString = (type === TYPE.STRING && String(val).length > STRING_PREVIEW_LIMIT);
      valEl.textContent = formatValue(val, type);
      line.appendChild(valEl);

      // 长字符串：附"展开/收起"按钮，点击在下方完整展开全文（可换行、可滚动）
      if (isLongString) {
        const full = String(val);
        const moreBtn = document.createElement('span');
        moreBtn.className = 'json-str-toggle';
        moreBtn.textContent = `展开（${full.length} 字）`;
        line.appendChild(moreBtn);

        pendingFullWrap = document.createElement('div');
        pendingFullWrap.className = 'json-str-full collapsed';
        pendingFullWrap.style.marginLeft = ((depth + 1) * 18) + 'px';
        pendingFullWrap.textContent = full;

        const fullWrap = pendingFullWrap;
        moreBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const collapsed = fullWrap.classList.toggle('collapsed');
          if (collapsed) {
            // 收起：恢复预览文本，并把该行滚回可见区域
            // （否则读完全文后滚动位置已跑远，收起来就一片空白）
            moreBtn.textContent = `展开（${full.length} 字）`;
            valEl.textContent = formatValue(val, type);
            line.scrollIntoView({ behavior: 'instant', block: 'nearest' });
          } else {
            moreBtn.textContent = '收起';
            valEl.textContent = '"…"';
          }
        });
      }
    }

    // 类型标签
    const tag = document.createElement('span');
    tag.className = 'json-type-tag json-tag-' + type;
    tag.textContent = typeLabel(type);
    line.appendChild(tag);

    wrapper.appendChild(line);
    // 长字符串全文容器挂在该行下方
    if (pendingFullWrap) wrapper.appendChild(pendingFullWrap);

    // 子节点容器（懒加载）
    if (isContainer) {
      const childrenWrap = document.createElement('div');
      childrenWrap.className = 'json-children';
      if (!startExpanded) childrenWrap.classList.add('collapsed');
      wrapper.appendChild(childrenWrap);

      let built = false;
      const buildChildren = () => {
        if (built) return;
        built = true;
        if (visited.has(val)) {
          const circular = document.createElement('div');
          circular.className = 'json-circular';
          circular.style.marginLeft = ((depth + 1) * 18) + 'px';
          circular.textContent = '[Circular Reference]';
          childrenWrap.appendChild(circular);
          return;
        }
        visited.add(val);
        const keys = type === TYPE.OBJECT ? Object.keys(val) : null;
        const total = type === TYPE.OBJECT ? keys.length : val.length;
        let rendered = 0;

        const getEntry = (i) => type === TYPE.OBJECT
          ? [keys[i], val[keys[i]]]
          : [i, val[i]];

        const renderBatch = () => {
          const frag = document.createDocumentFragment();
          const end = Math.min(rendered + CHILD_BATCH, total);
          for (let i = rendered; i < end; i++) {
            const [k, v] = getEntry(i);
            frag.appendChild(buildNode(k, v, depth + 1, visited));
          }
          rendered = end;
          // 移除旧的"加载更多"行（如有）
          const oldMore = childrenWrap.querySelector(':scope > .json-more');
          if (oldMore) oldMore.remove();
          childrenWrap.appendChild(frag);
          // 仍有剩余 → 追加"加载更多"行
          if (rendered < total) {
            const more = document.createElement('div');
            more.className = 'json-more';
            more.style.marginLeft = ((depth + 1) * 18) + 'px';
            more.textContent = `▾ 加载更多（已显示 ${rendered} / ${total}）`;
            more.addEventListener('click', (e) => { e.stopPropagation(); renderBatch(); });
            childrenWrap.appendChild(more);
          }
        };

        renderBatch();
        visited.delete(val);
      };

      // 初始展开的节点立即构建一层；折叠的留到首次点击再建
      if (startExpanded) buildChildren();

      const toggle = line.querySelector('.json-toggle');
      if (toggle) {
        toggle.addEventListener('click', (e) => {
          e.stopPropagation();
          const willCollapse = childrenWrap.classList.contains('collapsed') === false;
          if (!willCollapse) {
            // 即将展开 → 确保子节点已构建
            buildChildren();
          }
          const collapsed = childrenWrap.classList.toggle('collapsed');
          toggle.classList.toggle('expanded', !collapsed);
          toggle.innerHTML = collapsed ? '▶' : '▼';
        });
      }
    }

    return wrapper;
  }

  // ── 公开 API ──

  /** 在 container 中渲染 JSON 对象。
   *  opts.expandDepth      — 默认展开深度（默认 2）
   *  opts.stringPreviewLimit — 字符串预览截断长度，超长显示展开按钮（默认 200） */
  function render(container, jsonObj, opts = {}) {
    container.innerHTML = '';
    if (!container) return;
    expandDepth = (typeof opts.expandDepth === 'number') ? opts.expandDepth : 2;
    STRING_PREVIEW_LIMIT = (typeof opts.stringPreviewLimit === 'number') ? opts.stringPreviewLimit : 200;
    const visited = new Set();
    const root = buildNode(null, jsonObj, 0, visited);
    container.appendChild(root);
    // 初始全部展开如果 depth < 3
    if (opts.expandAll) expandAll(container);
  }

  /** 全部展开（仅展开已构建的节点；不强制构建未加载的大容器，避免冻结） */
  function expandAll(container) {
    container.querySelectorAll('.json-children.collapsed').forEach(c => {
      c.classList.remove('collapsed');
    });
    container.querySelectorAll('.json-toggle:not(.expanded)').forEach(t => {
      t.classList.add('expanded');
      t.innerHTML = '▼';
    });
  }

  /** 全部折叠（保留 root） */
  function collapseAll(container) {
    container.querySelectorAll('.json-children').forEach(c => {
      if (c.parentElement !== container.firstElementChild) {
        c.classList.add('collapsed');
      }
    });
    container.querySelectorAll('.json-toggle.expanded').forEach(t => {
      if (t.closest('.json-node') !== container.firstElementChild) {
        t.classList.remove('expanded');
        t.innerHTML = '▶';
      }
    });
  }

  /** 获取树中可见节点数 */
  function countVisibleNodes(container) {
    return container.querySelectorAll('.json-line').length;
  }

  /** 清空树 */
  function clear(container) {
    if (container) container.innerHTML = '';
  }

  /** 运行时更新字符串预览阈值（不重渲染）。
   *  用途：窗口 resize 时调，避免重建整棵树导致用户已展开的节点/滚动位置丢失。
   *  已渲染节点的视觉无影响——.json-value 的 CSS text-overflow:ellipsis 会把任何长度
   *  的预览截断到容器宽度；新展开的节点用新阈值。 */
  function setStringPreviewLimit(limit) {
    if (typeof limit === 'number' && limit > 0) STRING_PREVIEW_LIMIT = limit;
  }

  return { render, expandAll, collapseAll, countVisibleNodes, clear, setStringPreviewLimit };
})();

// 兼容模块加载
if (typeof module !== 'undefined' && module.exports) {
  module.exports = JSONTree;
}
