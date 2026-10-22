// （10/22 GitHub Actions用に写した版。5番目の引数 k/n で組に分ける）
// 候補のフォームを開いて読む（入力欄・必須・初期値・文字数上限・認証・営業お断り・LINE）。
// ボタンは一切押さない。入力欄に値を入れて、本文が一字一句入るか・必須が埋まるかだけ確かめる。
// 使い方：node inspect.mjs 候補.json 出力.jsonl [並列数]
import fs from 'node:fs';
import { chromium } from 'playwright';
const { planForm, readPage } = await import(new URL('../../入力の判定.js', import.meta.url).href);
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const MSG = JSON.parse(fs.readFileSync(new URL('./messages.json', import.meta.url)));
const MID = { '自動車学校': 'MSG-LINE導入-v2', 'パーソナルジム': 'MSG-ジム-v5', '美容クリニック': 'MSG-美容クリニック-v5', 'オンラインスクール': 'MSG-オンラインスクール-v5', '住宅・リフォーム': 'MSG-住宅リフォーム-v5', '太陽光': 'MSG-太陽光-v5' };
const [, , inFile, outFile, par = '6'] = process.argv;
const cands = JSON.parse(fs.readFileSync(inFile));
const done = new Set(fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).key) : []);
const [pk, pn] = (process.argv[5] || '1/1').split('/').map(Number);
const todo = cands.filter((c, i) => !done.has(c.key) && i % pn === pk - 1);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

