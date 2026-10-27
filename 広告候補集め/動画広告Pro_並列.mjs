// 動画広告Proに1回だけログインし、同じログインの中でタブを TABS 枚並べて、業種の言葉ごとの広告一覧データ（/api/v1/items）を読む。
// 2026-10-26 勝良さん決定「サーバーで何本も並べて集める」。同時に何個もログインしない（ログインは1つ、タブだけ増やす）。
// 各タブは人が見る速さで開く（1検索ごと・1ページごとに数秒待つ）。ダウンロード・CSV出力・設定変更・広告への反応はしない。
// ログイン画面に戻った・ロボット確認・利用制限や停止の表示・検索結果が続けて返らない、のどれかが起きたら、全部のタブを止める。
// user_logs/ban への送信は数えて記録するだけで止めない（10/26 22:5x 勝良さん「1」：記録が出ても続ける）。
import fs from 'node:fs';
import { chromium } from 'playwright';
const ID = process.env.DOUGA_PRO_ID, PW = process.env.DOUGA_PRO_PASSWORD;
const WORDS = (process.env.WORDS || '').split(',').map((s) => s.trim()).filter(Boolean);
const TABS = Math.min(+(process.env.TABS || 2), 4), PAGES = +(process.env.PAGES || 15);
const INTERVALS = (process.env.INTERVALS || '30,90').split(','), OBJ = 'ACQUISITION%2CAWARENESS';
const OUT = '記録/動画広告Pro_並列'; fs.mkdirSync(OUT, { recursive: true });
const KEEP = ['advertiser_name', 'account_name', 'product_name', 'genre_name', 'transition_url', 'thumbnail_url', 'production_url', 'ad_objective'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ locale: 'ja-JP', viewport: { width: 1600, height: 1000 }, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36' });
let stop = null; const got = [], summary = [];
const save = () => { fs.writeFileSync(`${OUT}/まとめ.json`, JSON.stringify({ stop, ban, summary: Array.isArray(summary) ? summary : summary, advertisers: summary.advertisers, new_vs_d1: summary.new_vs_d1, words: summary.words }, null, 1)); fs.writeFileSync(`${OUT}/広告一覧データ.json`, JSON.stringify(got)); };
let ban = 0, empty = 0;
ctx.on('request', (q) => { if (/user_logs\/ban/.test(q.url())) { ban++; console.log('user_logs/ban の送信（止めない）', ban); } });
const login = await ctx.newPage();
await login.goto('https://dpro.kashika-20mile.com/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
await login.fill('input[type=email]', ID); await login.fill('input[type=password]', PW); await login.click('button[type=submit]');
await login.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
await sleep(5000);
if (/login/.test(login.url())) { console.log('ログインできていない。止める'); stop = 'ログインできない'; save(); await b.close(); process.exit(1); }
const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
// COMBOS：「言葉|期間|並べ替え」を ; で区切る。無ければ WORDS×INTERVALS（並べ替えは増加額順）
const tasks = process.env.COMBOS ? process.env.COMBOS.split(';').filter(Boolean).map((c) => { const [w, iv, so, ind] = c.split('|'); return { w, iv, so: so || 'cost_difference-desc', ind: ind || '' }; })
  : WORDS.flatMap((w) => INTERVALS.map((iv) => ({ w, iv, so: 'cost_difference-desc' })));
async function tab(k) {
  const p = k === 0 ? login : await ctx.newPage();
  let cur = null;
  p.on('response', async (r) => {
    if (!cur || !r.url().startsWith('https://api.kashika-20mile.com/api/v1/items')) return;
    let j = null; try { j = await r.json(); } catch { return; }
    const items = (j?.items || []).map((i) => Object.fromEntries(KEEP.map((f) => [f, i[f]])));
    cur.n += items.length; got.push({ word: cur.w, interval: cur.iv, industry: cur.ind || undefined, url: r.url(), data: { items, total_count: j?.total_count } });
  });
  await sleep(k * 7000);
  for (let t = k; t < tasks.length && !stop; t += TABS) {
    const { w, iv, so, ind } = tasks[t]; cur = null;
    const u = `https://dpro.kashika-20mile.com/search?to_date=${today}&interval=${iv}&sort=${so}&media_type=video%2Cbanner%2Ccarousel&version=1&ad_objective=${OBJ}`;
    await p.goto(u, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await p.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    await sleep(3000 + Math.random() * 2000);
    cur = { w, iv, ind, n: 0 };
    const box = p.locator('input[placeholder*="キーワード"]').first();
    await box.fill(w).catch(() => {}); await box.press('Enter').catch(() => {}); await sleep(1500);
    await p.locator('button[type=submit]').last().click().catch(() => {});
    await p.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    await sleep(5000 + Math.random() * 3000);
    let pages = 1;
    for (; pages < PAGES && !stop; pages++) {
      const n0 = cur.n;
      await p.evaluate(() => { const v = document.querySelector('.ag-body-viewport'); if (v) v.scrollTop = v.scrollHeight; else window.scrollTo(0, document.body.scrollHeight); });
      await sleep(4000 + Math.random() * 2000);
      if (cur.n === n0) break;
    }
    const txt = await p.evaluate(() => document.body.innerText.slice(0, 3000)).catch(() => '');
    const hit = txt.match(/.{0,40}(ロボット|captcha|アクセスが制限|利用を制限|しばらくしてから|アカウントが停止).{0,40}/is);
    // 10/27 何の文で止まったかを残す（広告の文に同じ語が入っているだけかを見分けるため。止める決まりは変えない）
    if (/login/.test(p.url()) || hit) stop = stop || `画面の表示（${w}・${iv}日・タブ${k + 1}）：${/login/.test(p.url()) ? p.url() : hit[0].replace(/\s+/g, ' ')}`;
    empty = cur.n ? 0 : empty + 1;
    if (empty >= 4) stop = stop || `検索結果が4回続けて返らない（最後：${w}・${iv}日）`;
    summary.push({ tab: k + 1, w, iv, so, items: cur.n, pages, at: new Date().toISOString() });
    console.log(`タブ${k + 1}`, w, `${iv}日`, '読めた広告', cur.n, 'ページ', pages);
    save();
    await sleep(4000 + Math.random() * 4000);
  }
}
await Promise.all([...Array(TABS).keys()].map(tab));
// 広告主の数（言葉ごと）。D1は読まない（10/27 D1の1日の読み取り上限を超えたため。新しいかどうかは在庫づくりが照らす）
{
  const norm = (x) => (x || '').replace(/[\s\W_]+/gu, '').toLowerCase();
  const byW = {}; const all = new Set();
  for (const x of got) for (const i of x.data.items) {
    const n = norm(i.advertiser_name && i.advertiser_name !== 'None' ? i.advertiser_name : i.account_name); if (!n) continue;
    const k = `${x.word}|${x.interval}`; (byW[k] ||= new Set()).add(n); all.add(n);
  }
  Object.assign(summary, { advertisers: all.size, words: Object.fromEntries(Object.entries(byW).map(([k, v]) => [k, { advertisers: v.size }])) });
  console.log('広告主', all.size);
}
save();
console.log(stop ? `止めた：${stop}` : '全部読み終えた', '広告', got.reduce((a, x) => a + x.data.items.length, 0));
await b.close();
if (stop) process.exit(2);
