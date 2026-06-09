#!/usr/bin/env node

/**
 * 微信公众号发布脚本
 * 将博客 MDX 文章发布到公众号草稿箱
 *
 * 用法:
 *   node scripts/publish-wechat.mjs src/content/posts/2026-06-06-tech-daily.mdx
 *   node scripts/publish-wechat.mjs --all
 */

import { readFileSync, readdirSync } from 'fs';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// Load .env
const envContent = readFileSync(join(ROOT, '.env'), 'utf-8');
const env = Object.fromEntries(
  envContent.split('\n').filter(l => l && !l.startsWith('#')).map(l => {
    const i = l.indexOf('=');
    return [l.slice(0, i), l.slice(i + 1)];
  })
);

const APPID = env.AppID;
const APPSECRET = env.AppSecret;

if (!APPID || !APPSECRET) {
  console.error('Error: AppID and AppSecret required in .env');
  process.exit(1);
}

const WX_API = 'https://api.weixin.qq.com/cgi-bin';

// --- Get access token ---
async function getAccessToken() {
  const res = await fetch(
    `${WX_API}/token?grant_type=client_credential&appid=${APPID}&secret=${APPSECRET}`
  );
  const data = await res.json();
  if (data.errcode) {
    throw new Error(`WeChat token error: ${data.errcode} ${data.errmsg}`);
  }
  return data.access_token;
}

// --- Upload image to WeChat material ---
async function uploadImage(token, imageUrl) {
  console.log('  Downloading cover image...');
  let imgBuffer;
  try {
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) throw new Error(`HTTP ${imgRes.status}`);
    imgBuffer = Buffer.from(await imgRes.arrayBuffer());
  } catch (e) {
    // Fallback: use curl to download (handles TLS issues)
    const { execSync } = await import('child_process');
    const tmpPath = '/tmp/wechat-cover-tmp.jpg';
    execSync(`curl -sL "${imageUrl}" -o ${tmpPath} --max-time 15`);
    const { readFileSync } = await import('fs');
    imgBuffer = readFileSync(tmpPath);
  }

  const boundary = '----WebKitFormBoundary' + Math.random().toString(36).slice(2);
  const filename = 'cover.jpg';

  const bodyParts = [
    `--${boundary}\r\n`,
    `Content-Disposition: form-data; name="media"; filename="${filename}"\r\n`,
    `Content-Type: image/jpeg\r\n\r\n`,
  ];

  const header = Buffer.from(bodyParts.join(''));
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([header, imgBuffer, footer]);

  console.log('  Uploading to WeChat...');
  const res = await fetch(
    `${WX_API}/material/add_material?access_token=${token}&type=image`,
    {
      method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body,
    }
  );

  const data = await res.json();
  if (data.errcode) {
    throw new Error(`Upload error: ${data.errcode} ${data.errmsg}`);
  }
  console.log(`  Cover uploaded: media_id=${data.media_id}`);
  return data.media_id;
}

// --- Parse MDX file ---
function parseMDX(filePath) {
  const content = readFileSync(filePath, 'utf-8');
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!fmMatch) throw new Error(`Cannot parse frontmatter: ${filePath}`);

  const fm = fmMatch[1];
  const body = fmMatch[2].trim();

  const title = fm.match(/title:\s*"(.+?)"/)?.[1] || '';
  const description = fm.match(/description:\s*"(.+?)"/)?.[1] || '';
  const cover = fm.match(/cover:\s*"(.+?)"/)?.[1] || '';

  return { title, description, cover, body };
}

