import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import { SITE, CATEGORIES } from '../consts';

export async function GET(context) {
  const posts = (await getCollection('posts'))
    .filter((post) => !post.data.draft)
    .sort((a, b) => b.data.date.getTime() - a.data.date.getTime());

  return rss({
    title: SITE.title,
    description: SITE.description,
    site: context.site,
    items: posts.map((post) => ({
      title: post.data.title,
      pubDate: post.data.date,
      description: post.data.description,
      link: `/posts/${post.id}/`,
      categories: [CATEGORIES[post.data.category].label],
    })),
    customData: `<language>${SITE.language}</language>`,
  });
}
