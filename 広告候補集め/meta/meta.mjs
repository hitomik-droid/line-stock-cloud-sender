// Metaの広告ライブラリ（日本・配信中）を業種の語で検索し、広告主ごとに1件へまとめる。画面なし（headless）。
// 取るもの：広告主名、FacebookページID、リンク先URL（l.facebook.com の u= を外す）、広告ライブラリID、掲載開始日、広告文の一部。
// 広告・リンクはクリックしない。ログイン・ロボット確認・利用制限が出たら止めて 止まった記録.tsv に書く。
// 使い方：node meta.mjs [--industry=パーソナルジム] [--scroll=4] [--out=meta_候補.json]
import fs from 'node:fs';
import { DIR, WORDS, HINTS, BIG, NOT_OFFICIAL, host, human, sleep, loadExclusions, blockCheck, logStop, newBrowser, args } from './共通.mjs';

const A = args();
const OUT = A.out || DIR + '/出力/meta_候補.json';
const STOP = DIR + '/出力/止まった記録.tsv';
const SCROLL = +(A.scroll || 4);
fs.mkdirSync(DIR + '/出力', { recursive: true });
const ex = loadExclusions();
// --q=業種:語|語;業種:語 で検索語を直接渡せる（地名つきの語など）
if (A.q) { for (const k of Object.keys(WORDS)) delete WORDS[k]; for (const part of A.q.split(';')) { const [k, ws] = part.split(':'); WORDS[k] = ws.split('|'); } }
const inds = A.industry ? A.industry.split(',') : Object.keys(WORDS);

const { browser, ctx } = await newBrowser();
const page = await ctx.newPage();
const byPage = new Map(); // FacebookページID → 広告主
const stat = { started: Date.now(), words: 0, cards: 0 };
let stopped = null;

function unwrap(u) {
  try { const x = new URL(u); if (/l\.facebook\.com$/.test(x.hostname) && x.searchParams.get('u')) return x.searchParams.get('u'); } catch { }
  return u;
}

outer: for (const ind of inds) {
  for (const w of WORDS[ind]) {
    if (A.only && !A.only.split(',').includes(w)) continue;
    const url = 'https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=JP&media_type=all&search_type=keyword_unordered&q=' + encodeURIComponent(w);
    try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }); } catch (e) { logStop(STOP, `Meta: 開けず ${w} ${e.message.slice(0, 80)}`); continue; }
    await sleep(7000);
    let b = await blockCheck(page, 'Meta'); if (b) { stopped = b; logStop(STOP, b); break outer; }
    for (let i = 0; i < SCROLL; i++) {
      await page.mouse.wheel(0, 3500); await human(2500, 4000);
      b = await blockCheck(page, 'Meta'); if (b) { stopped = b; logStop(STOP, b); break outer; }
    }
    const cards = await page.evaluate(() => {
      const all = [...document.querySelectorAll('div')].filter(d => /ライブラリID[:：]/.test(d.innerText || ''));
      const cnt = el => ((el.innerText || '').match(/ライブラリID/g) || []).length;
      const cs = all.filter(d => cnt(d) === 1 && !(d.parentElement && cnt(d.parentElement) === 1));
      return cs.map(c => {
        const t = c.innerText;
        const lines = t.split('\n').map(s => s.replace(/​/g, '').trim()).filter(Boolean);
        const k = lines.indexOf('広告の詳細を見る');
        const hrefs = [...c.querySelectorAll('a[href]')].map(a => a.href);
        return {
          id: (t.match(/ライブラリID[:：]\s*(\d+)/) || [])[1] || '',
          start: (t.match(/掲載開始日[:：]\s*([\d/]+)/) || [])[1] || '',
          name: k >= 0 ? lines[k + 1] : '',
          pageUrl: hrefs.find(h => /facebook\.com\/(\d+|[^/?]+)\/?$/.test(h) && !/l\.facebook/.test(h)) || '',
          links: hrefs.filter(h => /l\.facebook\.com\/l\.php/.test(h)),
          text: [...lines.slice(k + 1).join(' ')].slice(0, 400).join(''),
        };
      });
    });
    stat.words++; stat.cards += cards.length;
    let added = 0;
    for (const c of cards) {
      if (!c.id || !c.name) continue;
      const land = c.links.map(unwrap).find(u => /^https?:/.test(u)) || '';
      const pid = (c.pageUrl.match(/facebook\.com\/([^/?]+)/) || [])[1] || c.name;
      const ok = HINTS[ind].test(c.text + ' ' + c.name);
      const cur = byPage.get(pid);
      if (cur) { cur.ads++; if (!cur.landing && land) cur.landing = land; if (!cur.words.includes(w)) cur.words.push(w); continue; }
      const h = host(land);
      let skip = '';
      if (!ok) skip = '広告文に業種の語なし';
      else if (BIG.test(c.name)) skip = '大手・チェーン・比較サイトの名前';
      else if (ex.hitName(c.name)) skip = '既存社名';
      else if (h && ex.hitDomain(h)) skip = '既存ドメイン';
      else if (!land) skip = 'リンク先なし';
      else if (NOT_OFFICIAL.test(h)) skip = 'リンク先がSNS・LINE・LP作成サービス（' + h + '）';
      byPage.set(pid, {
        industry: ind, name: c.name, page_id: pid, landing: land, domain: h, library_id: c.id, start: c.start,
        words: [w], ads: 1, text: [...c.text].slice(0, 200).join(''), skip,
        source_url: /^\d+$/.test(pid) ? `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=JP&media_type=all&search_type=page&view_all_page_id=${pid}` : '',
        ad_evidence_url: `https://www.facebook.com/ads/library/?id=${c.id}`,
      });
      added++;
    }
    console.log(`${ind}／${w}：広告${cards.length}件、新しい広告主${added}`);
    await human(3000, 5000);
  }
}
await browser.close();
const list = [...byPage.values()];
// 同じドメインの広告主は1件にまとめる（最初の1件を残す）
const seenD = new Set();
for (const r of list) { if (!r.skip && r.domain) { if (seenD.has(r.domain)) r.skip = '同じドメインの広告主が先にあり'; seenD.add(r.domain); } }
fs.writeFileSync(OUT, JSON.stringify(list, null, 1));
const ok = list.filter(r => !r.skip);
const sec = Math.round((Date.now() - stat.started) / 1000);
console.log(`検索語${stat.words}、広告${stat.cards}件、広告主${list.length}、残り${ok.length}、${sec}秒${stopped ? '、止まった：' + stopped : ''}`);
const by = {}; for (const r of ok) by[r.industry] = (by[r.industry] || 0) + 1; console.log(JSON.stringify(by));
const why = {}; for (const r of list) if (r.skip) { const k = r.skip.replace(/（.*/, ''); why[k] = (why[k] || 0) + 1; } console.log('外した理由', JSON.stringify(why));
