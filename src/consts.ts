export const SITE = {
  title: '思想实验室',
  description: '生活记录、科技资讯、经济观察 — 一个人的思想实验室',
  author: 'Win',
  url: import.meta.env.SITE || 'https://my-blog.vercel.app',
  language: 'zh-CN',
};

export const CATEGORIES = {
  life: { label: '生活记录', description: '旅行、读书、日常思考' },
  tech: { label: '科技资讯', description: '工具评测、编程笔记、AI 观察' },
  economy: { label: '经济观察', description: '宏观分析、行业研究、数据解读' },
} as const;

export type Category = keyof typeof CATEGORIES;

// Configure at https://giscus.app — enable GitHub Discussions on your repo first
export const GISCUS = {
  enabled: Boolean(import.meta.env.PUBLIC_GISCUS_REPO),
  repo: import.meta.env.PUBLIC_GISCUS_REPO || '',
  repoId: import.meta.env.PUBLIC_GISCUS_REPO_ID || '',
  category: import.meta.env.PUBLIC_GISCUS_CATEGORY || 'Announcements',
  categoryId: import.meta.env.PUBLIC_GISCUS_CATEGORY_ID || '',
  mapping: 'pathname' as const,
  reactionsEnabled: true,
  emitMetadata: false,
  lang: 'zh-CN',
};

// Configure at https://umami.is — set PUBLIC_UMAMI_WEBSITE_ID in .env
export const UMAMI = {
  enabled: Boolean(import.meta.env.PUBLIC_UMAMI_WEBSITE_ID),
  websiteId: import.meta.env.PUBLIC_UMAMI_WEBSITE_ID || '',
  src: import.meta.env.PUBLIC_UMAMI_SRC || 'https://cloud.umami.is/script.js',
};
