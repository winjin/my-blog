#!/usr/bin/env bash
# 首次在服务器上运行：安装 Node.js 20 + Nginx
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

if command -v apt-get >/dev/null 2>&1; then
  sudo apt-get update -qq
  sudo apt-get install -y curl nginx rsync git

  if ! command -v node >/dev/null 2>&1; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
    sudo apt-get install -y nodejs
  fi
elif command -v yum >/dev/null 2>&1; then
  sudo yum install -y curl nginx rsync git
  if ! command -v node >/dev/null 2>&1; then
    curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
    sudo yum install -y nodejs
  fi
else
  echo "Unsupported OS. Please install Node.js 20+ and Nginx manually."
  exit 1
fi

sudo mkdir -p /var/www/my-blog
sudo chown $(whoami):$(whoami) /var/www/my-blog
sudo systemctl enable nginx
sudo systemctl start nginx

echo "Server setup done."
node -v
npm -v
nginx -v
