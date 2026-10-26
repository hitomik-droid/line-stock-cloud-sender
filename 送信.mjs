// LINEストックのフォーム営業：会社ID 1つ分を、画面を出さないChromiumで入力・確認・送信する。
// 使い方：node 送信.mjs <会社ID> [--mode=dry|confirm|send] [--headed] [--retry-recaptcha]
//   --headed          画面を出し、インストール済みのChromeで動かす（reCAPTCHA v3で弾かれにくくする）
//   --retry-recaptcha 「送信時にエラー表示：…reCAPTCHA…」で送付失敗になった会社を1回だけ送り直す
//   dry     入力だけして止める（ボタンは押さない）。既定。
//   confirm 「確認」ボタンだけ押し、確認画面で止める（送信ボタンは押さない）。
//   send    送信まで行い、ダッシュボードのステータスを更新する。
// 決まり：送るのはダッシュボードで「確認中」の会社だけ。送信ボタンは1社1回まで。認証（CAPTCHA）は解かない。
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { planForm, readPage } from './入力の判定.js';
import { prepareCompanyTracking } from './追跡/会社別URL.mjs';

// LS_API は手元の試験用（偽のダッシュボードに向ける）。ふだんは付けない
export const API = process.env.LS_API || 'https://line-stock-product-plan.hitomi-k.workers.dev/api/sales';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const TODAY = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10).replace(/-/g, '');
const REC = path.join(HERE, '記録', TODAY);
const LIMIT_MS = 10 * 60e3; // 1社10分まで

// ダッシュボードが一時的に 5xx を返す・つながらない時は、間をあけて最大6回まで試す
async function fetchRetry(url, opt = {}) {
  let last;
  for (const wait of [0, 3000, 6000, 12000, 24000, 48000]) {
    if (wait) await new Promise((r) => setTimeout(r, wait));
    try {
      const r = await fetch(url, opt);
      if (r.status < 500) return r;
      last = new Error(`${url} → ${r.status}`);
    } catch (e) { last = e; }
  }
  throw last;
}
export async function getJSON(url) {
  const r = await fetchRetry(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.json();
}
export async function setStatus(id, status, note) {
  const r = await fetchRetry(`${API}/${id}/status`, {
    method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/json' },
    // 10/26 担当の記録：LS_SENDER（Claude／Codex／朝の自動送付 など）を状態の履歴の source に残す
    body: JSON.stringify({ status, note: note.slice(0, 500), source: process.env.LS_SENDER || 'Actions（担当の指定なし）' }),
  });
  if (!r.ok) throw new Error(`ステータス更新に失敗 ${id} → ${r.status} ${await r.text()}`);
}

const MANUAL_NOTE = /画像認証あり|計算問題|人が答える|人が読んで/;

// 送り直してよい会社：送付失敗で、最新のメモが「送信時にエラー表示」かつ reCAPTCHA の失敗（相手のサーバーが受け付けを断った表示）。
// 一度送り直した会社（メモに「再試行」がある）は対象にしない。
export function recaptchaRetryable(c) {
  if (!c || c.status !== '送付失敗') return false;
  const h = c.history || [];
  if (h.some((x) => /再試行/.test(x.note || ''))) return false;
  const last = h[0];
  return !!last && last.to_status === '送付失敗' && /^送信時にエラー表示/.test(last.note || '') && /reCAPTCHA[^。]*(失敗|failed)/i.test(last.note || '');
}
async function companyFromList(id) {
  const all = await getJSON(API);
  return all.companies.find((c) => c.id === id);
}
export async function launchBrowser(headed) {
  return headed ? chromium.launch({ headless: false, channel: 'chrome' }) : chromium.launch({ headless: true });
}

// 入力欄がいちばん多いフレームを選ぶ（フォームが iframe の中にある場合に備える）
async function pickFrame(page) {
  let best = page.mainFrame(); let max = -1;
  for (const fr of page.frames()) {
    const c = await fr.evaluate(() => document.querySelectorAll('input,textarea,select').length).catch(() => -1);
    if (c > max) { max = c; best = fr; }
  }
  return best;
}
async function readAll(page) {
  const parts = [];
  for (const fr of page.frames()) { const r = await fr.evaluate(readPage).catch(() => null); if (r) parts.push(r); }
  const main = parts[0] || { url: page.url(), refuse: [], captcha: [], thanks: false, errors: [], text: '' };
  return {
    url: page.url(),
    refuse: [...new Set(parts.flatMap((p) => p.refuse))],
    captcha: [...new Set(parts.flatMap((p) => p.captcha))],
    thanks: parts.some((p) => p.thanks),
    thanksLines: [...new Set(parts.flatMap((p) => p.thanksLines || []))],
    confirmPage: parts.some((p) => p.confirmPage),
    sending: parts.some((p) => p.sending),
    errors: [...new Set(parts.flatMap((p) => p.errors))],
    text: main.text,
  };
}
// 認証の理由の文。画面に出ない reCAPTCHA v3 は、押しても相手が受け付けない（10/26 CF7のspam）ので押さずに止める（10/22の決まり）
const capWhy = (c) => c.every((x) => /v3/.test(x)) ? `画面に出ない認証（${c.join('・')}）があるため送らない（押しても相手に弾かれる）` : `人の操作が要る認証（${c.join('・')}）のため手で送る`;
const newOnes = (after, before) => after.filter((x) => !before.includes(x));
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function settle(page) {
  await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  await pause(2500);
}

    // 確認画面の送信ボタンを探す。確認画面は入力欄が無いことがあり planForm では見つからないので、ボタンだけを見る
async function findSubmit(page) {
  for (const fr of page.frames()) {
    const b = await fr.evaluate(() => {
      const vis = (e) => !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length);
      const el = [...document.querySelectorAll('input[type=submit],input[type=button],input[type=image],button,[role=button]')]
        .filter((e) => vis(e) && e.type !== 'reset')
        .find((e) => { const t = ((e.value || '') + ' ' + (e.innerText || '') + ' ' + (e.alt || '')).trim(); return /送信|送る|submit|send|申し?込|問い?合わ?せ|同意して/i.test(t) && !/確認|修正|戻る/.test(t); });
      if (!el) return null;
      el.dataset.lsFinal = '1';
      return { sel: '[data-ls-final="1"]', text: ((el.value || '') + ' ' + (el.innerText || '')).trim() };
    }).catch(() => null);
    if (b) return { frame: fr, btn: b };
  }
  return null;
}

