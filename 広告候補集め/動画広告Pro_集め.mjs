// 動画広告Pro（https://dpro.kashika-20mile.com）にログインし、業種の言葉ごとに検索して、
// 画面の裏で届く広告一覧のデータ（/api/v1/items）だけを保存する。件数の把握と、広告主の候補集めに使う。
// IDとパスワードは GitHub Secrets から読む。ログイン関係の応答は保存しない。
// 人が見る速さで開く（1検索ごとに数秒待つ）。ダウンロード・CSV出力・設定変更・広告への反応はしない。
// ログイン画面のまま・ロボット確認・利用制限が出たら、そこで止める。
import fs from 'node:fs';
import { chromium } from 'playwright';
const ID = process.env.DOUGA_PRO_ID, PW = process.env.DOUGA_PRO_PASSWORD;
const WORDS = (process.env.WORDS || 'パーソナルジム,パーソナルトレーニング,ダイエットジム,美容皮膚科,美容外科,医療脱毛,教習所,自動車学校,合宿免許,太陽光,蓄電池,外壁塗装,リフォーム,工務店,注文住宅,オンライン講座,オンラインスクール').split(',');
const OBJS = (process.env.OBJS || 'ACQUISITION,AWARENESS').split(',');
const OUT = '記録/動画広告Pro_集め'; fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await chromium.launch({ headless: true });
const p = await b.newPage({ locale: 'ja-JP', viewport: { width: 1600, height: 1000 }, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36' });
let cur = null; const got = [];
p.on('response', async (r) => {
  if (!r.url().startsWith('https://api.kashika-20mile.com/api/v1/items')) return;
  let j = null; try { j = await r.json(); } catch { return; }
  got.push({ word: cur?.w, obj: cur?.o, url: r.url(), status: r.status(), data: j });
});
await p.goto('https://dpro.kashika-20mile.com/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
await p.fill('input[type=email]', ID); await p.fill('input[type=password]', PW); await p.click('button[type=submit]');
await p.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
await sleep(5000);
if (/login/.test(p.url())) { console.log('ログインできていない。止める'); await b.close(); process.exit(1); }
const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const summary = [];
for (const o of OBJS) for (const w of WORDS) {
  cur = { w, o }; const before = got.length;
  const kw = encodeURIComponent(encodeURIComponent('in:' + w));
  const u = `https://dpro.kashika-20mile.com/search?to_date=${today}&interval=2&sort=cost_difference-desc&media_type=video%2Cbanner%2Ccarousel&version=1&ad_objective=${o}&keyword=${kw}`;
  await p.goto(u, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await p.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await sleep(6000 + Math.random() * 4000);
  const txt = await p.evaluate(() => document.body.innerText.slice(0, 3000)).catch(() => '');
  if (/login/.test(p.url()) || /ロボット|captcha|アクセスが制限|利用を制限|しばらくしてから/i.test(txt)) { console.log('止まった：', w, o, p.url()); summary.push({ w, o, stop: true }); break; }
  const mine = got.slice(before);
  const last = mine[mine.length - 1]?.data;
  const n = Array.isArray(last) ? last.length : Array.isArray(last?.items) ? last.items.length : Array.isArray(last?.data) ? last.data.length : null;
  const keys = last && !Array.isArray(last) ? Object.keys(last) : [];
  summary.push({ w, o, responses: mine.length, items: n, keys, total: last?.total ?? last?.total_count ?? last?.meta?.total ?? last?.count ?? null });
  console.log(o, w, '応答', mine.length, '件数', n, 'total', summary.at(-1).total, 'キー', keys.join('/'));
}
fs.writeFileSync(`${OUT}/まとめ.json`, JSON.stringify(summary, null, 1));
fs.writeFileSync(`${OUT}/広告一覧データ.json`, JSON.stringify(got));
await b.close();
