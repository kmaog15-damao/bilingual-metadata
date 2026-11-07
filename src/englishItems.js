/* Independent English metadata records. Original citation fields are never changed. */
var BilingualEnglishItems = {
  tag: '双语元数据：英文引用条目',
  // Journal articles only: books and chapters need additional translated fields.
  fields: ['date','volume','issue','pages','DOI','ISSN','url','accessDate'],
  creators(value) {
    return BilingualCore.authorsToLines(value).map(line => {
      const parts=line.split('||').map(s=>s.trim());
      if(!parts[0] || !/^[A-Za-zÀ-ž'’ .-]+$/.test(parts.join(' '))) throw Error('英文作者格式有误，请使用“姓 || 名”，多人以分号分隔。');
      return {creatorType:'author',lastName:parts[0],firstName:parts[1] || '',fieldMode:0};
    });
  },
  validate(values) {
    for(const [key,label] of [['title','英文题名'],['authors','英文作者'],['journal','英文刊名']]) {
      if(!values[key]?.trim()) throw Error('创建英文引用条目前请补齐'+label+'。');
      if(!/[A-Za-z]/.test(values[key]) || /[\u3400-\u9fff\r\n]/.test(values[key])) throw Error(label+'需为核对后的英文内容，不能包含中文或换行。');
    }
    if(!this.creators(values.authors).length) throw Error('请补齐英文作者。');
  },
  async find(source) {
    for(const key of source.relatedItems || []) {
      const item=await Zotero.Items.getByLibraryAndKeyAsync(source.libraryID,key);
      if(item && !item.deleted && item.isRegularItem() && item.hasTag(this.tag) && (item.relatedItems || []).includes(source.key)) return item;
    }
    return null;
  },
  async create(plans) {
    for(const plan of plans) this.validate(plan.values);
    const created=[],skipped=[];
    await Zotero.DB.executeTransaction(async()=>{
      for(const plan of plans) {
        const source=await Zotero.Items.getAsync(plan.id);
        if(!source || source.deleted || source.key!==plan.key || source.libraryID!==plan.libraryID || source.itemType!=='journalArticle') throw Error('原条目已变化，请关闭窗口后重新执行。');
        if(!Zotero.Libraries.get(source.libraryID)?.editable) throw Error('原条目所在文库不可编辑。');
        const existing=await this.find(source);
        if(existing){skipped.push({source:source.key,id:existing.id});continue;}
        const item=new Zotero.Item('journalArticle');
        item.libraryID=source.libraryID;
        for(const field of this.fields) {const value=source.getField(field);if(value)item.setField(field,value);}
        item.setField('title',plan.values.title.trim());
        item.setField('publicationTitle',plan.values.journal.trim());
        item.setField('language',source.getField('language') || 'zh-CN');
        item.setCreators(this.creators(plan.values.authors));
        item.setCollections(source.getCollections());
        item.addTag(this.tag);
        item.addRelatedItem(source);
        await item.save();
        source.addRelatedItem(item);
        await source.save();
        created.push(item.id);
      }
    });
    if(typeof BilingualLinkedCitations!=='undefined' && BilingualLinkedCitations.installed)try{await BilingualLinkedCitations.refresh(created);}catch(e){Zotero.logError(e);}
    return {created,skipped};
  }
};
