# 2026-10-27 勝良さん「Cloudflareは有料にしない。上限に当たったら代わりのやり方で」：D1と代わりの置き場（Supabase）をそろえる。
# D1が読める時だけ動く。1) 代わりの置き場で変えた状態をD1に書き戻す 2) D1の確認中の会社・本文・フォームの欄を代わりの置き場に写し直す。
# 送らない。書き戻しは、D1の今の状態が代わりの置き場の変更前の状態と同じ時だけ行う（違えば書かずに記録だけ残す）。
# 使い方（GitHub Actions）：python3 登録/台帳の写し.py   要る環境変数：CLOUDFLARE_API_TOKEN・CLOUDFLARE_ACCOUNT_ID・SUPABASE_URL・SUPABASE_SERVICE_ROLE_KEY
import json, os, subprocess, sys, urllib.request, datetime

DB = 'line-stock-sales'
API = 'https://line-stock-product-plan.hitomi-k.workers.dev/api/sales'
SB_URL, SB_KEY = os.environ['SUPABASE_URL'], os.environ['SUPABASE_SERVICE_ROLE_KEY']
HERE = os.path.dirname(os.path.abspath(__file__))

def d1(sql):
    p = subprocess.run(['npx', '-y', 'wrangler@4.150.0', 'd1', 'execute', DB, '--remote', '--json', '--command', sql],
                       capture_output=True, text=True, cwd=HERE)
    try:
        out = json.loads(p.stdout)
    except Exception:
        raise RuntimeError('D1を読めない：' + (p.stdout + p.stderr)[-300:])
    if isinstance(out, dict) and out.get('error'):
        raise RuntimeError('D1を読めない：' + json.dumps(out['error'], ensure_ascii=False)[:300])
    return out[0]['results']

def sb(path, method='GET', body=None, prefer=None):
    h = {'apikey': SB_KEY, 'Authorization': f'Bearer {SB_KEY}', 'Content-Type': 'application/json'}
    if prefer: h['Prefer'] = prefer
    r = urllib.request.Request(f'{SB_URL}/rest/v1/{path}', method=method, headers=h,
                               data=None if body is None else json.dumps(body, ensure_ascii=False).encode())
    with urllib.request.urlopen(r, timeout=120) as res:
        t = res.read().decode()
        return json.loads(t) if t else None

def q(v): return urllib.request.quote(v, safe='')

try:
    d1("SELECT 1 AS ok FROM companies LIMIT 1")
except RuntimeError as e:
    print('D1が読めないので、今回は何もしない：', e); sys.exit(0)

# 1) 書き戻し
rows = sb('ls_status_history?written_back_at=is.null&select=*&order=id')
back = conflict = 0
for h in rows:
    cur = d1(f"SELECT status FROM companies WHERE id = '{h['company_id'].replace(chr(39), '')}'")
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    if cur and cur[0]['status'] == h['from_status']:
        body = json.dumps({'status': h['to_status'], 'note': ((h.get('note') or '') + '（代わりの置き場から書き戻し）')[:300],
                           'source': (h.get('source') or 'Actions')[:40]}).encode()
        req = urllib.request.Request(f"{API}/{h['company_id']}/status", data=body, method='POST',
                                     headers={'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0'})
        urllib.request.urlopen(req, timeout=60).read()
        back += 1
    else:
        conflict += 1
        print('書き戻さない（D1の今の状態が違う）：', h['company_id'], 'D1=', cur and cur[0]['status'], '代わり=', h['from_status'], '→', h['to_status'])
    sb(f"ls_status_history?id=eq.{h['id']}", 'PATCH', {'written_back_at': now})
print(f'書き戻し {back} 件／食い違いで書かなかった {conflict} 件')

# 2) 写し直し（書き戻しが全部済んだ後だけ）
left = sb('ls_status_history?written_back_at=is.null&select=id&limit=1')
if left:
    print('書き戻し待ちが残っているので、今回は写し直さない'); sys.exit(0)
cs = d1("SELECT id,name,addressee,observation,form_url,form_note,industry,official_url,list_source,message_id,status,sent_at FROM companies WHERE status = '確認中'")
ms = d1("SELECT id,body FROM messages")
fs = d1("SELECT f.company_id,f.ord,f.label,f.required,f.input_value FROM form_fields f JOIN companies c ON c.id = f.company_id WHERE c.status = '確認中'")
sb('ls_form_fields?company_id=neq.__none__', 'DELETE')
sb('ls_companies?id=neq.__none__', 'DELETE')
for i in range(0, len(cs), 500): sb('ls_companies', 'POST', cs[i:i + 500], 'resolution=merge-duplicates')
for i in range(0, len(fs), 1000): sb('ls_form_fields', 'POST', fs[i:i + 1000], 'resolution=merge-duplicates')
sb('ls_messages', 'POST', ms, 'resolution=merge-duplicates')
print(f'写し直し：確認中の会社 {len(cs)}／フォームの欄 {len(fs)}／本文 {len(ms)}')
