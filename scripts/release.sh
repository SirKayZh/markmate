#!/usr/bin/env bash
#
# release.sh — 一键发版：bump 版本 → 打包 macOS DMG + Windows exe → git 提交并打 tag
#
# 用法：
#   bash scripts/release.sh patch   # bug 修复  1.0.1 -> 1.0.2
#   bash scripts/release.sh minor   # 新增功能  1.0.1 -> 1.1.0
#   bash scripts/release.sh major   # 破坏改动  1.0.1 -> 2.0.0
#
# 发版前请先把本次改动写进 CHANGELOG.md 的“未发布”区，脚本会用它生成 tag 说明。
# 流程结束后会得到带新版本号的 DMG + exe，并创建对应的 git tag（v<version>）。

set -euo pipefail
cd "$(dirname "$0")/.."

LEVEL="${1:-patch}"
case "$LEVEL" in patch|minor|major) ;; *) echo "用法: release.sh [patch|minor|major]"; exit 1;; esac

PRODUCT="MarkMate"
REL="$(pwd)/release"

# ============================================================
# 阶段 1：前置校验 —— 全部通过才允许改 package.json
#
# 为什么必须全部前移：此前的顺序是「先 bump → 再校验 → 再打包 → 最后 commit」，
# bump 之后任何中断（Ctrl+C / 打包失败 / electron 下载超时）都会留下一个
# 已 bump 但未 commit 的 package.json；重跑时读到的是已 bump 的版本，于是再 bump 一次。
# 这就是 v1.7.2 / 1.7.3 / 1.7.4 那串碎版本的成因——跟是否放后台跑无关，中断一次就会复发。
# ============================================================

echo "==> 前置校验"

# 1) 工作区必须干净（package.json 与 CHANGELOG.md 例外，它们本来就要在本次发版里改）
#    否则打出来的包含有未提交代码，而 tag 里没有 → 产物无法由 tag 复现，线上问题无从回溯。
DIRTY="$(git status --porcelain | grep -vE '^.. (package\.json|CHANGELOG\.md)$' || true)"
if [ -n "${DIRTY}" ]; then
  echo "❌ 工作区有未提交改动，请先提交或 stash 后再发版：" >&2
  echo "${DIRTY}" >&2
  exit 1
fi
echo "    [1/4] 工作区干净 ✅"

# 2) 当前版本号必须是纯 SemVer（否则下面的计算会算出 2.1.NaN 并写进 package.json）
OLD="$(node -p "require('./package.json').version")"
if ! printf '%s' "${OLD}" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo "❌ package.json 里的版本号不是纯 SemVer：${OLD}" >&2
  exit 1
fi

# 计算新版本号（不依赖 npm version，避免它自动 commit/tag 与本脚本冲突）
NEW="$(node -e "
const [a,b,c]=require('./package.json').version.split('.').map(Number);
const lv='${LEVEL}';
let v=[a,b,c];
if(lv==='major')v=[a+1,0,0];
else if(lv==='minor')v=[a,b+1,0];
else v=[a,b,c+1];
console.log(v.join('.'));
")"
if ! printf '%s' "${NEW}" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo "❌ 计算出的新版本号非法：${NEW}" >&2
  exit 1
fi
echo "    [2/4] 版本号合法：${OLD} -> ${NEW} (${LEVEL}) ✅"

# 3) tag 不能已存在（说明该版本发过了）。必须限定 refs/tags 并加 --verify，
#    否则同名分支也会被误判成 tag 已存在。
if git rev-parse -q --verify "refs/tags/v${NEW}" >/dev/null; then
  echo "❌ tag v${NEW} 已存在，该版本已经发布过了。" >&2
  exit 1
fi
echo "    [3/4] tag v${NEW} 未占用 ✅"

# 4) CHANGELOG 必须已经写好本版段落。
#    原来这里是「打印警告 + read 等一下回车」，但 read 在非 tty（脚本调用 / CI / 管道）下会
#    立即返回非零并被 `|| true` 吞掉，等于护栏形同虚设。改成硬失败。
if ! grep -q "## \[${NEW}\]" CHANGELOG.md 2>/dev/null; then
  echo "❌ CHANGELOG.md 里还没有 [${NEW}] 段落。" >&2
  echo "   请先在 CHANGELOG.md 顶部补一段本版改动（格式：## [${NEW}] - $(date +%Y-%m-%d)），再重新发版。" >&2
  exit 1
fi
echo "    [4/4] CHANGELOG 已有 [${NEW}] 段落 ✅"

