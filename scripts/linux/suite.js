#!/usr/bin/env node
// Linux 回归。用法见 scripts/linux/README.md。
// 新功能：在 GROUPS 里加一条，函数里只做这一件事，用 pass / fail / skip 收尾。
const fs = require('fs');
const path = require('path');
const {
  APP, ELECTRON, FIXTURE, sleep, sh, killApp, boot, ev, appId, waitName, waitText,
  typeInto, pointerClick, key, fillSave, dismissDialogs, pngSize, pass, fail, skip,
  prepareFixtures, finish, electronEnv, spawn,
} = require('./lib');

const f = (name) => path.join(FIXTURE, name);

async function openFile() {
  await boot(f('open-me.md'));
  if (await waitText('OPENME')) pass('打开文件', '正文里有 OPENME');
  else fail('打开文件', '正文里没有 OPENME');
}

async function secondFile() {
  await boot(f('open-me.md'));
  await waitText('OPENME');
  const child = spawn(ELECTRON, ['--no-sandbox', '--disable-gpu', APP, f('second.md')], {
    env: electronEnv(), detached: true, stdio: 'ignore',
  });
  child.unref();
  let tabs = '';
  for (let i = 0; i < 20; i++) {
    tabs = await ev('JSON.stringify([...document.querySelectorAll(".tab-name")].map(e=>e.textContent))') || '';
    if (tabs.includes('second.md')) break;
    await sleep(250);
  }
  const body = await ev('(typeof getContentForSave==="function"?getContentForSave():"")');
  if (tabs.includes('second.md') && String(body).includes('SECONDFILE')) pass('已开着再打开', tabs);
  else fail('已开着再打开', tabs || '没有新标签');
}

async function focusNotFind() {
  await boot(f('open-me.md'));
  await waitText('OPENME');
  await key('ctrl+shift+f');
  await sleep(400);
  const focus = await ev('document.body.classList.contains("focus-mode")');
  const findHidden = await ev('document.getElementById("find-bar")?.classList.contains("hidden")');
  await key('ctrl+shift+f');
  if (focus === true && findHidden === true) pass('专注模式', 'Ctrl+Shift+F 打开专注，没有打开搜索');
  else fail('专注模式', 'focus=' + focus + ' findHidden=' + findHidden);
}

async function autosaveSurvivesQuit() {
  await boot(f('auto.md'));
  await waitText('AUTO');
  const typed = await typeInto('AUTOKEEP');
  await sleep(2200);
  const status = await ev('document.getElementById("status-autosave")?.textContent || ""');
  killApp();
  await sleep(400);
  const disk = fs.readFileSync(f('auto.md'), 'utf8');
  await boot(f('auto.md'));
  const back = await waitText('AUTOKEEP', 16);
  if (typed && /已自动保存/.test(status) && disk.includes('AUTOKEEP') && back) pass('自动保存后退出', status);
  else fail('自动保存后退出', 'typed=' + typed + ' status=' + status + ' disk=' + disk.includes('AUTOKEEP') + ' back=' + back);
}

async function externalEdit() {
  await boot(f('ext.md'));
  if (!await waitText('原始内容')) { fail('外部修改', '文件没进编辑器'); return; }
  fs.appendFileSync(f('ext.md'), '\nOUT2\n');
  const typed = await typeInto('QQQ');
  await sleep(2200);
  const status = await ev('document.getElementById("status-autosave")?.textContent || ""');
  const disk = fs.readFileSync(f('ext.md'), 'utf8');
  if (!(typed && /外部修改/.test(status) && disk.includes('OUT2') && !disk.includes('QQQ'))) {
    fail('外部修改自动保存', 'typed=' + typed + ' status=' + status);
    return;
  }
  pass('外部修改自动保存', status);
  await key('ctrl+s');
  const dlg = await waitName('文件已在外部修改', 15);
  if (!dlg) { fail('外部修改取消', '没有询问'); return; }
  sh('xdotool windowactivate --sync ' + dlg + '; xdotool key Escape');
  await sleep(300);
  if (fs.readFileSync(f('ext.md'), 'utf8').includes('QQQ')) { fail('外部修改取消', '取消后磁盘被盖掉了'); return; }
  pass('外部修改取消', '磁盘仍是外部内容');
  await key('ctrl+s');
  const dlg2 = await waitName('文件已在外部修改', 15);
  if (!dlg2) { fail('外部修改覆盖', '第二次没有询问'); return; }
  sh('xdotool windowactivate --sync ' + dlg2 + '; xdotool key Right; xdotool key Return');
  await sleep(700);
  if (fs.readFileSync(f('ext.md'), 'utf8').includes('QQQ')) pass('外部修改覆盖', '编辑器内容已写回');
  else fail('外部修改覆盖', '磁盘里没有编辑器里的新字');
}

