#!/usr/bin/env bash
#
# build-win.sh — 打包 MarkMate Windows x64 安装版 + 便携版
#
# 用法：bash scripts/build-win.sh
# 产物：release/MarkMate-<version>-x64-setup.exe / release/MarkMate-<version>-x64-portable.exe

set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
REL="$ROOT/release"

VERSION="$(node -p "require('./package.json').version")"
PRODUCT="$(node -p "require('./package.json').build.productName")"
echo "==> 打包 $PRODUCT Windows x64 v$VERSION"

# package.json 的 win.target 已同时声明 nsis 与 portable，一条命令就会把两个包都打出来。
# 此前还额外跑了一次 `--win portable --x64`，等于把 portable（约 80MB）重复构建一遍，纯浪费时间。
#
# --publish never 是必须的：package.json 里配了 github publish provider，
# 一旦环境里存在 GH_TOKEN / GITHUB_TOKEN，electron-builder 会自动把产物上传到 GitHub Release ——
# 那是个不可回滚的对外动作，而本项目约定「构建只产出，发布由人显式执行」。
echo "==> 打包 Windows x64（NSIS 安装版 + 便携版）"
env -u ELECTRON_RUN_AS_NODE npx electron-builder --win --x64 --publish never >/dev/null

# 产物名由 package.json 的 win.artifactName / portable.artifactName 直接决定
# （${productName}-${version}-${arch}-setup.${ext} 等），不需要再重命名。
# 原先这里有两个 mv 循环，模式里带引号根本不是 glob、匹配的旧命名也早已不存在，
# 是一段永不生效的死代码；更危险的是它一旦"生效"就会把文件改成与 latest.yml 里
# 记录的名字不一致，直接打断 Windows 端的自动更新。
SETUP="${REL}/${PRODUCT}-${VERSION}-x64-setup.exe"
PORTABLE="${REL}/${PRODUCT}-${VERSION}-x64-portable.exe"

# 必须显式断言产物存在。原来结尾是 `ls ... || echo "未找到产物"`，
# ls 失败时 `|| echo` 反而让脚本以 0 退出，release.sh 会据此继续 commit + 打 tag，
# 最后打印"macOS DMG + Windows exe 均已生成"——实际一个 Windows 包都没有。
MISSING=0
for f in "${SETUP}" "${PORTABLE}"; do
  if [ ! -f "${f}" ]; then
    echo "❌ 缺少 Windows 产物：${f}" >&2
    MISSING=1
  fi
done
if [ "${MISSING}" -ne 0 ]; then
  echo "   （macOS 上交叉编译 Windows 无需 wine；若失败请检查 electron-builder 输出）" >&2
  exit 1
fi

# electron-updater 需要 latest.yml 才能发现新版本，缺了它 Windows 端永远检查不到更新
if [ ! -f "${REL}/latest.yml" ]; then
  echo "❌ 缺少 Windows 更新清单：${REL}/latest.yml" >&2
  exit 1
fi

echo ""
echo "==> 完成。产物列表："
ls -lh "${SETUP}" "${PORTABLE}" "${REL}/latest.yml"