function extract() {
  const forms = [...document.querySelectorAll('form')];
  const count = (x) => x.querySelectorAll('input,textarea,select').length;
  const f = forms.sort((a, b) => count(b) - count(a))[0] || document;
  const root = f === document ? document.body : f;
  const visible = (e) => !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length);
  const other = (e, p) => [...p.querySelectorAll('input,textarea,select')].some((x) => x !== e && x.type !== 'hidden' && !(x.name && x.name === e.name));
  const lab = (e) => {
    let a = e;
    while (a.parentElement && a.parentElement !== document.body && !other(e, a.parentElement)) a = a.parentElement;
    let t = '';
    const prev = a.previousElementSibling;
    if (prev && !prev.querySelector('input,textarea,select')) t += (prev.innerText || '') + ' ';
    if (a !== e) t += (a.innerText || '');
    if (!t.trim() && e.id) { const l = document.querySelector('label[for="' + CSS.escape(e.id) + '"]'); if (l) t = l.innerText; }
    return (t + (e.placeholder ? ' 〔' + e.placeholder + '〕' : '')).replace(/\s+/g, ' ').trim().slice(0, 80);
  };
  const optText = (e) => { let t = ''; if (e.id) { const l = document.querySelector('label[for="' + CSS.escape(e.id) + '"]'); if (l) t = l.innerText; } const p = e.closest('label'); if (!t && p) t = p.innerText; return (t || e.value || '').replace(/\s+/g, ' ').trim(); };
  const els = root ? [...root.querySelectorAll('input,textarea,select')].filter((e) => !['hidden', 'submit', 'button', 'image', 'reset'].includes(e.type) && (visible(e) || e.type === 'checkbox' || e.type === 'radio')) : [];
  const out = []; const seen = new Set();
  for (const e of els) {
    if ((e.type === 'radio' || e.type === 'checkbox') && e.name) {
      const same = els.filter((x) => x.type === e.type && x.name === e.name);
      if (same.length > 1) {
        if (seen.has(e.type + e.name)) continue; seen.add(e.type + e.name);
        out.push({ kind: e.type + 'group', name: e.name, label: lab(same[0]).slice(0, 80), required: same.some((x) => x.required), options: same.map(optText), checked: same.filter((x) => x.checked).map(optText) });
        continue;
      }
    }
    const o = { kind: e.tagName === 'SELECT' ? 'select' : e.tagName === 'TEXTAREA' ? 'textarea' : e.type, name: e.name || e.id, label: lab(e), required: e.required || e.getAttribute('aria-required') === 'true', disabled: e.disabled };
    if (e.maxLength > 0) o.maxlength = e.maxLength;
    if (e.pattern) o.pattern = e.pattern;
    if (e.tagName === 'SELECT') { o.options = [...e.options].map((x) => x.text.trim()).slice(0, 30); o.selected = e.options[e.selectedIndex] ? e.options[e.selectedIndex].text.trim() : ''; }
    if (e.type === 'checkbox' || e.type === 'radio') { o.checked = e.checked; o.optText = optText(e); }
    if (e.type === 'file') o.file = true;
    if (!['checkbox','radio','select'].includes(o.kind)) o.value = (e.value || '').length > 150 ? '〈本文 ' + e.value.length + '字〉' : (e.value || '');
    out.push(o);
  }
  const html = document.documentElement.outerHTML;
  const scripts = [...document.querySelectorAll('script[src]')].map((s) => s.src);
  const cap = [];
  for (const s of scripts) {
    if (/recaptcha\/(api|enterprise)\.js/.test(s)) { const m = s.match(/render=([^&]+)/); cap.push(m && m[1] !== 'explicit' ? 'reCAPTCHA v3' : 'reCAPTCHA v2スクリプト'); }
    if (/hcaptcha/.test(s)) cap.push('hCaptcha');
    if (/challenges\.cloudflare\.com\/turnstile/.test(s)) cap.push('Turnstile');
  }
  for (const g of document.querySelectorAll('.g-recaptcha,[data-sitekey]')) {
    if (g.classList.contains('cf-turnstile')) { cap.push('Turnstile'); continue; }
    if (g.classList.contains('h-captcha')) { cap.push('hCaptcha'); continue; }
    cap.push(g.getAttribute('data-size') === 'invisible' ? 'reCAPTCHA v2（見えない形式）' : 'reCAPTCHA v2（チェック）');
  }
  if (document.querySelector('.cf-turnstile')) cap.push('Turnstile');
  if (document.querySelector('.h-captcha')) cap.push('hCaptcha');
  if (/wpcf7/.test(html) && /recaptcha/.test(html) && !cap.length) cap.push('reCAPTCHA（CF7の設定）');
  if (document.querySelector('img[src*="captcha" i],input[name*="captcha" i]:not([name*="recaptcha" i]):not([type=hidden]),img[src*="securimage" i],[class*="siimage" i]')) cap.push('画像の文字');
  const text = (document.body ? document.body.innerText : '');
  if (/\d\s*[+＋\-－×]\s*\d\s*[=＝]|計算(の答え|結果)|答えを(半角)?(数字で)?入力/.test(text)) cap.push('計算問題');
  const eigyo = [...new Set((text.match(/[^\n。]{0,40}(営業|セールス|勧誘|売り込み|販売促進|業者)[^\n。]{0,40}/g) || []))].slice(0, 8);
  const limits = [...new Set((text.match(/[^\n]{0,20}\d{2,5}\s*(文字|字)\s*(以内|まで|以下|程度)[^\n]{0,10}/g) || []))].slice(0, 5);
  const line = [...new Set([...document.querySelectorAll('a[href]')].map((a) => a.href).filter((h) => /lin\.ee|line\.me|liff\.line|page\.line/.test(h)))].slice(0, 5);
  const btns = root ? [...root.querySelectorAll('input[type=submit],input[type=button],input[type=image],button')].filter(visible).map((b) => ((b.value || '') + ' ' + (b.innerText || '') + ' ' + (b.alt || '')).trim()).slice(0, 6) : [];
  return { fields: out, captcha: [...new Set(cap)], eigyo, limits, line, btns, formAction: f && f.getAttribute ? f.getAttribute('action') : null, title: document.title, nForms: forms.length };
}
function topInfo() {
  const t = (s) => [...document.querySelectorAll(s)].map((e) => (e.innerText || e.content || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
  const line = [...new Set([...document.querySelectorAll('a[href]')].map((a) => a.href).filter((h) => /lin\.ee|line\.me|liff\.line|page\.line/.test(h)))].slice(0, 5);
  const md = document.querySelector('meta[name="description"]');
  return { title: document.title, desc: md ? md.content : '', h: [...t('h1'), ...t('h2')].slice(0, 12).map((x) => x.slice(0, 60)), text: (document.body ? document.body.innerText : '').replace(/\s+/g, ' ').slice(0, 1500), line, url: location.href };
}

async function inspectOne(browser, c) {
  const r = { key: c.key, industry: c.industry, name: c.name, official_url: c.official_url, form_url: c.form_url };
  const ctx = await browser.newContext({ userAgent: UA, locale: 'ja-JP', timezoneId: 'Asia/Tokyo', viewport: { width: 1280, height: 900 } });
  ctx.setDefaultTimeout(20000);
  try {
    const page = await ctx.newPage();
    page.on('dialog', (d) => d.dismiss().catch(() => {}));
    // トップ
    try {
      await page.goto(c.official_url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {});
      r.top = await page.evaluate(topInfo);
    } catch (e) { r.topError = String(e.message).split('\n')[0]; }
    // フォーム
    await page.goto(c.form_url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    await pause(2000);
    r.final_url = page.url();
    let frame = page.mainFrame(); let max = -1;
    for (const fr of page.frames()) { const n = await fr.evaluate(() => document.querySelectorAll('input,textarea,select').length).catch(() => -1); if (n > max) { max = n; frame = fr; } }
    r.frame = frame === page.mainFrame() ? 'main' : frame.url();
    r.ex = await frame.evaluate(extract);
    if (frame !== page.mainFrame()) { const m = await page.evaluate(extract).catch(() => null); if (m) { r.ex.captcha = [...new Set([...r.ex.captcha, ...m.captcha])]; r.ex.eigyo = [...new Set([...r.ex.eigyo, ...m.eigyo])]; r.ex.line = [...new Set([...r.ex.line, ...m.line])]; } }
    const rp = await frame.evaluate(readPage);
    r.refuse = rp.refuse; r.capVisible = rp.captcha;
    const body = MSG[MID[c.industry]].replace('{宛名}', c.name).replace('{観察}', '公式サイトに掲載されている施設の特徴や取り組みのご案内');
    r.bodyLen = body.length;
    const plan = await frame.evaluate(planForm, { body, fields: [] });
    r.plan = { fieldCount: plan.fieldCount, plan: (plan.plan || []).map((p) => ({ what: p.what, act: p.act, value: p.what === '本文' ? '本文' : p.value })), unknown: plan.unknown, notes: plan.notes, buttons: (plan.buttons || []).map((b) => b.kind + ':' + b.text) };
    // 値を入れて確かめる（ボタンは押さない）
    let bodyOk = false;
    for (const p of plan.plan || []) {
      const loc = frame.locator(p.sel).first();
      try {
        if (p.act === 'fill') await loc.fill(p.value, { timeout: 5000 });
        else if (p.act === 'select') await loc.selectOption(p.value, { timeout: 5000 });
        else if (p.act === 'check') await loc.check({ timeout: 5000, force: true }).catch(() => loc.evaluate((e) => { if (!e.checked) e.click(); }));
      } catch (e) { (r.fillErr = r.fillErr || []).push(p.what + '：' + String(e.message).split('\n')[0].slice(0, 80)); }
      if (p.what === '本文') bodyOk = (await loc.inputValue().catch(() => '')) === p.value;
    }
    r.bodyOk = bodyOk;
    r.invalid = await frame.evaluate(() => [...(([...document.querySelectorAll('form')].sort((a, b) => b.querySelectorAll('input,textarea,select').length - a.querySelectorAll('input,textarea,select').length)[0]) || document).querySelectorAll('input,textarea,select')]
      .filter((e) => e.willValidate && !e.checkValidity() && (e.offsetWidth || e.type === 'checkbox' || e.type === 'radio'))
      .filter((e) => (e.type === 'checkbox' || e.type === 'radio') ? !document.querySelector(`input[name="${CSS.escape(e.name)}"]:checked`) : true)
      .map((e) => (e.name || e.id || e.type) + '：' + e.validationMessage)).catch(() => []);
    r.capAfter = (await frame.evaluate(readPage)).captcha;
    r.after = (await frame.evaluate(extract)).fields;
  } catch (e) { r.error = String(e.message).split('\n')[0].slice(0, 200); }
  finally { await ctx.close().catch(() => {}); }
  return r;
}

const browser = await chromium.launch({ headless: true });
let i = 0;
async function worker() {
  while (i < todo.length) {
    const c = todo[i++];
    const r = await Promise.race([inspectOne(browser, c), pause(120000).then(() => ({ key: c.key, industry: c.industry, name: c.name, official_url: c.official_url, form_url: c.form_url, error: '2分を超えた' }))]);
    fs.appendFileSync(outFile, JSON.stringify(r) + '\n');
    process.stdout.write('.');
  }
}
await Promise.all(Array.from({ length: Number(par) }, worker));
await browser.close();
console.log('\n完了', todo.length);