async function readOnly() {
  fs.chmodSync(f('ro.md'), 0o444);
  await boot(f('ro.md'));
  const typed = await typeInto('ROWRITE');
  await key('ctrl+s');
  const dlg = await waitName('保存失败', 15);
  const disk = fs.readFileSync(f('ro.md'), 'utf8');
  if (typed && dlg && !disk.includes('ROWRITE')) pass('只读文件', '弹出保存失败，原文件未改');
  else fail('只读文件', 'typed=' + typed + ' dlg=' + !!dlg);
  await dismissDialogs();
  fs.chmodSync(f('ro.md'), 0o644);
}

async function noWriteDir() {
  await boot(f('nowrite/exists.md'));
  const typed = await typeInto('NWWRITE');
  await key('ctrl+s');
  const dlg = await waitName('保存失败', 15);
  const disk = fs.readFileSync(f('nowrite/exists.md'), 'utf8');
  if (typed && dlg && !disk.includes('NWWRITE')) pass('无权限目录', '弹出保存失败，原文件未改');
  else fail('无权限目录', 'typed=' + typed + ' dlg=' + !!dlg);
  await dismissDialogs();
}

async function draftRestore() {
  try { sh('rm -rf "$HOME/.config/markmate/drafts"'); } catch (_) {}
  await boot();
  await key('ctrl+n');
  await sleep(500);
  const typed = await typeInto('DRAFTKEEP');
  await sleep(2200);
  const status = await ev('document.getElementById("status-autosave")?.textContent || ""');
  killApp();
  await sleep(300);
  await boot();
  await sleep(600);
  const banner = await ev('(()=>{ const b=document.getElementById("draft-banner"); return !!(b && !b.classList.contains("hidden")); })()');
  if (!banner) { fail('草稿恢复', '没有草稿条 typed=' + typed + ' status=' + status); return; }
  await ev('document.getElementById("draft-restore").click()');
  await sleep(400);
  const back = await ev('(typeof getContentForSave==="function"?getContentForSave():"").includes("DRAFTKEEP")');
  if (back) pass('草稿恢复', status);
  else fail('草稿恢复', '点了恢复但内容没有');
}

async function versions() {
  await boot(f('hist.md'));
  await waitText('历史原文');
  if (!await typeInto('VERA')) { fail('历史版本', '第一段没打进去'); return; }
  await key('ctrl+s');
  await sleep(600);
  if (!await typeInto('VERB')) { fail('历史版本', '第二段没打进去'); return; }
  await key('ctrl+s');
  await sleep(600);
  await ev('showVersions()');
  await sleep(500);
  const n = await ev('document.querySelectorAll("#versions-list .ver-item").length');
  if (n >= 1) pass('历史版本', '列表里有 ' + n + ' 个');
  else fail('历史版本', '列表是空的');
  await ev('document.getElementById("versions-close")?.click()', 5000);
}

