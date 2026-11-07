// Linux 桌面测试的公共部分。在测试机上跑，不依赖 ws 包。
const { execSync, spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');

const APP = process.env.MARKMATE_APP || path.resolve(__dirname, '../..');
const ELECTRON = process.env.MARKMATE_ELECTRON || path.join(APP, 'node_modules/electron/dist/electron');
const PORT = Number(process.env.MARKMATE_CDP_PORT || 9224);
const DISPLAY = process.env.DISPLAY || ':0';
const XAUTHORITY = process.env.XAUTHORITY || path.join(process.env.HOME || '/home/ubuntu', '.Xauthority');
const FIXTURE = '/tmp/markmate-linux-test';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function record(status, name, detail) {
  const line = status + ' ' + name + (detail ? ' — ' + detail : '');
  results.push({ status, name, detail: detail || '', line });
  console.log(line);
  try { fs.appendFileSync(path.join(FIXTURE, 'results.txt'), line + '\n'); } catch (_) {}
}
const pass = (name, detail) => record('PASS', name, detail);
const fail = (name, detail) => record('FAIL', name, detail);
const skip = (name, detail) => record('SKIP', name, detail);

function sh(cmd, timeout) {
  const wrapped = 'export DISPLAY=' + JSON.stringify(DISPLAY) +
    ' XAUTHORITY=' + JSON.stringify(XAUTHORITY) +
    ' GTK_IM_MODULE="${GTK_IM_MODULE:-ibus}" XMODIFIERS="${XMODIFIERS:-@im=ibus}"; ' + cmd;
  return execSync(wrapped, { encoding: 'utf8', timeout: timeout || 20000 });
}

function killApp() {
  let txt = '';
  try { txt = execSync('ps -ww -eo pid,cmd', { encoding: 'utf8' }); } catch (e) { txt = e.stdout || ''; }
  for (const line of txt.split('\n')) {
    if (!line.includes('electron/dist/electron') && !line.includes('markmate.bin')) continue;
    if (line.includes('--type=')) continue;
    const pid = parseInt(line, 10);
    if (pid && pid !== process.pid) {
      try { process.kill(pid, 'SIGKILL'); } catch (_) {}
    }
  }
  try { execSync('pkill -f drag-src.py || true'); } catch (_) {}
}

function pages() {
  return new Promise((resolve, reject) => {
    const req = http.get('http://127.0.0.1:' + PORT + '/json', (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.setTimeout(2000, () => { req.destroy(); reject(new Error('调试端口没开')); });
  });
}

function encodeFrame(payload, opcode) {
  const mask = crypto.randomBytes(4);
  let header;
  if (payload.length < 126) {
    header = Buffer.from([opcode, 0x80 | payload.length]);
  } else if (payload.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = opcode;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = opcode;
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  const masked = Buffer.alloc(payload.length);
  for (let i = 0; i < payload.length; i++) masked[i] = payload[i] ^ mask[i % 4];
  return Buffer.concat([header, mask, masked]);
}

function connectSocket(wsUrl) {
  const u = new URL(wsUrl);
  return new Promise((resolve, reject) => {
    const socket = net.connect(Number(u.port || 80), u.hostname);
    const key = crypto.randomBytes(16).toString('base64');
    let buf = Buffer.alloc(0);
    let ready = false;
    let seq = 0;
    const pending = new Map();
    const fragments = [];
    const failConn = (err) => { if (!ready) reject(err); socket.destroy(); };

    function sendRaw(payload, opcode) {
      socket.write(encodeFrame(payload, opcode));
    }
    function takeFrames() {
      while (buf.length >= 2) {
        const b0 = buf[0];
        const b1 = buf[1];
        let len = b1 & 0x7f;
        let off = 2;
        if (len === 126) {
          if (buf.length < 4) return;
          len = buf.readUInt16BE(2);
          off = 4;
        } else if (len === 127) {
          if (buf.length < 10) return;
          const big = buf.readBigUInt64BE(2);
          if (big > BigInt(32 * 1024 * 1024)) { failConn(new Error('调试消息过大')); return; }
          len = Number(big);
          off = 10;
        }
        if (buf.length < off + len) return;
        const payload = buf.slice(off, off + len);
        buf = buf.slice(off + len);
        const opcode = b0 & 0x0f;
        if (opcode === 8) { socket.end(); return; }
        if (opcode === 9) { sendRaw(payload, 0x8a); continue; }
        if (opcode === 0 || opcode === 1) {
          fragments.push(payload);
          if (b0 & 0x80) {
            const text = Buffer.concat(fragments).toString('utf8');
            fragments.length = 0;
            let msg;
            try { msg = JSON.parse(text); } catch (_) { continue; }
            if (msg.id && pending.has(msg.id)) {
              const item = pending.get(msg.id);
              pending.delete(msg.id);
              clearTimeout(item.timer);
              if (msg.error) item.reject(new Error(JSON.stringify(msg.error)));
              else item.resolve(msg.result);
            }
          }
        }
      }
    }

    socket.on('error', failConn);
    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (!ready) {
        const idx = buf.indexOf('\r\n\r\n');
        if (idx < 0) return;
        const head = buf.slice(0, idx).toString('utf8');
        buf = buf.slice(idx + 4);
        if (!/^HTTP\/1\.\d 101/.test(head)) {
          failConn(new Error('调试通道握手失败'));
          return;
        }
        ready = true;
        resolve(api);
      }
      takeFrames();
    });

    function send(method, params, timeoutMs) {
      return new Promise((resolveSend, rejectSend) => {
        const id = ++seq;
        const timer = setTimeout(() => {
          pending.delete(id);
          rejectSend(new Error(method + ' 超时'));
        }, timeoutMs || 20000);
        pending.set(id, { resolve: resolveSend, reject: rejectSend, timer });
        sendRaw(Buffer.from(JSON.stringify({ id, method, params: params || {} })), 0x81);
      });
    }
    const api = {
      send,
      close() { try { socket.destroy(); } catch (_) {} },
    };
    const target = u.pathname + u.search;
    socket.write(
      'GET ' + target + ' HTTP/1.1\r\n' +
      'Host: ' + u.host + '\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      'Sec-WebSocket-Key: ' + key + '\r\n' +
      'Sec-WebSocket-Version: 13\r\n\r\n'
    );
  });
}

let cdp = null;
async function connect() {
  if (cdp) { try { cdp.close(); } catch (_) {} cdp = null; }
  let list;
  for (let i = 0; i < 50; i++) {
    try {
      list = await pages();
      if (list && list.find((p) => p.type === 'page')) break;
    } catch (_) {}
    await sleep(250);
  }
  const page = list && list.find((p) => p.type === 'page');
  if (!page) throw new Error('程序没有把调试端口打开');
  cdp = await connectSocket(page.webSocketDebuggerUrl);
}

function electronEnv() {
  const env = Object.assign({}, process.env, {
    DISPLAY, XAUTHORITY,
    GTK_IM_MODULE: process.env.GTK_IM_MODULE || 'ibus',
    QT_IM_MODULE: process.env.QT_IM_MODULE || 'ibus',
    XMODIFIERS: process.env.XMODIFIERS || '@im=ibus',
  });
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

async function boot(file) {
  if (!fs.existsSync(ELECTRON)) {
    throw new Error('找不到 Electron：' + ELECTRON + '。先在测试机的源码目录执行 npm install');
  }
  killApp();
  await sleep(400);
  try { sh('xdotool keyup ctrl alt shift super'); } catch (_) {}
  const args = ['--no-sandbox', '--disable-gpu', '--remote-debugging-port=' + PORT, APP];
  if (file) args.push(file);
  const child = spawn(ELECTRON, args, { env: electronEnv(), detached: true, stdio: 'ignore' });
  child.unref();
  await connect();
  await sleep(900);
}

async function ev(expression, timeoutMs, awaitPromise) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: awaitPromise !== false,
  }, timeoutMs);
  if (result.exceptionDetails) {
    const text = result.exceptionDetails.text || result.exceptionDetails.exception && result.exceptionDetails.exception.description;
    throw new Error(text || '页面执行失败');
  }
  return result.result && result.result.value;
}