async function applyPlan(frame, plan) {
  const done = [];
  for (const p of plan) {
    const loc = frame.locator(p.sel).first();
    try {
      if (p.act === 'fill') await loc.fill(p.value, { timeout: 5000 });
      else if (p.act === 'select') await loc.selectOption(p.value, { timeout: 5000 });
      else if (p.act === 'check') { await loc.check({ timeout: 5000, force: true }).catch(() => loc.evaluate((e) => { if (!e.checked) e.click(); })); await loc.evaluate((e) => { if (e.checked) return; const l = (e.id && document.querySelector('label[for="' + CSS.escape(e.id) + '"]')) || e.closest('label'); if (l) l.click(); if (!e.checked) { e.checked = true; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); } }).catch(() => {}); }
      done.push([p.what, p.act === 'fill' && p.what === '本文' ? `本文 ${p.value.length}字` : (p.value ?? 'ON')]);
    } catch (e) {
      done.push([p.what, '入力できず：' + String(e.message).split('\n')[0]]);
    }
  }
  // 本文が一字一句入ったか読み戻す
  const body = plan.find((p) => p.what === '本文');
  const bodyOk = body ? (await frame.locator(body.sel).first().inputValue().catch(() => '')) === body.value : false;
  return { done, bodyOk };
}

async function invalidFields(frame) {
  return frame.evaluate(() => [...((document.querySelector('textarea[data-ls]') || {}).form || document).querySelectorAll('input,textarea,select')]
    .filter((e) => e.willValidate && !e.checkValidity() && (e.offsetWidth || e.type === 'checkbox' || e.type === 'radio'))
    // 入力前に付いた古いエラー表示は数えない（空のまま・未選択のものだけ）
    .filter((e) => (e.type === 'checkbox' || e.type === 'radio') ? !document.querySelector(`input[name="${CSS.escape(e.name)}"]:checked`) : !e.value)
    .map((e) => (e.name || e.id || e.type) + '：' + e.validationMessage)).catch(() => []);
}

