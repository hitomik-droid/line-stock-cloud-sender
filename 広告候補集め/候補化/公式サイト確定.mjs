// （10/22 動画広告Pro用に写した版：--in の候補JSONを --from〜--to だけ調べる。並べて動かせるよう --log を分ける）
// meta.mjs・google.mjs の候補から、公式サイトのトップと問い合わせページ（textarea のあるフォーム）を探し、候補TSVにする。画面なし（headless）。
// 読むだけ。フォームには入力しない・送信しない。ボタンも押さない。
// 外すもの：予約・資料請求・見積り専用のフォーム、トップに埋め込みのフォーム、営業お断りの表記、フランチャイズ本部・全国チェーンの表記、既存と重なる会社。
// 使い方：node 公式サイト確定.mjs [--per=5] [--out=出力/広告候補.tsv]
//   --per：業種ごと・経路ごとに採用する上限（試しは少なく）
import fs from 'node:fs';
import { DIR, BIG, NOT_OFFICIAL, host, base, human, sleep, loadExclusions, logStop, newBrowser, args, norm } from './共通.mjs';

const A = args();
const PER = +(A.per || 5);
const OUT = A.out;
const LOG = A.log;
const ex = loadExclusions();
const read = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return []; } };
const dpro = read(A.in).slice(+(A.from || 0), +(A.to || 99999)).map(r => ({ ...r, list_source: '動画広告Pro' }));

const NG_SALES = /営業(目的|活動|行為|メール|電話|のご連絡|のご案内|のお問い合わせ|に関する)[^。\n]{0,30}(お断り|ご遠慮|控え|返信|対応|禁止|いたしかね|致しかね|できません)|セールス[^。\n]{0,20}(お断り|ご遠慮)|売り込み[^。\n]{0,20}(お断り|ご遠慮)|営業はお断り/;
const FC = /フランチャイズ(募集|加盟|本部|オーナー)|加盟店(募集|開発)|FC(加盟|募集|オーナー)|全国\s*\d{2,}\s*(店舗|院|校|拠点)|店舗数\s*\d{2,}|上場|証券コード|東証(プライム|スタンダード|グロース)/;
const ONLY = /予約|資料請求|見積|お見積|カタログ|来場|見学|体験|カウンセリング|無料相談|採用|エントリー|応募|購入|注文|会員登録|ログイン|求人/;
const CONTACT = /お問い?合わ?せ|問合せ|問い合せ|ご相談|contact|inquiry|toiawase|otoiawase/i;
const PREFS = '北海道|青森県|岩手県|宮城県|秋田県|山形県|福島県|茨城県|栃木県|群馬県|埼玉県|千葉県|東京都|神奈川県|新潟県|富山県|石川県|福井県|山梨県|長野県|岐阜県|静岡県|愛知県|三重県|滋賀県|京都府|大阪府|兵庫県|奈良県|和歌山県|鳥取県|島根県|岡山県|広島県|山口県|徳島県|香川県|愛媛県|高知県|福岡県|佐賀県|長崎県|熊本県|大分県|宮崎県|鹿児島県|沖縄県';
// 公式トップのタイトル・説明・見出しで業種を確かめる（広告文だけで決めない）
const STRICT = {
  // 10/26 通る率の改善：10/26の候補化ログで「業種の語が無い」871社のうち、外構・アートメイク・教育などの語で落ちていた分を拾う（英字は大文字小文字を区別しない）
  '自動車学校': /自動車学校|教習所|ドライビングスクール|運転免許|自動車教習/i,
  'パーソナルジム': /パーソナル(トレーニング|ジム)|ジム|ピラティス|フィットネス|トレーニング|ボディメイク|ダイエット|ヨガ|gym|fitness|pilates|yoga/i,
  '美容クリニック': /美容|脱毛|形成外科|整形|皮膚科|クリニック|スキン|アートメイク|ボトックス|ヒアルロン|エイジング|aesthetic|clinic|beauty/i,
  'オンラインスクール': /オンライン|講座|スクール|アカデミー|レッスン|養成|教室|教育|学び|スキル|研修|資格|受験|コーチング|カレッジ|school|academy|college/i,
  '住宅・リフォーム': /リフォーム|リノベ|塗装|工務店|住宅|新築|注文住宅|家づくり|外壁|屋根|建設|ホーム|外構|エクステリア|造園|建築|設計事務所|内窓|断熱|防水|解体|水回り|キッチン|浴室|内装|大工|住まい|ハウス/i,
  '太陽光': /太陽光|蓄電池|ソーラー|発電|エコキュート|省エネ|オール電化|V2H|エネルギー|solar/i,
  // 10/26 勝良さんOKの3業種（本文v3あり）
  '結婚相談所': /結婚相談所|婚活|お見合い|成婚|マリッジ|ブライダル/,
  '自由診療歯科': /歯科|デンタル|矯正|インプラント|ホワイトニング|審美/,
  '不動産': /不動産|売却|査定|賃貸|マンション|物件|土地|住まい/,
};
// 広告主名から、サイトの文に出ているはずの手がかりを作る（会社の種類・業種だけの語・「スポンサー:」の前の投稿者名を除き、先頭4字）
const GENERIC = /^(パーソナル(ジム|トレーニング)?|ジム|美容(クリニック|外科|皮膚科|院|室)?|クリニック|公式|オフィシャル|official|スクール|オンライン|リフォーム|工務店|住宅|塗装|結婚相談所|歯科|不動産|グループ|ホールディングス|本店|店|the|株式会社|有限会社|合同会社)$/i;
const squash = t => String(t || '').normalize('NFKC').toLowerCase().replace(/[\s　・\-－‐]/g, '');
function nameProbes(name) {
  const n = String(name || '').replace(/^.*スポンサー[:：]\s*/, '');
  const toks = n.split(/[\s　:：|｜\-－–・〜~～／\/（()）【】「」┊︎、,]+/).map(x => norm(x)).filter(x => x.length >= 2 && !GENERIC.test(x));
  return [...new Set(toks.map(x => squash(x).slice(0, 4)).filter(x => x.length >= 2))].slice(0, 4);
}
const FORM_SVC = /form-mailer|formzu|formmailer|form\.run|formrun|tayori|hubspot|hsforms|typeform|google\.com|forms\.gle|jotform|wufoo|cognito/i;
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
      tail: (document.body && document.body.innerText || '').slice(-4000),
      site: [(document.querySelector('meta[property="og:site_name"]') || {}).content || '', ...[...document.querySelectorAll('header img[alt],footer img[alt],[class*=logo] img[alt]')].map(i => i.alt)].join(' ').slice(0, 300),
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

