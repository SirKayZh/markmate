#!/usr/bin/env bash
#
# build-dmg.sh — 可靠地把 MarkPad 打包成带版本号的 macOS DMG（arm64 + x64）
#
# 为什么不直接用 electron-builder 出 DMG：
#   本机自动化环境下 `hdiutil create` 需要把卷临时挂载到 /Volumes/MarkPad，
#   会被 macOS TCC 权限拦截（操作不被允许）。这里改成：
#   1) electron-builder 只构建 .app（--dir，不碰 hdiutil）
#   2) hdiutil makehybrid 生成镜像（不挂载卷）
#   3) hdiutil convert 转成压缩只读 UDZO（体积正常、可分发）
#
# 用法：bash scripts/build-dmg.sh
# 产物：release/MarkPad-<version>-arm64.dmg / release/MarkPad-<version>-x64.dmg

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

# 1) 只构建 .app（不出 DMG，避免 hdiutil 挂载）
echo "==> [1/3] electron-builder 构建 .app (arm64 + x64)"
env -u ELECTRON_RUN_AS_NODE npx electron-builder --mac --dir --arm64 --x64 >/dev/null
echo "    .app 构建完成"

# 2)+3) 每个架构：makehybrid 生成镜像 → convert 压缩
make_dmg () {
  local arch="$1" srcdir="$2"
  local app="$srcdir/$PRODUCT.app"
  local out="$REL/$PRODUCT-$VERSION-$arch.dmg"
  local stage="$REL/.stage-$arch"
  local raw="$REL/.raw-$arch.dmg"

  if [ ! -d "$app" ]; then
    echo "    [跳过] 未找到 $app"
    return 0
  fi

  echo "==> [$arch] 生成 DMG"
  rm -rf "$stage" "$raw" "$out"
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
make_dmg "arm64" "$REL/mac-arm64"
make_dmg "x64"   "$REL/mac"

# 校验：镜像内的 app.asar 是否为当前源码（防止打到旧代码）
echo "==> 校验产物"
for arch in arm64 x64; do
  dmg="$REL/$PRODUCT-$VERSION-$arch.dmg"
  [ -f "$dmg" ] || continue
  hdiutil imageinfo "$dmg" >/dev/null 2>&1 && echo "    [$arch] 镜像可读 ✅" || echo "    [$arch] ⚠️ 镜像异常"
done

echo ""
echo "==> 完成。产物列表："
ls -lh "$REL"/"$PRODUCT"-"$VERSION"-*.dmg