async function clickOnce(frame, sel) {
  await frame.locator(sel).first().click({ timeout: 10000, noWaitAfter: true }).catch(async () => {
    await frame.locator(sel).first().evaluate((b) => b.click());
  });
}

// 1社分。戻り値：{ id, name, result, status, note, log }
// retryIds：送り直してよい会社IDの一覧（本人が送り直しを指示し、送れていないと分かっている会社だけ）。渡した時はこの一覧で判定する
// 2026-10-26 勝良さん指示：フォーム営業の送信はビジネスアワー（日本時間8:00〜20:00）だけ。時間外は送信まで進まない
export function inSendHours(now = new Date()) {
  const h = new Date(now.getTime() + 9 * 3600e3).getUTCHours();
  return h >= 8 && h < 20;
}

export async function sendOne(id, mode = 'dry', { browser: shared, headed = false, retry = false, retryIds = null } = {}) {
  if (mode !== 'dry' && !inSendHours()) return { id, mode, result: 'skip', status: null, note: '送付時間外（日本時間8:00〜20:00だけ送る）なので送らない', log: [] };
  const canRetry = (c) => retryIds ? !!c && c.status === '送付失敗' && retryIds.has(c.id) && !(c.history || []).some((x) => /再試行/.test(x.note || '')) : recaptchaRetryable(c);
  const log = []; const say = (...a) => { log.push(a.join(' ')); };
  fs.mkdirSync(REC, { recursive: true });
  const d = await getJSON(`${API}/${id}/send-data`);
  const out = { id, name: d.name, mode, form_url: d.form_url, status: null, note: '', log };
  const wantStatus = retry ? '送付失敗' : '確認中';
  if (d.status !== wantStatus) { out.result = 'skip'; out.note = `ステータスが「${d.status}」なので触らない`; return out; }
  if (retry && !canRetry(await companyFromList(id))) { out.result = 'skip'; out.note = '送り直してよい会社ではないので、送り直さない'; return out; }
  // 2026-10-24 依頼：設計図URLだけ会社別にする。本文の文章・入力値・送信判定は変えない。
  const tracking = prepareCompanyTracking(d.body, id);
  d.body = tracking.body;
  out.tracking_urls = tracking.urls;
  if (tracking.urls.length) say('会社別追跡URL：', JSON.stringify(tracking.urls));
  const tag = (retry ? '再試行・' : '') + (headed ? '画面あり' : '');
  if (mode === 'send' && !retry && MANUAL_NOTE.test(d.form_note || '')) {
    out.status = '送付失敗'; out.note = `人の操作が要る認証のため手で送る（${d.form_note}） ${d.form_url}`; out.result = 'manual';
    await setStatus(id, out.status, out.note); return out;
  }

  const browser = shared || await launchBrowser(headed);
  // 画面ありのChromeでは、ブラウザ本来の User-Agent をそのまま使う
  const ctx = await browser.newContext({ ...(headed ? {} : { userAgent: UA }), locale: 'ja-JP', timezoneId: 'Asia/Tokyo', viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on('dialog', (dlg) => { say('ダイアログ：', dlg.message()); dlg.accept().catch(() => {}); });
  const shot = (step) => page.screenshot({ path: path.join(REC, `${id}_${step}.png`), fullPage: true }).catch(() => {});
  let clickedSubmit = false;

  const decide = (status, note, result) => { out.status = status; out.note = note; out.result = result; };
  const deferOutsideHours = () => {
    if (inSendHours()) return false;
    decide(null, '送付時間外（日本時間8:00〜20:00だけ送る）。ボタンを押さず翌朝へ保留', 'deferred');
    return true;
  };
  const work = (async () => {
    await page.goto(d.form_url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await settle(page);
    let frame = await pickFrame(page);
    const plan = await frame.evaluate(planForm, { body: d.body, fields: d.fields });
    out.plan = plan;
    if (!plan.fieldCount) return decide('送付失敗', `フォームが見つからない ${d.form_url}`, 'stop');
    const before = await readAll(page);
    if (before.refuse.length) return decide('除外', `営業お断りの表記：「${before.refuse[0].trim()}」`, 'stop');

    const filled = await applyPlan(frame, plan.plan);
    out.filled = filled.done;
    await pause(1500);
    await shot('1_入力後');
    const afterFill = await readAll(page);
    const invalid = await invalidFields(frame);
    out.check = { unknown: plan.unknown, notes: plan.notes, invalid, captcha: afterFill.captcha, buttons: plan.buttons.map((b) => `${b.kind}:${b.text}`), bodyOk: filled.bodyOk };
    say('入力：', JSON.stringify(filled.done));
    if (afterFill.captcha.length) return decide('送付失敗', `${capWhy(afterFill.captcha)} ${d.form_url}`, 'manual');
    if (!filled.bodyOk) return decide('送付失敗', `本文が一字一句入らなかった ${d.form_url}`, 'stop');
    if (plan.unknown.length || invalid.length) return decide('送付失敗', `自動で埋められない必須欄：${[...plan.unknown, ...invalid].join(' / ').slice(0, 200)} ${d.form_url}`, 'stop');
    if (plan.notes.some((x) => /初期値/.test(x))) return decide('送付失敗', `${plan.notes.join(' / ')}（事実と違う値か要確認） ${d.form_url}`, 'stop');
    if (mode === 'dry') return decide(null, '入力まで（ボタンは押していない）', 'dry-ok');

    const confirmBtn = plan.buttons.find((b) => b.kind === 'confirm');
    let submitBtn = plan.buttons.find((b) => b.kind === 'submit');
    let state = afterFill;
    if (confirmBtn) {
      if (deferOutsideHours()) return;
      await clickOnce(frame, confirmBtn.sel);
      await settle(page);
      state = await readAll(page);
      await shot('2_確認画面');
      if (state.thanks && !afterFill.thanks) {
        // 「確認」ボタンで送信まで進むフォームだった
        clickedSubmit = true;
        return decide('送付完了', `クラウド送信（Playwright）が送信。確認ボタンで送信まで進んだ。完了画面「${(state.text.match(/[^\n]*(ありがとう|完了|受け付け)[^\n]*/) || [''])[0].slice(0, 80)}」`, 'sent');
      }
      const errs = newOnes(state.errors, afterFill.errors);
      if (errs.length) return decide('送付失敗', `確認に進めない：${errs.join(' / ').slice(0, 200)} ${d.form_url}`, 'stop');
      if (state.refuse.length) return decide('除外', `確認画面に営業お断りの表記：「${state.refuse[0].trim()}」`, 'stop');
      if (state.captcha.length) return decide('送付失敗', `${capWhy(state.captcha)} ${d.form_url}`, 'manual');
      // 確認画面の表示を待つ（最大15秒、送信ボタンが出るまで）
      for (let t = 0; t < 10 && !submitBtn; t++) {
        frame = await pickFrame(page);
        const p2 = await frame.evaluate(planForm, { body: d.body, fields: d.fields }).catch(() => ({ buttons: [] }));
        submitBtn = (p2.buttons || []).find((b) => b.kind === 'submit');
        if (!submitBtn && (await readAll(page)).confirmPage) { const f2 = await findSubmit(page); if (f2) { frame = f2.frame; submitBtn = f2.btn; } }
        if (!submitBtn) await pause(1500);
      }
      if (!submitBtn) {
        const stillInput = await frame.evaluate((body) => [...document.querySelectorAll('textarea')].some((t) => t.offsetWidth && t.value === body), d.body).catch(() => false);
        return decide('送付失敗', stillInput ? `確認ボタンを押しても入力画面のまま（確認画面に進めない） ${d.form_url}` : `確認画面で送信ボタンが見つからない ${d.form_url}`, 'stop');
      }
      if (!state.text.includes('hitomi.k@lincle-dreams.com')) say('注意：確認画面にメールアドレスの表示が見当たらない');
      if (mode === 'confirm') return decide(null, `確認画面まで（送信ボタン「${submitBtn.text}」は押していない）`, 'confirm-ok');
    } else if (mode === 'confirm') {
      return decide(null, `確認ボタンがなく、次は送信ボタン「${submitBtn ? submitBtn.text : 'なし'}」。押していない`, 'confirm-ok');
    }
    if (!submitBtn) return decide('送付失敗', `送信ボタンが見つからない ${d.form_url}`, 'stop');

    // 送信の直前に、ほかの送り手が先に送っていないかを確かめる
    const now = retry ? await companyFromList(id) : await getJSON(`${API}/${id}/send-data`);
    if (!now || now.status !== wantStatus || (retry && !canRetry(now))) { out.result = 'skip'; out.note = `送信直前にステータスが「${now && now.status}」に変わっていたので送らない`; return; }
    const pre = await readAll(page);
    const url0 = page.url();
    if (deferOutsideHours()) return;
    clickedSubmit = true;
    await clickOnce(frame, submitBtn.sel);
    await settle(page);
    // フォームの部品が出す完了・失敗の印（画面が切り替わらないフォーム用）。iframe の中のフォームもあるので全フレームを見る
    const formState = async () => {
      let cf7 = ''; let ok = false;
      for (const fr of page.frames()) {
        const s = await fr.evaluate(() => {
          const f = document.querySelector('form.wpcf7-form');
          const ok = document.querySelector('.elementor-message-success,.wpforms-confirmation-container,.wpforms-confirmation-container-full,.mw_wp_form_complete,.smf-complete-content,.snow-monkey-form--complete,.formrun-system-show[data-formrun-show-if-success]');
          return { cf7: f ? (f.getAttribute('data-status') || f.className) : '', ok: !!(ok && ok.offsetHeight) };
        }).catch(() => null);
        if (s) { cf7 = cf7 || s.cf7; ok = ok || s.ok; }
      }
      return { cf7, ok };
    };
    const DONE_URL = /thank|complete|cmp|finish|done|kanryo|success|formResponse/i;
    // 送信ボタンを押した後の画面が、まだ確認画面で送信ボタンが残っているか
    const submitLeft = () => findSubmit(page);
    // 送れた印があるか。完了の文言は、送信前の画面に無かった行だけを数える（「ご覧いただきありがとうございます」等の常設の文言で誤らないため）
    const isDone = async (fin, fs, before, u0) => {
      if (/\bsent\b/.test(fs.cf7) || fs.ok) return true;
      const moved = page.url() !== u0;
      const newThanks = newOnes(fin.thanksLines, before.thanksLines).length > 0 || (fin.thanks && !before.thanks);
      if (newThanks && !(fin.confirmPage && await submitLeft())) return true;
      if (moved && !fin.confirmPage && (fin.thanks || DONE_URL.test(page.url()))) return true;
      return false;
    };
    // 完了・失敗の表示を待つ（最大25秒。「送信中です」と出ている間は最大45秒）。URLが変わった直後は中身がまだ出ていないので、待ってから読み直す
    const waitResult = async (before, u0) => {
      let fin, fs;
      for (let t = 0; t < 30; t++) {
        fin = await readAll(page);
        fs = await formState();
        const changed = newOnes(fin.thanksLines, before.thanksLines).length || (fin.thanks && !before.thanks) || page.url() !== u0 || fs.ok || /\b(sent|failed|spam|aborted|invalid)\b/.test(fs.cf7) || fin.captcha.length || newOnes(fin.errors, before.errors).length;
        if ((changed && !fin.sending) || (t >= 16 && !fin.sending)) break;
        await pause(1500);
      }
      await settle(page);
      return { fin: await readAll(page), fs: await formState() };
    };
    let { fin, fs } = await waitResult(pre, url0);
    let base = pre; let baseUrl = url0;
    // 押したボタンが「送信内容を確認」のようなボタンで、確認画面に進んだだけの時は、確認画面の送信ボタンを1回だけ押す（まだ送っていないので二重送信にならない）
    if (!(await isDone(fin, fs, pre, url0)) && fin.confirmPage && !fin.captcha.length && !newOnes(fin.errors, pre.errors).length) {
      const left = await submitLeft();
      if (left) {
        await shot('2_確認画面');
        if (fin.refuse.length) return decide('除外', `確認画面に営業お断りの表記：「${fin.refuse[0].trim()}」`, 'stop');
        const again = retry ? await companyFromList(id) : await getJSON(`${API}/${id}/send-data`);
        if (!again || again.status !== wantStatus) { out.result = 'skip'; out.note = `確認画面で送信直前にステータスが「${again && again.status}」に変わっていたので送らない`; return; }
        say('送信ボタンの後に確認画面が出たので、確認画面の送信ボタン「' + left.btn.text + '」を押す');
        base = fin; baseUrl = page.url();
        frame = left.frame;
        if (deferOutsideHours()) return;
        await clickOnce(frame, left.btn.sel);
        await settle(page);
        ({ fin, fs } = await waitResult(base, baseUrl));
      }
    }
    await shot('3_送信後');
    if (/\bsent\b/.test(fs.cf7) || fs.ok) {
      return decide('送付完了', `クラウド送信（Playwright）が送信。完了の表示を確認（${/\bsent\b/.test(fs.cf7) ? 'Contact Form 7：送信済み' : '送信完了の表示'}）`, 'sent');
    }
    if (/\b(failed|spam|aborted)\b/.test(fs.cf7)) {
      return decide('送付失敗', `送信時にエラー表示：メッセージの送信に失敗（Contact Form 7：${(fs.cf7.match(/\b(failed|spam|aborted)\b/) || [''])[0]}）。送れていない見込み。再送しない ${d.form_url}`, 'unknown');
    }
    const thanksLine = (newOnes(fin.thanksLines, base.thanksLines)[0] || (fin.text.match(/[^\n]*(ありがとう|完了|受け付け|送信(いた)?しました|thank|submission)[^\n]*/i) || [''])[0]).trim().slice(0, 80);
    if (await isDone(fin, fs, base, baseUrl)) {
      return decide('送付完了', `クラウド送信（Playwright）が送信。完了画面「${thanksLine || page.url()}」`, 'sent');
    }
    if (fin.captcha.length) return decide('送付失敗', `送信時に認証（${fin.captcha.join('・')}）が出た。送れていない見込み。再送せず、相手の受信を確かめてから手で送る ${d.form_url}`, 'unknown');
    const errs = newOnes(fin.errors, base.errors);
    if (errs.length) return decide('送付失敗', `送信時にエラー表示：${errs.join(' / ').slice(0, 150)}。送れていない見込み。再送しない ${d.form_url}`, 'unknown');
    if (fin.confirmPage && await submitLeft()) return decide('送付失敗', `確認画面で止まった（最後の送信ボタンが効かない）。送れていない見込み。再送しない（送信後の画面：${page.url()}） ${d.form_url}`, 'unknown');
    return decide('送付失敗', `送れたか不明。再送しない（送信後の画面：${page.url()}） ${d.form_url}`, 'unknown');
  })();

  let timer;
  const timeout = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('10分を超えた')), LIMIT_MS); });
  try {
    await Promise.race([work, timeout]);
  } catch (e) {
    await shot('9_エラー');
    if (clickedSubmit) decide('送付失敗', `送信ボタンを押した後に止まった（${String(e.message).split('\n')[0]}）。送れたか不明。再送しない ${d.form_url}`, 'unknown');
    else decide('送付失敗', `送信前に止まった：${String(e.message).split('\n')[0].slice(0, 150)} ${d.form_url}`, 'stop');
  } finally {
    clearTimeout(timer);
    await ctx.close().catch(() => {});
    if (!shared) await browser.close().catch(() => {});
  }
  if (tag && out.note) out.note = `（${tag}）${out.note}`;
  if (mode === 'send' && out.status) {
    try {
      await setStatus(id, out.status, out.note);
    } catch (e) {
      // 送った後にステータスを書けなかった会社は「確認中」のまま残るので、次の実行で二重に送らないよう記録して知らせる
      out.statusFailed = true;
      out.result = 'status-failed';
      out.note = `ダッシュボードに書けなかった（${String(e.message).slice(0, 80)}）。本来のステータス「${out.status}」：${out.note}`;
    }
  }
  fs.mkdirSync(path.join(HERE, '記録'), { recursive: true });
  fs.appendFileSync(path.join(HERE, '記録', '送信ログ.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...out, log: undefined }) + '\n');
  return out;
}

// 直接実行された時
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const id = process.argv[2];
  const mode = (process.argv.find((a) => a.startsWith('--mode=')) || '--mode=dry').split('=')[1];
  const headed = process.argv.includes('--headed');
  const retry = process.argv.includes('--retry-recaptcha');
  if (!id || !['dry', 'confirm', 'send'].includes(mode)) {
    console.error('使い方：node 送信.mjs <会社ID> [--mode=dry|confirm|send] [--headed] [--retry-recaptcha]'); process.exit(2);
  }
  const r = await sendOne(id, mode, { headed, retry });
  console.log(JSON.stringify(r, null, 2));
}