async function exportWordHtml() {
  await boot(f('open-me.md'));
  await waitText('OPENME');
  fs.rmSync(f('out.docx'), { force: true });
  await ev('runExport("docx")', 5000, false);
  const ok = await fillSave(f('out.docx'));
  let mht = '';
  try { mht = require('child_process').execSync('unzip -p ' + JSON.stringify(f('out.docx')) + ' word/afchunk.mht', { encoding: 'utf8' }); } catch (_) {}
  if (ok && mht.includes('OPENME')) pass('导出 Word', '正文在文档里');
  else fail('导出 Word', 'ok=' + ok + ' has=' + mht.includes('OPENME'));

  fs.rmSync(f('out.html'), { force: true });
  await ev('runExport("html")', 5000, false);
  const okHtml = await fillSave(f('out.html'));
  const html = fs.existsSync(f('out.html')) ? fs.readFileSync(f('out.html'), 'utf8') : '';
  if (okHtml && html.includes('OPENME')) pass('导出 HTML', html.length + ' 字节');
  else fail('导出 HTML', 'ok=' + okHtml);
}

async function blankExport() {
  await boot();
  await key('ctrl+n');
  await sleep(600);
  const kinds = [['pdf', 'empty.pdf'], ['html', 'empty.html'], ['docx', 'empty.docx'], ['png', 'empty.png']];
  const bad = [];
  for (const [kind, name] of kinds) {
    const dest = f(name);
    fs.rmSync(dest, { force: true });
    await ev('runExport(' + JSON.stringify(kind) + ')', 5000, false);
    const ok = await fillSave(dest);
    await sleep(kind === 'png' ? 2000 : 600);
    const size = fs.existsSync(dest) ? fs.statSync(dest).size : 0;
    if (!ok || size < 20 || (kind === 'png' && !pngSize(dest))) bad.push(kind);
    await dismissDialogs();
  }
  if (!bad.length) pass('空白导出', 'pdf html docx png');
  else fail('空白导出', bad.join(','));
}

async function widePng() {
  await boot(f('wide.md'));
  await sleep(800);
  const overflow = await ev('(()=>{ const p=document.querySelector(".vditor-wysiwyg pre"); if(!p) return null; return {sw:p.scrollWidth, cw:p.clientWidth}; })()');
  fs.rmSync(f('wide.png'), { force: true });
  await ev('runExport("png")', 5000, false);
  const ok = await fillSave(f('wide.png'));
  await sleep(2000);
  const dim = fs.existsSync(f('wide.png')) ? pngSize(f('wide.png')) : null;
  if (ok && dim && dim.w < 2000 && overflow && overflow.sw <= overflow.cw + 8) pass('宽代码长图', dim.w + 'x' + dim.h);
  else fail('宽代码长图', JSON.stringify(overflow) + ' ' + JSON.stringify(dim));
}

async function pasteImage() {
  await boot(f('open-me.md'));
  await waitText('OPENME');
  const clip = spawn('xclip', ['-selection', 'clipboard', '-t', 'image/png', '-i', f('dot.png')], {
    env: electronEnv(), detached: true, stdio: 'ignore',
  });
  clip.unref();
  await sleep(400);
  if (!await typeInto('')) { /* 点进编辑器即可 */ }
  await key('ctrl+v');
  await sleep(1000);
  const hit = await ev('!!document.querySelector(".vditor-wysiwyg img") || (typeof getContentForSave==="function" && /!\\[/.test(getContentForSave()))');
  if (hit) pass('粘贴图片');
  else fail('粘贴图片', '正文里没有图片');
}

async function dragUri(name, uri, expect) {
  await boot(f('open-me.md'));
  await waitText('OPENME');
  const drag = spawn('python3', [path.join(__dirname, 'drag-src.py'), uri], {
    env: electronEnv(), detached: true, stdio: 'ignore',
  });
  drag.unref();
  const sid = await waitName('dragsrc', 15);
  if (!sid) { fail(name, '拖拽源没出现。需要 python3 和 GTK'); return; }
  const mid = appId();
  const geo = sh('xdotool getwindowgeometry ' + mid);
  const pos = geo.match(/Position: (\d+),(\d+)/);
  const size = geo.match(/Geometry: (\d+)x(\d+)/);
  const tx = (pos ? +pos[1] : 200) + (size ? Math.round(+size[1] / 2) : 400);
  const ty = (pos ? +pos[2] : 100) + (size ? Math.round(+size[2] / 2) : 300);
  sh('xdotool windowactivate --sync ' + sid + '; xdotool mousemove --window ' + sid + ' 90 45; xdotool mousedown 1');
  await sleep(200);
  for (let i = 0; i < 15; i++) {
    sh('xdotool mousemove ' + (80 + Math.round((tx - 80) * (i + 1) / 15)) + ' ' + (100 + Math.round((ty - 100) * (i + 1) / 15)));
    await sleep(30);
  }
  sh('xdotool mouseup 1');
  await sleep(1000);
  const ok = await expect();
  try { process.kill(drag.pid, 'SIGKILL'); } catch (_) {}
  if (ok) pass(name);
  else fail(name, '松开后窗口里没有出现预期内容');
}

