/**
 * json-worker.js — Web Worker 异步 JSON 解析
 * 大文件 JSON.parse 会阻塞主线程，用 Worker 避免 UI 冻结。
 * 用法：主线程 new Worker('json-worker.js')，postMessage({ raw, seq })，onmessage 收 { seq, ok, ... }。
 * 解析失败时附带 pos/line/col，供编辑器定位错误位置。
 */

function posToLineCol(raw, pos) {
  pos = Math.max(0, Math.min(pos, raw.length));
  let line = 1, lastNL = -1;
  for (let i = 0; i < pos; i++) if (raw.charCodeAt(i) === 10) { line++; lastNL = i; }
  return { pos, line, col: pos - lastNL };
}

// V8 的 JSON 报错信息有多种格式，逐一兜底推算出错位置（1-based 行/列）
function errorPosition(raw, message) {
  message = message || '';
  // 形式1：... in JSON at position N
  let m = /position (\d+)/.exec(message);
  if (m) return posToLineCol(raw, parseInt(m[1], 10));
  // 形式2：... (line N column M)
  m = /line (\d+) column (\d+)/.exec(message);
  if (m) return { pos: -1, line: parseInt(m[1], 10), col: parseInt(m[2], 10) };
  // 形式3：Unexpected token X, ..."<片段>"... is not valid JSON —— 无位置数字，用片段反查
  m = /"([\s\S]*?)"\s+is not valid JSON/.exec(message);
  if (m && m[1]) {
    const idx = raw.indexOf(m[1]);
    if (idx >= 0) return posToLineCol(raw, idx);
  }
  return { pos: -1, line: -1, col: -1 };
}

self.onmessage = function (e) {
  const { raw, seq } = e.data || {};
  try {
    const obj = JSON.parse(raw);
    self.postMessage({ seq, ok: true, data: obj });
  } catch (err) {
    const p = errorPosition(raw, err.message);
    self.postMessage({ seq, ok: false, error: err.message, pos: p.pos, line: p.line, col: p.col });
  }
};
