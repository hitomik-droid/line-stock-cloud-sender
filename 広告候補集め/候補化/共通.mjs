// （10/22 GitHub Actions用に写した版。元は 作業/営業リスト作り_道具/広告候補集め_画面なし/共通.mjs）
// 広告候補集め（画面なし）の共通部品。ブラウザは headless で開き、Macに画面を出さない。
// してはいけないこと：フォームの入力・送信、広告のクリック、ログイン。ロボット確認・ログイン要求・利用制限が出たら止めて記録する（かわさない）。
import fs from 'node:fs';
import path from 'node:path';

export const HERE = path.dirname(new URL(import.meta.url).pathname);
export const DIR = decodeURIComponent(HERE);
import { chromium } from 'playwright';
export { chromium };
export const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
export const EXCL_DIR = DIR;

// 業種と検索語
export const WORDS = {
  '自動車学校': ['自動車学校', '教習所'],
  'パーソナルジム': ['パーソナルジム', 'パーソナルトレーニング', 'ボディメイク', 'ダイエットジム'],
  '美容クリニック': ['美容皮膚科', '美容外科', '医療脱毛', '二重整形'],
  'オンラインスクール': ['オンライン講座', 'オンラインスクール', 'スクール'],
  '住宅・リフォーム': ['リフォーム', '外壁塗装', '工務店', '注文住宅', '屋根塗装', 'リノベーション', '平屋'],
  '太陽光': ['太陽光', '蓄電池', '太陽光発電'],
};
// 広告文に業種の語が入っているかの確認用（検索語だけだと関係ない広告も混ざるため）
export const HINTS = {
  '自動車学校': /自動車学校|教習所|ドライビングスクール|免許/,
  'パーソナルジム': /パーソナル|ジム|トレーニング/,
  '美容クリニック': /美容|皮膚科|クリニック|脱毛|形成外科/,
  'オンラインスクール': /オンライン|講座|スクール|レッスン|受講/,
  '住宅・リフォーム': /リフォーム|塗装|工務店|住宅|新築|注文住宅|外壁|屋根|リノベ|家づくり/,
  '太陽光': /太陽光|蓄電池|ソーラー|発電/,
};

// 大手・全国チェーン・FC本部（名前で外す。見つけたら足す）
export const BIG = /RIZAP|ライザップ|chocoZAP|チョコザップ|エニタイム|ANYTIME|ゴールドジム|カーブス|24\/7|BEYOND|ビヨンド|湘南美容|SBC|TCB|東京中央美容|品川美容|聖心美容|共立美容|城本|水の森|リゼ|ゴリラ|レジーナ|フレイア|エミナル|ルシアクリニック|アリシア|TCB|ヤマダ|ニトリ|LIXIL|リクシル|TOTO|パナソニック|Panasonic|積水|セキスイ|大和ハウス|ダイワハウス|住友林業|一条工務店|タマホーム|アイフルホーム|ミサワ|へーベル|旭化成|トヨタホーム|パナソニックホームズ|ヤマト住建|アキュラホーム|クレバリー|ジブンハウス|イオン|ベネッセ|ユーキャン|Schoo|Udemy|ストアカ|Progate|テックアカデミー|TechAcademy|侍エンジニア|デジハク|ヒューマンアカデミー|ECC|楽天|ソフトバンク|SoftBank|KDDI|NTT|ドコモ|docomo|ENEOS|東京ガス|大阪ガス|東京電力|関西電力|中部電力|シャープ|SHARP|京セラ|長州産業|エクソル|カインズ|コメリ|ナフコ|ケーズ|ビックカメラ|ヨドバシ|コジマ|エディオン|リショップナビ|ホームプロ|SUUMO|スーモ|ホットペッパー|楽待|ズバット|比較ナビ|ランキング|まとめ|くらべる|協会|機構|協同組合|組合|財団|AliExpress|日経|新聞|大学|市役所|県庁|PHC|検索・予約|予約サイト|ポータル|メーカー|合宿免許|整骨院|接骨院|介護|インターナショナル|International/i;

