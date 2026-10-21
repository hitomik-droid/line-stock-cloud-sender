// フォームの各欄に何を入れるかを、ページの中で判定する（ページ内で実行される関数）。
// 土台は今夜の入力補助（/api/fill.js）。値を入れるのは送信.mjs 側（Playwrightの fill/check）で行う。
// 引数 d：ダッシュボードの送信データ（body・fields）。戻り値：入れる計画と、止まる理由の材料。
export function planForm(d) {
  const ME = {
    name: '勝良仁海', sei: '勝良', mei: '仁海',
    kana: 'カツラ ヒトミ', kanaSei: 'カツラ', kanaMei: 'ヒトミ',
    hira: 'かつら ひとみ', hiraSei: 'かつら', hiraMei: 'ひとみ',
    mail: 'hitomi.k@lincle-dreams.com', tel: '07089803196', tel3: ['070', '8980', '3196'],
    company: 'ADNEXT', subject: '公式LINE活用のご相談',
  };
  const forms = [...document.querySelectorAll('form')];
  const count = (x) => x.querySelectorAll('input,textarea,select').length;
  const f = forms.sort((a, b) => count(b) - count(a))[0] || document;
  const root = f === document ? document.body : f;
  if (!root || count(root) === 0) return { fieldCount: 0 };

  // ダッシュボードの入力内容に「〇〇」で書かれた選択肢（例：「質問・お問い合わせ」を選ぶ）
  const hints = [];
  for (const x of d.fields || []) for (const m of String(x.input_value || '').matchAll(/「([^」]+)」/g)) hints.push(m[1]);
  if ((d.fields || []).some((x) => /メール.*選/.test(x.input_value || ''))) hints.push('メール');

  const lab = (e) => {
    let t = '';
    if (e.id) { const l = document.querySelector('label[for="' + CSS.escape(e.id) + '"]'); if (l) t += l.innerText; }
    if (e.getAttribute('aria-label')) t += ' ' + e.getAttribute('aria-label');
    // ほかの入力欄を含まない、いちばん外側の囲み（と、その直前の見出し）を、この欄のラベルとみなす
    const other = (p) => [...p.querySelectorAll('input,textarea,select')].some((x) => x !== e && x.type !== 'hidden' && !(x.name && x.name === e.name));
    let a = e;
    while (a.parentElement && a.parentElement !== document.body && !other(a.parentElement)) a = a.parentElement;
    if (a !== e) t += ' ' + (a.innerText || '').slice(0, 60);
    const prev = a.previousElementSibling;
    if (prev && !prev.querySelector('input,textarea,select')) t += ' ' + (prev.innerText || '').slice(0, 40);
    return (t + ' ' + (e.placeholder || '') + ' ' + (e.name || '')).replace(/\s+/g, ' ');
  };
  const optText = (e) => {
    let t = e.value || '';
    if (e.id) { const l = document.querySelector('label[for="' + CSS.escape(e.id) + '"]'); if (l) t += ' ' + l.innerText; }
    const p = e.closest('label'); if (p) t += ' ' + p.innerText;
    return t.replace(/\s+/g, ' ');
  };
  const visible = (e) => !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length);
  let n = 0;
  const mark = (e) => { if (!e.dataset.ls) e.dataset.ls = String(++n); return '[data-ls="' + e.dataset.ls + '"]'; };
  const pickChoice = (texts) => {
    for (const h of hints) { const i = texts.findIndex((t) => t.includes(h)); if (i >= 0) return i; }
    let i = texts.findIndex((t) => /その他/.test(t)); if (i >= 0) return i;
    i = texts.findIndex((t) => /お問い?合わ?せ|ご質問|質問|一般|メール/.test(t)); return i;
  };

  const plan = []; const unknown = []; const notes = [];
  const els = [...root.querySelectorAll('input,textarea,select')].filter((e) =>
    !['hidden', 'submit', 'button', 'image', 'reset', 'file'].includes(e.type) && !e.disabled &&
    (visible(e) || e.type === 'checkbox' || e.type === 'radio'));

  // 本文：いちばん大きい textarea
  const tas = els.filter((e) => e.tagName === 'TEXTAREA').sort((a, b) => (b.rows || 0) - (a.rows || 0) || b.offsetHeight - a.offsetHeight);
  if (tas[0]) plan.push({ sel: mark(tas[0]), act: 'fill', value: d.body, what: '本文' });
  else notes.push('本文を貼る欄（textarea）が見つからない');

  const tels = els.filter((e) => e.tagName === 'INPUT' && /電話|tel|TEL|Tel|phone/.test(lab(e) + e.type) && !['checkbox', 'radio'].includes(e.type));
  for (const e of els) {
    if (e.tagName === 'TEXTAREA') { if (e !== tas[0] && e.required) unknown.push('textarea ' + lab(e).slice(0, 40)); continue; }
    const L = lab(e); const t = e.type;
    if (t === 'radio') continue;
    if (t === 'checkbox') {
      const same = els.filter((x) => x.type === 'checkbox' && x.name && x.name === e.name);
      if (same.length > 1) continue; // 選択肢の並び（下でまとめて扱う）
      if (/同意|プライバシー|個人情報|規約|間違い|承諾/.test(L)) plan.push({ sel: mark(e), act: 'check', what: '同意' });
      else if (e.required) unknown.push('checkbox ' + L.slice(0, 40));
      continue;
    }
    if (e.tagName === 'SELECT') {
      const o = [...e.options]; const i = pickChoice(o.map((x) => x.text));
      if (i >= 0 && /種別|項目|内容|カテゴリ|用件|区分|件名|目的|ご相談|お問い?合わ?せ|方法|連絡|返答|回答/.test(L)) plan.push({ sel: mark(e), act: 'select', value: o[i].value, what: '選択 ' + o[i].text });
      else if (e.required && !e.value) unknown.push('select ' + L.slice(0, 40));
      else if (e.value && o[e.selectedIndex] && !/選択|--|―|未選択/.test(o[e.selectedIndex].text)) notes.push('選択欄に初期値あり：' + L.slice(0, 30) + ' = ' + o[e.selectedIndex].text);
      continue;
    }
    let v = null;
    if (/メール|mail|Mail|MAIL/.test(L + t)) v = ME.mail;
    else if (tels.includes(e)) v = tels.length === 3 ? ME.tel3[tels.indexOf(e)] : ME.tel;
    else if (/フリガナ|カナ|ｶﾅ/.test(L)) v = /セイ|姓/.test(L) && !/メイ/.test(L) ? ME.kanaSei : (/メイ/.test(L) && !/セイ/.test(L) ? ME.kanaMei : ME.kana);
    else if (/ふりがな|かな|フリ/.test(L)) v = /せい|姓/.test(L) && !/めい/.test(L) ? ME.hiraSei : (/めい/.test(L) && !/せい/.test(L) ? ME.hiraMei : ME.hira);
    else if (/セイ/.test(L) && !/メイ/.test(L)) v = ME.kanaSei;
    else if (/メイ/.test(L) && !/セイ/.test(L)) v = ME.kanaMei;
    else if (/会社|社名|法人|御社|貴社|団体|企業|店舗名|屋号/.test(L)) v = ME.company;
    else if (/件名|題名|タイトル|subject|Subject/.test(L)) v = ME.subject;
    else if (/姓/.test(L) && !/名前|氏名/.test(L)) v = ME.sei;
    else if (/^ ?名 |名（|名\(| 名$/.test(L) && !/氏名|名前/.test(L)) v = ME.mei;
    else if (/（名）|\(名\)/.test(L)) v = ME.mei;
    else if (/（姓）|\(姓\)/.test(L)) v = ME.sei;
    else if (/名前|氏名|お名前|担当者|NAME|Name|name/.test(L)) v = ME.name;
    if (v !== null) plan.push({ sel: mark(e), act: 'fill', value: v, what: L.slice(0, 20) });
    else if (e.required || e.getAttribute('aria-required') === 'true') unknown.push('input ' + L.slice(0, 40));
  }

  // ラジオと、同じ name のチェックボックスの並び
  const groups = {};
  for (const e of els.filter((x) => x.type === 'radio' || x.type === 'checkbox')) {
    if (!e.name) continue;
    const same = els.filter((x) => x.type === e.type && x.name === e.name);
    if (e.type === 'checkbox' && same.length < 2) continue;
    (groups[e.type + ':' + e.name] = groups[e.type + ':' + e.name] || []).push(e);
  }
  for (const [k, rs] of Object.entries(groups)) {
    const L = lab(rs[0]); const i = pickChoice(rs.map(optText));
    const req = rs.some((r) => r.required);
    if (i >= 0 && (req || /種別|項目|内容|カテゴリ|用件|区分|目的|ご相談|方法|連絡|返答|回答|お問い?合わ?せ/.test(L))) plan.push({ sel: mark(rs[i]), act: 'check', what: '選択 ' + optText(rs[i]).slice(0, 20) });
    else if (req && !rs.some((r) => r.checked)) unknown.push(k + ' ' + L.slice(0, 40));
  }

  // ボタン（確認・送信）
  const btns = [...root.querySelectorAll('input[type=submit],input[type=button],input[type=image],button,[role=button]')]
    .filter((b) => visible(b) && b.type !== 'reset')
    .map((b) => ({ sel: mark(b), text: ((b.value || '') + ' ' + (b.innerText || '') + ' ' + (b.alt || '')).trim() }));
  const kind = (t) => /確認/.test(t) && !/送信|送る/.test(t) ? 'confirm' : (/送信|送る|submit|send|申し?込|問い?合わ?せ|同意して/i.test(t) ? 'submit' : '');
  for (const b of btns) b.kind = kind(b.text);
  return { fieldCount: count(root), plan, unknown, notes, buttons: btns.filter((b) => b.kind) };
}

