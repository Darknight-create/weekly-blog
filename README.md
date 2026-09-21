# 日常之间

一个从 Obsidian `Weekly` 文件夹发布到 GitHub Pages 的免费个人博客。

## 写作与发布

文章继续写在 Obsidian 的 `Weekly` 文件夹中。只有满足以下条件的文件会发布：

```yaml
---
title: 文章标题
date: 2026-09-21
slug: weekly-001
description: 用一两句话介绍文章。
tags:
  - 周记
publish: true
---
```

- `publish: true` 才会进入博客。
- `draft: true` 会覆盖发布开关，文章仍保持草稿。
- `slug` 发布后不要修改，否则文章网址会改变。
- `description` 建议手动填写；未填写时会从正文生成干净摘要。
- `![[图片.png]]`、普通 Markdown 图片和已发布文章间的双链会自动转换。
- Dataview、Contribution Graph 等 Obsidian 插件代码不会上传到正文。

在 Obsidian 命令面板运行“博客发布：标记当前文章为发布并同步”，即可补齐必要属性并发布。插件会优先读取系统钥匙串里的 GitHub 登录；设置中的临时 token 只作为备用，且不会保存。

## 本地验证

```bash
pnpm test
node scripts/prepare-preview.mjs
BLOG_PREVIEW=1 pnpm dev
```

本地预览会显示 `Weekly` 里的全部 Markdown，方便排版检查；正式同步严格遵守 `publish: true`。

## 首次上线

1. 在 GitHub 新建公开仓库 `weekly-blog`。
2. 把本项目上传到仓库的 `main` 分支。
3. 创建 `gh-pages` 分支，并在仓库 Settings → Pages 中选择该分支的根目录。
4. 创建仅授权该仓库、权限为 `Contents: Read and write` 的 fine-grained token。
5. 在 Obsidian 设置 → 博客发布中临时填写 token。插件会在本机生成静态网页，并直接更新 `gh-pages` 分支。

网站地址将是 `https://darknight-create.github.io/weekly-blog/`。日后可免费继续使用这个地址，也可以另购独立域名。