# ============================================================
# 阶段 2：bump（此后任何失败都会自动回滚，保证重跑不会二次 bump）
# ============================================================

rollback() {
  local code=$?
  if [ "${code}" -ne 0 ]; then
    git checkout -- package.json 2>/dev/null \
      && echo "" >&2 \
      && echo "⚠️  发版中断，已把 package.json 回滚到 ${OLD}；重跑不会二次 bump。" >&2
  fi
  exit "${code}"
}
trap rollback ERR INT TERM

echo "==> 更新版本号"
node -e "
const fs=require('fs');
const p=require('./package.json');
p.version='${NEW}';
fs.writeFileSync('./package.json', JSON.stringify(p,null,2)+'\n');
"
echo "    package.json 已更新到 ${NEW}"

# ============================================================
# 阶段 3：打包
# ============================================================

echo "==> 开始打包 macOS DMG"
bash scripts/build-dmg.sh

echo "==> 开始打包 Windows exe (NSIS 安装版 + 便携版)"
bash scripts/build-win.sh

# 产物总断言：子脚本各自也会断言，这里再兜一次，确保 4 个包 + 2 个更新清单齐全。
# 少了这道检查的话，任一子脚本静默失败都会让流程继续 commit + 打 tag + 打印"发版完成"。
echo "==> 校验产物齐全"
MISSING=""
for f in \
  "${REL}/${PRODUCT}-${NEW}-arm64.dmg" \
  "${REL}/${PRODUCT}-${NEW}-x64.dmg" \
  "${REL}/${PRODUCT}-${NEW}-x64-setup.exe" \
  "${REL}/${PRODUCT}-${NEW}-x64-portable.exe" \
  "${REL}/latest.yml" \
  "${REL}/latest-mac.yml" ; do
  [ -f "${f}" ] || MISSING="${MISSING}\n    缺少：${f}"
done
if [ -n "${MISSING}" ]; then
  echo "❌ 产物不齐全：" >&2
  printf '%b\n' "${MISSING}" >&2
  exit 1
fi
echo "    4 个安装包 + 2 个更新清单齐全 ✅"

# ============================================================
# 阶段 4：提交并打 tag
# ============================================================

echo "==> 提交并打 tag v${NEW}"
# 只 add 这两个文件：其余改动应该在发版前就已单独提交（见阶段 1 的工作区检查）
git add package.json CHANGELOG.md
if git diff --cached --quiet; then
  echo "    （package.json / CHANGELOG.md 无实际改动，跳过 commit）"
else
  # 不要重定向也不要 `|| echo`：原写法把 hook 失败 / GPG 失败 / user.email 未配置
  # 全都当成"无改动"吞掉，然后照样打 tag —— tag 会指向不含版本号变更的旧提交。
  git commit -m "release: v${NEW}"
  echo "    已提交 release: v${NEW}"
fi

git tag -a "v${NEW}" -m "${PRODUCT} v${NEW}"
echo "    已创建 tag v${NEW}"

trap - ERR INT TERM   # 走到这里已经成功，撤掉回滚

echo ""
echo "==> 发版完成 🎉  v${NEW}"
echo "    产物在 release/ 目录：macOS DMG(arm64/x64) + Windows exe(setup/portable) + 更新清单"
echo ""
echo "    接下来手动执行（脚本不会自动推送 / 自动发布）："
echo "    1) 推送：git push origin main && git push origin v${NEW}"
echo "    2) 准备用户视角的 release notes（不要直接用 CHANGELOG 原文）"
echo "    3) 创建 Release —— 注意必须带上 latest*.yml，否则自动更新检查不到新版本："
echo ""
echo "       gh release create v${NEW} \\"
echo "         release/${PRODUCT}-${NEW}-arm64.dmg \\"
echo "         release/${PRODUCT}-${NEW}-x64.dmg \\"
echo "         release/${PRODUCT}-${NEW}-x64-setup.exe \\"
echo "         release/${PRODUCT}-${NEW}-x64-portable.exe \\"
echo "         release/${PRODUCT}-${NEW}-x64-setup.exe.blockmap \\"
echo "         release/${PRODUCT}-${NEW}-arm64-mac.zip \\"
echo "         release/${PRODUCT}-${NEW}-mac.zip \\"
echo "         release/latest.yml release/latest-mac.yml \\"
echo "         --title \"${PRODUCT} v${NEW}\" --notes-file RELEASE_NOTES.md"
echo ""
echo "    两个 mac zip 必须一起上传：latest-mac.yml 里按名字引用它们，"
echo "    只传 yml 不传 zip 的话 macOS 更新检查能成功、下载却 404。"
