// Native Zotero preference pane. The shared controller is removed on shutdown.
var BilingualPreferences = {
  id: 'bilingual-metadata-preferences',
  async start(plugin) {
    this.plugin = plugin;
    try {
      await Zotero.PreferencePanes.register({
        pluginID: 'bilingual-metadata@damao', id: this.id,
        label: '双语引用', src: 'src/preferences.xhtml',
        image: 'icon-48.png', scripts: ['src/preferencesPane.js']
      });
    } catch (e) {
      throw e;
    }
  },
  stop() {
    Zotero.PreferencePanes.unregister(this.id);
    this.plugin = null;
  },
  mainWindow() {
    const w = Zotero.getMainWindows().find(w => !w.closed && w.ZoteroPane);
    if (!w) throw Error('请先打开 Zotero 主窗口，再执行此操作。');
    return w;
  },
  async styles() {
    await Zotero.Styles.init();
    return Zotero.Styles.getVisible().filter(s => s.getXML().includes(BilingualStyleAdapter.marker))
      .map(s => ({title: s.title, id: s.styleID})).sort((a,b) => a.title.localeCompare(b.title));
  },
  async init(w) {
    const d = w.document, el = id => d.getElementById('bilingual-pref-' + id);
    const plugin = this.plugin;
    const status = el('status');
    const report = error => {
      Zotero.logError(error);
      status.textContent = '操作失败：' + (error.message || String(error));
    };
    const refresh = async () => {
      const styles = await this.styles();
      const list = el('styles');
      list.replaceChildren();
      for (const style of styles) {
        const row = d.createElementNS('http://www.w3.org/1999/xhtml','li');
        row.textContent = style.title;
        row.setAttribute('title',style.id);
        list.appendChild(row);
      }
      el('empty').hidden = styles.length > 0;
      el('count').textContent = `已安装的关联双语样式（${styles.length}）`;
      el('bridge').textContent = BilingualLinkedCitations.installed
        ? '关联引用已启动。引用中文原条目时，新样式会读取与它关联的英文条目。'
        : '关联引用尚未启动，请重启 Zotero 并检查错误日志。';
    };
    const bind = (id, task) => {
      const button = el(id);
      button.addEventListener('command', async () => {
        if (!this.plugin) { status.textContent = '插件已停用，请关闭设置页。'; return; }
        button.disabled = true;
        status.textContent = '正在处理…';
        try { await task(); status.textContent = '操作完成。'; }
        catch (e) { report(e); }
        finally { button.disabled = false; }
      });
    };
    el('roots').value = Zotero.Prefs.get(plugin.configKey,true) || '';
    bind('create',async () => { await BilingualStyleAdapter.run(this.mainWindow(),plugin); await refresh(); });
    bind('refresh',refresh);
    bind('save-roots',async () => {
      const roots = el('roots').value.split('|').map(s=>s.trim()).filter(Boolean);
      Zotero.Prefs.set(plugin.configKey,[...new Set(roots)].join('|'),true);
      el('roots').value = Zotero.Prefs.get(plugin.configKey,true) || '';
    });
    bind('index',async () => {
      if (el('roots').value.trim() !== (Zotero.Prefs.get(plugin.configKey,true) || '')) {
        throw Error('目录有未保存的修改，请先点击“保存目录”。');
      }
      await plugin.refreshIndex(w);
    });
    try { await refresh(); } catch (e) { report(e); }
  }
};
