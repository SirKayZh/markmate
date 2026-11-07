/**
 * Linux 打包后把可执行文件换成启动脚本。
 *
 * Ubuntu 24.04 起用户命名空间被 AppArmor 收紧，AppImage 里的 chrome-sandbox
 * 又没法设 setuid。沙箱在主进程脚本运行前就退出，app.commandLine.appendSwitch
 * 来不及。--no-sandbox 必须出现在进程 argv 里。
 * 桌面项的 executableArgs 只在从菜单启动时生效，直接 ./AppImage 或
 * /opt/MarkMate/markmate 不会带上。
 */
const fs = require('fs');
const path = require('path');

module.exports = async function linuxAfterPack(context) {
  if (context.electronPlatformName !== 'linux') return;
  const exeName = context.packager.executableName;
  if (!/^[A-Za-z0-9._-]+$/.test(exeName)) {
    throw new Error('无法为 Linux 可执行文件生成启动脚本：' + exeName);
  }
  const exe = path.join(context.appOutDir, exeName);
  const bin = path.join(context.appOutDir, exeName + '.bin');
  if (fs.existsSync(bin)) return;
  const fd = fs.openSync(exe, 'r');
  const magic = Buffer.alloc(2);
  fs.readSync(fd, magic, 0, 2, 0);
  fs.closeSync(fd);
  if (magic.toString() === '#!') return;
  const mode = fs.statSync(exe).mode;
  fs.renameSync(exe, bin);
  fs.chmodSync(bin, mode);
  // /usr/bin/markmate 是 update-alternatives 指过来的符号链接。
  // 用 $0 的目录会找到 /usr/bin/markmate.bin，文件其实在 /opt/MarkMate。
  const script = `#!/bin/sh
TARGET=$0
if [ -L "$TARGET" ]; then
  TARGET=$(readlink -f "$TARGET")
fi
HERE=$(CDPATH= cd -- "$(dirname -- "$TARGET")" && pwd)
exec "$HERE/${exeName}.bin" --no-sandbox "$@"
`;
  fs.writeFileSync(exe, script, { mode: 0o755 });
  fs.chmodSync(exe, 0o755);
};
