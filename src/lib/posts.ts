import fs from 'node:fs';
import data from '../../content/posts.json';
export type Post = { slug: string; title: string; date: string; description: string; tags: string[]; html: string; minutes: number; headings: { id: string; text: string; depth: number }[]; cover?: string; example?: boolean };
const source = process.env.BLOG_PREVIEW === '1' ? JSON.parse(fs.readFileSync(new URL('../../.local/preview/content/posts.json', import.meta.url), 'utf8')) : data;
export const posts = (source as Post[]).sort((a, b) => b.date.localeCompare(a.date));
export const base = import.meta.env.BASE_URL.replace(/\/$/, '');
export const href = (path = '') => `${base}/${path.replace(/^\//, '')}`;
export const postHref = (post: Post) => href(`blog/${post.slug}/`);
export const dateLabel = (date: string) => new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Shanghai' }).format(new Date(`${date}T12:00:00+08:00`));
