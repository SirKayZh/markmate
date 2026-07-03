#!/usr/bin/env bash
#
# dev-build.sh — 本地快速构建 DMG（不 bump 版本、不打 tag、不 commit）
#
# 用途：改了代码想本地跑一下看看效果，但还不想发版。
# 它会直接用当前 package.json 里的版本号打包，产出的 DMG 在 release/ 目录。
#
# 用法：bash scripts/dev-build.sh
#
# 与 release.sh 的区别：
#   dev-build.sh  ← 只打 DMG，不碰 git
#   release.sh    ← bump 版本 → 打包 → commit → tag（正式发版用）

set -euo pipefail
cd "$(dirname "$0")/.."

VERSION="$(node -p "require('./package.json').version")"
echo "==> 本地构建 MarkMate v${VERSION}（dev build，不 bump 版本）"

bash scripts/build-dmg.sh

echo ""
echo "==> 构建完成  v${VERSION}  (dev build)"
echo "    DMG 在 release/ 目录，仅供本地测试，未提交到 git"
