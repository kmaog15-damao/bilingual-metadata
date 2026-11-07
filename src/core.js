/* Shared by Zotero and Node tests. No external services. */
(function (scope) {
  const keys = ['original-title', 'original-author', 'original-container-title', 'collection-title'];
  // CJK 统一表意文字（含扩展 A：U+3400–U+4DBF、U+4E00–U+9FFF）。统一使用，避免「一-鿿」漏掉扩展 A。
  const HAN = /[\u3400-\u9fff]/;
  const clean = s => s.replace(/<sup\b[^>]*>\s*([:：;；,，.。])\s*<\/sup>/gi, '$1').replace(/<sup\b[^>]*>.*?<\/sup>/gi, '').replace(/<[^>]+>/g, '').replace(/\u00a0/g, ' ').replace(/^\s*#+\s*/, '').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
  const norm = s => clean(s).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const doi = s => (s.replace(/(10\.\d{4,9}\/)\s+/g, '$1').match(/10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i)?.[0] || '').replace(/[.,;]+$/, '').toLowerCase();
  function safeAuthors(s) {
    const value = clean(s);
    if (!value || /[$\\@\d]|university|department|school|institute|center|china|corresponding/i.test(value)) return '';
    return value.split(/[;,，；]/).map(x => x.trim()).filter(Boolean).every(x => /^[A-Za-zÀ-ž'’ .|-]+$/.test(x) && x.length < 65) ? value : '';
  }
  // MinerU author lines carry LaTeX affiliation markers ($\mathrm{a,b,1}$),
  // superscript digits/letters and OCR commas. Strip those instead of rejecting.
  function refineAuthors(s) {
    const t = String(s || '')
      .replace(/[（(]\s*\d*\s*\.?\s*(?:faculty|school|department|college|university|institute|laboratory|center|centre)\b[\s\S]*$/i, '')
      .replace(/\$[^$]*\$/g, ',')                 // LaTeX math (affiliation markers)
      .replace(/<[^>]+>/g, ' ')
      .replace(/[†‡§∗*]/g, ' ');
    const names = [];
    for (let p of t.split(/[,，;；]/)) {
      p = p.replace(/\d+/g, ' ')                  // affiliation numbers
        .replace(/(?:^|\s)[a-z](?=\s|$)/g, ' ')   // standalone affiliation letters
        .replace(/[^\p{L}'’.\-| ]/gu, ' ')
        .replace(/\s+/g, ' ').trim()
        .replace(/^and\s+/i, '')                  // "and X Y" before the last name
        .replace(/['’.\s]+$/g, '').trim();        // OCR superscript apostrophes
      if (!p || HAN.test(p) || !/^[A-Za-zÀ-ž]/.test(p) || p.length > 65) continue;
      if (p.split(' ').length < 2) continue;      // single word ⇒ affiliation fragment
      if (/university|institute|college|faculty|school|ministry|laboratory|department|center|centre|academy|key lab/i.test(p)) continue;
      names.push(p);
    }
    return names.join('; ');
  }
  function readExtra(extra) {
    const out = {};
    for (const line of extra.split(/\r?\n/)) {
      const m = line.match(/^\s*([a-z -]+):\s*(.*)$/i);
      if (!m) continue;
      const k = m[1].toLowerCase().replace(/ /g, '-');
      (out[k] ||= []).push(m[2]);
    }
    return out;
  }
  function updateExtra(extra, changes) {
    const pending = new Map(Object.entries(changes));
    const lines = extra.split(/\r?\n/).filter(line => {
      const m = line.match(/^\s*([a-z -]+):/i);
      return !m || !pending.has(m[1].toLowerCase().replace(/ /g, '-'));
    });
    const head = [];
    for (const [key, values] of pending) {
      if (!keys.includes(key)) throw Error('不允许修改字段：' + key);
      for (const v of [].concat(values)) {
        if (/[\r\n]/.test(v)) throw Error('字段中不能包含换行');
        if (v.trim()) head.push(`${key}: ${v.trim()}`);
      }
    }
    // CSL reads Extra metadata before arbitrary prose. Keep unmanaged lines verbatim.
    return head.concat(lines).join(extra.includes('\r\n') ? '\r\n' : '\n');
  }
  // 把「姓 名 / 姓名 / 姓, 名 / 姓 || 名」统一成 Zotero Extra 的两段式「姓 || 名」。
  // 中文作者英文名与 CrossRef 的「Family Given」均姓在前，故其余情况按「姓在前」处理。
  function authorsToLines(s) {
    return s.split(/[;；]/).map(clean).filter(Boolean).map(name => {
      const pipe = name.indexOf('||');
      if (pipe >= 0) {
        const family = name.slice(0, pipe).trim();
        const given = name.slice(pipe + 2).trim();
        return given ? `${family} || ${given}` : family;
      }
      const comma = name.indexOf(',');
      if (comma > 0) {
        const family = name.slice(0, comma).trim();
        const given = name.slice(comma + 1).trim();
        return given ? `${family} || ${given}` : family;
      }
      const parts = name.split(/\s+/);
      return parts.length > 1 ? `${parts[0]} || ${parts.slice(1).join(' ')}` : name;
    });
  }
  // 从「引用格式」块里取英文刊名/题名。兼容三种真实排版：
  //  1) 中文引用[J].中文刊名,年… [ 英文引用[J]. Journal, year… ]
  //  2) 中文引用 … [J/OL]．中文刊名…（英文引用[J]. Journal, year…）
  //  3) 中文引用一行、英文引用另起一行（英文无 [J]）：<Title>. <Journal>，<卷>（<期>）
  function parseCitationBlock(citation) {
    const isEn = s => /[A-Za-z]/.test(s) && !HAN.test(s);
    const segs = [];
    for (const m of citation.matchAll(/\[\s*J\s*(?:\/\s*OL)?\s*\]\s*[.．]?\s*([^\[\]]{2,140})/gi)) {
      let seg = m[1].split(/[,，]\s*(?:\d{4}|［?\s*\[?\s*DOI)/i)[0];
      seg = seg.replace(/^[\s.．,，]+|[\s.．,，]+$/g, '').trim();
      if (seg.length > 2 && !/[,，;；]/.test(seg)) segs.push(seg);
    }
    let journal = segs.find(isEn) || '';
    if (!journal) {
      const m = citation.match(/\.\s*([A-Za-z][^，,;；\[\]().]{2,120}?)\s*[,，]\s*\d{1,4}\s*[（(]/);
      if (m) journal = m[1].trim();
    }
    const journalZh = segs.find(s => HAN.test(s)) || '';
    let title = '';
    const badTitle = s => HAN.test(s) || /\d{4,}|https?:|doi/i.test(s);
    for (const tm of citation.matchAll(/\[\s*J\s*(?:\/\s*OL)?\s*\]/g)) {
      const m = citation.slice(0, tm.index).match(/.*\.\s*([^\[\]]{6,})\s*$/);
      if (m && !badTitle(m[1])) { title = m[1].trim(); break; }
    }
    return {title, journal, journalZh};
  }
  function extract(md) {
    const lines = md.split(/\r?\n/);
    const candidates = [];
    for (let i = 0; i < lines.length; i++) {
      if (!/^\s*#{1,6}\s+/.test(lines[i])) continue;
      const title = clean(lines[i]);
      if (!/^[A-Za-z]/.test(title) || HAN.test(title) || title.length < 18 || title.length > 450) continue;
      const next = lines.slice(i + 1, i + 20);
      // 兼容「Abstract:」「**Abstract**:」以及中文期刊常见的「【Abstract 】」。
      if (!next.some(s => /^\s*(?:[【\[]\s*abstract\s*[】\]]|abstract\s*[:：])/i.test(clean(s)))) continue;
      const authorLine = next.map(clean).find(Boolean) || '';
      if (!/^[A-Za-z]/.test(authorLine) || HAN.test(authorLine)) continue;
      candidates.push({title: title.replace(/\.+$/, ''), authors: refineAuthors(authorLine), line: i + 1});
    }
    // The citation block can appear in several places (header 引用格式：<title>,
    // 中文引用格式：…, 英文引用格式：…) and content may sit on following lines.
    // Join every 引用格式 line with its next 2 lines so nothing is missed.
    const citeIdxs = lines.map((s, i) => /引用格式\s*[:：]/.test(s) ? i : -1).filter(i => i >= 0);
    const citation = citeIdxs.length ? clean(citeIdxs.flatMap(i => lines.slice(i, i + 3)).join(' ')) : '';
    const articleDOI = doi(citation) || doi(md);
    const citedDOI = doi(citation);
    const { title: citedTitle, journal: citedJournal, journalZh: citedJournalZh } = parseCitationBlock(citation);
    const officialCitationMatches = !!articleDOI && !!citedDOI && articleDOI === citedDOI;
    return {
      doi: articleDOI,
      chineseTitles: lines.filter(s => /^\s*(?:#+\s*|题目[:：])/.test(s)).map(clean).map(s => s.replace(/^题目[:：]\s*/, '')).filter(s => HAN.test(s)),
      candidates,
      citation: officialCitationMatches ? {doi:citedDOI, title:citedTitle, journal:citedJournal, journalZh:citedJournalZh} : null
    };
  }
  function match(item, record) {
    if (item.doi && record.doi) return doi(item.doi) === record.doi ? 'DOI 精确匹配' : null;
    return record.chineseTitles.some(s => norm(s) === norm(item.title)) ? '中文题名精确匹配' : null;
  }
  function mergeMineruMatches(matches) {
    if (!matches.length) return {status:'none',fields:{},paths:[],conflicts:[]};
    const fields={}, paths=matches.map(r=>r.path).filter(Boolean), conflicts=[];
    for(const [key,get] of [
      // 取该记录的第一个英文候选：单篇论文的英文题名/摘要位于文末，多篇合刊时本文在前。
      ['title',r=>r.candidates?.[0]?.title || ''],
      ['authors',r=>r.candidates?.[0]?.authors || ''],
      ['journal',r=>r.citation?.journal || '']
    ]) {
      const values=[...new Map(matches.map(r=>get(r)).filter(Boolean).map(v=>[norm(v),v])).values()];
      if(values.length===1) fields[key]=values[0];
      else if(values.length>1) conflicts.push({field:key,values});
    }
    return {status:conflicts.length?'conflict':'matched',fields,paths,conflicts};
  }
  scope.BilingualCore = {clean, norm, doi, safeAuthors, refineAuthors, readExtra, updateExtra, authorsToLines, extract, match, mergeMineruMatches};
  if (typeof module !== 'undefined') module.exports = scope.BilingualCore;
})(globalThis);
