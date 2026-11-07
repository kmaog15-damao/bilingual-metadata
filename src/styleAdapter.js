var BilingualStyleAdapter = {
  marker:'https://github.com/kmaog15-damao/bilingual-metadata#linked-v1',
  build(xml, englishFirst = true) {
    const options=typeof englishFirst==='object'?englishFirst:{englishFirst};
    englishFirst=options.englishFirst!==false;
    const ns='http://purl.org/net/xbiblio/csl';
    const doc=new DOMParser().parseFromString(xml,'application/xml');
    const root=doc.documentElement;
    const all=name=>Array.from(root.getElementsByTagNameNS(ns,name));
    const children=n=>Array.from(n.childNodes).filter(c=>c.nodeType===1);
    if(root.localName!=='style' || root.namespaceURI!==ns || doc.getElementsByTagName('parsererror').length) throw Error('不是有效的 CSL XML。');
    if(root.getAttribute('class')!=='in-text' || !all('category').some(n=>n.getAttribute('citation-format')==='numeric')) throw Error('首版仅支持顺序编码制 in-text 样式。');
    if(all('link').some(n=>n.getAttribute('rel')==='independent-parent')) throw Error('依赖样式请先选择其独立父样式。');
    if(xml.includes(this.marker) || all('macro').some(n=>(n.getAttribute('name')||'').startsWith('bilingual-'))) throw Error('该样式已由本插件适配，请选择原始样式重新生成。');
    const bib=all('bibliography')[0];
    const layouts=bib?children(bib).filter(n=>n.localName==='layout'):[];
    const existing=Array.from(root.getElementsByTagName('*')).some(n=>/\boriginal-/.test(n.getAttribute('variable')||''));
    const make=name=>doc.createElementNS(ns,name);
    let layout,body,english;
    if(existing){
      layout=layouts.find(n=>/^zh(?:-CN)?$/.test(n.getAttribute('locale') || ''));
      const fallback=layouts.find(n=>!n.hasAttribute('locale'));
      if(layouts.length!==2 || !layout || !fallback)throw Error('已有双语样式仅支持一个中文布局及一个默认布局，请选择其他原始样式。');
      const content=children(layout),pair=content[1],refs=pair?children(pair):[];
      if(content.length!==2 || pair.localName!=='group' || refs.length!==2 || refs.some(n=>n.localName!=='text' || !n.hasAttribute('macro')))throw Error('无法安全识别该双语样式的中英文段落，未修改。');
      const macros=new Map(all('macro').map(m=>[m.getAttribute('name'),m]));
      const translated=(name,seen=new Set())=>{if(seen.has(name))return false;seen.add(name);const m=macros.get(name);if(!m)throw Error('样式引用了不存在的宏：'+name);return Array.from(m.getElementsByTagName('*')).some(n=>/\boriginal-/.test(n.getAttribute('variable')||'') || (n.hasAttribute('macro') && translated(n.getAttribute('macro'),seen)));};
      const en=refs.filter(n=>translated(n.getAttribute('macro'))),zh=refs.filter(n=>!translated(n.getAttribute('macro')));
      if(en.length!==1 || zh.length!==1)throw Error('无法唯一识别中英文段落，未修改。');
      const segment=node=>{const group=make('group'),copy=node.cloneNode(true);for(const attr of ['prefix','suffix'])if(copy.hasAttribute(attr))copy.setAttribute(attr,copy.getAttribute(attr).replace(/[\[\]]/g,''));group.appendChild(copy);return group;};
      english=segment(en[0]);body=segment(zh[0]);
      bib.removeChild(fallback);layout.removeAttribute('locale');
      // These aliases exist only in the processor input for linked styles.
      for(const node of Array.from(root.getElementsByTagName('*')))if(node.hasAttribute('variable'))node.setAttribute('variable',node.getAttribute('variable').split(/\s+/).map(v=>v==='original-container-title'?'collection-title':v).join(' '));
    }else{
      if(layouts.length!==1 || layouts[0].hasAttribute('locale'))throw Error('普通样式暂只支持单一 bibliography layout。');
      layout=layouts[0];body=make('group');
      const delimiter=layout.getAttribute('delimiter');if(delimiter)body.setAttribute('delimiter',delimiter);
      for(const child of children(layout))if(child.getAttribute('variable')!=='citation-number')body.appendChild(child.cloneNode(true));
      if(!children(body).length)throw Error('没有可转换的参考文献正文。');
      const mapping={'title':'original-title','author':'original-author','container-title':'collection-title','publisher':'original-publisher','publisher-place':'original-publisher-place'};
      for(const macro of all('macro')){const clone=macro.cloneNode(true);clone.setAttribute('name','bilingual-'+macro.getAttribute('name'));this.rewrite(clone,mapping);root.insertBefore(clone,all('citation')[0] || bib);}
      english=body.cloneNode(true);this.rewrite(english,mapping);
    }
    const numbering=children(layout).filter(n=>n.getAttribute('variable')==='citation-number');
    if(numbering[0]!==children(layout)[0])throw Error('首版要求参考文献编号位于 layout 开头。');
    const nestedNumber=Array.from(layout.getElementsByTagNameNS(ns,'text')).some(n=>n.getAttribute('variable')==='citation-number' && n.parentNode!==layout);
    if(numbering.length!==1 || numbering[0].localName!=='text' || nestedNumber || all('macro').some(m=>Array.from(m.getElementsByTagNameNS(ns,'text')).some(n=>n.getAttribute('variable')==='citation-number'))) throw Error('参考文献编号必须是 layout 的一个直接 text 子元素。');
    // Older user styles treated original-author as one plain string, which
    // bypasses name separators, initials and et-al. Feed structured creators.
    const rendered=name=>[...all(name),...Array.from(english.getElementsByTagNameNS(ns,name))];
    for(const node of rendered('text').filter(n=>n.getAttribute('variable')==='original-author')){
      const names=make('names');names.setAttribute('variable','original-author');
      for(const attr of ['prefix','suffix','font-style','font-weight'])if(node.hasAttribute(attr))names.setAttribute(attr,node.getAttribute(attr));
      const name=make('name');name.setAttribute('initialize','false');names.appendChild(name);node.parentNode.replaceChild(names,node);
    }
    for(const names of rendered('names').filter(n=>n.getAttribute('variable')==='original-author')){
      for(const old of children(names).filter(n=>n.localName==='et-al'))names.removeChild(old);
      const etal=make('et-al');etal.setAttribute('term','and others');names.insertBefore(etal,children(names).find(n=>n.localName==='substitute') || null);
    }
    let locale=all('locale').find(n=>!n.getAttribute('xml:lang'));
    if(!locale){locale=make('locale');root.insertBefore(locale,all('macro')[0] || all('citation')[0] || bib);}
    let terms=children(locale).find(n=>n.localName==='terms');if(!terms){terms=make('terms');locale.appendChild(terms);}
    let etal=children(terms).find(n=>n.getAttribute('name')==='and others');if(!etal){etal=make('term');etal.setAttribute('name','and others');terms.appendChild(etal);}etal.textContent='et al.';
    const originalBody=body.cloneNode(true);
    if(options.chineseLabel){const label=make('text');label.setAttribute('value','（中文文献）');body.appendChild(label);}
    for(const child of children(layout))if(!numbering.includes(child))layout.removeChild(child);
    layout.removeAttribute('delimiter');
    const choose=make('choose'), condition=make('if');condition.setAttribute('variable','original-title original-author collection-title');condition.setAttribute('match','all');
    const group=make('group');group.setAttribute('delimiter',' ');
    const primary=englishFirst?english:body;
    const secondary=(englishFirst?body:english).cloneNode(true);
    if(options.brackets!==false){secondary.setAttribute('prefix','[');secondary.setAttribute('suffix',']');}
    if(options.newline){primary.setAttribute('display','block');secondary.setAttribute('display','block');}
    group.appendChild(primary);group.appendChild(secondary);condition.appendChild(group);choose.appendChild(condition);
    const fallback=make('else');fallback.appendChild(originalBody);choose.appendChild(fallback);layout.appendChild(choose);
    const title=all('title')[0],id=all('id')[0];
    if(!title || !id)throw Error('缺少样式标题或 ID。');
    title.textContent+=`（关联双语·${englishFirst?'英文在前':'中文在前'}${options.newline?'·换行':''}${options.brackets===false?'·无括号':''}${options.chineseLabel?'·中文标注':''}）`;
    const newID='https://www.zotero.org/styles/bilingual-linked-'+Services.uuid.generateUUID().toString().replace(/[{}]/g,'');
    id.textContent=newID;
    for(const link of all('link'))if(link.getAttribute('rel')==='self')link.setAttribute('href',newID);
    const info=all('info')[0],marker=make('link');marker.setAttribute('rel','documentation');marker.setAttribute('href',this.marker);info.insertBefore(marker,children(info).find(n=>['author','contributor','category','summary','updated','rights'].includes(n.localName)) || null);
    const updated=all('updated')[0];if(updated)updated.textContent=new Date().toISOString();
    root.removeAttribute('default-locale-sort');
    // CSL uses URIs here, not literal Unicode IRIs. Preserve existing escapes.
    for(const node of Array.from(root.getElementsByTagName('*'))) {
      for(const attr of ['href','license'])if(node.hasAttribute(attr))node.setAttribute(attr,encodeURI(node.getAttribute(attr)).replace(/%25([0-9a-f]{2})/gi,'%$1'));
      if(node.hasAttribute('variable'))node.setAttribute('variable',node.getAttribute('variable').split(/\s+/).map(v=>v==='original-container-title'?'collection-title':v==='original-event-title'?'event-title':v).join(' '));
      if(node.localName==='term' && node.getAttribute('name')==='et-al-en')node.setAttribute('name','and others');
      if(node.localName==='term' && node.getAttribute('name')==='citation-range-delimiter')node.parentNode.removeChild(node);
      // Numeric date rendering already omits missing month/day parts.
      if(node.hasAttribute('has-day')){node.setAttribute('variable',node.getAttribute('has-day'));node.removeAttribute('has-day');}
    }
    return {xml:new XMLSerializer().serializeToString(doc),title:title.textContent};
  },
  rewrite(node,mapping) {
    for(const n of [node,...Array.from(node.getElementsByTagName('*'))]) {
      if(n.hasAttribute('macro'))n.setAttribute('macro','bilingual-'+n.getAttribute('macro'));
      for(const attr of ['variable','is-numeric'])if(n.hasAttribute(attr))n.setAttribute(attr,n.getAttribute(attr).split(/\s+/).map(v=>mapping[v]||v).join(' '));
    }
  },
  async run(w,plugin) {
    if(!BilingualLinkedCitations.installed)throw Error('关联引用功能未能启动，请重启 Zotero 后重试，或查看错误日志。');
    await Zotero.Styles.init();
    const styles=Zotero.Styles.getVisible().map(s=>({id:s.styleID,title:s.title})).sort((a,b)=>a.title.localeCompare(b.title));
    let defaults={};try{defaults=JSON.parse(Zotero.Prefs.get('extensions.bilingual-metadata.styleOptions',true)||'{}');}catch(e){}
    const args={styles,defaults};
    w.openDialog('chrome://bilingual-metadata/content/styleOptions.xhtml','','chrome,modal,centerscreen,resizable,width=700,height=650',args);
    if(!args.result)return;
    const options=args.result;
    const xml=options.source==='file'?await plugin.IO.readUTF8(options.path):Zotero.Styles.get(options.styleID).getXML();
    const result=this.build(xml,options);
    try{await Zotero.Styles.validate(result.xml);}catch(e){throw Error('生成结果未通过 CSL 1.0.2 校验，未保存或安装。该原样式仍有不支持的结构：\n'+String(e));}
    const system=new Zotero.Cite.System({automaticJournalAbbreviations:false});
    const base={type:'article-journal',title:'中文题名',author:[{literal:'中文作者'}],'container-title':'中文期刊',issued:{'date-parts':[[2025]]},volume:'12',issue:'3',page:'10-20',language:'zh-CN'};
    const items={a:{...base,id:'a','original-title':'English article title','original-author':[{family:'LI',given:'Ming'}],'collection-title':'English Journal'},b:{...base,id:'b'},c:{...base,id:'c',title:'An English article',language:'en',author:[{family:'Smith',given:'John'}],'container-title':'English Journal'},d:{...base,id:'d','original-title':'Title only'}};
    const selected=w.ZoteroPane.getSelectedItems().filter(item=>item.isRegularItem()).slice(0,6);
    const checks=[];
    for(const item of selected){
      const peer=await BilingualEnglishItems.find(item);if(peer)BilingualLinkedCitations.remember(peer);
      const csl=BilingualLinkedCitations.inject(Zotero.Utilities.Item.itemToCSLJSON(item),item);
      const id='selected-'+item.id;items[id]={...csl,id};
      checks.push(item.getField('title')+'：'+(csl['original-title']?'已读取完整关联英文信息':/[\u3400-\u9fff]/.test(csl.title || '')?'缺少有效且完整的关联英文信息，输出原文':'单语输出'));
    }
    system.retrieveItem=id=>items[id];
    const engine=new Zotero.CiteProc.CSL.Engine(system,result.xml,'zh-CN');
    engine.setOutputFormat('text');engine.updateItems(Object.keys(items));
    const preview=engine.makeBibliography()?.[1]?.join('\n');
    if(!preview)throw Error('引用处理器未能生成预览，未保存样式。');
    const target=plugin.Path.join(Zotero.DataDirectory.dir,'bilingual-style-drafts');
    await plugin.IO.makeDirectory(target,{ignoreExisting:true});
    const output=plugin.Path.join(target,result.title.replace(/[<>:"/\\|?*]/g,'-')+'-'+Date.now()+'.csl');
    if(!Services.prompt.confirm(w,'双语样式预览',preview+'\n\n前四条为测试示例，其后为选中文献。\n'+checks.join('\n')+'\n已通过 CSL 1.0.2 校验。多语言布局已合并；非标准日期判断已规范化，文内连号分隔采用标准默认值，请核对目标期刊格式。\n实际引用从关联英文条目读取，插件需保持启用。确定后另存草稿，是否继续？'))return;
    await plugin.IO.writeUTF8(output,result.xml);
    Zotero.Prefs.set('extensions.bilingual-metadata.styleOptions',JSON.stringify(options),true);
    if(Services.prompt.confirm(w,'草稿已保存',output+'\n是否安装到 Zotero？安装后请在 Word 文档首选项中选择新样式并刷新。'))await Zotero.Styles.install({string:result.xml},output);
  }
};
