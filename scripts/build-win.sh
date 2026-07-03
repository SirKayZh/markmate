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

# 1) NSIS 安装版
echo "==> [1/2] Windows 安装版 (NSIS)"
env -u ELECTRON_RUN_AS_NODE npx electron-builder --win --x64 >/dev/null

# 2) 便携版
echo "==> [2/2] Windows 便携版"
env -u ELECTRON_RUN_AS_NODE npx electron-builder --win portable --x64 >/dev/null

# electron-builder 输出格式：MarkMate Setup x.y.z.exe / MarkMate x.y.z.exe
# 统一重命名为 MarkMate-<version>-x64-setup.exe / MarkMate-<version>-x64-portable.exe
for f in "$REL"/"$PRODUCT Setup $VERSION.exe"; do
  [ -f "$f" ] && mv "$f" "$REL/$PRODUCT-$VERSION-x64-setup.exe" && echo "    ✅ $PRODUCT-$VERSION-x64-setup.exe" || true
done
for f in "$REL"/"$PRODUCT $VERSION.exe"; do
  [ -f "$f" ] && mv "$f" "$REL/$PRODUCT-$VERSION-x64-portable.exe" && echo "    ✅ $PRODUCT-$VERSION-x64-portable.exe" || true
done

echo ""
echo "==> 完成。产物列表："
ls -lh "$REL"/"$PRODUCT"-"$VERSION"-x64-*.exe 2>/dev/null || echo "    ⚠️ 未找到产物（检查 electron-builder 是否支持交叉编译）"