function appId() {
  const ids = sh('xdotool search --name MarkMate').trim().split('\n').filter(Boolean);
  return ids[ids.length - 1];
}

async function waitName(part, tries) {
  for (let i = 0; i < (tries || 20); i++) {
    try {
      const id = sh('xdotool search --name ' + JSON.stringify(part) + ' | head -1').trim();
      if (id) return id;
    } catch (_) {}
    await sleep(200);
  }
  return '';
}

async function waitText(needle, tries) {
  for (let i = 0; i < (tries || 20); i++) {
    const hit = await ev('(typeof getContentForSave==="function"?getContentForSave():"").includes(' + JSON.stringify(needle) + ')');
    if (hit) return true;
    await sleep(250);
  }
  return false;
}

async function pointerClick(x, y) {
  sh('xdotool windowactivate --sync ' + appId());
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  await sleep(200);
}

async function clickEditor() {
  const box = await ev('(()=>{ const code=document.getElementById("code-editor"); const shown=code && code.offsetParent!==null; const el=shown?code:document.querySelector(".vditor-wysiwyg"); if(!el) return null; const r=el.getBoundingClientRect(); return {x:Math.round(r.left+80), y:Math.round(r.top+70)}; })()');
  if (!box) return false;
  await pointerClick(box.x, box.y);
  return true;
}