async function dragFile() {
  await dragUri('拖入文件', 'file://' + f('drop-me.md'), async () => {
    const tabs = await ev('JSON.stringify([...document.querySelectorAll(".tab-name")].map(e=>e.textContent))');
    return (tabs || '').includes('drop-me.md');
  });
}

async function dragImage() {
  await dragUri('拖入图片', 'file://' + f('dot.png'), async () => {
    return ev('!!document.querySelector(".vditor-wysiwyg img") || (typeof getContentForSave==="function" && /!\\[/.test(getContentForSave()))');
  });
}

async function formatJson() {
  await boot(f('sample.json'));
  await sleep(600);
  await key('ctrl+shift+l');
  await sleep(800);
  const text = await ev('document.getElementById("code-editor")?.value || ""');
  if (text && text.includes('\n') && text.includes('"a"')) pass('格式化 JSON', 'Ctrl+Shift+L');
  else fail('格式化 JSON', JSON.stringify(String(text).slice(0, 80)));
}

async function resizer() {
  await boot(f('open-me.md'));
  const before = await ev('document.getElementById("outline")?.getBoundingClientRect().width');
  const box = await ev('(()=>{ const r=document.getElementById("outline-resizer").getBoundingClientRect(); return {x:Math.round(r.x+2), y:Math.round(r.y+40)}; })()');
  const id = appId();
  sh('xdotool windowactivate --sync ' + id + '; xdotool mousemove --window ' + id + ' ' + box.x + ' ' + box.y + '; xdotool mousedown 1; xdotool mousemove_relative 80 0; xdotool mouseup 1');
  await sleep(300);
  const after = await ev('document.getElementById("outline")?.getBoundingClientRect().width');
  if (Math.abs(after - before) > 20) pass('拖分隔条', before + '→' + after);
  else fail('拖分隔条', before + '→' + after);
}

async function followSystem() {
  let themes = '';
  try { themes = sh('ls /usr/share/themes').trim(); } catch (_) {}
  if (!themes.includes('Greybird-dark')) { skip('跟随系统', '这台机器没有 Greybird-dark'); return; }
  const orig = sh('xfconf-query -c xsettings -p /Net/ThemeName').trim();
  let origGtk = "'Adwaita'";
  try { origGtk = sh('gsettings get org.gnome.desktop.interface gtk-theme').trim(); } catch (_) {}
  try {
    await boot(f('open-me.md'));
    await ev('setTheme("system")');
    sh('xfconf-query -c xsettings -p /Net/ThemeName -s Greybird-dark');
    sh('gsettings set org.gnome.desktop.interface gtk-theme Greybird-dark');
    sh('gsettings set org.gnome.desktop.interface color-scheme prefer-dark');
    await sleep(1500);
    const dark = await ev('window.matchMedia("(prefers-color-scheme: dark)").matches');
    const body = await ev('document.body.classList.contains("dark")');
    if (dark === true && body === true) pass('跟随系统', 'Greybird-dark');
    else fail('跟随系统', 'match=' + dark + ' body=' + body);
  } finally {
    try { sh('xfconf-query -c xsettings -p /Net/ThemeName -s ' + JSON.stringify(orig)); } catch (_) {}
    try { sh('gsettings set org.gnome.desktop.interface gtk-theme ' + origGtk); } catch (_) {}
    try { sh('gsettings set org.gnome.desktop.interface color-scheme default'); } catch (_) {}
  }
}

