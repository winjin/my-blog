#!/bin/bash

# 本地每日自动发文脚本
# 从 .env 读取 AI_API_KEY，生成文章后 commit + push

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

# 加载 .env
if [ -f .env ]; then
  export $(grep -v '^#' .env | grep -v '^\s*$' | xargs)
fi

if [ -z "$AI_API_KEY" ]; then
  echo "Error: AI_API_KEY not found in .env"
  exit 1
fi

# 生成文章
node scripts/auto-post.mjs

# 检查是否有新文件
if git diff --quiet && git diff --cached --quiet && [ -z "$(git ls-files --others --exclude-standard src/content/posts/)" ]; then
  echo "No new post generated, skipping."
  exit 0
fi

# commit + push
git add src/content/posts/
git commit -m "auto: daily tech post $(date +%Y-%m-%d)"
git push

echo "Done! Post pushed to remote."
