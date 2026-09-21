import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { syncContent, projectRoot } from './sync.mjs';

const token = process.env.BLOG_GITHUB_TOKEN;
if (!token) { console.error('请在 Obsidian 的「博客发布」设置中填写 GitHub token，再发布。'); process.exit(1); }
const config = JSON.parse(await fs.readFile(path.join(projectRoot, 'sync.local.json'), 'utf8'));
if (!/^[\w.-]+\/[\w.-]+$/.test(config.repository || '')) throw new Error('repository 必须是 owner/repo。');
const lockDir = path.join(projectRoot, '.local/publish.lock');
await fs.mkdir(path.dirname(lockDir), { recursive: true });
try { await fs.mkdir(lockDir); } catch { console.error('另一个发布任务正在运行。若此前异常退出，可删除项目 .local/publish.lock 空目录后重试。'); process.exit(1); }
async function api(route, method = 'GET', data) {
  const response = await fetch(`https://api.github.com/repos/${config.repository}/${route}`, { method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' }, body: data ? JSON.stringify(data) : undefined, signal: AbortSignal.timeout(60000) });
  if (!response.ok) { let detail; try { detail = (await response.json()).message; } catch {} throw new Error(`GitHub ${response.status}: ${detail || '发布失败，请检查网络和仓库权限。'}`); }
  return response.json();
}
async function buildSite() {
  const astro = path.join(projectRoot, 'node_modules/astro/astro.js');
  const { BLOG_GITHUB_TOKEN: _token, ...safeEnv } = process.env;
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [astro, 'build'], {
      cwd: projectRoot,
      stdio: 'inherit',
      env: {
        ...safeEnv,
        ASTRO_TELEMETRY_DISABLED: '1',
        SITE_URL: 'https://darknight-create.github.io',
        BASE_PATH: '/weekly-blog',
      },
    });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`网页构建失败，退出码 ${code}。`)));
  });
  await fs.writeFile(path.join(projectRoot, 'dist/.nojekyll'), '');
}
async function collectFiles(root, relative = '') {
  const files = new Map();
  for (const entry of await fs.readdir(path.join(root, relative), { withFileTypes: true })) {
    const name = path.posix.join(relative, entry.name);
    if (entry.isDirectory()) {
      for (const [childName, bytes] of await collectFiles(root, name)) files.set(childName, bytes);
    } else if (entry.isFile()) files.set(name, await fs.readFile(path.join(root, name)));
  }
  return files;
}
async function updateBranch(branch, files, message, shouldDelete = () => false) {
  const ref = await api(`git/ref/heads/${branch}`);
  const head = await api(`git/commits/${ref.object.sha}`);
  const tree = await api(`git/trees/${head.tree.sha}?recursive=1`);
  if (tree.truncated) throw new Error(`${branch} 分支目录过大，停止发布以避免误处理文件。`);
  const changed = [];
  for (const [name, bytes] of files) {
    const sha = crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    if (tree.tree.find(entry => entry.path === name)?.sha === sha) continue;
    const blob = await api('git/blobs', 'POST', { content: bytes.toString('base64'), encoding: 'base64' });
    changed.push({ path: name, mode: '100644', type: 'blob', sha: blob.sha });
  }
  for (const entry of tree.tree) {
    if (entry.type === 'blob' && !files.has(entry.path) && shouldDelete(entry.path)) {
      changed.push({ path: entry.path, mode: '100644', type: 'blob', sha: null });
    }
  }
  if (!changed.length) return false;
  const nextTree = await api('git/trees', 'POST', { base_tree: head.tree.sha, tree: changed });
  const commit = await api('git/commits', 'POST', { message, tree: nextTree.sha, parents: [ref.object.sha] });
  await api(`git/refs/heads/${branch}`, 'PATCH', { sha: commit.sha, force: false });
  return true;
}
try {
  const report = await syncContent(config);
  const files = new Map();
  files.set('content/posts.json', await fs.readFile(path.join(projectRoot, 'content/posts.json')));
  for (const name of await fs.readdir(path.join(projectRoot, 'public/media'))) files.set(`public/media/${name}`, await fs.readFile(path.join(projectRoot, 'public/media', name)));
  const sourceUpdated = await updateBranch(
    'main',
    files,
    `Publish ${report.published} articles from Obsidian`,
    name => /^public\/media\/[a-f0-9]{24}\.(png|jpe?g|webp|gif|avif)$/.test(name),
  );
  await buildSite();
  const siteUpdated = await updateBranch(
    'gh-pages',
    await collectFiles(path.join(projectRoot, 'dist')),
    `Deploy ${report.published} articles from Obsidian`,
    name => name !== 'CNAME',
  );
  if (!sourceUpdated && !siteUpdated) console.log('文章和网页均没有变化，无需发布。');
  else console.log(`已发布 ${report.published} 篇文章、${report.images} 张图片：https://darknight-create.github.io/weekly-blog/`);
  for (const warning of report.warnings) console.log(warning);
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { await fs.rmdir(lockDir); }
