// 2026-10-27 勝良さん「Cloudflareは有料にしない。上限に当たったら代わりのやり方で」：D1（Cloudflare）が無料枠の上限で読めない時の代わりの置き場（Supabase）。
// 置き場の中身は 登録/台帳の写し.py が D1 から写す（確認中の会社・本文・フォームの欄）。ここで変えた状態は、D1が戻った時に同じスクリプトが書き戻す。
// 二重送付の防ぎ：状態は ls_set_status（今の状態が expected の時だけ変える）で書く。D1で送る時も、ここに書き戻し待ちの履歴がある会社は送らない。
const URL_ = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
export const enabled = () => !!(URL_ && KEY);

async function rest(path, opt = {}) {
  const r = await fetch(`${URL_}/rest/v1/${path}`, {
    ...opt,
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', ...(opt.headers || {}) },
  });
  if (!r.ok) throw new Error(`代わりの置き場 ${path.split('?')[0]} → ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.status === 204 ? null : r.json();
}
const q = encodeURIComponent;

// Worker の send-data と同じ形で返す
export async function sendData(id) {
  const [c] = await rest(`ls_companies?id=eq.${q(id)}&select=id,name,addressee,observation,form_url,message_id,status,form_note`);
  if (!c) throw new Error(`代わりの置き場に ${id} が無い`);
  const [m] = c.message_id ? await rest(`ls_messages?id=eq.${q(c.message_id)}&select=body`) : [];
  const fields = await rest(`ls_form_fields?company_id=eq.${q(id)}&select=ord,label,required,input_value&order=ord`);
  return { ...c, fields, body: (m?.body || '').replaceAll('{宛名}', c.addressee || '').replaceAll('{観察}', c.observation || '') };
}

// 今の状態が expected の時だけ変える。変わっていたら例外（呼ぶ側は送らずに止まる）
export async function setStatus(id, expected, status, note, source) {
  const r = await rest('rpc/ls_set_status', { method: 'POST', body: JSON.stringify({ p_id: id, p_expected: expected, p_status: status, p_note: note, p_source: source }) });
  if (!r || !r.ok) throw new Error(`代わりの置き場の状態を書けない ${id}（${r && r.error}${r && r.status ? '：今は' + r.status : ''}）`);
  return r;
}

// D1で送る時の追加の照合：ここでまだD1に書き戻していない履歴がある会社は送らない
export async function hasUnsynced(id) {
  const rows = await rest(`ls_status_history?company_id=eq.${q(id)}&written_back_at=is.null&select=id&limit=1`);
  return rows.length > 0;
}

// 送り直しの判定に使う形（Worker の一覧の1社分と同じく history を新しい順で付ける）
export async function company(id) {
  const [c] = await rest(`ls_companies?id=eq.${q(id)}&select=id,name,status,message_id,list_source`);
  if (!c) return null;
  c.history = await rest(`ls_status_history?company_id=eq.${q(id)}&select=from_status,to_status,note,changed_at,source&order=id.desc&limit=20`);
  return c;
}

// 一括送信の対象選び用：確認中の会社の一覧
export async function confirmCompanies() {
  return rest(`ls_companies?status=eq.${q('確認中')}&select=id,name,industry,status,message_id,list_source&order=id`);
}
