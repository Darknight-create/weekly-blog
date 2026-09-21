import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import matter from 'gray-matter';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeSanitize from 'rehype-sanitize';
import rehypeSlug from 'rehype-slug';
import rehypeStringify from 'rehype-stringify';
import { visit } from 'unist-util-visit';

export const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const inside = (root, target) => target === root || target.startsWith(root + path.sep);
const imageExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif']);
const textContent = node => node.value || (node.children || []).map(textContent).join('');
const cleanExcerpt = tree => {
  const paragraphs = [];
  visit(tree, 'paragraph', node => {
    const text = textContent(node).replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim();
    if (text.length >= 12 && !node.children?.every(child => child.type === 'image')) paragraphs.push(text);
  });
  const excerpt = paragraphs.join(' ').slice(0, 112).trim();
  return excerpt && !/[。！？!?]$/.test(excerpt) ? `${excerpt}…` : excerpt;
};

async function walk(root) {
  const files = [];
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...await walk(target));
    else if (entry.isFile()) files.push(target);
  }
  return files;
}

function dateValue(value, file) {
  const date = value instanceof Date ? value.toISOString().slice(0, 10) : String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) {
    throw new Error(`${path.basename(file)}：请填写有效 date，例如 2026-09-21。`);
  }
  return date;
}

