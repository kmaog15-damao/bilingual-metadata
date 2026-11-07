// 内置刊名表：只收录可提供证据的刊名（论文自带引用块 / 期刊官方页面）。
// 未收录的刊名由用户在审核窗口手填一次，写入数据目录词典后自动复用。
// 键用英文括号，norm() 会统一处理全/半角括号差异。
const SEED_JOURNALS = {
  // 只收录经核实的刊名：① 论文自带英文引用块 ② 期刊官方/权威页面。其余留空，由用户手填后自动学习。
  '地球信息科学学报': 'Journal of Geo-information Science',
  '武汉大学学报(信息科学版)': 'Geomatics and Information Science of Wuhan University',
  '智能系统学报': 'CAAI Transactions on Intelligent Systems',
  '遥感学报': 'National Remote Sensing Bulletin',
  '地理学报': 'Acta Geographica Sinica',
  '地理研究': 'Geographical Research',
  '地理科学': 'Scientia Geographica Sinica',
  '人文地理': 'Human Geography',
  '城市观察': 'Urban Insight',
  '地理教学': 'Geography Teaching',
  '旅游科学': 'Tourism Science'
};

var BilingualPlugin = {
  windows: new Set(), dialogs: new Set(), busy: false,
  // 词典内置常见刊名；用户核实过的对照也会写入数据目录词典并复用。
  async start() {
    this.IO = IOUtils;
    this.Path = PathUtils;
    this.statePath = this.Path.join(Zotero.DataDirectory.dir, 'bilingual-metadata-history.json');
    this.dictPath = this.Path.join(Zotero.DataDirectory.dir, 'bilingual-metadata-journals.json');
    this.configKey = 'extensions.bilingual-metadata.roots';
    this.journalDict = await this.readDict();
    try{await BilingualLinkedCitations.start();}catch(e){Zotero.logError(e);}
    for (const [zh, en] of Object.entries(SEED_JOURNALS)) {
      const k = BilingualCore.norm(zh);
      if (!this.journalDict[k]) this.journalDict[k] = {zh, en};
    }
    await BilingualPreferences.start(this);
    for (const w of Zotero.getMainWindows()) this.attach(w);
  },
  // 词典文件格式：{version:1, journals:{中文刊名: 英文刊名}}；兼容旧版扁平 {中文刊名: 英文刊名}。
  _journalsObject(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    return (raw.journals && typeof raw.journals === 'object' && !Array.isArray(raw.journals)) ? raw.journals : raw;
  },
  async readDict() {
    const dict = {};
    try {
      const raw = await this.IO.readJSON(this.dictPath);
      for (const [zh, en] of Object.entries(this._journalsObject(raw))) if (en) dict[BilingualCore.norm(zh)] = {zh, en};
    } catch(e) { if (e.name !== 'NotFoundError') Zotero.logError(e); }
    return dict;
  },
  async learnJournals(pairs) {
    if (!pairs.length) return 0;
    let journals = {};
    try { journals = this._journalsObject(await this.IO.readJSON(this.dictPath)); } catch(e) { if (e.name !== 'NotFoundError') Zotero.logError(e); }
    let n = 0;
    for (const {zh, en} of pairs) {
      const k = BilingualCore.norm(zh);
      if (!k || journals[zh] === en) continue;
      journals[zh] = en; this.journalDict[k] = {zh, en}; n++;
    }
    if (n) try { await this.IO.writeJSON(this.dictPath, {version:1, journals}, {tmpPath: this.dictPath + '.tmp'}); } catch(e) { Zotero.logError(e); }
    return n;
  },
  attach(w) {
    if (this.windows.has(w)) return;
    w.BilingualPlugin=this;
    w.BilingualStyleAdapter=BilingualStyleAdapter;
    w.BilingualLinkedCitations=BilingualLinkedCitations;
    const popup = w.document.getElementById('zotero-itemmenu');
    if (!popup) return;
    this.windows.add(w);
    for (const [id, label, action] of [
      ['run', '补充英文元数据（Extra 兼容）…', () => this.run(w)],
      ['english-item', '创建英文引用条目…', () => this.run(w,'english')],
      ['check-link', '检查关联双语状态…', () => this.checkLinked(w)],
      ['undo', '撤销上次英文元数据修改…', () => this.undo(w)]
    ]) {
      const el = w.document.createXULElement('menuitem');
      el.id = 'bilingual-' + id; el.setAttribute('label', label);
      el.addEventListener('command', () => Promise.resolve(action()).catch(e => {Zotero.logError(e); Services.prompt.alert(w, '双语元数据', e.message);}));
      popup.appendChild(el);
    }
  },
  detach(w) { for (const id of ['run','english-item','check-link','adapt-style','config','refresh','undo']) w.document.getElementById('bilingual-' + id)?.remove();if(w.BilingualPlugin===this)delete w.BilingualPlugin;if(w.BilingualStyleAdapter===BilingualStyleAdapter)delete w.BilingualStyleAdapter;if(w.BilingualLinkedCitations===BilingualLinkedCitations)delete w.BilingualLinkedCitations;this.windows.delete(w); },
  stop() { BilingualPreferences.stop();BilingualLinkedCitations.stop();for (const w of this.windows) this.detach(w); for (const d of this.dialogs) d.close(); },
  async checkLinked(w) {
    const items=w.ZoteroPane.getSelectedItems().filter(i=>i.isRegularItem());
    if(!items.length) throw Error('请先选中需要检查的文献。');
    const bridge=BilingualLinkedCitations;
    const lines=[`关联引用处理：${bridge.installed?'已启动':'未启动（请重启 Zotero）'}`];
    for(const item of items.slice(0,20)) {
      const title=item.getField('title');
      if(!/[\u3400-\u9fff]/.test(title)){lines.push(`《${title}》：英文题目条目；关联样式会按单语输出。`);continue;}
      const peers=[];
      for(const key of item.relatedItems || []) {const peer=await Zotero.Items.getByLibraryAndKeyAsync(item.libraryID,key);if(peer&&!peer.deleted&&peer.hasTag(BilingualEnglishItems.tag)&&(peer.relatedItems||[]).includes(item.key))peers.push(peer);}
      if(!peers.length){lines.push(`《${title}》：没有双向关联的英文条目，将只输出中文。`);continue;}
      if(peers.length>1){lines.push(`《${title}》：找到 ${peers.length} 个英文条目，关系不唯一，将只输出中文。`);continue;}
      const peer=peers[0],missing=[];if(!/[A-Za-z]/.test(peer.getField('title'))||/[\u3400-\u9fff]/.test(peer.getField('title')))missing.push('题名');if(!peer.getCreators?.()?.length)missing.push('作者');if(!/[A-Za-z]/.test(peer.getField('publicationTitle')))missing.push('刊名');
      const doi=BilingualCore.doi(item.getField('DOI')),other=BilingualCore.doi(peer.getField('DOI'));lines.push(`《${title}》：关联《${peer.getField('title')}》；${bridge.installed?'可读取':'插件未启动'}。${missing.length?'缺少英文'+missing.join('、')+'。':''}${doi&&other&&doi!==other?' DOI 不一致。':''}${/[:：]\s*$/.test(peer.getField('title'))?'英文题名可能不完整。':''}`);
    }
    lines.push('Word 中请选择名称含“关联双语”的样式并刷新；原始 CSL 不会读取关联条目。');
    Services.prompt.alert(w,'关联双语状态',lines.join('\n\n'));
  },
  configure(w) {
    const value = {value: Zotero.Prefs.get(this.configKey, true) || ''};
    if (Services.prompt.prompt(w, 'MinerU 目录', '输入 MinerU 根目录；多个目录用 | 分隔。仅扫描本地文件，不上传 PDF。', value, null, {})) Zotero.Prefs.set(this.configKey, value.value, true);
  },
  async history() { try {return await this.IO.readJSON(this.statePath);} catch(e) {if (e.name === 'NotFoundError') return []; throw e;} },
  async writeHistory(h) { await this.IO.writeJSON(this.statePath, h, {tmpPath: this.statePath + '.tmp'}); },
  async refreshIndex(w) {
    if (this.busy) throw Error('请先关闭处理窗口。');
    const roots = (Zotero.Prefs.get(this.configKey, true) || '').split('|').map(s => s.trim()).filter(Boolean);
    if (!roots.length) throw Error('请先在 Zotero 设置 → 双语引用中保存 MinerU 目录。');
    this.busy = true;
    try {
      this.forceIndex = true;
      const {records, errors} = await this.scan(roots, {textContent: ''}, () => false);
      Services.prompt.alert(w, 'MinerU 索引', `索引已重建：${records.length} 份文件${errors.length ? '，其中 ' + errors.length + ' 处读取失败（详见日志）' : ''}。`);
    } finally { this.busy = false; }
  },
  async scan(roots, status, cancelled) {
    if (!roots.length) return {records:[],errors:['未配置 MinerU 目录，未搜索 Markdown。请在 Zotero 设置 → 双语引用中保存目录。']};
    const indexPath=this.Path.join(Zotero.DataDirectory.dir,'bilingual-metadata-index.json');
    let cachedRecords = new Map();
    if(!this.forceIndex) {
      try {
        const cached=await this.IO.readJSON(indexPath);
        if(cached.version===4 && JSON.stringify(cached.roots)===JSON.stringify(roots)) {
          cachedRecords = new Map(cached.records.map(r=>[r.path,r]));
          status.textContent=`正在检查 MinerU 索引更新：${cached.records.length} 份缓存；只读取新增或修改的 Markdown。`;
        }
      } catch(e) {if(e.name!=='NotFoundError') Zotero.logError(e);}
    }
    const records = [], errors = [];
    const queue = [...roots];
    let count = 0;
    while (queue.length) {
      if (cancelled()) throw Error('扫描已取消，未修改条目');
      const dir = queue.shift();
      try {
        for (const path of await this.IO.getChildren(dir)) {
          const st = await this.IO.stat(path);
          if (st.type === 'directory') queue.push(path);
          else if (this.Path.filename(path).toLowerCase() === 'full.md') {
            const prior=cachedRecords.get(path);
            const stamp={size:st.size,lastModified:st.lastModified};
            if(prior && prior.size===stamp.size && prior.lastModified===stamp.lastModified) records.push(prior);
            else records.push({...BilingualCore.extract(await this.IO.readUTF8(path)), path,...stamp});
            status.textContent = `已检查 ${++count} 份 MinerU 文件（复用未变更文件）…`;
          }
        }
      } catch(e) {errors.push(`${dir}: ${e.message}`);}
      await Zotero.Promise.delay(1);
    }
    if (!cancelled()) {
      try {
        await this.IO.writeJSON(indexPath,{version:4,roots,records,errors,updated:new Date().toISOString()},{tmpPath:indexPath+'.tmp'});
        this.forceIndex=false;
      } catch(e) {errors.push('索引缓存保存失败，下次将重新扫描：'+e.message);}
    }
    return {records, errors};
  },
  async run(w, mode='extra') {
    const englishMode=mode==='english';
    if (this.busy) throw Error('已有处理窗口，请先完成或取消。');
    const items = w.ZoteroPane.getSelectedItems().filter(i => i.isRegularItem() && (/^zh/i.test(i.getField('language')) || /[\u3400-\u9fff]/.test(i.getField('title'))));
    if (!items.length) throw Error('请先选中中文文献条目。');
    if(englishMode && items.some(i=>i.itemType!=='journalArticle' || i.hasTag(BilingualEnglishItems.tag))) throw Error('创建英文引用条目目前仅支持中文期刊论文，请勿选择已生成的英文条目。');
    const roots = (Zotero.Prefs.get(this.configKey, true) || '').split('|').map(s => s.trim()).filter(Boolean);
    const online = Services.prompt.confirm(w,'英文信息来源','是否联网补充元数据？将查询 CrossRef（仅发送 DOI）并读取条目 URL 对应的期刊页面，不上传 PDF。选择取消则仅使用期刊词典、本地快照、MinerU 和 PDF 索引。');
    this.busy = true;
    let d;
    let ready;
    const readyPromise = new Promise(resolve => {ready=resolve;});
    try { d = w.openDialog('chrome://bilingual-metadata/content/review.xhtml', '', 'chrome,centerscreen,resizable,width=1000,height=760', {onReady:ready}); }
    catch(e) {this.busy=false; throw e;}
    this.dialogs.add(d);
    let closed = false, committing = false;
    try {
      await new Promise((resolve, reject) => {
        const timer = w.setTimeout(() => reject(Error('预览窗口初始化超时，请关闭窗口后重试。')), 15000);
        readyPromise.then(() => {w.clearTimeout(timer); resolve();});
      });
    } catch(e) {this.busy=false; if (!closed) d.close(); throw e;}
    d.addEventListener('unload', () => {closed = true; this.dialogs.delete(d); if (!committing) this.busy = false;}, {once:true});
    const doc = d.document, status = doc.getElementById('status'), save = doc.getElementById('save');
    if(englishMode) {
      doc.title='创建英文引用条目';
      doc.getElementById('heading').textContent='创建英文引用条目';
      doc.getElementById('description').textContent='审核英文题名、作者和刊名后，在同一文库和分类下新建独立条目，并关联回中文原条目。日期、卷期页、DOI 和原文语言保留；不复制 PDF、笔记和 Extra，也不修改原条目的引用字段。英文投稿引用新条目；双语投稿引用中文原条目，并选择“关联双语”样式，插件从关联英文条目读取信息。此前写入的 Extra 保留。作者使用“姓 || 名”，多人以分号分隔。';
      save.textContent='确认创建英文条目';
    }
    save.disabled = true;
    doc.getElementById('cancel').onclick = () => d.close();
    status.textContent = '正在读取本地快照及期刊网页，可以点击取消。';
    try {
      const prepared = new Map();
      for(const item of items) {
        const result=await BilingualSources.collect(item,this,online,()=>closed,status);
        if(englishMode) {
          const extra=BilingualCore.readExtra(item.getField('extra'));
          result.merge({title:extra['original-title']?.[0],authors:extra['original-author']?.join('; '),journal:extra['original-container-title']?.[0]},'原条目 Extra（请核对）');
        }
        if(closed) return;
        prepared.set(item,result);
      }
      const needsFallback=[...prepared.values()].some(r=>!r.title || !r.authors || !r.journal);
      const {records, errors} = needsFallback ? await this.scan(roots, status, () => closed) : {records:[],errors:[]};
      if (closed) return;
      const rows = [];
      // 先统一跑 PDF/MinerU 兜底
      for (const item of items) {
        if(['title','authors','journal'].every(k=>prepared.get(item)[k])) continue;
        await BilingualSources.fallback(item, prepared.get(item), records, () => closed);
        prepared.get(item).warnings.push(...errors.map(e=>'MinerU：'+e));
        if (closed) return;
      }
      // 自动学习本次核实到的「中文刊名 → 英文刊名」，再用词典回填仍缺刊名的条目
      const journalPairs = [];
      for (const item of items) {
        const r = prepared.get(item);
        const zh = (item.getField('publicationTitle') || '').trim();
        if (zh && r.journal) journalPairs.push({zh, en: r.journal});
      }
      if (!englishMode && journalPairs.length) await this.learnJournals(journalPairs);
      for (const item of items) {
        const r = prepared.get(item);
        if (r.journal) continue;
        const zh = (item.getField('publicationTitle') || '').trim();
        const hit = zh ? this.journalDict[BilingualCore.norm(zh)] : null;
        if (hit) r.merge({journal: hit.en}, '期刊词典：' + hit.zh + ' → ' + hit.en);
      }
      for (const item of items) {
        const snapshot = item.getField('extra');
        const current = BilingualCore.readExtra(snapshot);
        const result = prepared.get(item);
        const candidate=result;
        const box = doc.createElement('article'), heading = doc.createElement('h2');
        heading.textContent = item.getField('title'); box.appendChild(heading);
        const check = doc.createElement('input'); check.type = 'checkbox'; check.checked = !!(candidate.title || candidate.authors || candidate.journal); box.appendChild(check);
        const note = doc.createElement('small');
        note.textContent = Object.entries(result.sources).map(([k,v])=>`${k} 来源：${v}`).concat(result.warnings).join('\n') || '未找到已核验信息，可手动填写。';
        if(englishMode && await BilingualEnglishItems.find(item)) {check.checked=false;check.disabled=true;note.textContent+='\n已有关联英文引用条目，本次不重复创建。可在原条目的「相关」中打开它。';}
        box.appendChild(note);
        const inputs = {};
        for (const [key,label,value] of [
          ['original-title','英文题名',candidate?.title || ''],
          ['original-author','英文作者（姓 || 名；多人分号分隔）',candidate?.authors || ''],
          ['original-container-title','英文刊名（仅填写核实过的名称）',candidate.journal || '']
        ]) {
          const l = doc.createElement('label'); l.textContent = label; box.appendChild(l);
          const old = doc.createElement('small'); old.textContent = '当前值：' + (current[key]?.join('; ') || '空'); box.appendChild(old);
          const input = doc.createElement('textarea'); input.value = value; box.appendChild(input); inputs[key] = input;
          if (key === 'original-container-title') {
            const hint = doc.createElement('small');
            hint.textContent = '填一次即记住：保存后会记入本刊词典，同刊的所有条目下次自动填充。';
            box.appendChild(hint);
          }
        }
        if (!englishMode && current['collection-title']?.length) {const warning = doc.createElement('p'); warning.className='warning'; warning.textContent='collection-title 已有内容：填写英文刊名时将检查冲突，不会覆盖。'; box.appendChild(warning);}
        doc.getElementById('rows').appendChild(box);
        rows.push({item,snapshot,current,check,inputs,source:result.sources});
      }
      status.textContent = `共 ${items.length} 条。${englishMode?'勾选后创建；英文题名、作者、刊名必须完整。已关联条目自动跳过。':'勾选条目后保存；输入框留空保留旧值。'}${errors.length ? '\n读取警告：' + errors.join('\n') : ''}`;
      save.disabled = false;
      save.onclick = async () => {
        save.disabled = true;
        try {
          if(englishMode) {
            const plans=rows.filter(r=>r.check.checked && !r.check.disabled).map(r=>({id:r.item.id,key:r.item.key,libraryID:r.item.libraryID,values:{title:r.inputs['original-title'].value.trim(),authors:r.inputs['original-author'].value.trim(),journal:r.inputs['original-container-title'].value.trim()}}));
            if(!plans.length){status.textContent='没有需要创建的英文条目。已有的英文条目可从原条目的「相关」中打开。';save.disabled=false;return;}
            for(const plan of plans) BilingualEnglishItems.validate(plan.values);
            if(!Services.prompt.confirm(d,'确认创建英文引用条目',`将新建 ${plans.length} 条独立的英文元数据条目，并与中文原条目关联。不会修改原条目的 Extra，也不会复制附件。是否继续？`)){save.disabled=false;return;}
            committing=true;doc.getElementById('cancel').disabled=true;
            const result=await BilingualEnglishItems.create(plans);
            const pairs=plans.map(p=>({zh:rows.find(r=>r.item.id===p.id).item.getField('publicationTitle'),en:p.values.journal}));
            try{await this.learnJournals(pairs);}catch(e){Zotero.logError(e);}
            status.textContent=`已创建 ${result.created.length} 条英文引用条目，跳过 ${result.skipped.length} 条已关联条目。英文投稿：Word 中选择英文条目。双语投稿：选择中文原条目和“关联双语”样式。可从原条目的「相关」中打开英文条目；已有引用不会自动替换。`;
            save.textContent='已完成';save.disabled=true;doc.getElementById('cancel').textContent='关闭';
            return;
          }
          const plans = [], skipped = [];
          for (const row of rows.filter(r => r.check.checked)) {
            const changes = {};
            for (const [key,input] of Object.entries(row.inputs)) {
              const value = input.value.trim(); if (!value) continue;
              changes[key] = key === 'original-author' ? BilingualCore.authorsToLines(value) : [value];
            }
            const journal = changes['original-container-title']?.[0];
            if (journal) {
              const prior = row.current['collection-title'];
              if (prior?.length && (prior.length !== 1 || prior[0] !== journal)) { skipped.push(row.item.getField('title')); continue; }
              changes['collection-title'] = [journal];
            }
            if (!Object.keys(changes).length) continue;
            const after = BilingualCore.updateExtra(row.snapshot, changes);
            if (after !== row.snapshot) plans.push({libraryID:row.item.libraryID,key:row.item.key,id:row.item.id,before:row.snapshot,after,source:row.source,fields:Object.keys(changes),journalZh:(row.item.getField('publicationTitle')||'').trim(),journalEn:journal||''});
          }
          if (!plans.length) {status.textContent='没有需要保存的修改。' + (skipped.length ? `（${skipped.length} 条因 collection-title 冲突被跳过）` : ''); save.disabled=false; return;}
          if (!Services.prompt.confirm(d,'确认批量修改',`将修改 ${plans.length} 条文献的英文元数据，包括预览中填写的已有字段。${skipped.length ? `另有 ${skipped.length} 条因冲突被跳过。` : ''}是否保存？`)) {save.disabled=false; return;}
          committing = true; doc.getElementById('cancel').disabled = true;
          const history = await this.history();
          const entry = {time:new Date().toISOString(),status:'prepared',plans};
          history.push(entry); await this.writeHistory(history);
          try { await Zotero.DB.executeTransaction(async () => {
            for (const p of plans) {
              const item = await Zotero.Items.getAsync(p.id);
              if (!item || item.deleted || item.getField('extra') !== p.before) throw Error('条目已发生变化，请重新扫描：' + p.key);
              item.setField('extra',p.after); await item.save();
            }
          }); } catch(e) {entry.status='rolledback'; await this.writeHistory(history); throw e;}
          entry.status='committed';
          try {await this.writeHistory(history);} catch(e) {Zotero.logError(e);}
          // 把本次核实过的中英文刊名对照记入词典，同刊下次自动命中。
          const learned = await this.learnJournals(plans.filter(p => p.journalZh && p.journalEn && /[\u3400-\u9fff]/.test(p.journalZh)).map(p => ({zh: p.journalZh, en: p.journalEn})));
          // 保存成功后把每行的基准更新为已保存值，允许继续修改后再次保存
          for (const row of rows) { const p = plans.find(x => x.id === row.item.id); if (p) row.snapshot = p.after; }
          status.textContent=`已保存 ${plans.length} 条。${skipped.length ? `跳过 ${skipped.length} 条（collection-title 冲突）。` : ''}${learned ? `已记住 ${learned} 个期刊对照。` : ''}可继续修改后再次保存，完成后点「关闭」。`;
          save.textContent='再次保存'; save.disabled=false;
          doc.getElementById('cancel').textContent = '关闭';
        } catch(e) {Zotero.logError(e); status.textContent='保存未完成：' + e.message; save.disabled=false;}
        finally {committing=false; this.busy = !closed; doc.getElementById('cancel').disabled=false;}
      };
    } catch(e) {if (!closed) status.textContent=e.message; else this.busy=false;}
  },
  async undo(w) {
    if (this.busy) throw Error('请先关闭处理窗口。');
    const h = await this.history(), entry = [...h].reverse().find(x => ['prepared','committed'].includes(x.status));
    if (!entry) throw Error('暂无可撤销记录。');
    const plans = [];
    for (const p of entry.plans) {
      const item = await Zotero.Items.getAsync(p.id);
      if (!item || item.key !== p.key || item.libraryID !== p.libraryID || item.deleted) throw Error('原条目已不存在，无法安全撤销。');
      const now = item.getField('extra');
      if (now === p.before) continue;
      if (now !== p.after) throw Error('Extra 已被后续修改，已停止撤销：' + p.key);
      plans.push({item,p});
    }
    if (!Services.prompt.confirm(w,'撤销英文元数据',`恢复 ${plans.length} 条文献修改前的 Extra？`)) return;
    await Zotero.DB.executeTransaction(async () => {for (const {item,p} of plans) {if(item.getField('extra')!==p.after) throw Error('条目已变化'); item.setField('extra',p.before); await item.save();}});
    entry.status='undone'; await this.writeHistory(h);
    Services.prompt.alert(w,'双语元数据','已撤销。');
  }
};
