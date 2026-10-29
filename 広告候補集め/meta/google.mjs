// Googleの広告の透明性センター（地域：日本）で業種の語から広告主を探し、広告主ページを開いて
// 広告に出ているサイトのドメインと媒体（Google検索・YouTube の件数、形式：テキスト・画像・動画）を取る。画面なし（headless）。
// 入力欄に語を入れて候補を読むだけ。広告はクリックしない。ログイン・ロボット確認・利用制限が出たら止めて記録する。
// 使い方：node google.mjs [--industry=パーソナルジム] [--per=4] [--maxads=300] [--out=出力/google_候補.json]
//   --per：1つの語で開く広告主の数（試しは少なく） --maxads：これより広告が多い広告主は大手として開かない
import fs from 'node:fs';
import { DIR, WORDS, BIG, NOT_OFFICIAL, host, human, sleep, loadExclusions, blockCheck, logStop, newBrowser, args, norm } from './共通.mjs';

const A = args();
const OUT = A.out || DIR + '/出力/google_候補.json';
const STOP = DIR + '/出力/止まった記録.tsv';
const PER = +(A.per || 4);
const MAXADS = +(A.maxads || 300);
fs.mkdirSync(DIR + '/出力', { recursive: true });
const ex = loadExclusions();
// --q=業種:語|語;業種:語 で検索語を直接渡せる（meta.mjs と同じ形。10/27）
if (A.q) { for (const k of Object.keys(WORDS)) delete WORDS[k]; for (const part of A.q.split(';')) { const [k, ws] = part.split(':'); WORDS[k] = ws.split('|'); } }
const inds = A.industry ? A.industry.split(',') : Object.keys(WORDS);
const FMT = { 1: 'テキスト', 2: '画像', 3: '動画' };

const { browser, ctx } = await newBrowser();
const page = await ctx.newPage();
const out = [];
const seenAR = new Set();
const t0 = Date.now();
let stopped = null;

// ページが自分で読み込む広告一覧の通信（SearchCreatives）から、形式と件数を読む
let lastCreatives = [];
page.on('response', async r => {
  if (!/SearchService\/SearchCreatives/.test(r.url())) return;
  try { const j = JSON.parse(await r.text()); lastCreatives = lastCreatives.concat(j['1'] || []); } catch { }
});

