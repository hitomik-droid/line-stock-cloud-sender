// meta.mjs・google.mjs の候補から、公式サイトのトップと問い合わせページ（textarea のあるフォーム）を探し、候補TSVにする。画面なし（headless）。
// 読むだけ。フォームには入力しない・送信しない。ボタンも押さない。
// 外すもの：予約・資料請求・見積り専用のフォーム、トップに埋め込みのフォーム、営業お断りの表記、フランチャイズ本部・全国チェーンの表記、既存と重なる会社。
// 使い方：node 公式サイト確定.mjs [--per=5] [--out=出力/広告候補.tsv]
//   --per：業種ごと・経路ごとに採用する上限（試しは少なく）
import fs from 'node:fs';
import { DIR, BIG, NOT_OFFICIAL, host, base, human, sleep, loadExclusions, logStop, newBrowser, args, norm } from './共通.mjs';

const A = args();
const PER = +(A.per || 5);
const OUT = A.out || DIR + '/出力/広告候補.tsv';
const LOG = DIR + '/出力/公式サイト確定ログ.jsonl';
const STOP = DIR + '/出力/止まった記録.tsv';
const ex = loadExclusions();
const read = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return []; } };
const meta = read(DIR + '/出力/meta_候補.json').filter(r => !r.skip).map(r => ({ ...r, list_source: 'Meta広告ライブラリ', ad_media: 'Facebook・Instagram（Meta）' }));
const IN = A.in ? A.in.split(',') : [DIR + '/出力/meta_候補.json'];
const metaAll = IN.flatMap(f => read(f)).filter(r => !r.skip).map(r => ({ ...r, list_source: 'Meta広告ライブラリ', ad_media: 'Facebook・Instagram（Meta）' }));
const goog = A.in ? [] : read(DIR + '/出力/google_候補.json').filter(r => !r.skip).map(r => ({ ...r, list_source: 'Google広告の透明性センター' }));

const NG_SALES = /営業(目的|活動|行為|メール|電話|のご連絡|のご案内|のお問い合わせ|に関する)[^。\n]{0,30}(お断り|ご遠慮|控え|返信|対応|禁止|いたしかね|致しかね|できません)|セールス[^。\n]{0,20}(お断り|ご遠慮)|売り込み[^。\n]{0,20}(お断り|ご遠慮)|営業はお断り/;
const FC = /フランチャイズ(募集|加盟|本部|オーナー)|加盟店(募集|開発)|FC(加盟|募集|オーナー)|全国\s*\d{2,}\s*(店舗|院|校|拠点)|店舗数\s*\d{2,}|上場|証券コード|東証(プライム|スタンダード|グロース)/;
const ONLY = /予約|資料請求|見積|お見積|カタログ|来場|見学|体験|カウンセリング|無料相談|採用|エントリー|応募|購入|注文|会員登録|ログイン|求人/;
const CONTACT = /お問い?合わ?せ|問合せ|問い合せ|ご相談|contact|inquiry|toiawase|otoiawase/i;
const PREFS = '北海道|青森県|岩手県|宮城県|秋田県|山形県|福島県|茨城県|栃木県|群馬県|埼玉県|千葉県|東京都|神奈川県|新潟県|富山県|石川県|福井県|山梨県|長野県|岐阜県|静岡県|愛知県|三重県|滋賀県|京都府|大阪府|兵庫県|奈良県|和歌山県|鳥取県|島根県|岡山県|広島県|山口県|徳島県|香川県|愛媛県|高知県|福岡県|佐賀県|長崎県|熊本県|大分県|宮崎県|鹿児島県|沖縄県';
// 公式トップのタイトル・説明・見出しで業種を確かめる（広告文だけで決めない）
const STRICT = {
  '自動車学校': /自動車学校|教習所|ドライビングスクール/,
  'パーソナルジム': /パーソナル(トレーニング|ジム)|ジム|ピラティス|フィットネス/,
  '美容クリニック': /美容|脱毛|形成外科|整形|皮膚科/,
  'オンラインスクール': /オンライン|講座|スクール|アカデミー|レッスン|養成|教室/,
  '住宅・リフォーム': /リフォーム|リノベ|塗装|工務店|住宅|新築|注文住宅|家づくり|外壁|屋根|建設|ホーム/,
  '太陽光': /太陽光|蓄電池|ソーラー|発電|エコキュート|省エネ/,
};
const AGG = /合宿免許|比較|ランキング|一括見積|検索・予約|ポータル|まとめ/;
const ADDR = new RegExp(`(${PREFS})([^\\s　、。,\\d０-９〒（(]{1,8}?[市区町村郡])([^\\s　、。,\\d０-９（(]{0,8}?[区町村])?`);