// ページ全体の文字から読む材料（営業お断り・認証・完了・エラー）
export function readPage() {
  const text = (document.body ? document.body.innerText : '').replace(/[ \t]+/g, ' ');
  const refuse = text.match(/[^\n。]{0,30}((営業|セールス|勧誘|売り込み)[^\n。]{0,30}(お断り|ご遠慮|禁止|控え|受け付けて?(い)?ません|おりません|しかねます|お答えでき)|(お断り|ご遠慮)[^\n。]{0,10}(営業|セールス|勧誘))[^\n。]{0,20}/g) || [];
  const shown = (s) => [...document.querySelectorAll(s)].some((e) => e.offsetWidth > 30 && e.offsetHeight > 30);
  const captcha = [];
  for (const fr of document.querySelectorAll('iframe')) {
    const src = fr.src || '';
    if (/recaptcha\/(api2|enterprise)\/anchor/.test(src) && !/size=invisible/.test(src) && fr.offsetWidth > 30) captcha.push('reCAPTCHA（チェック）');
    if (/recaptcha\/(api2|enterprise)\/bframe/.test(src) && fr.offsetHeight > 100) captcha.push('reCAPTCHA（画像選択）');
    if (/hcaptcha/.test(src) && fr.offsetWidth > 30) captcha.push('hCaptcha');
  }
  if (shown('.cf-turnstile,iframe[src*="challenges.cloudflare.com"]')) {
    const tok = document.querySelector('input[name="cf-turnstile-response"]');
    if (!tok || !tok.value) captcha.push('Turnstile');
  }
  if (shown('img[src*="captcha" i],input[name*="captcha" i]') || /画像の文字|表示されている文字|画像に表示|計算(の答え|結果)|\d\s*[+＋]\s*\d\s*[=＝]/.test(text)) captcha.push('画像・計算の認証');
  const thanks = /ありがとうございま|送信(が)?完了|送信いたしました|送信しました|受け付けました|受け付けいたしました|受付(が)?完了|送信されました|回答を記録しました|thank you|お問い合わせを受け付け/i.test(text);
  const errors = text.match(/[^\n]{0,20}((入力|選択|チェック)(して|され)?(下さい|ください)|必須項目です|正しく入力|入力内容に誤り|エラーが発生|送信に失敗|失敗しました)[^\n]{0,10}/g) || [];
  return { url: location.href, refuse, captcha: [...new Set(captcha)], thanks, errors: [...new Set(errors)].slice(0, 5), text: text.slice(0, 4000) };
}
