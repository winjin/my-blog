# my-blog

每日中文技术博客,基于 **Astro** 静态站点。文章同时发布到 **网站** 和 **微信公众号草稿箱**。

## 内容

- 文章位于 `src/content/posts/*.mdx`,命名 `YYYY-MM-DD-tech-daily.mdx`。
- Frontmatter schema 见 `src/content/config.ts`,必填字段:`title`、`description`、`category`(`life` | `tech` | `economy`)、`date`;可选 `tags`、`draft`、`cover`。
- 文章风格:由浅入深、面向新手、配可运行代码示例与「避坑清单」。
- 封面 `cover` 多用 Unsplash 远程图(写文章前先 `curl` 确认返回 200)。注意:封面**不会**在正文里渲染(见 `PostLayout.astro`),正文需要配图时要在 markdown 里单独插入。

## 部署 + 公众号自动发布(重要)

push 到 `main` 后全自动,无需手动操作:

```
git push → GitHub Actions(.github/workflows/daily-post.yml)
   → 构建,rsync dist/ 到服务器 nginx
   → rsync 文章+脚本到服务器,SSH 执行 publish-wechat.mjs --new
   → 从服务器白名单 IP 发布新文章到公众号草稿箱
```

- **发布服务器**:`115.190.175.160`(`deploy/deploy.env`),固定 IP,已加入公众号 IP 白名单。把发布动作放服务器执行,是为了规避本机/CI 出口 IP 频繁变动导致的 `40164 invalid ip` 报错。
- **公众号凭证**:`AppID`/`AppSecret` 在服务器 `/var/www/my-blog/.env`(本机 `.env` 也有,**绝不提交**)。
- **发布账本**:服务器上 `/var/www/my-blog/.wechat-published.json`,记录已发布文章。`--new` 模式只发布不在账本里的文章,**绝不重发**。账本缺失时会先「播种基线」而非全量误发(防止一次性把所有旧文推出去)。已在 `.gitignore` 忽略。

## 常用命令

```bash
npm run dev                                   # 本地预览
npm run build                                 # 构建(含 pagefind 搜索索引)
node scripts/publish-wechat.mjs <file.mdx>    # 手动发布指定文章到公众号
node scripts/publish-wechat.mjs --new         # 发布账本里没有的新文章(CI 用这个)
./deploy/deploy.sh                            # 手动全量部署(同步源码并在服务器构建)
```

## 环境注意

- `scripts/publish-wechat.mjs` 仅用 Node 内置模块(无 npm 依赖);Node 18+ 自带 `fetch`。
- TLS:Node 自带 CA 无法验证微信证书链,脚本会自动用系统 CA 包重新执行(macOS `/etc/ssl/cert.pem`、Ubuntu `/etc/ssl/certs/ca-certificates.crt` 已做跨平台探测)。
- 图片压缩:优先 `sips`(macOS),无则 ImageMagick,再无则用原始字节(服务器无图像工具时,远程封面通常已 <1MB,不受影响)。
- 微信 digest 上限约 120 字,脚本会自动截断到 109 字 + `…`。
- macOS 本地 cron 受 TCC 限制无法访问 `~/Documents`,所以**不要依赖本机 cron 定时发文**;自动化走上面的 push → CI 链路。