async function readPage(page, url) {
  const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(3500);
  return page.evaluate(() => {
    const forms = [...document.querySelectorAll('form')].filter(f => f.querySelector('textarea'));
    const ifr = [...document.querySelectorAll('iframe[src]')].map(i => i.src).filter(s => /form|contact|inquiry|toiawase/i.test(s));
    return {
      url: location.href, title: document.title,
      desc: (document.querySelector('meta[name=description]') || {}).content || (document.querySelector('meta[property="og:description"]') || {}).content || '',
      h1: [...document.querySelectorAll('h1,h2')].slice(0, 3).map(h => h.innerText.trim()).join(' / '),
      text: (document.body && document.body.innerText || '').slice(0, 30000),
      textarea: forms.length, ifr,
      formText: forms.map(f => f.innerText.slice(0, 1500)).join('\n'),
      links: [...document.querySelectorAll('a[href]')].map(a => ({ h: a.href, t: (a.innerText || a.title || a.getAttribute('aria-label') || (a.querySelector('img[alt]') || {}).alt || '').trim().slice(0, 40) })).filter(l => /^https?:/.test(l.h)),
    };
  }).then(r => ({ ...r, status: res ? res.status() : 0 }));
}

function memoOf(top, contact, ind) {
  const src = (top.text + '\n' + (contact ? contact.text : ''));
  // 〒・住所・所在地の近くを先に見る（無ければ本文の最初の住所）
  const near = [...src.matchAll(/(〒\s?\d{3}-?\d{4}|住所|所在地|アクセス)[\s\S]{0,40}/g)].map(x => x[0]).join('\n');
  const m = near.match(ADDR) || src.match(ADDR);
  const addr = m ? (m[1] + m[2] + (m[3] || '')) : '';
  let feat = (top.desc || '').replace(/\s+/g, ' ').replace(/[【】「」]/g, '').trim();
  if (!feat) feat = (top.title || '').replace(/\s+/g, ' ').trim();
  feat = feat.split(/[。！!]/)[0];
  let memo = addr ? `所在地は${addr}。${feat}` : feat;
  if (memo.length < 30 && top.h1) memo = (memo + '。' + top.h1.split(' / ')[0]).replace(/。。/g, '。');
  if (memo.length > 60) memo = memo.slice(0, 59) + '…';
  return { memo, addr };
}

