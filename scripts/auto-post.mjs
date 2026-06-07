#!/usr/bin/env node

/**
 * 自动科技资讯生成脚本
 * 1. 从 Hacker News + TechCrunch 抓取热门资讯
 * 2. 用 DeepSeek 挑选最有价值的一条并生成深度分析
 * 3. 写入 MDX 文件
 */

import { writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const AI_API_KEY = process.env.AI_API_KEY;
if (!AI_API_KEY) {
  console.error('Error: AI_API_KEY environment variable is required');
  process.exit(1);
}

// --- Fetch Hacker News top stories ---
async function fetchHackerNews() {
  console.log('Fetching Hacker News...');
  const res = await fetch('https://hacker-news.firebaseio.com/v0/topstories.json');
  const ids = await res.json();
  const top30 = ids.slice(0, 30);

  const stories = await Promise.all(
    top30.map(async (id) => {
      const r = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
      const item = await r.json();
      return { title: item.title, url: item.url || `https://news.ycombinator.com/item?id=${id}`, source: 'Hacker News' };
    })
  );
  return stories.filter((s) => s.title);
}

// --- Fetch TechCrunch RSS ---
async function fetchTechCrunch() {
  console.log('Fetching TechCrunch...');
  try {
    const res = await fetch('https://techcrunch.com/feed/');
    const xml = await res.text();
    const items = [];
    const regex = /<item>[\s\S]*?<title><!\[CDATA\[(.*?)\]\]><\/title>[\s\S]*?<link>(.*?)<\/link>/g;
    let match;
    while ((match = regex.exec(xml)) !== null && items.length < 10) {
      items.push({ title: match[1], url: match[2], source: 'TechCrunch' });
    }
    return items;
  } catch (e) {
    console.warn('TechCrunch fetch failed, skipping:', e.message);
    return [];
  }
}

// --- Call AI API (Anthropic format) ---
async function callAI(messages) {
  const systemMsg = messages.find((m) => m.role === 'system');
  const userMsgs = messages.filter((m) => m.role !== 'system');

  const body = {
    model: 'claude-haiku-4-5-20251001',
    messages: userMsgs,
    max_tokens: 4096,
    temperature: 0.7,
  };
  if (systemMsg) body.system = systemMsg.content;

  const res = await fetch('https://chat-ai.ctsdn.com:4346/anthropic/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': AI_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`AI API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.content[0].text;
}

// --- Main ---
async function main() {
  // 1. Fetch news
  const [hn, tc] = await Promise.all([fetchHackerNews(), fetchTechCrunch()]);
  const allNews = [...hn, ...tc];
  console.log(`Fetched ${allNews.length} stories total.`);

  if (allNews.length === 0) {
    console.error('No news fetched, aborting.');
    process.exit(1);
  }

  // 2. Ask DeepSeek to pick the most valuable story
  const newsList = allNews.map((n, i) => `${i + 1}. [${n.source}] ${n.title} — ${n.url}`).join('\n');

  const pickResponse = await callAI([
    {
      role: 'system',
      content:
        '你是一位资深科技编辑。从下面的新闻列表中，挑选出 1 条最有深度分析价值的科技新闻（优先选择 AI、开源、开发者工具、前沿技术相关）。只返回该新闻的编号和标题，格式：编号|标题|链接',
    },
    { role: 'user', content: newsList },
  ]);

  console.log('AI picked:', pickResponse.trim());

  // Parse pick
  const parts = pickResponse.trim().split('|');
  const pickedIndex = parseInt(parts[0]) - 1;
  const picked = allNews[pickedIndex] || allNews[0];
  console.log(`Selected: "${picked.title}" from ${picked.source}`);

  // 3. Generate article
  const today = process.env.OVERRIDE_DATE || new Date().toISOString().split('T')[0];

  const articleResponse = await callAI([
    {
      role: 'system',
      content: `你是一位专业的中文科技博主，擅长深度分析科技趋势。请根据给定的新闻写一篇 800-1200 字的中文深度分析文章。

要求：
- 标题要吸引人，体现深度观点（不要照搬原标题）
- 开头简述新闻事实
- 中间分析其背景、意义、影响
- 结尾给出你的观点或展望
- 语言流畅自然，适合中文博客读者
- 适当使用 Markdown 格式（## 小标题、**加粗**、列表等）

请严格按照以下格式输出（不要有多余内容）：

---TITLE---
文章标题
---DESCRIPTION---
一句话描述（50字以内）
---TAGS---
标签1, 标签2, 标签3
---CONTENT---
正文内容（Markdown格式）`,
    },
    {
      role: 'user',
      content: `新闻标题：${picked.title}\n来源：${picked.source}\n链接：${picked.url}\n\n请生成深度分析文章。`,
    },
  ]);

  // 4. Parse response
  const titleMatch = articleResponse.match(/---TITLE---\s*\n(.*)/);
  const descMatch = articleResponse.match(/---DESCRIPTION---\s*\n(.*)/);
  const tagsMatch = articleResponse.match(/---TAGS---\s*\n(.*)/);
  const contentMatch = articleResponse.match(/---CONTENT---\s*\n([\s\S]*)/);

  if (!titleMatch || !contentMatch) {
    console.error('Failed to parse AI response. Raw output:');
    console.error(articleResponse);
    process.exit(1);
  }

  const title = titleMatch[1].trim();
  const description = descMatch ? descMatch[1].trim() : title;
  const tags = tagsMatch
    ? tagsMatch[1]
        .split(/[,，]/)
        .map((t) => t.trim())
        .filter(Boolean)
    : ['科技', 'AI'];
  const content = contentMatch[1].trim();

  // 5. Write MDX file
  const filename = `${today}-tech-daily.mdx`;
  const filePath = join(ROOT, 'src/content/posts', filename);

  if (existsSync(filePath)) {
    console.log(`File ${filename} already exists, skipping.`);
    process.exit(0);
  }

  const mdx = `---
title: "${title.replace(/"/g, '\\"')}"
description: "${description.replace(/"/g, '\\"')}"
category: tech
tags: [${tags.map((t) => `"${t}"`).join(', ')}]
date: ${today}
draft: false
---

${content}

---

> 本文由 AI 根据 [${picked.source}](${picked.url}) 资讯自动生成，仅供参考。
`;

  writeFileSync(filePath, mdx, 'utf-8');
  console.log(`✓ Generated: ${filePath}`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
