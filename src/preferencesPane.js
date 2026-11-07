var BilingualPreferencesPane = {
  busy: false,
  element(w, name) { return w.document.getElementById('bilingual-pref-' + name); },
  mainWindow() {
    const w=Zotero.getMainWindows().find(win=>!win.closed&&win.ZoteroPane);
    if(!w||!w.BilingualPlugin||!w.BilingualStyleAdapter)throw Error('插件主程序尚未就绪，请重启 Zotero 后重试。');
    return w;
  },
  async init(w) {
    try {
      this.refresh(w);
      this.element(w,'roots').value=Zotero.Prefs.get('extensions.bilingual-metadata.roots',true)||'';
      this.element(w,'bridge').textContent=this.mainWindow().BilingualLinkedCitations?.installed
        ?'关联引用已启动。引用中文原条目时，新样式会读取与它关联的英文条目。'
        :'关联引用尚未启动，请重启 Zotero 并检查错误日志。';
    } catch(e) { this.report(w,e); }
  },
  report(w,error) { Zotero.logError(error);this.element(w,'status').textContent='操作失败：'+(error.message||String(error)); },
  refresh(w) {
    const styles=Zotero.Styles.getVisible().filter(s=>s.getXML().includes('bilingual-linked-')||s.title.includes('关联双语'))
      .map(s=>({title:s.title,id:s.styleID})).sort((a,b)=>a.title.localeCompare(b.title));
    const list=this.element(w,'styles');list.replaceChildren();
    for(const style of styles){const row=w.document.createElementNS('http://www.w3.org/1999/xhtml','li');row.textContent=style.title;row.setAttribute('title',style.id);list.appendChild(row);}
    this.element(w,'empty').hidden=styles.length>0;
    this.element(w,'count').textContent=`已安装的关联双语样式（${styles.length}）`;
  },
  async run(event,action) {
    event.preventDefault();
    const w=event.currentTarget.ownerDocument.defaultView;
    if(this.busy)return;
    this.busy=true;const button=event.currentTarget,status=this.element(w,'status');
    button.disabled=true;status.textContent='正在处理…';
    try {
      const main=this.mainWindow(),plugin=main.BilingualPlugin;
      if(action==='create'){await main.BilingualStyleAdapter.run(main,plugin);this.refresh(w);}
      else if(action==='refresh')this.refresh(w);
      else if(action==='save-roots'){
        const roots=this.element(w,'roots').value.split('|').map(s=>s.trim()).filter(Boolean);
        Zotero.Prefs.set(plugin.configKey,[...new Set(roots)].join('|'),true);
        this.element(w,'roots').value=Zotero.Prefs.get(plugin.configKey,true)||'';
      } else if(action==='index'){
        if(this.element(w,'roots').value.trim()!==(Zotero.Prefs.get(plugin.configKey,true)||''))throw Error('目录有未保存的修改，请先点击“保存目录”。');
        await plugin.refreshIndex(main);
      }
      status.textContent='操作完成。';
    } catch(e) { this.report(w,e); }
    finally { button.disabled=false;this.busy=false; }
  }
};
Zotero.BilingualPreferencesPane = BilingualPreferencesPane;
