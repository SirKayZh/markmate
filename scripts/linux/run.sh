#!/usr/bin/env bash
# 在 Linux 本机跑。桌面必须已经登录，DISPLAY 指向那块屏幕。
# 用法：bash scripts/linux/run.sh
#       bash scripts/linux/run.sh smoke
#       bash scripts/linux/run.sh safety export
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"
export GTK_IM_MODULE="${GTK_IM_MODULE:-ibus}"
export QT_IM_MODULE="${QT_IM_MODULE:-ibus}"
export XMODIFIERS="${XMODIFIERS:-@im=ibus}"
exec node scripts/linux/suite.js "$@"
