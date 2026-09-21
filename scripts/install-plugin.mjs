import fs from 'node:fs/promises';
import path from 'node:path';
import { projectRoot } from './sync.mjs';

const config = JSON.parse(await fs.readFile(path.join(projectRoot, 'sync.local.json'), 'utf8'));
const target = path.join(config.vault, '.obsidian/plugins/weekly-blog-publisher');
await fs.mkdir(target, { recursive: true });
await Promise.all(['main.js', 'manifest.json'].map(file => fs.copyFile(path.join(projectRoot, 'obsidian-plugin', file), path.join(target, file))));
let saved = {};
try { saved = JSON.parse(await fs.readFile(path.join(target, 'data.json'), 'utf8')); } catch {}
await fs.writeFile(path.join(target, 'data.json'), JSON.stringify({
  ...saved,
  project: projectRoot.replace(/\/$/, ''),
  node: process.execPath,
  git: config.git || saved.git || '',
  auto: saved.auto || false
}, null, 2) + '\n');
console.log(`插件已安装到 ${target}`);
