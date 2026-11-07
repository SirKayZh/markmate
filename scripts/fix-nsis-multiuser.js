// electron-builder 24 的多用户脚本用 System.dll 按固定长度去拷
// SHGetKnownFolderPath 返回的路径。那块内存只够放路径本身，多读会直接
// 0xc0000005，安装包界面还没出来就退出。这里改成按长度截断的 lstrcpynW。
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'node_modules', 'app-builder-lib', 'templates', 'nsis', 'multiUser.nsh');
if (!fs.existsSync(file)) {
  console.error('找不到 NSIS 模板: ' + file);
  process.exit(1);
}

const src = fs.readFileSync(file, 'utf8');
if (src.includes('KERNEL32::lstrcpynW')) {
  console.log('NSIS 模板已经是安全拷贝，跳过');
  process.exit(0);
}

const bad = [
  '      System::Store S',
  '      # Win7 has a per-user programfiles known folder and this can be a non-default location',
  '      System::Call \'SHELL32::SHGetKnownFolderPath(g "${FOLDERID_UserProgramFiles}", i ${KF_FLAG_CREATE}, p 0, *p .r2)i.r1\'',
  '      ${If} $1 == 0',
  '        System::Call \'*$2(&w${NSIS_MAX_STRLEN} .s)\'',
  '        StrCpy $0 $1',
  '        System::Call \'OLE32::CoTaskMemFree(p r2)\'',
  '      ${endif}',
  '      System::Store L',
].join('\n');

const good = [
  '      Push $1',
  '      Push $2',
  '      StrCpy $2 0',
  '      System::Call \'SHELL32::SHGetKnownFolderPath(g "${FOLDERID_UserProgramFiles}", i ${KF_FLAG_CREATE}, p 0, *p .r2)i.r1\'',
  '      ${If} $1 == 0',
  '        System::Call \'KERNEL32::lstrcpynW(w .r0, p r2, i ${NSIS_MAX_STRLEN})\'',
  '      ${endif}',
  '      ${If} $2 != 0',
  '        System::Call \'OLE32::CoTaskMemFree(p r2)\'',
  '      ${endif}',
  '      Pop $2',
  '      Pop $1',
].join('\n');

if (!src.includes(bad)) {
  console.error('NSIS 模板里的危险拷贝长得和预期不一样，没有改。请核对 multiUser.nsh');
  process.exit(1);
}

fs.writeFileSync(file, src.replace(bad, good));
console.log('已把 NSIS 按固定长度拷路径改成 lstrcpynW');
