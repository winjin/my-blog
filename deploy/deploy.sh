#!/usr/bin/env bash
# 在本机运行：同步代码到服务器、构建、配置 Nginx
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

ENV_FILE="$ROOT_DIR/deploy/deploy.env"
if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi

SERVER_HOST="${SERVER_HOST:-115.190.175.160}"
SERVER_USER="${SERVER_USER:-root}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519}"
REMOTE_DIR="${REMOTE_DIR:-/var/www/my-blog}"
SITE_URL="${SITE_URL:-http://${SERVER_HOST}}"

SSH_OPTS=(-o StrictHostKeyChecking=accept-new)
if [[ -f "$SSH_KEY" ]]; then
  SSH_OPTS+=(-i "$SSH_KEY")
fi

REMOTE="${SERVER_USER}@${SERVER_HOST}"

echo "==> 1/5 检查 SSH 连接 (${REMOTE})"
ssh "${SSH_OPTS[@]}" "$REMOTE" "echo 'SSH OK' && uname -a"

echo "==> 2/5 首次服务器环境准备（如需）"
ssh "${SSH_OPTS[@]}" "$REMOTE" "bash -s" < "$ROOT_DIR/deploy/server-setup.sh"

echo "==> 3/5 同步代码到 ${REMOTE}:${REMOTE_DIR}"
ssh "${SSH_OPTS[@]}" "$REMOTE" "mkdir -p ${REMOTE_DIR}"
RSYNC_SSH="ssh ${SSH_OPTS[*]}"
rsync -avz --delete \
  --exclude node_modules \
  --exclude dist \
  --exclude .git \
  --exclude .astro \
  --exclude .DS_Store \
  -e "$RSYNC_SSH" \
  "$ROOT_DIR/" "${REMOTE}:${REMOTE_DIR}/"

echo "==> 4/5 远程构建"
ssh "${SSH_OPTS[@]}" "$REMOTE" "bash -s" <<EOF
set -euo pipefail
cd ${REMOTE_DIR}
export SITE=${SITE_URL}
rm -rf node_modules package-lock.json
npm install
npm run build
EOF

echo "==> 5/5 配置 Nginx"
ssh "${SSH_OPTS[@]}" "$REMOTE" "bash -s" <<EOF
set -euo pipefail
sudo cp ${REMOTE_DIR}/deploy/nginx-my-blog.conf /etc/nginx/sites-available/my-blog 2>/dev/null || \\
  sudo cp ${REMOTE_DIR}/deploy/nginx-my-blog.conf /etc/nginx/conf.d/my-blog.conf
if [[ -d /etc/nginx/sites-enabled ]]; then
  sudo ln -sf /etc/nginx/sites-available/my-blog /etc/nginx/sites-enabled/my-blog
  sudo rm -f /etc/nginx/sites-enabled/default
fi
sudo nginx -t
sudo systemctl reload nginx
EOF

echo ""
echo "部署完成！"
echo "访问地址: ${SITE_URL}"
echo ""
echo "后续更新：在本地改完代码后，再次运行 ./deploy/deploy.sh"
