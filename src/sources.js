var BilingualSources = {
  fromDocument(doc, item) {
    const C = BilingualCore;
    const values = name => [...doc.querySelectorAll('meta[name],meta[property]')].filter(m => (m.getAttribute('name') || m.getAttribute('property') || '').toLowerCase() === name).map(m => C.clean(m.getAttribute('content') || '')).filter(Boolean);
    const titles = values('citation_title');
    const pageDOI = C.doi(values('citation_doi').join(' '));
    const wantedDOI = C.doi(item.getField('DOI'));
    const identity = wantedDOI && pageDOI ? wantedDOI === pageDOI : titles.some(t => C.norm(t) === C.norm(item.getField('title')));
    if (!identity) return null;
    const english = s => /[A-Za-z]/.test(s) && !/[\u3400-\u9fff]/.test(s);
    const authors = values('citation_author');
    return {title:titles.find(english) || '', authors:authors.length && authors.every(english) ? C.safeAuthors(authors.join('; ')) : '', journal:values('citation_journal_title').find(english) || ''};
  },
  async collect(item, plugin, online, cancelled, status) {
    const result = {title:'',authors:'',journal:'',sources:{},warnings:[]};
    const merge = (candidate, source) => {
      if (!candidate) return;
      for (const key of ['title','authors','journal']) if (candidate[key]) {
        if (!result[key]) {result[key]=candidate[key];result.sources[key]=source;}
        else if (BilingualCore.norm(result[key]) !== BilingualCore.norm(candidate[key])) result.warnings.push(`${key} 存在不同候选（${source}）：${candidate[key]}`);
      }
    };
    // 期刊名是期刊级常量：先查本地词典（用户历史核实值，跨条目复用）。
    const pubTitle=(item.getField('publicationTitle')||'').trim();
    if(pubTitle && !result.journal){
      const hit=(plugin.journalDict||{})[BilingualCore.norm(pubTitle)];
      if(hit) merge({journal:hit.en},'期刊词典：'+hit.zh+' → '+hit.en);
    }
    const attachments=[];
    const inspect = (doc, source) => {
      const candidate=this.fromDocument(doc,item);
      if(!candidate) result.warnings.push(source+'：缺少身份元数据或与当前条目不匹配，未采用。');
      else {
        merge(candidate,source);
        const labels={title:'英文题名',authors:'英文作者',journal:'英文刊名'};
        const missing=Object.keys(labels).filter(k=>!candidate[k]).map(k=>labels[k]);
        if(missing.length) result.warnings.push(source+'：未提供可用的'+missing.join('、')+'。');
      }
    };
    for (const id of item.getAttachments?.() || []) {
      if(cancelled()) return result;
      const a=await Zotero.Items.getAsync(id); attachments.push(a);
      if (a.attachmentContentType !== 'text/html') continue;
      try {
        const path=await a.getFilePathAsync();
        if(path) inspect(new DOMParser().parseFromString(await plugin.IO.readUTF8(path),'text/html'),'本地网页快照：'+path);
      } catch(e) {result.warnings.push('快照读取失败：'+e.message);}
    }
    if (online && ['title','authors','journal'].some(k=>!result[k])) {
      const urls=[];
      const url=item.getField('url'); if (/^https?:\/\//i.test(url)) urls.push(url);
      const doi=BilingualCore.doi(item.getField('DOI')); if(doi) urls.push('https://doi.org/'+doi);
      for (const url of [...new Set(urls)]) {
        if(cancelled()) return result;
        status.textContent='正在读取期刊页面：'+url;
        try {
          const response=await Zotero.HTTP.request('GET',url,{responseType:'document',timeout:15000});
          if(cancelled()) return result;
          inspect(response.response,'网页：'+(response.responseURL || url));
        } catch(e) {result.warnings.push('网页读取失败：'+url+' '+e.message);}
        if(result.title && result.authors && result.journal) break;
      }
      // CrossRef 仅对注册在其名下的 DOI 有效（CNKI/ISTIC 注册的 DOI 会 404，属正常）。
      const cdoi=BilingualCore.doi(item.getField('DOI'));
      if(cdoi && ['title','authors','journal'].some(k=>!result[k])){
        if(cancelled()) return result;
        status.textContent='正在查询 CrossRef：'+cdoi;
        try {
          // CrossRef 建议通过 mailto 进入礼貌池；发布前可把 User-Agent 换成维护者邮箱。
          const r=await Zotero.HTTP.request('GET','https://api.crossref.org/works/'+encodeURIComponent(cdoi),{responseType:'json',timeout:15000,headers:{'Accept':'application/json','User-Agent':'bilingual-metadata-zotero/0.4.0'}});
          const m=(r.response&&r.response.message)||JSON.parse(r.responseText||'{}').message||{};
          if(BilingualCore.doi(m.DOI||'')===cdoi){
            const en=s=>/[A-Za-z]/.test(s)&&!/[\u3400-\u9fff]/.test(s);
            const ct=(m['container-title']||[]).find(en)||'';
            const tt=(m.title||[]).find(en)||'';
            const au=(m.author||[]).map(a=>[a.family,a.given].filter(Boolean).join(' ')).filter(x=>en(x));
            merge({title:tt,authors:au.join('; '),journal:ct},'CrossRef');
          }
        } catch(e){ if(!/404/.test(e.message)) result.warnings.push('CrossRef 查询失败：'+e.message); }
      }
    }
    result.attachments = attachments;
    result.merge = merge;
    return result;
  },
  async fallback(item, result, records, cancelled) {
    if(cancelled())return;
    const matches=records.filter(r=>BilingualCore.match({title:item.getField('title'),doi:item.getField('DOI')},r));
    const merged=BilingualCore.mergeMineruMatches(matches);
    if(!matches.length) result.warnings.push((records.length
      ? `MinerU：已检查 ${records.length} 份 Markdown，未找到与本条目 DOI 或中文题名精确匹配的 full.md。请确认 MinerU 已完成这篇文献的解析，并核对条目 DOI。`
      : 'MinerU：本次未读取到任何 full.md。请检查 MinerU 根目录设置、解析是否完成，以及下方是否有目录读取错误。')
      +(!BilingualCore.doi(item.getField('DOI'))?' 当前条目缺少 DOI；若 Markdown 中文题名乱码，请补全 DOI 后重试。':''));
    if(merged.status!=='none') {
      const source='MinerU：'+(merged.paths.length>1?`${merged.paths.length} 份相同 DOI 解析结果（${merged.paths.join('；')}）`:merged.paths[0] || '本地索引');
      result.merge(merged.fields,source);
      if(!merged.fields.title && !merged.fields.authors) result.warnings.push(source+'：已找到对应 Markdown，但未提取到可用英文题名和作者，请检查原文件排版。');
      for(const conflict of merged.conflicts) result.warnings.push(`MinerU 的${conflict.field}候选互相冲突，未自动采用：${conflict.values.join(' / ')}`);
      if(merged.fields.title && !merged.fields.authors) result.warnings.push('MinerU 作者含单位、数字或 OCR 符号，或不同解析结果无法形成一致值，已拦截，请手动核对。');
    }
    if(['title','authors'].some(k=>!result[k])) for(const a of result.attachments || []) {
      if(cancelled()) return;
      if(a.attachmentContentType !== 'application/pdf') continue;
      try {
        const text=await a.attachmentText;
        const r=BilingualCore.extract(text || '');
        // Indexed plain text has no reliable title boundaries. Only an explicit
        // self-citation with matching DOI may supply a title/journal candidate.
        if(r.citation && BilingualCore.doi(item.getField('DOI')) === r.citation.doi) result.merge(r.citation,'PDF 索引全文（待核对）：'+a.key);
      } catch(e) {result.warnings.push('PDF 索引读取失败：'+e.message);}
    }
  }
};
