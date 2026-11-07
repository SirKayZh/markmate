#!/usr/bin/env bash
#
# build-linux.sh — 打包 MarkMate Linux x64（AppImage + deb）
#
# 用法：bash scripts/build-linux.sh
# 产物：release/MarkMate-<version>-x86_64.AppImage / release/MarkMate-<version>-amd64.deb
#
# 为什么 AppImage 是主推：
#   - 单个文件、免安装、双击即用，跨发行版通用；
#   - electron-updater 原生支持 AppImage（依赖 latest-linux.yml 做增量更新）。
# deb 是给 Debian/Ubuntu 系用户的可选安装包（deb 不支持 electron-updater，需 apt 升级）。

set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
REL="$ROOT/release"

VERSION="$(node -p "require('./package.json').version")"
PRODUCT="$(node -p "require('./package.json').build.productName")"
echo "==> 打包 $PRODUCT Linux x64 v$VERSION (AppImage + deb)"

# ============ GNU ar 检测（deb 构建必需）============
# electron-builder 内置 fpm 在 macOS 上默认用系统的 BSD ar 打包 deb：BSD ar 会往
# archive 里塞 __.SYMDEF 符号表成员，产出 96 字节的损坏 .deb（dpkg 无法安装）。
# 必须改用 GNU binutils 的 ar 才能出正确的 deb。检测顺序：PATH 里的 ar/gar →
# 常见 Homebrew 路径（binutils 是 keg-only，不链进 PATH）。
GNU_AR_DIR=""
if command -v ar >/dev/null 2>&1 && ar --version 2>/dev/null | grep -qi "GNU binutils"; then
  GNU_AR_DIR="$(dirname "$(command -v ar)")"
elif command -v gar >/dev/null 2>&1 && gar --version 2>/dev/null | grep -qi "GNU binutils"; then
  GNU_AR_DIR="$(dirname "$(command -v gar)")"
else
  for p in /opt/homebrew/opt/binutils/bin /usr/local/opt/binutils/bin; do
    if [ -x "$p/ar" ] && "$p/ar" --version 2>/dev/null | grep -qi "GNU binutils"; then
      GNU_AR_DIR="$p"
      break
    fi
  done
fi

BUILD_DEB=1
if [ -n "$GNU_AR_DIR" ]; then
  export PATH="$GNU_AR_DIR:$PATH"
  echo "    GNU ar 已就位：${GNU_AR_DIR}（deb 可构建）"
else
  BUILD_DEB=0
  echo "    ⚠️  未检测到 GNU ar（binutils），macOS 上的 BSD ar 会产出损坏的 deb。"
  echo "    本次仅构建 AppImage；如需 deb 请先执行：brew install binutils"
fi

# --publish never 是必须的：package.json 配了 github publish provider，
# 环境里存在 GH_TOKEN / GITHUB_TOKEN 时 electron-builder 会自动上传 Release ——
# 那是不可回滚的对外动作。本项目约定「构建只产出，发布由人显式执行」。
#
# env -u：ELECTRON_RUN_AS_NODE / NODE_OPTIONS 均为受管环境注入（后者会拦 asar 写操作），
# 清掉后脚本裸跑成立，见 build-dmg.sh 同款注释。
# ELECTRON_BUILDER_BINARIES_MIRROR 默认指向 npmmirror，规避 github 主域被 RST 时
# AppImage 工具下载失败（见 BUG_JOURNAL）。
MIRROR="${ELECTRON_BUILDER_BINARIES_MIRROR:-https://npmmirror.com/mirrors/electron-builder-binaries/}"

echo "==> 打包 Linux x64"
if [ "${BUILD_DEB}" -eq 1 ]; then
  env -u ELECTRON_RUN_AS_NODE -u NODE_OPTIONS ELECTRON_BUILDER_BINARIES_MIRROR="$MIRROR" \
    npx electron-builder --linux --x64 --publish never >/dev/null
else
  env -u ELECTRON_RUN_AS_NODE -u NODE_OPTIONS ELECTRON_BUILDER_BINARIES_MIRROR="$MIRROR" \
    npx electron-builder --linux AppImage --x64 --publish never >/dev/null
fi

# 产物名由 package.json 的 linux.artifactName（${productName}-${version}-${arch}.${ext}）
# 决定，${arch} 宏对 AppImage 展开为 x86_64、对 deb 展开为 amd64。
APPIMAGE="${REL}/${PRODUCT}-${VERSION}-x86_64.AppImage"
DEB="${REL}/${PRODUCT}-${VERSION}-amd64.deb"

# AppImage 必须存在（主推格式，硬校验）
if [ ! -f "${APPIMAGE}" ]; then
  echo "❌ 缺少 Linux 产物：${APPIMAGE}" >&2
  exit 1
fi

# deb：仅在有 GNU ar 时校验；且必须超过 10MB —— 损坏的 deb（BSD ar 产物）只有 96 字节，
# 光查文件存在会放过去。
if [ "${BUILD_DEB}" -eq 1 ]; then
  if [ ! -f "${DEB}" ]; then
    echo "❌ 缺少 Linux 产物：${DEB}" >&2
    exit 1
  fi
  DEB_SIZE="$(stat -f%z "${DEB}" 2>/dev/null || stat -c%s "${DEB}" 2>/dev/null || echo 0)"
  if [ "${DEB_SIZE}" -lt 10485760 ]; then
    echo "❌ deb 疑似损坏（${DEB_SIZE} 字节）：${DEB}" >&2
    echo "   这是 macOS BSD ar 的已知产物；请 brew install binutils 后重跑。" >&2
    exit 1
  fi
else
  echo "    ⚠️  本次跳过 deb（缺 GNU ar），发版前请在装有 binutils 的环境补出 deb。"
fi

# 没装 libfuse2 时，直接双击 AppImage 会在挂载阶段失败，进不到程序里。
# 这个 .run 先告诉运行时「挂不上就解压再跑」，再把参数交给 AppImage。
RUNNER="${REL}/${PRODUCT}-${VERSION}-x86_64.run"
cat > "${RUNNER}" << EOF
#!/bin/sh
DIR=\$(CDPATH= cd -- "\$(dirname -- "\$0")" && pwd)
export APPIMAGE_EXTRACT_AND_RUN=1
exec "\$DIR/${PRODUCT}-${VERSION}-x86_64.AppImage" --appimage-extract-and-run "\$@"
EOF
chmod +x "${RUNNER}"

# electron-updater 需要 latest-linux.yml 才能发现新版本，缺了它 AppImage 永远检查不到更新
if [ ! -f "${REL}/latest-linux.yml" ]; then
  echo "❌ 缺少 Linux 更新清单：${REL}/latest-linux.yml" >&2
  exit 1
fi

echo ""
echo "==> 完成。产物列表："
ls -lh "${APPIMAGE}" "${RUNNER}" "${REL}/latest-linux.yml"
[ -f "${DEB}" ] && ls -lh "${DEB}"
