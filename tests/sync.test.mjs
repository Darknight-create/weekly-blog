import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { syncContent } from '../scripts/sync.mjs';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const note = (meta, body = '') => `---\ntitle: 测试\ndate: 2026-09-21\n${meta}\n---\n${body}`;
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'weekly-blog-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const vault = path.join(root, 'vault'), output = path.join(root, 'output');
  await fs.mkdir(path.join(vault, 'Weekly'), { recursive: true });
  await fs.mkdir(path.join(vault, 'Image'));
  return { vault, output, config: { vault, folder: 'Weekly', base: '/weekly-blog' }, write: (name, text) => fs.writeFile(path.join(vault, name), text), read: () => fs.readFile(path.join(output, 'content/posts.json'), 'utf8').then(JSON.parse) };
}
test('only explicitly published notes export; draft flags and private vault notes stay private', async t => {
  const f = await fixture(t);
  await f.write('Weekly/a.md', note('publish: true\nslug: a', '公开正文'));
  await f.write('Weekly/b.md', note('publish: false', '私密正文'));
  await f.write('Weekly/c.md', note('publish: "true"', '字符串不是发布开关'));
  await f.write('Weekly/d.md', note('publish: true\ndraft: true', '草稿'));
  await f.write('outside.md', note('publish: true', '目录外内容'));
  const report = await syncContent(f.config, f.output);
  assert.equal(report.published, 1); assert.equal(report.drafts, 3);
  assert.equal((await f.read())[0].html, '<p>公开正文</p>');
});
test('wiki images, standard images, links, headings and code are transformed correctly', async t => {
  const f = await fixture(t);
  await f.write('Image/photo.png', png);
  await f.write('Weekly/a.md', note('publish: true\nslug: a', '## 小标题\n\n![[photo.png|照片]]\n\n![图片](../Image/photo.png)\n\n[[b|另一篇]] 和 [[private|未公开]]\n\n一段可以用作摘要的正文 https://example.com/path，不应该把网址放进文章摘要。\n\n`![[missing.png]]`\n\n```js\n![[missing.png]]\n```\n\n```dataviewjs\nprivate note metadata\n```\n\n<script>alert(1)</script>'));
  await f.write('Weekly/b.md', note('publish: true\nslug: b', '另一篇'));
  const report = await syncContent(f.config, f.output); const a = (await f.read()).find(p => p.slug === 'a');
  assert.equal(report.images, 1); assert.match(a.html, /src="\/weekly-blog\/media\/[a-f0-9]+\.png"/);
  assert.match(a.html, /href="\/weekly-blog\/blog\/b\/"/); assert.match(a.html, /未公开/); assert.doesNotMatch(a.html, /<script/);
  assert.match(a.html, /<code>!\[\[missing.png\]\]<\/code>/); assert.equal(a.headings[0].id, '小标题');
  assert.doesNotMatch(a.html, /private note metadata/); assert.doesNotMatch(a.description, /https?:/);
  assert.match(a.cover, /^\/weekly-blog\/media\/[a-f0-9]+\.png$/);
});
test('missing attachments fail without damaging last successful content; unpublish removes content', async t => {
  const f = await fixture(t);
  await f.write('Weekly/a.md', note('publish: true\nslug: a', '原始正文'));
  await syncContent(f.config, f.output);
  await f.write('Weekly/a.md', note('publish: true\nslug: a', '![[missing.png]]'));
  await assert.rejects(syncContent(f.config, f.output), /找不到附件/);
  assert.match((await f.read())[0].html, /原始正文/);
  await f.write('Weekly/a.md', note('publish: false', '未发布'));
  await syncContent(f.config, f.output); assert.equal((await f.read()).length, 0);
});
test('duplicate slugs and invalid dates fail explicitly', async t => {
  const f = await fixture(t);
  await f.write('Weekly/a.md', note('publish: true\nslug: same'));
  await f.write('Weekly/b.md', note('publish: true\nslug: same'));
  await assert.rejects(syncContent(f.config, f.output), /重复文章地址/);
  await f.write('Weekly/b.md', '---\npublish: true\ndate: "2026-02-30"\n---\n');
  await assert.rejects(syncContent(f.config, f.output), /有效 date/);
});
test('attachment paths outside vault cannot be exported', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.vault, '../secret.png'), png);
  await f.write('Weekly/a.md', note('publish: true', '![](../../secret.png)'));
  await assert.rejects(syncContent(f.config, f.output), /找不到附件/);
});
