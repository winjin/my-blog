# 思想实验室 · 个人博客

生活记录、科技资讯、经济观察 — 基于 Astro 的静态个人博客。

## 功能

- 文章分类（生活 / 科技 / 经济）
- 深色模式
- Pagefind 站内搜索
- RSS 订阅（`/rss.xml`）
- Giscus 评论（需配置）
- Umami 访问统计（需配置）

## 本地开发

```bash
cd ~/Documents/my-blog
npm install
npm run dev
```

浏览器打开 http://localhost:4321

## 写作

在 `src/content/posts/` 新建 `.mdx` 文件：

```yaml
---
title: "文章标题"
description: "摘要"
category: life   # life | tech | economy
tags: [标签1, 标签2]
date: 2025-05-23
draft: false
---
```

正文使用 Markdown 语法。`draft: true` 的文章不会发布。

## 环境变量

复制 `.env.example` 为 `.env`，按需填写：

| 变量 | 说明 |
|------|------|
| `SITE` | 站点 URL（部署后更新） |
| `PUBLIC_GISCUS_*` | [Giscus](https://giscus.app) 评论配置 |
| `PUBLIC_UMAMI_*` | [Umami](https://umami.is) 统计配置 |

## 部署到 Vercel

1. 将项目推送到 GitHub：

```bash
git init
git add .
git commit -m "feat: initial blog setup"
gh repo create my-blog --public --source=. --push
```

2. 打开 [vercel.com/new](https://vercel.com/new)，导入 GitHub 仓库
3. Framework Preset 选 **Astro**，Build Command 保持默认 `npm run build`
4. 在 Vercel 项目 Settings → Environment Variables 中添加 `.env.example` 里的变量
5. Deploy 完成后，将 `SITE` 和 `astro.config.mjs` 中的 `site` 更新为你的域名

## 部署到自有服务器

已准备好一键部署脚本（默认服务器 `115.190.175.160`）：

```bash
cd ~/Documents/my-blog
cp deploy/deploy.env.example deploy/deploy.env   # 首次：按需修改用户名、域名
./deploy/deploy.sh
```

脚本会自动：安装 Node/Nginx → 同步代码 → 构建 → 配置 Nginx。

部署完成后访问：`http://115.190.175.160`（或你在 `deploy.env` 里配置的域名）

## 项目结构

```
src/
├── content/posts/    # 文章（Markdown）
├── components/       # 组件
├── layouts/          # 页面布局
├── pages/            # 路由页面
└── styles/           # 全局样式
```

## 常用命令

```bash
npm run dev      # 本地开发
npm run build    # 构建 + 生成搜索索引
npm run preview  # 预览构建结果
```
