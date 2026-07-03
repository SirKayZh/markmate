/**
 * llm-dataset.js — LLM 数据集专业化解析
 * 支持三种业界通用微调/标注格式：
 *   - Alpaca   {instruction, input, output}
 *   - ShareGPT {conversations: [{from, value}]}
 *   - Messages {messages: [{role, content}]}  (OpenAI / vLLM 通用对话格式)
 * 零依赖，纯 JS
 */

const LLMDataset = (() => {

  // ── Token 估算（字符级启发式） ──
  function estimateTokens(text) {
    if (!text) return 0;
    const s = String(text);
    // 中文约 2 chars/token，英文约 4 chars/token
    const cn = (s.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
    const en = s.length - cn;
    return Math.max(1, Math.ceil(cn / 1.8 + en / 4));
  }

  // ── 格式检测 ──
  /** 采样前 sampleSize 行判断 JSONL 格式 */
  function detectFormat(sampleLines) {
    if (!sampleLines || sampleLines.length === 0) return 'generic';
    const lines = (Array.isArray(sampleLines) ? sampleLines : [sampleLines])
      .filter(l => l && l.trim());

    let alpacaVotes = 0, sharegptVotes = 0, messagesVotes = 0, parsed = 0;

    for (const line of lines.slice(0, 10)) {
      try {
        const obj = JSON.parse(line.trim());
        if (!obj || typeof obj !== 'object') continue;
        parsed++;
        // Alpaca: 必须有 instruction 字段
        if ('instruction' in obj && typeof obj.instruction === 'string') {
          alpacaVotes++;
        }
        // ShareGPT: 必须有 conversations 数组，每项含 from/value
        if (Array.isArray(obj.conversations) && obj.conversations.length > 0) {
          const hasFromValue = obj.conversations.every(
            m => m && typeof m.from === 'string' && 'value' in m
          );
          if (hasFromValue) sharegptVotes++;
        }
        // Messages (OpenAI): 必须有 messages 数组，每项含 role/content
        if (Array.isArray(obj.messages) && obj.messages.length > 0) {
          const hasRoleContent = obj.messages.every(
            m => m && typeof m.role === 'string' && 'content' in m
          );
          if (hasRoleContent) messagesVotes++;
        }
      } catch (_) { /* 跳过无效行 */ }
    }

    if (parsed === 0) return 'generic';
    if (messagesVotes >= parsed * 0.5) return 'messages';
    if (sharegptVotes >= parsed * 0.5) return 'sharegpt';
    if (alpacaVotes >= parsed * 0.5) return 'alpaca';
    return 'generic';
  }

  // ── content 归一化 ──
  // OpenAI messages 的 content 可能是字符串，也可能是多模态数组 [{type,text},{type:'image_url',...}]
  function contentToText(content) {
    if (content == null) return '';
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content.map(part => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object') {
          if (typeof part.text === 'string') return part.text;
          if (part.type === 'image_url') return '[图片]';
          if (part.type === 'image') return '[图片]';
        }
        return '';
      }).filter(Boolean).join('\n');
    }
    if (typeof content === 'object') return JSON.stringify(content);
    return String(content);
  }

  // ── 单条目 Token 估算 ──
  function estimateEntryTokens(entry, format) {
    if (format === 'alpaca') {
      return estimateTokens(entry.instruction || '')
        + estimateTokens(entry.input || '')
        + estimateTokens(entry.output || '');
    }
    if (format === 'sharegpt') {
      let total = 0;
      for (const msg of (entry.conversations || [])) {
        total += estimateTokens(msg.value || '');
      }
      return total;
    }
    if (format === 'messages') {
      let total = 0;
      for (const msg of (entry.messages || [])) {
        total += estimateTokens(contentToText(msg.content));
      }
      return total;
    }
    return estimateTokens(JSON.stringify(entry));
  }

  // ── 统计 ──
  function computeStats(entries, format) {
    const stats = {
      totalEntries: entries.length,
      estimatedTokens: 0,
      fieldDist: {},       // 字段覆盖率
      format,
    };

    if (format === 'alpaca') {
      stats.avgInstructionLen = 0;
      stats.inputPresenceRate = 0;
      stats.avgOutputLen = 0;
      stats.maxInstructionLen = 0;
      stats.maxOutputLen = 0;
      let inputCount = 0;
      for (const e of entries) {
        stats.estimatedTokens += estimateEntryTokens(e, format);
        stats.avgInstructionLen += (e.instruction || '').length;
        stats.avgOutputLen += (e.output || '').length;
        if (e.input && e.input.trim()) inputCount++;
        stats.maxInstructionLen = Math.max(stats.maxInstructionLen, (e.instruction || '').length);
        stats.maxOutputLen = Math.max(stats.maxOutputLen, (e.output || '').length);
        for (const k of Object.keys(e)) {
          stats.fieldDist[k] = (stats.fieldDist[k] || 0) + 1;
        }
      }
      if (entries.length > 0) {
        stats.avgInstructionLen = Math.round(stats.avgInstructionLen / entries.length);
        stats.avgOutputLen = Math.round(stats.avgOutputLen / entries.length);
        stats.inputPresenceRate = Math.round((inputCount / entries.length) * 100);
      }
    } else if (format === 'sharegpt') {
      stats.avgTurns = 0;
      stats.roleDist = {};
      stats.maxTurns = 0;
      stats.minTurns = Infinity;
      for (const e of entries) {
        stats.estimatedTokens += estimateEntryTokens(e, format);
        const convs = e.conversations || [];
        const turns = convs.length;
        stats.avgTurns += turns;
        stats.maxTurns = Math.max(stats.maxTurns, turns);
        stats.minTurns = Math.min(stats.minTurns, turns);
        for (const msg of convs) {
          const role = msg.from || 'unknown';
          stats.roleDist[role] = (stats.roleDist[role] || 0) + 1;
        }
        for (const k of Object.keys(e)) {
          stats.fieldDist[k] = (stats.fieldDist[k] || 0) + 1;
        }
      }
      if (entries.length > 0) {
        stats.avgTurns = (stats.avgTurns / entries.length).toFixed(1);
      }
      if (stats.minTurns === Infinity) stats.minTurns = 0;
    } else if (format === 'messages') {
      // 区分两个语义不同的指标：
      //   avgMsgs   = 平均消息条数（含 system/user/assistant/tool）
      //   avgTurns  = 平均对话轮次（一次 user 提问算 1 轮；单轮问答 = 1）
      stats.roleDist = {};
      stats.avgMsgs = 0;
      stats.maxMsgs = 0;
      stats.minMsgs = Infinity;
      stats.avgTurns = 0;
      stats.maxTurns = 0;
      stats.minTurns = Infinity;
      stats.systemRate = 0;
      let sysCount = 0;
      for (const e of entries) {
        stats.estimatedTokens += estimateEntryTokens(e, format);
        const msgs = e.messages || [];
        const msgCount = msgs.length;
        const turns = msgs.filter(m => m && m.role === 'user').length;  // 真实轮次
        stats.avgMsgs += msgCount;
        stats.maxMsgs = Math.max(stats.maxMsgs, msgCount);
        stats.minMsgs = Math.min(stats.minMsgs, msgCount);
        stats.avgTurns += turns;
        stats.maxTurns = Math.max(stats.maxTurns, turns);
        stats.minTurns = Math.min(stats.minTurns, turns);
        if (msgs.some(m => m && m.role === 'system')) sysCount++;
        for (const msg of msgs) {
          const role = (msg && msg.role) || 'unknown';
          stats.roleDist[role] = (stats.roleDist[role] || 0) + 1;
        }
        for (const k of Object.keys(e)) {
          stats.fieldDist[k] = (stats.fieldDist[k] || 0) + 1;
        }
      }
      if (entries.length > 0) {
        stats.avgMsgs = (stats.avgMsgs / entries.length).toFixed(1);
        stats.avgTurns = (stats.avgTurns / entries.length).toFixed(1);
        stats.systemRate = Math.round((sysCount / entries.length) * 100);
      }
      if (stats.minMsgs === Infinity) stats.minMsgs = 0;
      if (stats.minTurns === Infinity) stats.minTurns = 0;
    } else {
      // generic
      for (const e of entries) {
        stats.estimatedTokens += estimateTokens(JSON.stringify(e));
        for (const k of Object.keys(e)) {
          stats.fieldDist[k] = (stats.fieldDist[k] || 0) + 1;
        }
      }
    }

    return stats;
  }

  // ── 对话视图渲染 ──
  function renderChatView(container, entries, format, opts = {}) {
    container.innerHTML = '';
    if (!entries || entries.length === 0) {
      container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted)">无数据</div>';
      return;
    }

    const start = opts.start || 0;
    const end = opts.end || entries.length;
    const editable = !!opts.editable;
    const onEdit = typeof opts.onEdit === 'function' ? opts.onEdit : null;
    const editedSet = opts.editedSet || null;
    const cachedIndexOf = typeof opts.cachedIndexOf === 'function' ? opts.cachedIndexOf : (i => i);

    for (let i = start; i < end && i < entries.length; i++) {
      const entry = entries[i];
      const cachedIdx = cachedIndexOf(i);
      const entryCard = document.createElement('div');
      entryCard.className = 'json-chat-entry';
      if (editedSet && editedSet.has(cachedIdx)) entryCard.classList.add('edited');

      // 头部（可点击折叠）
      const header = document.createElement('div');
      header.className = 'json-chat-entry-header';

      const headerLeft = document.createElement('span');
      headerLeft.className = 'json-chat-entry-headleft';
      const caret = document.createElement('span');
      caret.className = 'json-chat-caret';
      caret.textContent = '▼';
      headerLeft.appendChild(caret);
      const numSpan = document.createElement('span');
      numSpan.className = 'json-chat-entry-number';
      numSpan.textContent = `#${i + 1}`;
      headerLeft.appendChild(numSpan);
      const editedBadge = document.createElement('span');
      editedBadge.className = 'json-chat-edited-badge';
      editedBadge.textContent = '已改';
      headerLeft.appendChild(editedBadge);
      header.appendChild(headerLeft);

      const tokSpan = document.createElement('span');
      tokSpan.className = 'json-chat-entry-tokens';
      tokSpan.textContent = `~${estimateEntryTokens(entry, format)} tokens`;
      header.appendChild(tokSpan);
      entryCard.appendChild(header);

      // 消息容器（折叠目标）
      const body = document.createElement('div');
      body.className = 'json-chat-entry-body';

      // 编辑回调：标记该卡片为已改，并上抛给宿主
      const markEdited = (fieldPath, newText) => {
        entryCard.classList.add('edited');
        if (onEdit) onEdit(i, fieldPath, newText);
      };

      if (format === 'alpaca') {
        if (entry.instruction !== undefined && entry.instruction !== null) {
          body.appendChild(buildChatMsg('指令', entry.instruction, 'instruction',
            { editable, onEdit: markEdited, fieldPath: ['instruction'] }));
        }
        // 输入：编辑态下只要原文有该字段就渲染（允许补充空 input）；只读态仅在非空时显示
        if ((editable && 'input' in entry) || (entry.input && String(entry.input).trim())) {
          body.appendChild(buildChatMsg('输入', entry.input || '', 'input',
            { editable, onEdit: markEdited, fieldPath: ['input'] }));
        }
        if (entry.output !== undefined && entry.output !== null) {
          body.appendChild(buildChatMsg('输出', entry.output, 'output',
            { editable, onEdit: markEdited, fieldPath: ['output'] }));
        }
      } else if (format === 'sharegpt') {
        const convs = entry.conversations || [];
        for (let k = 0; k < convs.length; k++) {
          const msg = convs[k] || {};
          const roleLabel = msg.from || 'unknown';
          body.appendChild(buildChatMsg(roleLabel, msg.value || '', msg.from || 'unknown',
            { editable, onEdit: markEdited, fieldPath: ['conversations', k, 'value'] }));
        }
      } else if (format === 'messages') {
        const msgs = entry.messages || [];
        for (let k = 0; k < msgs.length; k++) {
          const msg = msgs[k] || {};
          const role = msg.role || 'unknown';
          // content 为字符串时可直接编辑；多模态数组只读展示文本
          const isStringContent = typeof msg.content === 'string';
          const text = contentToText(msg.content);
          body.appendChild(buildChatMsg(role, text, role,
            isStringContent
              ? { editable, onEdit: markEdited, fieldPath: ['messages', k, 'content'] }
              : { editable: false }));
        }
      }
      entryCard.appendChild(body);

      // 点击头部折叠/展开（编辑态下点击文本不触发折叠）
      header.addEventListener('click', () => {
        const collapsed = entryCard.classList.toggle('collapsed');
        caret.textContent = collapsed ? '▶' : '▼';
      });

      container.appendChild(entryCard);
    }
  }

  function buildChatMsg(roleLabel, text, roleClass, editInfo) {
    editInfo = editInfo || {};
    const msgDiv = document.createElement('div');
    msgDiv.className = 'json-chat-msg';

    const roleEl = document.createElement('div');
    roleEl.className = 'json-chat-role role-' + roleClass;
    roleEl.textContent = roleLabel;
    msgDiv.appendChild(roleEl);

    const textEl = document.createElement('div');
    textEl.className = 'json-chat-text';
    textEl.textContent = text;

    if (editInfo.editable) {
      textEl.classList.add('editable');
      // plaintext-only：避免富文本粘贴产生 <div>/<br>，innerText 取值稳定
      try { textEl.contentEditable = 'plaintext-only'; }
      catch (_) { textEl.contentEditable = 'true'; }
      textEl.spellcheck = false;
      textEl.dataset.field = (editInfo.fieldPath || []).join('.');
      const fire = () => {
        if (editInfo.onEdit) editInfo.onEdit(editInfo.fieldPath, textEl.innerText);
      };
      textEl.addEventListener('input', fire);
      // 兜底：某些环境不支持 plaintext-only，粘贴时强制纯文本
      textEl.addEventListener('paste', (e) => {
        if (textEl.contentEditable === 'plaintext-only') return;
        e.preventDefault();
        const t = (e.clipboardData || window.clipboardData).getData('text');
        document.execCommand('insertText', false, t);
      });
    }
    msgDiv.appendChild(textEl);

    return msgDiv;
  }

  // ── 统计面板渲染 ──
  function renderStatsPanel(container, stats) {
    if (!stats) return;
    const grid = container.querySelector('.json-stats-grid');
    if (!grid) return;
    grid.innerHTML = '';

    const addStat = (label, value) => {
      const item = document.createElement('div');
      item.className = 'json-stat-item';
      const lbl = document.createElement('span');
      lbl.className = 'json-stat-label';
      lbl.textContent = label;
      item.appendChild(lbl);
      const val = document.createElement('span');
      val.className = 'json-stat-value';
      val.textContent = value;
      item.appendChild(val);
      grid.appendChild(item);
    };

    addStat('条目数', stats.totalEntries);
    addStat('Token 估算', stats.estimatedTokens.toLocaleString());
    if (stats.filtered) addStat('统计范围', '筛选结果');
    else if (stats.scopeAll) addStat('统计范围', '全文');

    if (stats.format === 'alpaca') {
      addStat('Instruction 均长', stats.avgInstructionLen + ' 字符');
      addStat('含 Input 比例', stats.inputPresenceRate + '%');
      addStat('Output 均长', stats.avgOutputLen + ' 字符');
      addStat('最长 Instruction', stats.maxInstructionLen + ' 字符');
      addStat('最长 Output', stats.maxOutputLen + ' 字符');
    } else if (stats.format === 'sharegpt') {
      addStat('平均轮次', stats.avgTurns);
      addStat('最多轮次', stats.maxTurns);
      addStat('最少轮次', stats.minTurns);
      if (stats.roleDist && Object.keys(stats.roleDist).length > 0) {
        const roles = Object.entries(stats.roleDist)
          .map(([k, v]) => `${k}: ${v}`).join(' | ');
        addStat('角色分布', roles);
      }
    } else if (stats.format === 'messages') {
      // 单轮 vs 多轮：avgTurns 用真实"user 提问数"算，单轮问答=1.0，不再误把 3 条消息当 3 轮
      const single = String(stats.avgTurns) === '1.0' && stats.maxTurns === 1;
      addStat('对话类型', single ? '单轮问答' : '多轮对话');
      addStat('平均轮次', stats.avgTurns + (single ? '（单轮）' : ''));
      if (!single) { addStat('最多轮次', stats.maxTurns); addStat('最少轮次', stats.minTurns); }
      addStat('平均消息数', stats.avgMsgs);
      if (typeof stats.systemRate === 'number') addStat('含 System 比例', stats.systemRate + '%');
      if (stats.roleDist && Object.keys(stats.roleDist).length > 0) {
        const roles = Object.entries(stats.roleDist)
          .map(([k, v]) => `${k}: ${v}`).join(' | ');
        addStat('角色分布', roles);
      }
    }

    if (stats.fieldDist && Object.keys(stats.fieldDist).length > 0) {
      const fields = Object.entries(stats.fieldDist)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([k, v]) => `${k} (${v})`).join(', ');
      addStat('主要字段', fields);
    }
  }

  return { detectFormat, estimateTokens, estimateEntryTokens, computeStats, renderChatView, renderStatsPanel, contentToText };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = LLMDataset;
}
