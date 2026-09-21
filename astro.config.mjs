import { defineConfig } from 'astro/config';
export default defineConfig({
  site: process.env.SITE_URL || 'https://darknight-create.github.io',
  base: process.env.BASE_PATH || '/weekly-blog',
  output: 'static',
  trailingSlash: 'always',
  publicDir: process.env.BLOG_PREVIEW === '1' ? './.local/preview/public' : './public',
});
