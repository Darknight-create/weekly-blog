const { Plugin, PluginSettingTab, Setting, Notice } = require('obsidian');
const { execFile } = require('child_process');
const path = require('path');
const defaults = { project: '', node: '', git: '', auto: false };
module.exports = class BlogPublisher extends Plugin {
  async onload() {
    this.settings = Object.assign({}, defaults, await this.loadData());
    this.token = ''; this.busy = false;
    this.addRibbonIcon('upload', '同步博客中已标记发布的文章', () => this.publish());
    this.addCommand({ id: 'publish-marked', name: '同步所有已标记发布的文章', callback: () => this.publish() });
    this.addCommand({ id: 'publish-current', name: '标记当前文章为发布并同步', callback: async () => {
      const file = this.app.workspace.getActiveFile();
      if (!file || !file.path.startsWith('Weekly/') || file.extension !== 'md') return new Notice('请先打开 Weekly 文件夹中的 Markdown 文章。');
      await this.app.fileManager.processFrontMatter(file, data => {
        data.publish = true;
        if (!data.title) data.title = file.basename;
        if (!data.date) data.date = new Date().toLocaleDateString('sv-SE');
        if (!data.slug) data.slug = 'post-' + require('crypto').createHash('sha256').update(file.path.slice('Weekly/'.length)).digest('hex').slice(0, 12);
      });
      await this.publish();
    }});
    this.addSettingTab(new BlogSettings(this.app, this));
    this.registerInterval(window.setInterval(() => { if (this.settings.auto) this.publish(true); }, 180000));
  }
  async publish(quiet = false) {
    if (this.busy) return quiet ? undefined : new Notice('正在发布，请稍候。');
    if (!this.settings.project || !this.settings.node) return new Notice('请先填写博客项目路径和 Node 路径。');
    this.busy = true;
    if (!quiet) new Notice('正在同步文章与图片…');
    execFile(this.settings.node, [path.join(this.settings.project, 'scripts/publish.mjs')], { cwd: this.settings.project, env: { ...process.env, BLOG_GITHUB_TOKEN: this.token.trim(), BLOG_GIT_EXECUTABLE: this.settings.git }, timeout: 240000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      this.busy = false;
      if (error) return new Notice(`博客发布失败：${stderr || error.message}`, 15000);
      if (!quiet || !stdout.includes('无需发布')) new Notice(stdout.trim(), 12000);
    });
  }
};
class BlogSettings extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    const { containerEl } = this; containerEl.empty();
    containerEl.createEl('h2', { text: '博客发布' });
    containerEl.createEl('p', { text: '只同步 Weekly 中 publish: true 且 draft 不为 true 的文章。图片随文章一起上传。' });
    new Setting(containerEl).setName('项目文件夹').addText(text => text.setValue(this.plugin.settings.project).onChange(async value => { this.plugin.settings.project = value; await this.plugin.saveData(this.plugin.settings); }));
    new Setting(containerEl).setName('Node 可执行文件').addText(text => text.setValue(this.plugin.settings.node).onChange(async value => { this.plugin.settings.node = value; await this.plugin.saveData(this.plugin.settings); }));
    new Setting(containerEl).setName('Git 可执行文件').setDesc('用于读取系统钥匙串中的 GitHub 登录。').addText(text => text.setValue(this.plugin.settings.git).onChange(async value => { this.plugin.settings.git = value; await this.plugin.saveData(this.plugin.settings); }));
    new Setting(containerEl).setName('备用 GitHub token').setDesc('通常留空即可。仅在系统凭据不可用时，临时填写仓库 Contents: Read and write token；不会保存。').addText(text => { text.inputEl.type = 'password'; text.setValue(this.plugin.token).onChange(value => this.plugin.token = value); });
    new Setting(containerEl).setName('自动同步').setDesc('开启后，每 3 分钟检查并发布已标记的文章。').addToggle(toggle => toggle.setValue(this.plugin.settings.auto).onChange(async value => { this.plugin.settings.auto = value; await this.plugin.saveData(this.plugin.settings); }));
    new Setting(containerEl).setName('发布已标记文章').addButton(button => button.setButtonText('立即同步').onClick(() => this.plugin.publish()));
  }
}
