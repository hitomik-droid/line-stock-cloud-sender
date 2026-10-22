// フォームの各欄に何を入れるかを、ページの中で判定する（ページ内で実行される関数）。
// 土台は今夜の入力補助（/api/fill.js）。値を入れるのは送信.mjs 側（Playwrightの fill/check）で行う。
// 引数 d：ダッシュボードの送信データ（body・fields）。戻り値：入れる計画と、止まる理由の材料。
export function planForm(d) {
  const ME = {
    name: '勝良仁海', sei: '勝良', mei: '仁海',
    kana: 'カツラ ヒトミ', kanaSei: 'カツラ', kanaMei: 'ヒトミ',
    hira: 'かつら ひとみ', hiraSei: 'かつら', hiraMei: 'ひとみ',
    mail: 'hitomi.k@lincle-dreams.com', tel: '07089803196', tel3: ['070', '8980', '3196'],
    company: 'ADNEXT', subject: '公式LINE活用のご相談', pref: '東京都',
  };
  // 10/22夜 勝良さん指示（落ちた会社を拾う）：都道府県は東京都。住所・郵便番号は正本に無いので入れない（止まる）
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
      if (/営業|セールス|勧誘/.test(L)) { if (e.required) unknown.push('checkbox ' + L.slice(0, 40)); continue; } // 「営業目的ではありません」などにはチェックしない
      const same = els.filter((x) => x.type === 'checkbox' && x.name && x.name === e.name);
      if (same.length > 1) continue; // 選択肢の並び（下でまとめて扱う）
      if (/同意|プライバシー|個人情報|規約|間違い|承諾|了承|内容を確認|確認しました|確認の上|確認して|確認後|スパム|ロボット|agree|privacy|accept/i.test(L)) plan.push({ sel: mark(e), act: 'check', what: '同意' });
      else if (e.required) unknown.push('checkbox ' + L.slice(0, 40));
      continue;
    }
    if (e.tagName === 'SELECT') {
      const o = [...e.options]; const i = pickChoice(o.map((x) => x.text));
      const pi = o.findIndex((x) => x.text.trim() === ME.pref);
      if (pi >= 0 && /都道府県|pref/i.test(L)) { plan.push({ sel: mark(e), act: 'select', value: o[pi].value, what: '選択 ' + ME.pref }); continue; }
      if (i >= 0 && /種別|項目|内容|カテゴリ|用件|区分|件名|目的|ご相談|お問い?合わ?せ|方法|連絡|返答|返信|回答/.test(L)) plan.push({ sel: mark(e), act: 'select', value: o[i].value, what: '選択 ' + o[i].text });
      else if (i >= 0 && /その他/.test(o[i].text) && (e.required || /必須|\*|※/.test(L)) && !/店|校|院|教室|クリニック|地域|エリア|学年|性別|年齢|予算|時期|日|時間|免許|車種|コース|プラン|カタログ|資料/.test(L)) plan.push({ sel: mark(e), act: 'select', value: o[i].value, what: '選択 ' + o[i].text });
      else if (e.required && !e.value) unknown.push('select ' + L.slice(0, 40));
      else if (e.value && o[e.selectedIndex] && !/選択|--|―|未選択/.test(o[e.selectedIndex].text)) notes.push('選択欄に初期値あり：' + L.slice(0, 30) + ' = ' + o[e.selectedIndex].text);
      continue;
    }
    let v = null;
    const ph = e.placeholder || '';
    if (/メール|mail|Mail|MAIL/.test(L + t)) v = ME.mail;
    else if (/^(都道府県|pref|prefecture)$/i.test((e.name || '').replace(/^.*[\[_-]/, '').replace(/\]$/, '')) || /^ ?都道府県/.test(L)) v = ME.pref;
    else if (/kana|furigana|ruby/i.test(e.name || '') && /[ぁ-ん]/.test(ph) && !/[ァ-ヶ]/.test(ph)) v = /(01|_1|sei|last|family)\b|kana1|sei/i.test(e.name) ? ME.hiraSei : (/(02|_2|mei|first|given)\b|kana2|mei/i.test(e.name) ? ME.hiraMei : ME.hira);
    else if (/kana|furigana|ruby/i.test(e.name || '') && /[ァ-ヶ]/.test(ph)) v = /(01|_1|sei|last|family)\b|kana1|sei/i.test(e.name) ? ME.kanaSei : (/(02|_2|mei|first|given)\b|kana2|mei/i.test(e.name) ? ME.kanaMei : ME.kana);
    else if (tels.includes(e)) v = tels.length === 3 ? ME.tel3[tels.indexOf(e)] : ME.tel;
    else if (/フリガナ|カナ|ｶﾅ/.test(L)) v = /セイ|姓/.test(L) && !/メイ/.test(L) ? ME.kanaSei : (/メイ/.test(L) && !/セイ/.test(L) ? ME.kanaMei : ME.kana);
    else if (/ふりがな|かな|フリ/.test(L)) v = /せい|姓/.test(L) && !/めい/.test(L) ? ME.hiraSei : (/めい/.test(L) && !/せい/.test(L) ? ME.hiraMei : ME.hira);
    else if (/^ ?せい\b|せい（|せい\(/.test(L) && !/めい/.test(L)) v = ME.hiraSei;
    else if (/^ ?めい\b|めい（|めい\(/.test(L) && !/せい/.test(L)) v = ME.hiraMei;
    else if (/セイ/.test(L) && !/メイ/.test(L)) v = ME.kanaSei;
    else if (/メイ/.test(L) && !/セイ/.test(L)) v = ME.kanaMei;
    else if (/会社|社名|法人|御社|貴社|団体|企業|店舗名|屋号/.test(L)) v = ME.company;
    else if (/件名|題名|タイトル|subject|Subject/.test(L)) v = ME.subject;
    else if (/姓/.test(L) && !/名前|氏名/.test(L)) v = ME.sei;
    else if (/^ ?名 |名（|名\(| 名$/.test(L) && !/氏名|名前/.test(L)) v = ME.mei;
    else if (/（名）|\(名\)/.test(L)) v = ME.mei;
    else if (/（姓）|\(姓\)/.test(L)) v = ME.sei;
    else if (/^(last_?name|family_?name|lname|sei|name_?sei|name1|name_1|name01)$/i.test(e.name || '')) v = ME.sei;
    else if (/^(first_?name|given_?name|fname|mei|name_?mei|name2|name_2|name02)$/i.test(e.name || '')) v = ME.mei;
    else if (/部署|役職|所属/.test(L)) v = null;
    else if (/名前|氏名|お名前|担当者|NAME|Name|name/.test(L)) v = ME.name;
    // 見出しの無い欄が氏名の欄のすぐ後ろにある時は、姓と名に分かれた欄とみなす
    const prevP = plan.length && plan[plan.length - 1].el === els[els.indexOf(e) - 1] ? plan[plan.length - 1] : null;
    const nameLike = !/年齢|歳|age|zip|郵便|〒|部署|役職|会社|電話|tel|住所|addr|mail|url|番号/i.test(L) && (/^例?[）)：:]?\s*[一-龥ァ-ヶぁ-ん]{1,5}$/.test(ph.trim()) || /name|mei|first|kana/i.test(e.name || ''));
    if (v === null && prevP && nameLike) for (const [full, a, b] of [[ME.name, ME.sei, ME.mei], [ME.kana, ME.kanaSei, ME.kanaMei], [ME.hira, ME.hiraSei, ME.hiraMei]]) if (prevP.value === full) { prevP.value = a; v = b; }
    if (v !== null) plan.push({ sel: mark(e), act: 'fill', value: v, what: L.slice(0, 20), el: e });
    else if (e.required || e.getAttribute('aria-required') === 'true') unknown.push('input ' + L.slice(0, 40));
  }

  // 姓と名に分かれた欄：同じ氏名（漢字・カナ・かな）が続けて2つの欄に入る時は、前を姓・後ろを名にする
  for (const [full, a, b] of [[ME.name, ME.sei, ME.mei], [ME.kana, ME.kanaSei, ME.kanaMei], [ME.hira, ME.hiraSei, ME.hiraMei]]) {
    const ps = plan.filter((p) => p.act === 'fill' && p.value === full);
    if (ps.length === 2 && !/部署|役職|会社|所属|担当者/.test(ps[1].what)) { ps[0].value = a; ps[1].value = b; }
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
    const tm = rs.findIndex((r) => /メール/.test(optText(r)));
    if (tm >= 0 && rs.some((r) => r.checked && /電話/.test(optText(r)))) { plan.push({ sel: mark(rs[tm]), act: 'check', what: '選択 ' + optText(rs[tm]).slice(0, 20) }); continue; } // 返信方法の初期値が電話の時はメールにする
    if (i >= 0 && (req || /種別|項目|内容|カテゴリ|用件|区分|目的|ご相談|方法|連絡|返答|返信|回答|お問い?合わ?せ/.test(L))) plan.push({ sel: mark(rs[i]), act: 'check', what: '選択 ' + optText(rs[i]).slice(0, 20) });
    else if (req && !rs.some((r) => r.checked)) unknown.push(k + ' ' + L.slice(0, 40));
  }

  // ボタン（確認・送信）
  const btns = [...root.querySelectorAll('input[type=submit],input[type=button],input[type=image],button,[role=button]')]
    .filter((b) => visible(b) && b.type !== 'reset')
    .map((b) => ({ sel: mark(b), text: ((b.value || '') + ' ' + (b.innerText || '') + ' ' + (b.alt || '')).trim() }));
  const kind = (t) => /確認/.test(t) && !/送信|送る/.test(t) ? 'confirm' : (/送信|送る|submit|send|申し?込|問い?合わ?せ|同意して/i.test(t) ? 'submit' : '');
  for (const b of btns) b.kind = kind(b.text);
  return { fieldCount: count(root), plan: plan.map(({ el, ...x }) => x), unknown, notes, buttons: btns.filter((b) => b.kind) };
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
  const THANKS = /ありがとうございま|送信(が)?完了|送信いたしました|送信しました|受け付けました|受け付けいたしました|受付(が)?完了|送信されました|回答を記録しました|thank you|お問い合わせを受け付け|submission (was )?(added|received)|successfully (sent|submitted)|message (has been|was) sent/i;
  const thanks = THANKS.test(text);
  // 完了の文言がある行（送信前の画面にもある行は、送信.mjs 側で除く）
  const thanksLines = [...new Set(text.split('\n').map((l) => l.trim()).filter((l) => l && l.length <= 120 && THANKS.test(l)))].slice(0, 20);
  // 送信後の画面で、まだ確認画面にいる（送信ボタンをもう一度押す必要がある）ことを示す文言
  const confirmPage = /以下の内容で|入力内容を(ご)?確認|内容をご確認|内容に間違いがなければ|よろしければ[^\n]{0,20}(送信|押して|クリック)|送信してよろしいですか|送信内容の確認|お問い合わせ（確認）|確認画面/.test(text);
  const sending = /送信中です|送信しています|Sending/i.test(text);
  const errors = text.match(/[^\n]{0,20}((入力|選択|チェック)(して|され)?(下さい|ください)|必須項目です|正しく入力|入力内容に誤り|入力内容に問題|未入力です|間違いがあります|エラーが発生|送信に失敗|失敗しました)[^\n]{0,10}/g) || [];
  return { url: location.href, refuse, captcha: [...new Set(captcha)], thanks, thanksLines, confirmPage, sending, errors: [...new Set(errors)].slice(0, 5), text: text.slice(0, 4000) };
}