async function openAdvertiser(ar, platform) {
  lastCreatives = [];
  const u = `https://adstransparency.google.com/advertiser/${ar}?region=JP` + (platform ? `&platform=${platform}` : '');
  await page.goto(u, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(6000);
  const b = await blockCheck(page, 'Google'); if (b) throw new Error('STOP:' + b);
  for (let i = 0; i < 2; i++) { await page.mouse.wheel(0, 1500); await sleep(1500); }
  const n = await page.evaluate(() => { const m = document.body.innerText.match(/([\d,]+)\s*件の広告/); return m ? +m[1].replace(/,/g, '') : null; });
  return { n, creatives: lastCreatives.slice() };
}
async function frameTexts() {
  const ts = [];
  for (const f of page.frames()) {
    if (f === page.mainFrame()) continue;
    try { const t = await f.evaluate(() => document.body ? document.body.innerText : ''); if (t && t.trim()) ts.push(t.replace(/[⁦-⁩]/g, '').replace(/\s+/g, ' ').trim()); } catch { }
  }
  return ts;
}

try {
  outer: for (const ind of inds) {
    for (const w of WORDS[ind]) {
      await page.goto('https://adstransparency.google.com/?region=JP', { waitUntil: 'domcontentloaded', timeout: 60000 });
      await sleep(5000);
      let b = await blockCheck(page, 'Google'); if (b) { stopped = b; logStop(STOP, b); break outer; }
      const box = page.locator('input').first();
      await box.click(); await box.type(w, { delay: 90 });
      await sleep(5000);
      const opts = await page.evaluate(() => [...document.querySelectorAll('material-select-item')].map(e => e.innerText.replace(/\s+/g, ' ').trim()));
      // 「社名 確認済み 日本 約 N 件の広告」の形だけ（ドメイン候補は除く）
      const advs = opts.map((t, i) => { const m = t.match(/^(.*?)\s*(?:確認済み\s*)?(日本|[^\s]+)\s*約\s*([\d,]+)\s*件の広告$/); return m ? { i, name: m[1].trim(), country: m[2], ads: +m[3].replace(/,/g, '') } : null; }).filter(Boolean);
      console.log(`${ind}／${w}：候補${advs.length}`);
      let opened = 0, restoreSearch = false;
      for (const a of advs) {
        if (opened >= PER) break;
        let skip = '';
        if (BIG.test(a.name)) skip = '大手・チェーン・比較サイトの名前';
        else if (ex.hitName(a.name)) skip = '既存社名';
        else if (a.ads > MAXADS) skip = `広告${a.ads}件で大手の見込み`;
        else if (a.country !== '日本') skip = '所在地が日本以外';
        if (skip) { out.push({ industry: ind, name: a.name, words: [w], google_ads: a.ads, skip }); continue; }
        // 候補を選ぶと広告主ページへ移る（検索語の入力からやり直す）
        if (restoreSearch) {
          await page.goto('https://adstransparency.google.com/?region=JP', { waitUntil: 'domcontentloaded', timeout: 60000 });
          await human(3500, 5000);
          const bx = page.locator('input').first(); await bx.click(); await bx.type(w, { delay: 90 }); await sleep(4500);
          restoreSearch = false;
        }
        const items = page.locator('material-select-item');
        const cnt = await items.count();
        let idx = -1; for (let i = 0; i < cnt; i++) { const t = (await items.nth(i).innerText()).replace(/\s+/g, ' '); if (t.startsWith(a.name)) { idx = i; break; } }
        if (idx < 0) { out.push({ industry: ind, name: a.name, words: [w], google_ads: a.ads, skip: '候補を選べず' }); continue; }
        lastCreatives = [];
        await items.nth(idx).click();
        restoreSearch = true;
        await sleep(7000);
        b = await blockCheck(page, 'Google'); if (b) { stopped = b; logStop(STOP, b); break outer; }
        const ar = (page.url().match(/advertiser\/(AR\d+)/) || [])[1];
        if (!ar || seenAR.has(ar)) { continue; }
        seenAR.add(ar); opened++;
        const allCre = lastCreatives.slice();
        const texts = await frameTexts();
        const fmts = {}; for (const c of allCre) { const f = FMT[c['4']] || 'その他'; fmts[f] = (fmts[f] || 0) + 1; }
        await human(3000, 4500);
        const s = await openAdvertiser(ar, 'SEARCH');
        texts.push(...await frameTexts());
        await human(3000, 4500);
        const y = await openAdvertiser(ar, 'YOUTUBE');
        // テキスト広告の表示URL（例：www.example.com/）からドメインを取る
        const pickDom = () => { const d = {}; for (const t of texts) for (const m of t.matchAll(/(?:https?:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,})(?:\/[^\s]*)?/gi)) { const h = host(m[1]); if (h && !/google|gstatic|googleusercontent|^window\./.test(h) && /\.(jp|com|net|org|info|biz|co|tokyo|osaka|nagoya|yokohama|kyoto|clinic|life|site|online|shop|work|me|io|xyz|beauty|school|jp\.net)$/.test(h)) d[h] = (d[h] || 0) + 1; } return Object.entries(d).sort((p, q) => q[1] - p[1]).map(e => e[0]).find(h => !NOT_OFFICIAL.test(h)) || ''; };
        // 一覧で読めない時は、テキスト形式の広告の詳細ページを2件まで開いて読む
        if (!pickDom()) {
          const tx = allCre.concat(s.creatives).filter(c => c['4'] == 1 && c['3'] && c['3']['1']).slice(0, 2);
          for (const c of tx) {
            await human(3000, 4500);
            await page.goto(`https://adstransparency.google.com/advertiser/${ar}/creative/${c['2']}?region=JP`, { waitUntil: 'domcontentloaded', timeout: 60000 });
            await sleep(6000);
            const bb = await blockCheck(page, 'Google'); if (bb) throw new Error('STOP:' + bb);
            texts.push(...await frameTexts());
            if (pickDom()) break;
          }
        }
        const doms = {};
        for (const t of texts) for (const m of t.matchAll(/(?:https?:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,})(?:\/[^\s]*)?/gi)) { const h = host(m[1]); if (h && !/google|gstatic|googleusercontent/.test(h)) doms[h] = (doms[h] || 0) + 1; }
        const dom = pickDom();
        const media = [];
        if (s.n) media.push(`Google検索${s.n}件`);
        if (y.n) media.push(`YouTube${y.n}件`);
        const rest = a.ads - (s.n || 0) - (y.n || 0);
        if (fmts['画像'] || rest > 0) media.push('ディスプレイ等' + (rest > 0 ? `${rest}件` : ''));
        let sk = '';
        if (!dom) sk = '広告からドメインが読めず';
        else if (ex.hitDomain(dom)) sk = '既存ドメイン';
        const r = {
          industry: ind, name: a.name, words: [w], advertiser_id: ar, google_ads: a.ads, domain: dom, landing: dom ? 'https://' + dom + '/' : '',
          ad_media: media.join('・'), formats: Object.entries(fmts).map(([k, v]) => `${k}${v}`).join('・'), ad_text: texts.slice(0, 2).join(' / ').slice(0, 200),
          source_url: `https://adstransparency.google.com/advertiser/${ar}?region=JP`,
          ad_evidence_url: allCre[0] ? `https://adstransparency.google.com/advertiser/${ar}/creative/${allCre[0]['2']}?region=JP` : `https://adstransparency.google.com/advertiser/${ar}?region=JP`,
          skip: sk,
        };
        out.push(r);
        console.log(`  ${a.name}｜${dom || 'ドメイン不明'}｜${r.ad_media}｜${r.formats}${sk ? '｜外す：' + sk : ''}`);
        await human(3000, 4500);
      }
    }
  }
} catch (e) {
  if (String(e.message).startsWith('STOP:')) { stopped = e.message.slice(5); logStop(STOP, stopped); }
  else { logStop(STOP, 'Google: エラー ' + String(e.message).slice(0, 120)); }
}
await browser.close();
// 同じドメインは1件に
const seenD = new Set();
for (const r of out) { if (!r.skip && r.domain) { if (seenD.has(r.domain)) r.skip = '同じドメインの広告主が先にあり'; seenD.add(r.domain); } }
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
const ok = out.filter(r => !r.skip);
console.log(`広告主${out.length}、開いた${seenAR.size}、残り${ok.length}、${Math.round((Date.now() - t0) / 1000)}秒${stopped ? '、止まった：' + stopped : ''}`);
const by = {}; for (const r of ok) by[r.industry] = (by[r.industry] || 0) + 1; console.log(JSON.stringify(by));
const why = {}; for (const r of out) if (r.skip) { const k = r.skip.replace(/広告\d+件/, '広告多数'); why[k] = (why[k] || 0) + 1; } console.log('外した理由', JSON.stringify(why));
