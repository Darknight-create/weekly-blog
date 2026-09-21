import { posts, postHref } from '../lib/posts';
import config from '../../site.config.json';
const xml = (value: string) => value.replace(/[<>&"']/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[ch]!));
export function GET({ site }: { site: URL }) {
  const items = posts.filter(p => !p.example).map(p => { const url = new URL(postHref(p), site).href; return `<item><title>${xml(p.title)}</title><link>${url}</link><guid>${url}</guid><pubDate>${new Date(p.date + 'T12:00:00+08:00').toUTCString()}</pubDate><description>${xml(p.description)}</description></item>`; }).join('');
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${xml(config.title)}</title><link>${new URL(import.meta.env.BASE_URL, site).href}</link><description>${xml(config.description)}</description><language>zh-cn</language>${items}</channel></rss>`, { headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' } });
}