// 公式サイトにならない行き先（SNS・LINE・アプリ・LP作成サービス）
export const NOT_OFFICIAL = /(^|\.)(facebook\.com|fb\.me|fb\.com|instagram\.com|line\.me|lin\.ee|youtube\.com|youtu\.be|tiktok\.com|x\.com|twitter\.com|apps\.apple\.com|play\.google\.com|google\.com|goo\.gl|bit\.ly|linktr\.ee|lit\.link|peraichi\.com|utage-system\.com|ameblo\.jp|note\.com|hotpepper\.jp|beauty\.hotpepper\.jp|forms\.gle|docs\.google\.com|tayori\.com|formrun\.com|form\.run|hubspot\.com|hsforms\.com|calendly\.com|reserva\.be|airrsv\.net|coubic\.com|stores\.jp|base\.shop|thebase\.in|amazon\.co\.jp|rakuten\.co\.jp|wa\.me|m\.me|messenger\.com|onelink\.me|app\.link|myshopify\.com|teachable\.com|udemy\.com|mosh\.jp|teachme\.jp|lstep\.app|proline\.app|myasp\.jp|expa\.jp|dosmo\.jp|panda-lp\.com|lp\.)/i;

export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const human = (min = 3000, max = 6000) => sleep(min + Math.floor(Math.random() * (max - min)));

export function host(u) {
  try { const h = new URL(u.includes('://') ? u : 'http://' + u).hostname.toLowerCase(); return h.startsWith('www.') ? h.slice(4) : h; } catch { return ''; }
}
export function base(h) {
  const p = h.split('.');
  if (p.length >= 3 && ['co', 'or', 'ne', 'ac', 'go', 'gr', 'ed', 'lg'].includes(p[p.length - 2]) && p[p.length - 1] === 'jp') return p.slice(-3).join('.');
  return p.slice(-2).join('.');
}
export const norm = n => (n || '').replace(/(株式会社|有限会社|合同会社|一般社団法人|医療法人社団|医療法人|\(株\)|（株）|\(有\)|（有）|\s|　)/g, '');

// 除外リスト（used_domains.json・調べ済みドメイン.txt・既存社名.txt と、既にある候補TSV）
export function loadExclusions() {
  // GitHub Actions用：このフォルダの 除外ドメイン.txt・除外社名.txt（手元で作ってpushする）だけを読む
  const doms = new Set(); const names = new Set();
  const add = d => { d = (d || '').trim().toLowerCase().replace(/^www\./, ''); if (d) { doms.add(d); doms.add(base(d)); } };
  try { fs.readFileSync(DIR + '/除外ドメイン.txt', 'utf8').split('\n').forEach(add); } catch (e) { console.error('除外ドメイン.txt 読めず', e.message); }
  try { fs.readFileSync(DIR + '/除外社名.txt', 'utf8').split('\n').map(norm).filter(Boolean).forEach(n => names.add(n)); } catch (e) { console.error('除外社名.txt 読めず', e.message); }
  return { doms, names, hitDomain: d => !!d && (doms.has(d) || doms.has(base(d))), hitName: n => !!norm(n) && names.has(norm(n)) };
}

// ロボット確認・ログイン要求・利用制限の判定（出たら止める）
export async function blockCheck(page, site) {
  const url = page.url();
  let t = '';
  try { t = await page.evaluate(() => (document.body && document.body.innerText || '').slice(0, 4000)); } catch { }
  if (/\/login|\/checkpoint|accounts\.google\.com|\/sorry\//.test(url)) return `${site}: ログイン・確認画面へ移動（${url}）`;
  if (/ロボットではありません|unusual traffic|通常と異なるトラフィック|reCAPTCHA|captcha|セキュリティチェック|Security Check/i.test(t)) return `${site}: ロボット確認が表示`;
  if (/一時的にブロック|利用制限|Rate limit|Too Many Requests|しばらくしてから|You're Temporarily Blocked|制限されています/i.test(t)) return `${site}: 利用制限の表示`;
  if (site === 'Meta' && /ログインして続行|ログインしてください|Log in to continue|You must log in/i.test(t)) return `${site}: ログイン要求`;
  return null;
}

export function logStop(file, msg) {
  const line = `${new Date().toISOString()}\t${msg}\n`;
  fs.appendFileSync(file, line);
  console.error('止めた：' + msg);
}

export async function newBrowser() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ locale: 'ja-JP', userAgent: UA, viewport: { width: 1280, height: 900 } });
  return { browser, ctx };
}

export function args() {
  const a = {};
  for (const s of process.argv.slice(2)) { const m = s.match(/^--([^=]+)=(.*)$/); if (m) a[m[1]] = m[2]; else if (s.startsWith('--')) a[s.slice(2)] = true; }
  return a;
}
