#!/usr/bin/env node

/**
 * 微信公众号发布脚本
 * 将博客 MDX 文章发布到公众号草稿箱
 *
 * 用法:
 *   node scripts/publish-wechat.mjs src/content/posts/2026-06-06-tech-daily.mdx
 *   node scripts/publish-wechat.mjs --all
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname, basename, extname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// Node's bundled CA roots can't verify the WeChat API cert chain (DigiCert
// intermediate missing), so reuse the OS bundle that curl/openssl trusts. This
// var must be set before TLS init, so re-exec ourselves with it if absent.
// Path differs by OS: macOS uses /etc/ssl/cert.pem, Debian/Ubuntu ca-certificates.
const SYSTEM_CA = ['/etc/ssl/cert.pem', '/etc/ssl/certs/ca-certificates.crt', '/etc/pki/tls/certs/ca-bundle.crt'].find(p => existsSync(p));
if (!process.env.NODE_EXTRA_CA_CERTS && SYSTEM_CA) {
  const { spawnSync } = await import('child_process');
  const { status } = spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, NODE_EXTRA_CA_CERTS: SYSTEM_CA },
  });
  process.exit(status ?? 0);
}

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

// --- Resolve a local image path (e.g. /images/x.png) to a file on disk ---
function resolveLocal(src) {
  const rel = src.replace(/^\//, '');
  for (const p of [join(ROOT, 'public', rel), join(ROOT, rel)]) {
    if (existsSync(p)) return p;
  }
  return null;
}

// --- Get an upload-ready JPEG buffer (downloads remote, compresses via sips) ---
// WeChat in-article images are limited to ~1MB, so we resize to <=1080px JPEG.
function prepareImage(src) {
  let inputPath;
  if (/^https?:\/\//.test(src)) {
    inputPath = `/tmp/wx-src-${Math.random().toString(36).slice(2)}`;
    execSync(`curl -sL "${src}" -o "${inputPath}" --max-time 20`);
  } else {
    inputPath = resolveLocal(src);
    if (!inputPath) throw new Error(`本地图片不存在: ${src}`);
  }
  const out = `/tmp/wx-opt-${Math.random().toString(36).slice(2)}.jpg`;
  // macOS sips, then ImageMagick (Linux servers), then raw bytes as last resort.
  for (const cmd of [
    `sips -Z 1080 -s format jpeg -s formatOptions 72 "${inputPath}" --out "${out}"`,
    `magick "${inputPath}" -resize "1080x1080>" -quality 72 "${out}"`,
    `convert "${inputPath}" -resize "1080x1080>" -quality 72 "${out}"`,
  ]) {
    try {
      execSync(cmd, { stdio: 'ignore' });
      return { buffer: readFileSync(out), filename: 'image.jpg' };
    } catch { /* tool unavailable — try next */ }
  }
  // No image tool available (e.g. minimal server): use raw bytes. Fine for
  // remote covers already sized <=1MB, but very large local images may be rejected.
  return { buffer: readFileSync(inputPath), filename: 'image' + (extname(inputPath) || '.jpg') };
}

