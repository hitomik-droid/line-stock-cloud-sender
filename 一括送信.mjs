// ダッシュボードで「確認中」の会社を、上から順に1社ずつ送る。
// 使い方：node 一括送信.mjs [--mode=dry|confirm|send] [--limit=100] [--industry=業種] [--ids=ID1,ID2] [--part=1/4]
// --part=k/n は、確認中の会社をID順に n 組へ分けた k 組目だけを送る（同時に複数のタスクで流す時に重ならないようにする）。
// --headed は画面を出してインストール済みのChromeで動かす。--retry-recaptcha は reCAPTCHA の失敗で送付失敗になった会社だけを1回送り直す。
// --retry-list=ファイル は、ファイル（会社IDのJSON配列）にある送付失敗の会社だけを送り直す。送れたか不明の会社は一覧に入れない。
// 既定は dry（入力だけ）。実際に送るのは --mode=send を付けた時だけ。
import fs from 'node:fs';
import { API, getJSON, sendOne, launchBrowser, recaptchaRetryable } from './送信.mjs';

const arg = (k, def) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || `--${k}=${def}`).split('=').slice(1).join('=');
const mode = arg('mode', 'dry');
const limit = Number(arg('limit', '100'));
const industry = arg('industry', '');
const ids = arg('ids', '').split(',').filter(Boolean);
const [partK, partN] = arg('part', '1/1').split('/').map(Number);
const headed = process.argv.includes('--headed');
const retryList = arg('retry-list', '');
const retryIds = retryList ? new Set(JSON.parse(fs.readFileSync(retryList, 'utf8'))) : null;
const retry = process.argv.includes('--retry-recaptcha') || !!retryIds;
if (!['dry', 'confirm', 'send'].includes(mode)) { console.error('--mode は dry / confirm / send'); process.exit(2); }

const data = await getJSON(API);
let targets = retryIds ? data.companies.filter((c) => c.status === '送付失敗' && retryIds.has(c.id) && !(c.history || []).some((x) => /再試行/.test(x.note || ''))) : retry ? data.companies.filter(recaptchaRetryable) : data.companies.filter((c) => c.status === '確認中');
if (industry) targets = targets.filter((c) => c.industry === industry);
if (ids.length) targets = targets.filter((c) => ids.includes(c.id));
targets.sort((a, b) => a.id.localeCompare(b.id));
if (partN > 1) targets = targets.filter((_, i) => i % partN === partK - 1);
targets = targets.slice(0, limit);
console.log(`モード ${mode}${headed ? '／画面あり' : ''}${retryIds ? '／一覧の送り直し' : retry ? '／reCAPTCHA失敗の送り直し' : ''}／組 ${partK}/${partN}／対象 ${targets.length} 社`);

const browser = await launchBrowser(headed);
const results = [];
for (const [i, c] of targets.entries()) {
  let r;
  try {
    r = await sendOne(c.id, mode, { browser, headed, retry, retryIds });
  } catch (e) {
    r = { id: c.id, name: c.name, result: 'error', status: null, note: String(e.message).slice(0, 200) };
  }
  results.push(r);
  console.log(`[${i + 1}/${targets.length}] ${c.id} ${c.name} → ${r.status || r.result}：${r.note}`);
  await new Promise((res) => setTimeout(res, 3000));
}
await browser.close();

const by = (s) => results.filter((r) => r.status === s);
console.log('\n===== まとめ =====');
console.log(`送付完了 ${by('送付完了').length}／送付失敗 ${by('送付失敗').length}／除外 ${by('除外').length}／その他 ${results.filter((r) => !r.status).length}`);
const manual = results.filter((r) => r.status === '送付失敗' && r.result !== 'unknown');
if (manual.length) {
  console.log('\n手で送る候補（送っていない会社）：');
  for (const r of manual) console.log(`- ${r.name}（${r.id}） ${r.form_url || ''}：${r.note}`);
}
const unknown = results.filter((r) => r.result === 'unknown');
if (unknown.length) {
  console.log('\n送れたか不明（再送しない。相手の受信を確かめる）：');
  for (const r of unknown) console.log(`- ${r.name}（${r.id}）：${r.note}`);
}
