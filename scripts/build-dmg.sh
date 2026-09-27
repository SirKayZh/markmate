#!/usr/bin/env bash
#
# build-dmg.sh — 可靠地把 MarkMate 打包成带版本号的 macOS DMG（arm64 + x64）
#
# 为什么不直接用 electron-builder 出 DMG：
#   本机自动化环境下 `hdiutil create` 需要把卷临时挂载到 /Volumes/MarkMate，
#   会被 macOS TCC 权限拦截（操作不被允许）。这里改成：
#   1) electron-builder 只构建 .app（--dir，不碰 hdiutil）
#   2) hdiutil makehybrid 生成镜像（不挂载卷）
#   3) hdiutil convert 转成压缩只读 UDZO（体积正常、可分发）
#
# 用法：bash scripts/build-dmg.sh
# 产物：release/MarkMate-<version>-arm64.dmg / release/MarkMate-<version>-x64.dmg

set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
REL="$ROOT/release"

VERSION="$(node -p "require('./package.json').version")"
PRODUCT="$(node -p "require('./package.json').build.productName")"
echo "==> 打包 $PRODUCT v$VERSION"

# 清理可能残留的挂载卷（上次失败留下的）
for v in /Volumes/"$PRODUCT"*; do
  [ -d "$v" ] && hdiutil detach "$v" -force 2>/dev/null && echo "    已弹出残留卷 $v" || true
done

# 预清理上次构建残留：electron-builder 不会自动清空这两个目录，
# 一旦某个架构这次没真正重打，残留的旧 .app 会被原样塞进带**新版本号**文件名的 DMG，
# 也就是「版本号是新的、代码是旧的」。下面 make_dmg 里还会再校验一次 .app 的版本。
echo "==> [0/4] 清理上次构建残留"
rm -rf "$REL/mac" "$REL/mac-arm64"

# 1) 只构建 .app（不出 DMG，避免 hdiutil 挂载）
# --publish never：package.json 配了 github publish provider，环境里有 GH_TOKEN 时
# electron-builder 会自动上传 Release。本项目约定「构建只产出，发布由人显式执行」。
echo "==> [1/4] electron-builder 构建 .app (arm64 + x64)"
env -u ELECTRON_RUN_AS_NODE npx electron-builder --mac --dir --arm64 --x64 --publish never >/dev/null
echo "    .app 构建完成"

# 1.5) 出 zip + latest-mac.yml —— macOS 自动更新的必需品
#
# electron-updater 在 macOS 上只能从 zip 做增量更新，且必须有 latest-mac.yml 作为版本清单；
# 而本脚本为绕开 hdiutil 的 TCC 限制走的是 `--dir` + 自制 DMG，完全跳过了 electron-builder
# 的 target 流程，于是从来没产出过 latest-mac.yml。
# 后果：main.js 里 autoUpdater 是启用的、README 也把「自动更新」当卖点，
# 但所有 macOS 用户点检查更新都拿不到清单（而失败是静默的，用户只会以为自己已是最新版）。
echo "==> [2/4] 生成 zip + latest-mac.yml（macOS 自动更新必需）"
env -u ELECTRON_RUN_AS_NODE npx electron-builder --mac zip --arm64 --x64 --publish never >/dev/null
if [ ! -f "$REL/latest-mac.yml" ]; then
  echo "❌ 未生成 $REL/latest-mac.yml —— macOS 自动更新会失效，中止发版。" >&2
  echo "   排查：确认 package.json 的 build.mac.target 含 zip、且 build.publish 配置存在。" >&2
  exit 1
fi
echo "    latest-mac.yml 已生成 ✅"

# 2)+3) 每个架构：makehybrid 生成镜像 → convert 压缩
make_dmg () {
  local arch="$1" srcdir="$2"
  local app="$srcdir/$PRODUCT.app"
  local out="$REL/$PRODUCT-$VERSION-$arch.dmg"
  local stage="$REL/.stage-$arch"
  local raw="$REL/.raw-$arch.dmg"

  # 原来这里是 `return 0`，单架构构建失败会被静默跳过，
  # 而 release.sh 仍会打印"macOS DMG + Windows exe 均已生成"并打 tag。
  if [ ! -d "$app" ]; then
    echo "❌ [${arch}] 未找到 ${app}，该架构没有构建产物" >&2
    return 1
  fi

  # 校验 .app 的版本号与当前 package.json 一致，挡住"打进旧代码"的情况
  local got
  got="$(plutil -extract CFBundleShortVersionString raw "$app/Contents/Info.plist" 2>/dev/null || echo '?')"
  if [ "${got}" != "${VERSION}" ]; then
    echo "❌ [${arch}] .app 版本是 ${got}，期望 ${VERSION}（疑似残留的旧构建）" >&2
    return 1
  fi

  echo "==> [$arch] 生成 DMG"
  rm -rf "$stage" "$raw" "$out"

  # ad-hoc 签名：降低 macOS Gatekeeper 拦截等级
  # 不签名 → "无法验证" 直接不让装；签名后 → "来自未识别开发者"，右键可打开
  # 所以签名失败不能只打印一行灰字继续——那会产出用户根本装不上的 DMG。
  echo "    ad-hoc 签名..."
  if ! codesign --force --deep --sign - "$app" 2>/dev/null; then
    echo "❌ [${arch}] ad-hoc 签名失败，产出的 DMG 会被 Gatekeeper 拒绝安装" >&2
    return 1
  fi

  mkdir -p "$stage"
  cp -R "$app" "$stage/"
  ln -s /Applications "$stage/Applications"   # 拖拽安装快捷方式

  hdiutil makehybrid -hfs -hfs-volume-name "$PRODUCT" -o "$raw" "$stage" >/dev/null
  hdiutil convert "$raw" -format UDZO -o "$out" >/dev/null
  rm -rf "$stage" "$raw"

  local size; size="$(du -h "$out" | cut -f1)"
  echo "    ✅ $out ($size)"
}

# electron-builder 输出目录：arm64 在 mac-arm64/，x64 在 mac/
echo "==> [3/4] 生成两个架构的 DMG"
make_dmg "arm64" "$REL/mac-arm64"
make_dmg "x64"   "$REL/mac"

# 校验产物。原来这里 `hdiutil imageinfo ... || echo "⚠️ 镜像异常"` 会让异常也以 0 退出，
# release.sh 据此继续 commit + 打 tag。现在改成硬失败。
# （.app 的版本校验已在 make_dmg 里做过，注释别再声称这里校验 app.asar 源码。）
echo "==> [4/4] 校验产物"
for arch in arm64 x64; do
  dmg="$REL/$PRODUCT-$VERSION-$arch.dmg"
  if [ ! -f "$dmg" ]; then
    echo "❌ [${arch}] 缺少产物：${dmg}" >&2
    exit 1
  fi
  if ! hdiutil imageinfo "$dmg" >/dev/null 2>&1; then
    echo "❌ [${arch}] 镜像损坏无法读取：${dmg}" >&2
    exit 1
  fi
  echo "    [${arch}] 镜像可读 ✅"
done

echo ""
echo "==> 完成。产物列表："
ls -lh "$REL"/"$PRODUCT"-"$VERSION"-*.dmg
ls -lh "$REL/latest-mac.yml"
