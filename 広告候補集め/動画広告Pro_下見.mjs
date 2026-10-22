// 動画広告Pro（https://dpro.kashika-20mile.com）にログインし、中の画面の作りを調べるだけ（下見）。
// IDとパスワードは GitHub Secrets（DOUGA_PRO_ID・DOUGA_PRO_PASSWORD）から読む。値はログにも画像にも出さない。
// 検索・ダウンロード・設定変更はしない。見るのはログイン後の画面と、そこからたどれるメニューのページだけ。
import fs from 'node:fs';
import { chromium } from 'playwright';
const ID = process.env.DOUGA_PRO_ID, PW = process.env.DOUGA_PRO_PASSWORD;
if (!ID || !PW) { console.log('Secrets（DOUGA_PRO_ID・DOUGA_PRO_PASSWORD）が登録されていない'); process.exit(1); }
const OUT = '記録/動画広告Pro_下見'; fs.mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ headless: true });
const p = await b.newPage({ locale: 'ja-JP', viewport: { width: 1440, height: 1000 }, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36' });
const look = async (name) => {
  await p.waitForTimeout(4000);
  const info = await p.evaluate(() => ({
    url: location.href, title: document.title,
    text: document.body.innerText.slice(0, 4000),
    links: [...document.querySelectorAll('a[href]')].map((a) => (a.innerText.trim().slice(0, 30) + ' → ' + a.href)).filter((x, i, s) => s.indexOf(x) === i).slice(0, 120),
    inputs: [...document.querySelectorAll('input,select,textarea,button')].map((e) => [e.tagName, e.type, e.name || e.id, (e.placeholder || e.innerText || '').slice(0, 30)].join(':')).slice(0, 120),
  }));
  fs.writeFileSync(`${OUT}/${name}.json`, JSON.stringify(info, null, 1));
  await p.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  console.log('==', name, info.url, info.title, 'リンク', info.links.length, '入力欄', info.inputs.length);
  return info;
};
await p.goto('https://dpro.kashika-20mile.com/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
await p.fill('input[type=email]', ID);
await p.fill('input[type=password]', PW);
await p.click('button[type=submit]');
await p.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
const top = await look('01_ログイン後');
if (/login/.test(top.url)) { console.log('ログインできていない（ログイン画面のまま）。確認コードや別の確認が出ていないか、画像を見る'); await b.close(); process.exit(1); }
// メニューのうち、同じサイト内のページを最大8つ見る（ログアウト・設定・支払いは開かない）
const menu = [...new Set(top.links.map((l) => l.split(' → ')[1]).filter((u) => u && u.startsWith('https://dpro.kashika-20mile.com') && !/logout|setting|account|billing|plan|payment|login/i.test(u)))].slice(0, 8);
let n = 2;
for (const u of menu) { await p.goto(u, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {}); await look(String(n++).padStart(2, '0') + '_' + u.replace(/^https:\/\/[^/]+\//, '').replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 40)); }
await b.close();