async function typeInto(text) {
  if (!await clickEditor()) return false;
  sh('xdotool key ctrl+End; xdotool type --delay 20 ' + JSON.stringify(text));
  await sleep(300);
  let hit = await ev('(typeof getContentForSave==="function"?getContentForSave():"").includes(' + JSON.stringify(text) + ')');
  if (!hit) {
    await cdp.send('Input.insertText', { text });
    await sleep(250);
    hit = await ev('(typeof getContentForSave==="function"?getContentForSave():"").includes(' + JSON.stringify(text) + ')');
  }
  return !!hit;
}

async function key(combo) {
  sh('xdotool windowactivate --sync ' + appId() + '; xdotool key ' + combo);
}

async function fillSave(filePath) {
  const id = await waitName('Save File');
  if (!id) return false;
  sh('xdotool windowactivate --sync ' + id + '; sleep 0.15; xdotool key ctrl+l; sleep 0.1; xdotool key ctrl+a; xdotool type --delay 8 ' + JSON.stringify(filePath) + '; xdotool key Return');
  await sleep(800);
  return true;
}

async function dismissDialogs() {
  for (const name of ['保存失败', '文件已在外部修改', 'Error', '导出长图失败']) {
    try {
      const id = sh('xdotool search --name ' + JSON.stringify(name) + ' | head -1').trim();
      if (id) {
        sh('xdotool windowactivate --sync ' + id + '; xdotool key Escape; xdotool key Return');
        await sleep(200);
      }
    } catch (_) {}
  }
}

function pngSize(file) {
  const b = fs.readFileSync(file);
  if (b.slice(0, 8).toString('hex') !== '89504e470d0a1a0a') return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

function writePng(file) {
  fs.writeFileSync(file, Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  ));
}

function prepareFixtures() {
  fs.mkdirSync(FIXTURE, { recursive: true });
  fs.writeFileSync(path.join(FIXTURE, 'results.txt'), '');
  fs.writeFileSync(path.join(FIXTURE, 'open-me.md'), '# OPENME\n\n从测试脚本打开。\n');
  fs.writeFileSync(path.join(FIXTURE, 'second.md'), '# SECONDFILE\n\n第二个文件。\n');
  fs.writeFileSync(path.join(FIXTURE, 'ext.md'), '# EXT\n\n原始内容。\n');
  fs.writeFileSync(path.join(FIXTURE, 'auto.md'), '# AUTO\n\n');
  fs.writeFileSync(path.join(FIXTURE, 'hist.md'), '# HIST\n\n历史原文。\n');
  fs.writeFileSync(path.join(FIXTURE, 'ro.md'), '# RO\n\n只读原文。\n');
  fs.chmodSync(path.join(FIXTURE, 'ro.md'), 0o644);
  fs.writeFileSync(path.join(FIXTURE, 'wide.md'), '# 宽\n\n```\n' + ('宽'.repeat(800)) + '\n```\n');
  fs.writeFileSync(path.join(FIXTURE, 'sample.json'), '{"a":1,"b":[2,3]}\n');
  writePng(path.join(FIXTURE, 'dot.png'));
  fs.writeFileSync(path.join(FIXTURE, 'drop-me.md'), '# DROP\n');
  const nowrite = path.join(FIXTURE, 'nowrite');
  fs.mkdirSync(nowrite, { recursive: true });
  try { fs.chmodSync(nowrite, 0o755); } catch (_) {}
  fs.writeFileSync(path.join(nowrite, 'exists.md'), '# NW\n\n目录里的原文。\n');
  fs.chmodSync(nowrite, 0o555);
  try { sh('rm -rf "$HOME/.config/markmate/drafts"'); } catch (_) {}
}

function finish() {
  const failed = results.filter((r) => r.status === 'FAIL').length;
  const skipped = results.filter((r) => r.status === 'SKIP').length;
  console.log('LINUX_TEST_DONE fail=' + failed + ' skip=' + skipped + ' total=' + results.length);
  try { killApp(); } catch (_) {}
  try { fs.chmodSync(path.join(FIXTURE, 'ro.md'), 0o644); } catch (_) {}
  try { fs.chmodSync(path.join(FIXTURE, 'nowrite'), 0o755); } catch (_) {}
  return failed ? 1 : 0;
}

module.exports = {
  APP, ELECTRON, FIXTURE, sleep, sh, killApp, boot, ev, appId, waitName, waitText,
  typeInto, pointerClick, key, fillSave, dismissDialogs, pngSize, pass, fail, skip, results,
  prepareFixtures, finish, electronEnv, spawn,
};