// --- Generic multipart upload to a WeChat endpoint ---
async function wxUpload(url, buffer, filename) {
  const boundary = '----WK' + Math.random().toString(36).slice(2);
  const header = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="media"; filename="${filename}"\r\n` +
    `Content-Type: image/jpeg\r\n\r\n`
  );
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([header, buffer, footer]);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    body,
  });
  const data = await res.json();
  if (data.errcode) throw new Error(`${data.errcode} ${data.errmsg}`);
  return data;
}

// --- Upload cover as permanent material, returns media_id (for thumb) ---
async function uploadCover(token, src) {
  console.log(`  Preparing cover (${src})...`);
  const { buffer, filename } = prepareImage(src);
  const data = await wxUpload(`${WX_API}/material/add_material?access_token=${token}&type=image`, buffer, filename);
  console.log(`  Cover uploaded: media_id=${data.media_id}`);
  return data.media_id;
}

// --- Upload an in-article image, returns a WeChat-hosted URL ---
async function uploadContentImage(token, src) {
  const { buffer, filename } = prepareImage(src);
  const data = await wxUpload(`${WX_API}/media/uploadimg?access_token=${token}`, buffer, filename);
  return data.url;
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
// imgMap maps original markdown image src -> WeChat-hosted URL
function mdToWechatHtml(md, imgMap = {}) {
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

  // Images — extract before links/paragraphs; swap src for WeChat-hosted URL
  const images = [];
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, src) => {
    const url = imgMap[src] || src;
    const placeholder = `__IMG_${images.length}__`;
    const caption = alt ? `<br><span style="color:#888;font-size:13px;">${alt}</span>` : '';
    images.push(`<p style="text-align:center;margin:18px 0;"><img src="${url}" alt="${alt}" style="max-width:100%;border-radius:8px;"/>${caption}</p>`);
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

  // Restore code blocks, images, and inline code
  codeBlocks.forEach((block, i) => {
    html = html.replace(`__CODE_BLOCK_${i}__`, block);
  });
  images.forEach((img, i) => {
    html = html.replace(`__IMG_${i}__`, img);
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
        // WeChat digest 上限约 120 字，超出会报 45004，这里截断
        digest: article.description.length > 110
          ? article.description.slice(0, 109) + '…'
          : article.description,
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

// --- Publish ledger: records which posts have already been pushed to WeChat,
//     so `--new` only publishes newly-added posts (and never re-publishes). ---
const LEDGER = join(ROOT, '.wechat-published.json');

function loadLedger() {
  if (!existsSync(LEDGER)) return null;
  try {
    const data = JSON.parse(readFileSync(LEDGER, 'utf-8'));
    return data.published ? data : { published: {} };
  } catch {
    return { published: {} };
  }
}

function saveLedger(ledger) {
  writeFileSync(LEDGER, JSON.stringify(ledger, null, 2) + '\n');
}

// --- Main ---
async function main() {
  const args = process.argv.slice(2);
  const postsDir = join(ROOT, 'src/content/posts');

  let files = [];
  let ledger = null; // non-null only in --new mode; records successes as we go
  if (args.includes('--new')) {
    ledger = loadLedger();
    const allPosts = readdirSync(postsDir).filter(f => f.endsWith('.mdx')).sort();
    if (ledger === null) {
      // No ledger yet: refuse to mass-publish every existing post. Seed a
      // baseline of current posts and exit; later runs publish only new ones.
      saveLedger({ published: Object.fromEntries(allPosts.map(f => [f, { seeded: true }])) });
      console.log(`No ledger found — seeded baseline with ${allPosts.length} existing post(s) WITHOUT publishing.`);
      console.log('Add a new post and re-run to auto-publish it.');
      return;
    }
    files = allPosts.filter(f => !ledger.published[f]).map(f => join(postsDir, f));
    if (files.length === 0) {
      console.log('No new posts to publish.');
      return;
    }
  } else if (args.includes('--all')) {
    files = readdirSync(postsDir)
      .filter(f => f.endsWith('.mdx'))
      .sort()
      .map(f => join(postsDir, f));
  } else if (args.length > 0) {
    files = args.map(f => f.startsWith('/') ? f : join(ROOT, f));
  } else {
    console.error('Usage: node scripts/publish-wechat.mjs <file.mdx> [file2.mdx ...]');
    console.error('       node scripts/publish-wechat.mjs --all');
    console.error('       node scripts/publish-wechat.mjs --new   (publish posts not yet in the ledger)');
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
        thumbMediaId = await uploadCover(token, cover);
      } else {
        console.warn('  Warning: No cover image, using empty thumb');
      }

      // Upload every inline image and map its src -> WeChat-hosted URL
      const imgMap = {};
      const srcs = [...new Set([...body.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map(m => m[1]))];
      for (const src of srcs) {
        try {
          console.log(`  Uploading inline image: ${src}`);
          imgMap[src] = await uploadContentImage(token, src);
        } catch (e) {
          console.warn(`  ! inline image failed (${src}): ${e.message} — keeping original`);
          imgMap[src] = src;
        }
      }

      const html = mdToWechatHtml(body, imgMap);
      const draftId = await createDraft(token, { title, description, html, thumbMediaId });
      console.log(`  ✓ Draft created: media_id=${draftId}\n`);
      if (ledger) {
        // Persist after each success so a mid-batch failure won't re-publish earlier ones.
        ledger.published[name] = { at: new Date().toISOString(), draftId };
        saveLedger(ledger);
      }
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