// --- Markdown to WeChat HTML ---
function mdToWechatHtml(md) {
  let html = md;

  // Remove the trailing AI disclaimer
  html = html.replace(/---\s*\n\s*>.*AI.*生成.*$/s, '');

  // Code blocks — extract first to protect content from other transformations
  const codeBlocks = [];
  html = html.replace(/```[\w]*\n([\s\S]*?)```/g, (_, code) => {
    const escaped = code.replace(/</g, '&lt;').replace(/>/g, '&gt;').trim();
    const placeholder = `__CODE_BLOCK_${codeBlocks.length}__`;
    codeBlocks.push(`<pre style="background:#f6f8fa;border-radius:6px;padding:16px;overflow-x:auto;font-size:13px;line-height:1.6;margin:16px 0;"><code>${escaped}</code></pre>`);
    return placeholder;
  });

  // Inline code — extract to protect from other transformations
  const inlineCodes = [];
  html = html.replace(/`([^`]+)`/g, (_, code) => {
    const placeholder = `__INLINE_CODE_${inlineCodes.length}__`;
    inlineCodes.push(`<code style="background:#f0f0f0;padding:2px 6px;border-radius:3px;font-size:13px;color:#d14;">${code}</code>`);
    return placeholder;
  });

  // Headers
  html = html.replace(/^### (.+)$/gm, '<h3 style="font-size:16px;font-weight:bold;color:#333;margin:20px 0 10px;">$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2 style="font-size:18px;font-weight:bold;color:#1a1a1a;margin:25px 0 12px;border-left:4px solid #07c160;padding-left:10px;">$1</h2>');

  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // Italic
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Tables
  html = html.replace(/\|(.+)\|\n\|[-| :]+\|\n((?:\|.+\|\n?)*)/g, (_, header, rows) => {
    const ths = header.split('|').filter(c => c.trim()).map(c =>
      `<th style="border:1px solid #ddd;padding:8px 12px;background:#f6f8fa;font-weight:bold;text-align:left;">${c.trim()}</th>`
    ).join('');
    const trs = rows.trim().split('\n').map(row => {
      const tds = row.split('|').filter(c => c.trim()).map(c =>
        `<td style="border:1px solid #ddd;padding:8px 12px;">${c.trim()}</td>`
      ).join('');
      return `<tr>${tds}</tr>`;
    }).join('');
    return `<table style="border-collapse:collapse;width:100%;margin:16px 0;font-size:14px;"><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>`;
  });

  // Unordered lists
  html = html.replace(/^- (.+)$/gm, '<li style="margin:4px 0;">$1</li>');
  html = html.replace(/((?:<li[^>]*>.*<\/li>\n?)+)/g, '<ul style="padding-left:20px;margin:12px 0;">$1</ul>');

  // Blockquotes
  html = html.replace(/^> (.+)$/gm, '<blockquote style="border-left:4px solid #07c160;padding:10px 15px;color:#666;background:#f9f9f9;margin:16px 0;">$1</blockquote>');

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a style="color:#576b95;text-decoration:none;" href="$2">$1</a>');

  // Paragraphs - wrap remaining text lines
  html = html.replace(/^(?!<[hupbtlo]|<\/)(.+)$/gm, '<p style="margin:12px 0;line-height:1.8;color:#333;font-size:15px;">$1</p>');

  // Clean up empty paragraphs
  html = html.replace(/<p[^>]*>\s*<\/p>/g, '');

  // Restore code blocks and inline code
  codeBlocks.forEach((block, i) => {
    html = html.replace(`__CODE_BLOCK_${i}__`, block);
  });
  inlineCodes.forEach((code, i) => {
    html = html.replace(`__INLINE_CODE_${i}__`, code);
  });

  // Wrap in container
  html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;padding:10px;line-height:1.8;">${html}</div>`;

  return html;
}

// --- Create draft ---
async function createDraft(token, article) {
  const res = await fetch(`${WX_API}/draft/add?access_token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      articles: [{
        title: article.title,
        author: '',
        digest: article.description,
        content: article.html,
        thumb_media_id: article.thumbMediaId,
        content_source_url: '',
        need_open_comment: 0,
      }],
    }),
  });

  const data = await res.json();
  if (data.errcode) {
    throw new Error(`Draft error: ${data.errcode} ${data.errmsg}`);
  }
  return data.media_id;
}

// --- Main ---
async function main() {
  const args = process.argv.slice(2);

  let files = [];
  if (args.includes('--all')) {
    const postsDir = join(ROOT, 'src/content/posts');
    files = readdirSync(postsDir)
      .filter(f => f.endsWith('.mdx'))
      .sort()
      .map(f => join(postsDir, f));
  } else if (args.length > 0) {
    files = args.map(f => f.startsWith('/') ? f : join(ROOT, f));
  } else {
    console.error('Usage: node scripts/publish-wechat.mjs <file.mdx> [file2.mdx ...]');
    console.error('       node scripts/publish-wechat.mjs --all');
    process.exit(1);
  }

  console.log(`Publishing ${files.length} article(s) to WeChat draft...\n`);

  const token = await getAccessToken();
  console.log('Access token obtained.\n');

  for (const file of files) {
    const name = basename(file);
    console.log(`[${name}]`);

    try {
      const { title, description, cover, body } = parseMDX(file);
      console.log(`  Title: ${title}`);

      let thumbMediaId = '';
      if (cover) {
        thumbMediaId = await uploadImage(token, cover);
      } else {
        console.warn('  Warning: No cover image, using empty thumb');
      }

      const html = mdToWechatHtml(body);
      const draftId = await createDraft(token, { title, description, html, thumbMediaId });
      console.log(`  ✓ Draft created: media_id=${draftId}\n`);
    } catch (err) {
      console.error(`  ✗ Failed: ${err.message}\n`);
    }
  }

  console.log('Done.');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
