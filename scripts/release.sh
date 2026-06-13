#!/usr/bin/env bash
#
# release.sh — 一键发版：bump 版本 → 打包 DMG → git 提交并打 tag
#
# 用法：
#   bash scripts/release.sh patch   # bug 修复  1.0.1 -> 1.0.2
#   bash scripts/release.sh minor   # 新增功能  1.0.1 -> 1.1.0
#   bash scripts/release.sh major   # 破坏改动  1.0.1 -> 2.0.0
#
# 发版前请先把本次改动写进 CHANGELOG.md 的“未发布”区，脚本会用它生成 tag 说明。
# 流程结束后会得到带新版本号的 DMG，并创建对应的 git tag（v<version>）。

set -euo pipefail
cd "$(dirname "$0")/.."

LEVEL="${1:-patch}"
case "$LEVEL" in patch|minor|major) ;; *) echo "用法: release.sh [patch|minor|major]"; exit 1;; esac

OLD="$(node -p "require('./package.json').version")"

# 计算新版本号（不依赖 npm version，避免它自动 commit/tag）
NEW="$(node -e "
const [a,b,c]=require('./package.json').version.split('.').map(Number);
const lv='$LEVEL';
let v=[a,b,c];
if(lv==='major')v=[a+1,0,0];
else if(lv==='minor')v=[a,b+1,0];
else v=[a,b,c+1];
console.log(v.join('.'));
")"

echo "==> 版本：$OLD -> $NEW ($LEVEL)"

# 写回 package.json
node -e "
const fs=require('fs');
const p=require('./package.json');
p.version='$NEW';
fs.writeFileSync('./package.json', JSON.stringify(p,null,2)+'\n');
"
echo "    package.json 已更新到 $NEW"

# CHANGELOG 提醒
if ! grep -q "## \[$NEW\]" CHANGELOG.md 2>/dev/null; then
  echo ""
  echo "⚠️  CHANGELOG.md 里还没有 [$NEW] 的条目。"
  echo "    建议先在 CHANGELOG.md 顶部补一段本版改动，再继续打包。"
  echo "    （按 Enter 继续打包，Ctrl+C 取消去补 CHANGELOG）"
  read -r _ || true
fi

# 打包
echo "==> 开始打包 DMG"
bash scripts/build-dmg.sh

# git 提交 + 打 tag
echo "==> 提交并打 tag v$NEW"
git add package.json CHANGELOG.md
git commit -m "release: v$NEW" >/dev/null 2>&1 || echo "    （无改动可提交，跳过 commit）"
if git rev-parse "v$NEW" >/dev/null 2>&1; then
  echo "    tag v$NEW 已存在，跳过"
else
  git tag -a "v$NEW" -m "MarkPad v$NEW"
  echo "    已创建 tag v$NEW"
fi

echo ""
echo "==> 发版完成 🎉  v$NEW"
echo "    DMG 在 release/ 目录；推送：git push && git push --tags"
