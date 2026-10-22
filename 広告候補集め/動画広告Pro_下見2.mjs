// 動画広告Proで業種の言葉を1つ検索し、画面の裏で届くデータ（JSON）の宛先と形を記録するだけ（下見2）。
// IDとパスワードは Secrets から読み、ログにも記録にも出さない。ダウンロード・設定変更はしない。
import fs from 'node:fs';
import { chromium } from 'playwright';
const ID = process.env.DOUGA_PRO_ID, PW = process.env.DOUGA_PRO_PASSWORD;
const OUT = '記録/動画広告Pro_下見2'; fs.mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ headless: true });
const p = await b.newPage({ locale: 'ja-JP', viewport: { width: 1600, height: 1000 }, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36' });
const seen = [];
p.on('response', async (r) => {
  const ct = r.headers()['content-type'] || '';
  if (!ct.includes('json')) return;
  let body = ''; try { body = await r.text(); } catch {}
  seen.push({ method: r.request().method(), url: r.url().replace(/(token|key|session)=[^&]+/gi, '$1=…'), status: r.status(), size: body.length, sample: body.slice(0, 1500), post: (r.request().postData() || '').slice(0, 500) });
});
await p.goto('https://dpro.kashika-20mile.com/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
await p.fill('input[type=email]', ID); await p.fill('input[type=password]', PW); await p.click('button[type=submit]');
await p.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
await p.waitForTimeout(4000);
const kw = p.locator('input[placeholder*="キーワード"]').first();
await kw.fill('パーソナルジム'); await kw.press('Enter');
await p.waitForTimeout(2000);
await p.locator('button[type=submit]').last().click().catch(() => {});
await p.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
await p.waitForTimeout(6000);
fs.writeFileSync(`${OUT}/画面の裏のデータ.json`, JSON.stringify(seen, null, 1));
fs.writeFileSync(`${OUT}/検索後の画面.txt`, (await p.evaluate(() => location.href + '\n' + document.body.innerText)).slice(0, 8000));
await p.screenshot({ path: `${OUT}/検索後.png`, fullPage: false });
console.log('JSONの応答', seen.length, '件。検索後のURL', p.url());
for (const s of seen) console.log(s.method, s.status, s.size, s.url.slice(0, 150));
await b.close();
