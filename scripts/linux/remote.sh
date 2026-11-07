#!/usr/bin/env bash
# 在开发机上把当前源码同步到 Linux 测试机，再跑回归。
# 不带参数时跑日常回归。分组见 scripts/linux/README.md。
#
#   bash scripts/linux/remote.sh
#   bash scripts/linux/remote.sh smoke
#   LINUX_HOST=ubuntu@10.0.0.8 bash scripts/linux/remote.sh safety
#
# 认证用 SSH 公钥，脚本里不放密码。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HOST="${LINUX_HOST:-ubuntu@106.52.211.86}"
KEY="${LINUX_SSH_KEY:-$HOME/.ssh/id_ed25519}"
REMOTE_APP="${LINUX_APP:-/home/ubuntu/markmate}"

if [[ ! -f "$KEY" ]]; then
  echo "找不到 SSH 私钥：$KEY" >&2
  echo "换一台机器时设置 LINUX_SSH_KEY。" >&2
  exit 1
fi

SSH=(ssh -o BatchMode=yes -o IdentitiesOnly=yes -i "$KEY")
RSYNC_SSH="ssh -o BatchMode=yes -o IdentitiesOnly=yes -i $KEY"

echo "==> 同步源码到 $HOST:$REMOTE_APP"
"${SSH[@]}" "$HOST" "mkdir -p '$REMOTE_APP'"
rsync -az --delete \
  --exclude node_modules \
  --exclude release \
  --exclude .git \
  -e "$RSYNC_SSH" \
  "$ROOT/" "$HOST:$REMOTE_APP/"

echo "==> 运行 Linux 回归"
"${SSH[@]}" "$HOST" "sudo -n chvt 7 || true; cd '$REMOTE_APP' && bash scripts/linux/run.sh $(printf '%q ' "$@")"