async function checkUpdate() {
  await boot(f('open-me.md'));
  const r = await ev('window.markmate.checkUpdate()', 30000);
  if (r && (r.hasUpdate === true || r.hasUpdate === false || r.error)) pass('检查更新', r.hasUpdate ? '有新版本' : (r.error || '已是最新'));
  else fail('检查更新', JSON.stringify(r));
}

async function chineseInput() {
  let listed = '';
  try { listed = sh('ibus list-engine'); } catch (_) {}
  if (!/libpinyin/.test(listed)) { skip('中文输入', '没有 libpinyin。可安装 ibus-libpinyin 后再跑 input'); return; }
  try { sh('ibus engine libpinyin'); } catch (_) {}
  const eng = sh('ibus engine').trim();
  if (eng !== 'libpinyin') { fail('中文输入', '切不到 libpinyin，当前是 ' + eng); return; }
  await boot(f('open-me.md'));
  await waitText('OPENME');
  const box = await ev('(()=>{ const el=document.querySelector(".vditor-wysiwyg"); const r=el.getBoundingClientRect(); return {x:Math.round(r.left+80), y:Math.round(r.top+70)}; })()');
  await pointerClick(box.x, box.y);
  sh('xdotool type --delay 140 nihao; xdotool key space');
  await sleep(700);
  const text = await ev('typeof getContentForSave==="function"?getContentForSave():""');
  try { sh('ibus engine xkb:us::eng'); } catch (_) {}
  if (/[\u4e00-\u9fff]/.test(text || '')) pass('中文输入', '打出了汉字');
  else fail('中文输入', JSON.stringify(String(text).slice(-40)));
}

async function bigMarkdown() {
  const lines = ['# big'];
  for (let i = 0; i < 6000; i++) lines.push('第' + i + '行 ' + '字'.repeat(80));
  lines.push('ENDMARK');
  fs.writeFileSync(f('big.md'), lines.join('\n'));
  await boot(f('big.md'));
  const info = await ev('(()=>{ const ed=document.getElementById("code-editor"); const st=document.getElementById("status-autosave")?.textContent||""; if(!ed) return JSON.stringify({mode:"wysiwyg", status:st}); ed.scrollTop=ed.scrollHeight; return JSON.stringify({mode:"text", top:ed.scrollTop, end:ed.value.includes("ENDMARK"), len:ed.value.length, status:st}); })()', 30000);
  const data = JSON.parse(info || '{}');
  if (data.mode === 'text' && data.end && data.top > 500) pass('大 Markdown', data.status);
  else fail('大 Markdown', info);
}

async function bigJsonl() {
  const mb = Number(process.env.HEAVY_JSONL_MB || 2);
  const target = mb * 1024 * 1024;
  const row = JSON.stringify({ i: 0, text: 'x'.repeat(200) }) + '\n';
  const chunks = [];
  let size = 0;
  let n = 0;
  while (size < target) { chunks.push(row); size += Buffer.byteLength(row); n++; }
  fs.writeFileSync(f('big.jsonl'), chunks.join(''));
  const before = fs.statSync(f('big.jsonl')).size;
  await boot(f('big.jsonl'));
  await sleep(1500);
  const tab = await ev('document.querySelector(".tab-item.active .tab-name")?.textContent || ""');
  const after = fs.statSync(f('big.jsonl')).size;
  if (tab.includes('big.jsonl') && after === before) pass('大 JSONL', before + ' 字节，没有被写小');
  else fail('大 JSONL', 'tab=' + tab + ' before=' + before + ' after=' + after);
}