// --shard=i/n：候補を n 組に分けた i 組目だけ調べる（並列で回す時）
const [SI, SN] = (A.shard || '0/1').split('/').map(Number);
const pool = [...(A.in ? metaAll : meta), ...goog].filter(c => !BIG.test(c.name)).filter((c, i) => i % SN === SI);
const { browser, ctx } = await newBrowser();
const page = await ctx.newPage();
const rows = [], taken = {}, seenBase = new Set(), seenName = new Set();
const t0 = Date.now();
let tried = 0;
if (A.resume) {
  // 前回の続き：ログに名前がある会社は飛ばし、前回の採用行を残す
  try { for (const l of fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean)) { const j = JSON.parse(l); seenName.add(norm(j.name)); if (j.top) seenBase.add(base(host(j.top))); } } catch { }
  try {
    const [hd, ...ls] = fs.readFileSync(OUT, 'utf8').split('\n').filter(Boolean); const ks = hd.split('\t');
    for (const l of ls) { const v = l.split('\t'); const r = Object.fromEntries(ks.map((k, i) => [k, v[i] || ''])); rows.push(r); const key = r.industry + '|' + r.list_source; taken[key] = (taken[key] || 0) + 1; seenBase.add(base(host(r.official_url))); }
  } catch { }
} else if (A.skiplogged) {
  // 前に調べた会社（ログにある名前・ドメイン）は飛ばす。ログは足していく
  try { for (const l of fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean)) { const j = JSON.parse(l); seenName.add(norm(j.name)); if (j.landing) seenBase.add(base(host(j.landing))); if (j.top) seenBase.add(base(host(j.top))); } } catch { }
} else fs.writeFileSync(LOG, '');
for (const c of pool) {
  const key = c.industry + '|' + c.list_source;
  if ((taken[key] || 0) >= PER) continue;
  const h = host(c.landing || '');
  const b = base(h);
  if (!h || seenBase.has(b) || seenName.has(norm(c.name))) continue;
  seenBase.add(b); seenName.add(norm(c.name));
  const t1 = Date.now(); tried++;
  const log = { name: c.name, industry: c.industry, list_source: c.list_source, landing: c.landing };
  try {
    // 公式トップ：リンク先のホストの / を開き、リダイレクト後を正とする
    let top;
    try { top = await readPage(page, `https://${h}/`); }
    catch (e) { if (!h.startsWith('www.') && /NAME_NOT_RESOLVED|CONNECTION_REFUSED|CERT/.test(e.message)) top = await readPage(page, `https://www.${h}/`); else throw e; }
    const th = host(top.url);
    log.top = top.url;
    if (top.status >= 400) throw new Error(`トップが開けない（${top.status}）`);
    if (th !== h && NOT_OFFICIAL.test(th)) throw new Error('トップがSNS等へ移動');
    if (ex.hitDomain(th)) throw new Error('既存ドメイン（移動後）');
    if (NG_SALES.test(top.text)) throw new Error('営業お断りの表記（トップ）');
    if (FC.test(top.text)) throw new Error('フランチャイズ・チェーン・上場の表記');
    const head0 = `${top.title} ${top.desc} ${top.h1}`;
    if (!STRICT[c.industry].test(head0)) throw new Error('トップのタイトル・説明に業種の語が無い：' + head0.slice(0, 40));
    if (AGG.test(top.title)) throw new Error('比較・予約サイトの恐れ：' + top.title.slice(0, 40));
    // 広告主名がサイトに出ているか（比較サイト・別会社のサイトへの誘導を外す）
    const core = norm(c.name).split(/[\s:：|｜\-－・〜~／\/（(【]/).filter(x => x.length >= 2)[0] || norm(c.name);
    const probe = core.slice(0, Math.min(4, core.length));
    if (probe && !(top.text + top.title).toLowerCase().includes(probe.toLowerCase())) throw new Error(`広告主名（${probe}）がトップに無い：別サイトの恐れ`);
    // 問い合わせページを探す（同じサイト内のリンクで、文字かURLが問い合わせ）
    const cands = [];
    for (const l of top.links) {
      const lh = host(l.h);
      if (base(lh) !== base(th)) continue;
      if (CONTACT.test(l.t) || CONTACT.test(l.h)) { const u = l.h.split('#')[0]; if (u.replace(/\/$/, '') !== top.url.replace(/\/$/, '') && !cands.includes(u)) cands.push(u); }
    }
    cands.sort((p, q) => (/お問い?合わ?せ|contact/i.test(q) ? 1 : 0) - (/お問い?合わ?せ|contact/i.test(p) ? 1 : 0));
    // リンクで見つからない時は、よくある場所を2つまで試す
    if (!cands.length) for (const pth of ['/contact/', '/inquiry/']) cands.push(new URL(pth, top.url).href);
    let found = null; const seenWhy = [];
    for (const u of cands.slice(0, 4)) {
      await human(2500, 4000);
      let pg; try { pg = await readPage(page, u); } catch (e) { seenWhy.push(`${u}：開けず`); continue; }
      if (pg.url.replace(/[#?].*$/, '').replace(/\/$/, '') === top.url.replace(/[#?].*$/, '').replace(/\/$/, '')) { seenWhy.push('トップ埋め込み'); continue; }
      if (/complete|thanks|thank-you|finish|confirm|kanryo|done/i.test(pg.url)) { seenWhy.push(`${u}：完了・確認ページ`); continue; }
      if (base(host(pg.url)) !== base(th)) { seenWhy.push(`${u}：別ドメインのフォーム`); continue; }
      if (pg.status >= 400) { seenWhy.push(`${u}：${pg.status}`); continue; }
      if (!pg.textarea) { seenWhy.push(`${u}：textareaなし${pg.ifr.length ? '（外部フォーム埋め込み）' : ''}`); continue; }
      const head = pg.title + ' ' + pg.h1;
      if (ONLY.test(head) && !/お問い?合わ?せ|問合せ|contact/i.test(head)) { seenWhy.push(`${u}：専用フォーム（${head.slice(0, 30)}）`); continue; }
      if (NG_SALES.test(pg.text)) { found = { bad: '営業お断りの表記（問い合わせページ）', u }; break; }
      found = { u: pg.url, pg }; break;
    }
    if (!found && top.textarea) seenWhy.push('フォームはトップ埋め込みだけ');
    if (!found) throw new Error('問い合わせフォームなし：' + (seenWhy.join('／') || '問い合わせへのリンクなし'));
    if (found.bad) throw new Error(found.bad);
    const { memo, addr } = memoOf(top, found.pg, c.industry);
    const row = {
      industry: c.industry, name: c.name, official_url: top.url.replace(/[#?].*$/, ''), form_url: found.u, memo,
      list_source: c.list_source, source_url: c.source_url || '', ad_media: c.ad_media || '', ad_purpose: '',
      ad_evidence_url: c.ad_evidence_url || '',
    };
    rows.push(row); taken[key] = (taken[key] || 0) + 1;
    Object.assign(log, { ok: true, form: found.u, memo, addr: !!addr });
  } catch (e) {
    log.ok = false; log.why = String(e.message).replace(/\n/g, ' ').slice(0, 200);
  }
  log.sec = Math.round((Date.now() - t1) / 1000);
  fs.appendFileSync(LOG, JSON.stringify(log) + '\n');
  console.log(`${log.ok ? '○' : '×'} ${c.industry}｜${c.name}｜${log.sec}秒｜${log.ok ? log.form : log.why}`);
  await human(2500, 4000);
}
await browser.close();
const COLS = ['industry', 'name', 'official_url', 'form_url', 'memo', 'list_source', 'source_url', 'ad_media', 'ad_purpose', 'ad_evidence_url'];
const clean = v => String(v || '').replace(/[\t\r\n]+/g, ' ').trim();
fs.writeFileSync(OUT, COLS.join('\t') + '\n' + rows.map(r => COLS.map(k => clean(r[k])).join('\t')).join('\n') + '\n');
const sec = Math.round((Date.now() - t0) / 1000);
console.log(`調べた${tried}社、採用${rows.length}社、${sec}秒（1社あたり${tried ? Math.round(sec / tried) : 0}秒）`);
console.log(JSON.stringify(taken));
