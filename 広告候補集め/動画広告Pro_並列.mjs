// 動画広告Proに1回だけログインし、同じログインの中でタブを TABS 枚並べて、業種の言葉ごとの広告一覧データ（/api/v1/items）を読む。
// 2026-10-26 勝良さん決定「サーバーで何本も並べて集める」。同時に何個もログインしない（ログインは1つ、タブだけ増やす）。
// 各タブは人が見る速さで開く（1検索ごと・1ページごとに数秒待つ）。ダウンロード・CSV出力・設定変更・広告への反応はしない。
// ログイン画面に戻った・ロボット確認・利用制限の表示・user_logs/ban への送信のどれかが出たら、全部のタブを止める。
import fs from 'node:fs';
import { chromium } from 'playwright';
const ID = process.env.DOUGA_PRO_ID, PW = process.env.DOUGA_PRO_PASSWORD;
const WORDS = (process.env.WORDS || '').split(',').map((s) => s.trim()).filter(Boolean);
const TABS = Math.min(+(process.env.TABS || 2), 5), PAGES = +(process.env.PAGES || 15);
const INTERVALS = (process.env.INTERVALS || '30,90').split(','), OBJ = 'ACQUISITION%2CAWARENESS';
const OUT = '記録/動画広告Pro_並列'; fs.mkdirSync(OUT, { recursive: true });
const KEEP = ['advertiser_name', 'account_name', 'product_name', 'genre_name', 'transition_url', 'thumbnail_url', 'production_url', 'ad_objective'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ locale: 'ja-JP', viewport: { width: 1600, height: 1000 }, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36' });
let stop = null; const got = [], summary = [];
const save = () => { fs.writeFileSync(`${OUT}/まとめ.json`, JSON.stringify({ stop, summary }, null, 1)); fs.writeFileSync(`${OUT}/広告一覧データ.json`, JSON.stringify(got)); };
ctx.on('request', (q) => { if (/user_logs\/ban/.test(q.url()) && !stop) { stop = 'user_logs/ban への送信'; console.log('止める：', stop); } });
const login = await ctx.newPage();
await login.goto('https://dpro.kashika-20mile.com/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
await login.fill('input[type=email]', ID); await login.fill('input[type=password]', PW); await login.click('button[type=submit]');
await login.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
await sleep(5000);
if (/login/.test(login.url())) { console.log('ログインできていない。止める'); stop = 'ログインできない'; save(); await b.close(); process.exit(1); }
if (stop) { save(); await b.close(); process.exit(1); }
const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const tasks = WORDS.flatMap((w) => INTERVALS.map((iv) => ({ w, iv })));
async function tab(k) {
  const p = k === 0 ? login : await ctx.newPage();
  let cur = null;
  p.on('response', async (r) => {
    if (!cur || !r.url().startsWith('https://api.kashika-20mile.com/api/v1/items')) return;
    let j = null; try { j = await r.json(); } catch { return; }
    const items = (j?.items || []).map((i) => Object.fromEntries(KEEP.map((f) => [f, i[f]])));
    cur.n += items.length; got.push({ word: cur.w, interval: cur.iv, url: r.url(), data: { items, total_count: j?.total_count } });
  });
  await sleep(k * 7000);
  for (let t = k; t < tasks.length && !stop; t += TABS) {
    const { w, iv } = tasks[t]; cur = null;
    const u = `https://dpro.kashika-20mile.com/search?to_date=${today}&interval=${iv}&sort=cost_difference-desc&media_type=video%2Cbanner%2Ccarousel&version=1&ad_objective=${OBJ}`;
    await p.goto(u, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await p.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    await sleep(3000 + Math.random() * 2000);
    cur = { w, iv, n: 0 };
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
    if (/login/.test(p.url()) || /ロボット|captcha|アクセスが制限|利用を制限|しばらくしてから|アカウントが停止/i.test(txt)) stop = stop || `画面の表示（${w}・${iv}日・タブ${k + 1}）`;
    summary.push({ tab: k + 1, w, iv, items: cur.n, pages, at: new Date().toISOString() });
    console.log(`タブ${k + 1}`, w, `${iv}日`, '読めた広告', cur.n, 'ページ', pages);
    save();
    await sleep(4000 + Math.random() * 4000);
  }
}
await Promise.all([...Array(TABS).keys()].map(tab));
save();
console.log(stop ? `止めた：${stop}` : '全部読み終えた', '広告', got.reduce((a, x) => a + x.data.items.length, 0));
await b.close();
if (stop) process.exit(2);
