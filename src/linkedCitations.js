/* Supply translations only to explicitly adapted styles, never to stored Extra. */
var BilingualLinkedCitations = {
  marker:'https://github.com/kmaog15-damao/bilingual-metadata#linked-v1',
  legacyMarkers:['https://github.com/damao/bilingual-metadata#linked-v1'],
  installed:false, active:false, peers:new Map(), bySource:new Map(), engines:new Set(),
  remove(id) {
    const old=this.peers.get(id);
    if(old) for(const target of old.targets){const ids=this.bySource.get(target);ids?.delete(id);if(!ids?.size)this.bySource.delete(target);}
    this.peers.delete(id);
  },
  remember(item) {
    this.remove(item.id);
    if(item.deleted || !item.isRegularItem() || !item.hasTag(BilingualEnglishItems.tag))return;
    const targets=(item.relatedItems || []).map(key=>item.libraryID+'/'+key);
    this.peers.set(item.id,{item,targets});
    for(const target of targets){if(!this.bySource.has(target))this.bySource.set(target,new Set());this.bySource.get(target).add(item.id);}
  },
  async refresh(ids) {
    let changed=false;
    for(const id of ids){changed=this.peers.has(id)||changed;this.remove(id);const item=await Zotero.Items.getAsync(id);if(item){this.remember(item);changed=this.peers.has(id)||changed;}}
    if(changed)for(const style of this.engines)style.clearEngineCache();
  },
  inject(csl,input) {
    // Shallow copy; never mutate data returned by another plugin or an embedded citation.
    const out={...csl};
    for(const key of ['original-title','original-author','original-container-title','collection-title','original-publisher','original-publisher-place'])delete out[key];
    // The translated metadata record still describes a Chinese publication. Its
    // English title must nevertheless use the single-language bibliography branch.
    if(!/[\u3400-\u9fff]/.test(out.title || '')){if(/[A-Za-z]/.test(out.title || '') && /^zh/i.test(out.language || ''))out.language='en-US';return out;}
    let source;
    try{source=input instanceof Zotero.Item?input:Zotero.Items.get(input);}catch(e){return out;}
    if(!source || source.deleted || source.hasTag(BilingualEnglishItems.tag))return out;
    const ids=this.bySource.get(source.libraryID+'/'+source.key) || [];
    const candidates=[...ids].map(id=>this.peers.get(id)?.item).filter(item=>item && !item.deleted && item.hasTag(BilingualEnglishItems.tag) && (source.relatedItems || []).includes(item.key));
    if(candidates.length!==1)return out;
    const peer=candidates[0];
    const doi=BilingualCore.doi(source.getField('DOI')),peerDOI=BilingualCore.doi(peer.getField('DOI'));
    if(doi && peerDOI && doi!==peerDOI)return out;
    const english=Zotero.Utilities.Item.itemToCSLJSON(peer);
    const title=english.title,journal=english['container-title'],authors=english.author;
    const isEnglish=s=>typeof s==='string' && /[A-Za-z]/.test(s) && !/[\u3400-\u9fff]/.test(s);
    if(!isEnglish(title) || !isEnglish(journal) || !authors?.length || !authors.every(a=>isEnglish(a.literal || [a.family,a.given].filter(Boolean).join(' '))))return out;
    out['original-title']=title;
    out['original-author']=authors.map(a=>({...a}));
    out['collection-title']=journal;
    return out;
  },
  async start() {
    if(this.installed)return true;
    if(!Zotero.Style?.prototype?.getCiteProc || !Zotero.Cite?.System)return false;
    // Load only tagged companions, not all Markdown or all library records.
    for(const library of Zotero.Libraries.getAll()){
      if(!['user','group'].includes(library.libraryType))continue;
      const search=new Zotero.Search();search.libraryID=library.libraryID;
      search.addCondition('tag','is',BilingualEnglishItems.tag);
      await this.refresh(await search.search());
    }
    const bridge=this,Original=Zotero.Cite.System,originalGet=Zotero.Style.prototype.getCiteProc;
    const generation={};
    function System(...args){
      Original.apply(this,args);
      if(bridge.active){const retrieve=this.retrieveItem;this.retrieveItem=function(item){const csl=retrieve.call(this,item);return bridge.installed?bridge.inject(csl,item):csl;};}
    }
    System.prototype=Original.prototype;Object.setPrototypeOf(System,Original);
    function getCiteProc(...args){
      const xml=this.getXML();
      const linked=xml.includes(bridge.marker) || bridge.legacyMarkers.some(marker=>xml.includes(marker));
      // Discard an engine created before this hook, including cached Word engines.
      if(linked && this._bilingualGeneration!==generation){this.clearEngineCache();this._bilingualGeneration=generation;}
      const previous=bridge.active;bridge.active=linked;
      try{const engine=originalGet.apply(this,args);if(linked)bridge.engines.add(this);return engine;}
      finally{bridge.active=previous;}
    }
    this.originalSystem=Original;this.originalGet=originalGet;this.systemWrapper=System;this.styleWrapper=getCiteProc;
    this.installed=true;Zotero.Cite.System=System;Zotero.Style.prototype.getCiteProc=getCiteProc;
    this.observer=Zotero.Notifier.registerObserver({notify:async(event,type,ids)=>{
      try{if(event==='delete'){let changed=false;for(const id of ids){changed=this.peers.has(id)||changed;this.remove(id);}if(changed)for(const style of this.engines)style.clearEngineCache();}else if(['add','modify','trash'].includes(event))await this.refresh(ids);}catch(e){Zotero.logError(e);}
    }},['item'],'bilingual-linked-citations');
    return true;
  },
  stop() {
    this.installed=false;this.active=false;
    if(this.systemWrapper && Zotero.Cite?.System===this.systemWrapper)Zotero.Cite.System=this.originalSystem;
    if(this.styleWrapper && Zotero.Style?.prototype?.getCiteProc===this.styleWrapper)Zotero.Style.prototype.getCiteProc=this.originalGet;
    if(this.observer!==undefined)Zotero.Notifier.unregisterObserver(this.observer);this.observer=undefined;
    for(const style of this.engines)style.clearEngineCache();
    this.engines.clear();this.peers.clear();this.bySource.clear();
  }
};
