import fs from 'node:fs/promises';
import path from 'node:path';
import { projectRoot, syncContent } from './sync.mjs';
const config = JSON.parse(await fs.readFile(path.join(projectRoot, 'sync.local.json'), 'utf8'));
const output = path.join(projectRoot, '.local/preview');
const report = await syncContent(config, output, { preview: true });
await fs.copyFile(path.join(projectRoot, 'public/favicon.svg'), path.join(output, 'public/favicon.svg'));
console.log('仅本地预览，未标记文章不会上传：', report);