export async function syncContent(config, outputRoot = projectRoot, { preview = false } = {}) {
  const vault = await fs.realpath(config.vault);
  const folder = await fs.realpath(path.resolve(vault, config.folder));
  if (!inside(vault, folder)) throw new Error('文章目录必须位于指定 Obsidian 库中。');
  const base = String(config.base || '').replace(/\/$/, '');
  if (base && !/^\/[a-zA-Z0-9/_-]+$/.test(base)) throw new Error('base 路径无效。');
  const allFiles = await walk(vault);
  const candidates = allFiles.filter(file => inside(folder, file) && file.endsWith('.md'));
  const articles = [];
  for (const file of candidates) {
    const parsed = matter(await fs.readFile(file, 'utf8'));
    if (!preview && (parsed.data.publish !== true || parsed.data.draft === true)) continue;
    const title = String(parsed.data.title || path.basename(file, '.md')).trim();
    const slug = String(parsed.data.slug || `post-${digest(path.relative(folder, file)).slice(0, 12)}`);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(slug)) throw new Error(`${title}：slug 只能包含英文字母、数字、短横线或下划线。`);
    if (articles.some(p => p.slug === slug)) throw new Error(`重复文章地址：${slug}`);
    const date = parsed.data.date || (preview ? (await fs.stat(file)).birthtime.toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' }) : undefined);
    articles.push({ file, title, slug, body: parsed.content, data: parsed.data, date: dateValue(date, file) });
  }
  const assets = new Map();
  const warnings = new Set();

  async function resolveFile(target, current) {
    let decoded;
    try { decoded = decodeURIComponent(target); } catch { decoded = target; }
    decoded = decoded.replace(/^<|>$/g, '');
    const exact = [path.resolve(path.dirname(current), decoded), path.resolve(vault, decoded.replace(/^\//, ''))];
    for (const candidate of exact) {
      if (!inside(vault, candidate)) continue;
      try { const real = await fs.realpath(candidate); if (inside(vault, real) && (await fs.stat(real)).isFile()) return real; } catch {}
    }
    const matches = allFiles.filter(file => path.basename(file) === decoded || path.relative(vault, file).split(path.sep).join('/') === decoded);
    if (matches.length > 1) throw new Error(`附件重名，请使用完整库内路径：${target}`);
    if (matches.length === 1) return matches[0];
    throw new Error(`${path.basename(current)}：找不到附件 ${target}`);
  }

  async function mediaUrl(target, current) {
    if (/^https?:\/\//i.test(target)) return target;
    const resolved = await resolveFile(target, current);
    const ext = path.extname(resolved).toLowerCase();
    if (!imageExtensions.has(ext)) throw new Error(`暂不支持附件格式 ${ext}：${path.basename(resolved)}。支持 PNG/JPG/WebP/GIF/AVIF。`);
    const bytes = await fs.readFile(resolved);
    const filename = `${digest(bytes).slice(0, 24)}${ext}`;
    assets.set(filename, bytes);
    return `${base}/media/${filename}`;
  }

  function findArticle(target, current) {
    const clean = target.replace(/\.md$/i, '');
    const absolute = path.resolve(path.dirname(current), clean + '.md');
    const direct = articles.find(a => a.file === absolute || path.relative(vault, a.file).replace(/\.md$/, '') === clean);
    if (direct) return direct;
    const matches = articles.filter(a => path.basename(a.file, '.md') === clean || a.title === clean || a.slug === clean);
    if (matches.length > 1) throw new Error(`双链重名，请写完整路径：${target}`);
    return matches[0];
  }

  const posts = [];
  for (const article of articles) {
    const parser = unified().use(remarkParse).use(remarkGfm);
    const tree = parser.parse(article.body.replace(/%%[\s\S]*?%%/g, ''));
    const jobs = [];
    function transform(parent) {
      if (!parent.children || ['code', 'inlineCode', 'link', 'image'].includes(parent.type)) return;
      parent.children = parent.children.flatMap(node => {
        if (node.type !== 'text') { transform(node); return [node]; }
        const result = []; let cursor = 0;
        for (const match of node.value.matchAll(/(!?)\[\[([^\]]+)\]\]/g)) {
          if (match.index > cursor) result.push({ type: 'text', value: node.value.slice(cursor, match.index) });
          const [targetWithHash, label] = match[2].split('|');
          const hashAt = targetWithHash.indexOf('#');
          const target = hashAt < 0 ? targetWithHash : targetWithHash.slice(0, hashAt);
          const heading = hashAt < 0 ? '' : targetWithHash.slice(hashAt + 1);
          if (match[1]) {
            const image = { type: 'image', url: '', alt: label && !/^\d+(x\d+)?$/.test(label) ? label : path.basename(target, path.extname(target)) };
            jobs.push(mediaUrl(target, article.file).then(url => image.url = url));
            result.push(image);
          } else {
            const linked = target ? findArticle(target, article.file) : article;
            if (linked) result.push({ type: 'link', url: `${base}/blog/${linked.slug}/${heading ? '#' + encodeURIComponent(heading.toLowerCase().replace(/\s+/g, '-')) : ''}`, children: [{ type: 'text', value: label || target || heading }] });
            else { result.push({ type: 'text', value: label || target }); warnings.add(`未发布的双链保留为文字：${target}`); }
          }
          cursor = match.index + match[0].length;
        }
        if (cursor < node.value.length) result.push({ type: 'text', value: node.value.slice(cursor) });
        return result.length ? result : [node];
      });
    }
    // Existing Markdown images are resolved before wikilinks insert their image nodes.
    visit(tree, 'image', node => jobs.push(mediaUrl(node.url, article.file).then(url => node.url = url)));
    visit(tree, 'link', node => {
      if (!/^(https?:|mailto:|#)/i.test(node.url) && /\.md(?:#|$)/i.test(node.url)) {
        const [target, fragment] = decodeURIComponent(node.url).split('#');
        const linked = findArticle(target, article.file);
        if (linked) node.url = `${base}/blog/${linked.slug}/${fragment ? '#' + encodeURIComponent(fragment) : ''}`;
        else { node.type = 'text'; node.value = textContent(node); delete node.children; delete node.url; }
      }
    });
    visit(tree, 'code', (node, index, parent) => {
      if (!['dataview', 'dataviewjs', 'contributionGraph'].includes(node.lang)) return;
      warnings.add(`${article.title}：已从网页中隐藏 ${node.lang} 插件代码。`);
      if (parent && typeof index === 'number') parent.children.splice(index, 1);
    });
    transform(tree);
    await Promise.all(jobs);
    let cover;
    visit(tree, 'image', node => { if (!cover) cover = node.url; });
    const headings = [];
    const renderer = unified().use(remarkRehype).use(rehypeSanitize).use(rehypeSlug).use(() => tree => {
      visit(tree, 'element', node => {
        if (/^h[23]$/.test(node.tagName)) headings.push({ id: node.properties.id, text: textContent(node), depth: Number(node.tagName[1]) });
        if (node.tagName === 'img') { node.properties.loading = 'lazy'; node.properties.decoding = 'async'; }
      });
    }).use(rehypeStringify);
    const html = renderer.stringify(await renderer.run(tree));
    const plain = textContent(tree).replace(/\s+/g, ' ').trim();
    posts.push({ slug: article.slug, title: article.title, date: article.date, description: String(article.data.description || cleanExcerpt(tree) || '一篇新的记录。'), tags: (Array.isArray(article.data.tags) ? article.data.tags : []).map(String), html, headings, minutes: Math.max(1, Math.ceil(plain.length / 450)), cover });
  }
  posts.sort((a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug));
  // Validate every note and image before replacing the previous successful export.
  const media = path.join(outputRoot, 'public/media');
  await fs.mkdir(media, { recursive: true });
  await fs.mkdir(path.join(outputRoot, 'content'), { recursive: true });
  for (const [filename, bytes] of assets) await fs.writeFile(path.join(media, filename), bytes);
  const manifest = JSON.stringify(posts, null, 2) + '\n';
  const temp = path.join(outputRoot, 'content/posts.json.tmp');
  await fs.writeFile(temp, manifest);
  await fs.rename(temp, path.join(outputRoot, 'content/posts.json'));
  for (const entry of await fs.readdir(media)) if (/^[a-f0-9]{24}\.(png|jpe?g|webp|gif|avif)$/.test(entry) && !assets.has(entry)) await fs.unlink(path.join(media, entry));
  return { published: posts.length, drafts: candidates.length - posts.length, images: assets.size, warnings: [...warnings] };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { const config = JSON.parse(await fs.readFile(path.join(projectRoot, 'sync.local.json'), 'utf8')); console.log(JSON.stringify(await syncContent(config), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