async function wayland() {
  let westonBin = '';
  try { westonBin = sh('command -v weston').trim(); } catch (_) {}
  if (!westonBin) { skip('Wayland', '没装 weston。这台机器是 X 桌面，嵌套验证需要 weston'); return; }
  killApp();
  const wlog = fs.openSync(f('weston.log'), 'w');
  const weston = spawn('weston', ['--backend=x11-backend.so', '--socket=mm-wl'], {
    env: electronEnv(), detached: true, stdio: ['ignore', wlog, wlog],
  });
  weston.unref();
  await sleep(2000);
  let alive = false;
  try { process.kill(weston.pid, 0); alive = true; } catch (_) {}
  if (!alive) {
    skip('Wayland', 'weston 没起来。日志在 ' + f('weston.log'));
    return;
  }
  const elog = fs.openSync(f('wayland-electron.log'), 'w');
  const env = electronEnv();
  env.WAYLAND_DISPLAY = 'mm-wl';
  env.GDK_BACKEND = 'wayland';
  const child = spawn(ELECTRON, ['--no-sandbox', '--disable-gpu', '--ozone-platform=wayland', '--enable-features=UseOzonePlatform', APP], {
    env, detached: true, stdio: ['ignore', elog, elog],
  });
  child.unref();
  await sleep(4000);
  let up = false;
  try { process.kill(child.pid, 0); up = true; } catch (_) {}
  const etxt = fs.readFileSync(f('wayland-electron.log'), 'utf8');
  try { process.kill(child.pid, 'SIGKILL'); } catch (_) {}
  try { process.kill(weston.pid, 'SIGKILL'); } catch (_) {}
  if (up && !/FATAL|cannot open display/i.test(etxt)) pass('Wayland', '嵌套 weston 里进程还在');
  else fail('Wayland', etxt.replace(/\n/g, ' | ').slice(0, 240));
}

async function installedPackage() {
  if (!fs.existsSync('/usr/bin/markmate')) {
    skip('安装包打开文件', '这台机器没装 deb。源码回归不依赖安装包');
    return;
  }
  killApp();
  const child = spawn('/usr/bin/markmate', [f('open-me.md')], {
    env: electronEnv(), detached: true, stdio: 'ignore',
  });
  child.unref();
  const id = await waitName('open-me.md', 25);
  if (id) pass('安装包打开文件', '窗口标题里有文件名');
  else fail('安装包打开文件', '装了 deb 但窗口没打开这个文件');
  killApp();
}

const GROUPS = {
  smoke: [
    ['打开文件', openFile],
    ['已开着再打开', secondFile],
    ['专注模式', focusNotFind],
    ['自动保存后退出', autosaveSurvivesQuit],
  ],
  safety: [
    ['外部修改', externalEdit],
    ['只读文件', readOnly],
    ['无权限目录', noWriteDir],
    ['草稿恢复', draftRestore],
    ['历史版本', versions],
  ],
  export: [
    ['导出', exportWordHtml],
    ['空白导出', blankExport],
    ['宽代码长图', widePng],
  ],
  input: [
    ['粘贴图片', pasteImage],
    ['拖入文件', dragFile],
    ['拖入图片', dragImage],
    ['格式化 JSON', formatJson],
    ['中文输入', chineseInput],
  ],
  desk: [
    ['拖分隔条', resizer],
    ['跟随系统', followSystem],
    ['检查更新', checkUpdate],
    ['安装包打开文件', installedPackage],
  ],
  heavy: [
    ['大 Markdown', bigMarkdown],
    ['大 JSONL', bigJsonl],
    ['Wayland', wayland],
  ],
};

const DEFAULT = ['smoke', 'safety', 'export', 'input', 'desk'];

function selected() {
  const args = process.argv.slice(2);
  if (!args.length) return DEFAULT;
  if (args.includes('all')) return Object.keys(GROUPS);
  const unknown = args.filter((a) => !GROUPS[a]);
  if (unknown.length) {
    console.error('没有这个分组：' + unknown.join(', '));
    console.error('可选：' + Object.keys(GROUPS).join(' ') + ' all');
    process.exit(2);
  }
  return args;
}

(async () => {
  prepareFixtures();
  try { sh('sudo -n chvt 7'); } catch (_) {}
  try { sh('ibus engine xkb:us::eng'); } catch (_) {}
  for (const group of selected()) {
    console.log('\n# ' + group);
    for (const [name, fn] of GROUPS[group]) {
      try { await fn(); }
      catch (err) { fail(name, err.message); }
      await dismissDialogs();
    }
  }
  process.exit(finish());
})().catch((err) => {
  console.error('ERR', err);
  process.exit(1);
});