const pool = dpro.filter(c => !BIG.test(c.name) && !ex.hitName(c.name) && !ex.hitDomain(host(c.landing)));
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
    catch (e) { if (!h.startsWith('www.') && /NAME_NOT_RESOLVED|CONNECTION_REFUSED|CERT/.test(e.message)) top = await readPage(page, `https://www.${h}/`).catch(() => null); if (!top && /CERT|SSL/.test(e.message)) top = await readPage(page, `http://${h}/`).catch(() => null); if (!top) top = { status: 0, err: e }; }
    // 10/27 通る率の改善：広告用のサブドメイン（lp.・ad.・sub. など）のトップが開けない時は、本体のドメインのトップを見る（22:47の回で74社中6社）
    if ((top.status >= 400 || top.err) && b && b !== h.replace(/^www\./, '')) {
      const alt = await readPage(page, `https://www.${b}/`).catch(() => readPage(page, `https://${b}/`)).catch(() => null);
      if (alt && alt.status < 400) top = alt;
    }
    if (top.err) throw top.err;
    const th = host(top.url);
    log.top = top.url;
    if (top.status >= 400) throw new Error(`トップが開けない（${top.status}）`);
    if (th !== h && NOT_OFFICIAL.test(th)) throw new Error('トップがSNS等へ移動');
    if (ex.hitDomain(th)) throw new Error('既存ドメイン（移動後）');
    if (NG_SALES.test(top.text)) throw new Error('営業お断りの表記（トップ）');
    if (FC.test(top.text)) throw new Error('フランチャイズ・チェーン・上場の表記');
    const head0 = `${top.title} ${top.desc} ${top.h1}`;
    if (!/[ぁ-んァ-ヶ]/.test(head0 + top.text.slice(0, 3000))) throw new Error('日本語のサイトでない：' + head0.slice(0, 40));
    // 見出しに業種の語が無くても、本文の先頭に業種の語が4回以上あれば業種どおりとみる（10/26 通る率の改善）
    const bodyHits = (top.text.slice(0, 5000).match(new RegExp(STRICT[c.industry].source, 'gi')) || []).length;
    if (!STRICT[c.industry].test(head0) && bodyHits < 4) throw new Error('トップのタイトル・説明に業種の語が無い：' + head0.slice(0, 40));
    if (AGG.test(top.title)) throw new Error('比較・予約サイトの恐れ：' + top.title.slice(0, 40));
    // 広告主名の手がかり（比較サイト・別会社のサイトへの誘導を外すため、後でトップ・問い合わせ・会社概要のどこかに出ているかを見る）
    const probes = nameProbes(c.name);
    const hasName = t => { const x = squash(t); return !probes.length || probes.some(p => x.includes(p)); };
    // 問い合わせページを探す（同じサイト内のリンクで、文字かURLが問い合わせ）
    const cands = [], corp = [];
    for (const l of top.links) {
      const lh = host(l.h);
      const isContact = CONTACT.test(l.t) || CONTACT.test(l.h);
      if (base(lh) !== base(th)) {
        // ブランドサイトから運営会社のサイトの問い合わせへ飛ぶ形（10/26 通る率の改善）。SNS・外部フォームの会社は除く
        if (isContact && !NOT_OFFICIAL.test(lh) && !FORM_SVC.test(lh) && !ex.hitDomain(lh)) { const u = l.h.split('#')[0]; if (!corp.includes(u)) corp.push(u); }
        continue;
      }
      if (isContact) { const u = l.h.split('#')[0]; if (u.replace(/\/$/, '') !== top.url.replace(/\/$/, '') && !cands.includes(u)) cands.push(u); }
    }
    cands.sort((p, q) => (/お問い?合わ?せ|contact/i.test(q) ? 1 : 0) - (/お問い?合わ?せ|contact/i.test(p) ? 1 : 0));
    // リンクで見つからない時は、よくある場所を試す
    if (!cands.length) for (const pth of ['/contact/', '/inquiry/', '/contact.html', '/otoiawase/']) cands.push(new URL(pth, top.url).href);
    const corpBase = new Set(corp.map(u => base(host(u))));
    let found = null; const seenWhy = [];
    for (const u of [...cands.slice(0, 4), ...corp.slice(0, 2)]) {
      await human(2500, 4000);
      let pg; try { pg = await readPage(page, u); } catch (e) { seenWhy.push(`${u}：開けず`); continue; }
      if (pg.url.replace(/[#?].*$/, '').replace(/\/$/, '') === top.url.replace(/[#?].*$/, '').replace(/\/$/, '')) { seenWhy.push('トップ埋め込み'); continue; }
      if (/complete|thanks|thank-you|finish|confirm|kanryo|done/i.test(pg.url)) { seenWhy.push(`${u}：完了・確認ページ`); continue; }
      if (base(host(pg.url)) !== base(th) && !corpBase.has(base(host(pg.url)))) { seenWhy.push(`${u}：別ドメインのフォーム`); continue; }
      if (new URL(pg.url).pathname === '/' ) { seenWhy.push(`${u}：トップ埋め込み`); continue; }
      if (pg.status >= 400) { seenWhy.push(`${u}：${pg.status}`); continue; }
      if (!pg.textarea) { seenWhy.push(`${u}：textareaなし${pg.ifr.length ? '（外部フォーム埋め込み）' : ''}`); continue; }
      const head = pg.title + ' ' + pg.h1;
      if (ONLY.test(head) && !/お問い?合わ?せ|問合せ|contact/i.test(head)) { seenWhy.push(`${u}：専用フォーム（${head.slice(0, 30)}）`); continue; }
      if (NG_SALES.test(pg.text)) { found = { bad: '営業お断りの表記（問い合わせページ）', u }; break; }
      found = { u: pg.url, pg }; break;
    }
    // 10/27 広告用のサブドメイン（LP）にフォームが無い時は、本体のドメインのトップから問い合わせを探す
    if (!found && base(th) !== th.replace(/^www\./, '')) {
      try {
        await human(1500, 2500);
        const bt = await readPage(page, `https://www.${base(th)}/`).catch(() => readPage(page, `https://${base(th)}/`));
        const bl = [...new Set(bt.links.filter((l) => base(host(l.h)) === base(th) && (CONTACT.test(l.t) || CONTACT.test(l.h))).map((l) => l.h.split('#')[0]))].slice(0, 2);
        for (const u of bl) {
          await human(1500, 2500);
          const pg = await readPage(page, u).catch(() => null);
          if (!pg || pg.status >= 400 || !pg.textarea || new URL(pg.url).pathname === '/') { seenWhy.push(`${u}：本体のドメインでも無し`); continue; }
          if (NG_SALES.test(pg.text)) { found = { bad: '営業お断りの表記（問い合わせページ）', u }; break; }
          found = { u: pg.url, pg }; break;
        }
      } catch { seenWhy.push('本体のドメインが開けない'); }
    }
    if (!found && top.textarea) seenWhy.push('フォームはトップ埋め込みだけ');
    if (!found) throw new Error('問い合わせフォームなし：' + (seenWhy.join('／') || '問い合わせへのリンクなし'));
    if (found.bad) throw new Error(found.bad);
    // 広告主名：トップ（末尾・サイト名を含む）→問い合わせページ→会社概要の順に探す（10/26 通る率の改善。前はトップの先頭30000字だけ）
    let named = hasName([top.title, top.site, top.text, top.tail, found.pg.title, found.pg.text].join(' '));
    if (!named) {
      const co = top.links.find(l => base(host(l.h)) === base(th) && /会社概要|会社案内|運営会社|企業情報|医院概要|クリニック概要|院紹介|about|company|corporate|特定商取引|特商法|プライバシー/i.test(l.t + ' ' + l.h));
      if (co) { try { await human(1500, 2500); const cp = await readPage(page, co.h.split('#')[0]); named = hasName([cp.title, cp.text, cp.tail].join(' ')); } catch { } }
    }
    if (!named) throw new Error(`広告主名（${probes.join('・')}）がサイトに無い：別サイトの恐れ`);
    const { memo, addr } = memoOf(top, found.pg, c.industry);
    const row = {
      industry: c.industry, name: c.name, official_url: top.url.replace(/[#?].*$/, ''), form_url: found.u, memo,
      list_source: c.list_source, source_url: c.source_url || '', ad_media: c.ad_media || '', ad_purpose: c.ad_purpose || '',
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
