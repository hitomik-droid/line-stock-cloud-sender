# 確認中・広告経路（動画広告Pro・Meta・Google。10/27に Meta・Google を足した）で、本文に設計図リンクがあるのに会社別追跡リンクが無い会社に、Supabaseで追跡リンクを発行し、会社別リンク.json に足す（2026-10-26）。
# Macの 在庫づくり_追跡リンク待ち.py＋MCPでのINSERT＋在庫づくり_追跡リンクを写す.py を、GitHubで動く形にした。発行の中身（token は既定値でランダム、既存の会社は再発行しない）は同じ。
# 使い方：python3 追跡/追跡リンク登録.py <D1の会社.json> <D1の文面.json>
# 11/12 追記：本文の設計図を業種別（custom-home・solar・reform など）に変えた会社は、既にある行でも page を本文に合わせて上書きする（token は変えない。広告経路以外の確認中の会社も対象）。
#   送付時の「業種と本文が一致しません」の判定は緩めない。表とJSONの page を本文に合わせるだけ。
# 11/12 直し2：直す会社は JSON と本文の比較だけでなく、Supabase の非テスト行の page も読んで決める（表だけ違う会社も直す）。
#   PATCH が1行にも当たらない／読み直しで対象が返らない・本文の page になっていない時は、エラーを出して終了コード1にする。
# 11/12 直し3：JSON にあって本文に設計図がある会社で、表に非テスト行が無い会社（JSON は本文どおりでも）はエラーにして終了コード1（表の欠落を「待ち：0社」で見落とさない）。
#   環境変数 SUPABASE_URL・SUPABASE_SERVICE_ROLE_KEY が無い時は、発行せずに待ちの会社を出すだけ（終了コード0。表は読めないので JSON と本文の比較だけ）
import json, os, re, sys, urllib.parse, urllib.request
HERE = os.path.dirname(os.path.abspath(__file__))
P = os.path.join(HERE, '会社別リンク.json')
cs = [r for c in json.load(open(sys.argv[1])) for r in c['results']]
ms = {r['id']: r['body'] for c in json.load(open(sys.argv[2])) for r in c['results']}
conf = json.load(open(P)); links = conf['links']
body_page, want = {}, []
for c in cs:
    if c['status'] != '確認中': continue
    pg = re.findall(r'line-stock-flow\.hitomi-k\.workers\.dev/([a-z-]+)', ms.get(c.get('message_id'), '') or '')
    if not pg: continue
    body_page[c['id']] = pg[0]
    if c['id'] not in links and (c.get('list_source') or '').startswith(('動画広告Pro', 'Meta', 'Google')):
        want.append({'company_id': c['id'], 'company_name': c['name'], 'industry': c['industry'], 'page': pg[0]})
json_fix = [i for i in body_page if i in links and links[i].get('page') != body_page[i]]
url, key = os.environ.get('SUPABASE_URL'), os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
if not (url and key):
    if not want and not json_fix: print('追跡リンクの待ち：0社／page直しの待ち：0社'); sys.exit()
    print(f'追跡リンクの待ち：{len(want)}社／page直しの待ち：{len(json_fix)}社（SupabaseのSecretsが無いので発行・直しをしていない。表は読んでいない）：' + ','.join([w['company_id'] for w in want] + json_fix)); sys.exit()
base = url.rstrip('/') + '/rest/v1/line_stock_tracking_links'
h = {'apikey': key, 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'}
def call(q, data=None, method='GET', prefer=None):
    hh = {**h, 'Prefer': prefer} if prefer else h
    req = urllib.request.Request(base + q, data=None if data is None else json.dumps(data).encode(), headers=hh, method=method)
    with urllib.request.urlopen(req, timeout=60) as r:
        t = r.read()
    return json.loads(t) if t else []
def read_rows(ids):
    # 表の非テスト行を読む（URLが長くなりすぎないよう100社ずつ）
    rows = {}
    for k in range(0, len(ids), 100):
        q = '?select=company_id,token,page&is_test=eq.false&company_id=in.(' + urllib.parse.quote(','.join(ids[k:k + 100]), safe=',') + ')'
        for r in call(q): rows[r['company_id']] = r
    return rows
# 表を読み、JSON か表のどちらかで page が本文と違う会社を直す対象にする
table = read_rows([i for i in body_page if i in links])
fix = [i for i in body_page if i in links and (links[i].get('page') != body_page[i] or (i in table and table[i]['page'] != body_page[i]))]
# JSON は本文どおりでも表に非テスト行が無い会社は、表の欠落としてエラーにする（JSON が違う会社は下の PATCH で同じくエラーになる）
errors = [f'{i}：表に非テスト行が無い（JSON の page は本文どおり）' for i in body_page if i in links and i not in table and i not in fix]
if not want and not fix and not errors: print('追跡リンクの待ち：0社／page直しの待ち：0社'); sys.exit()
if want:
    call('?on_conflict=company_id&select=company_id,token,page', want, 'POST', 'resolution=ignore-duplicates,return=representation')
# 既にある会社の page を本文に合わせる（token はそのまま。テスト行は触らない）
for i in fix:
    if i in table and table[i]['page'] == body_page[i]: continue  # 表は既に本文どおり（JSONだけ直す）
    got = call('?company_id=eq.' + urllib.parse.quote(i) + '&is_test=eq.false&select=company_id,page', {'page': body_page[i]}, 'PATCH', 'return=representation')
    if not got: errors.append(f'{i}：PATCH が表の行に1件も当たらなかった（非テスト行が無い）')
# 発行・直した行を読み直す（表の値を正にする）
ids = [w['company_id'] for w in want] + fix
after = read_rows(ids)
n = m = 0
for i in ids:
    r = after.get(i)
    if not r:
        if not any(e.startswith(i + '：') for e in errors): errors.append(f'{i}：読み直しで表の非テスト行が返らなかった')
        continue
    if r['page'] != body_page[i]: errors.append(f"{i}：読み直した page が {r['page']}（本文は {body_page[i]}）"); continue
    new = {'token': r['token'], 'page': r['page']}
    if i not in links: links[i] = new; n += 1
    elif links[i] != new: links[i] = new; m += 1
json.dump(conf, open(P, 'w'), ensure_ascii=False, indent=2); open(P, 'a').write('\n')
print(f'追跡リンクを発行して会社別リンク.json に足した：{n}社／page を本文に合わせた：{m}社（表とJSONを見て直す対象：{len(fix)}社）')
if errors:
    print(f'エラー：{len(errors)}社は表を直せたか確かめられなかった', file=sys.stderr)
    for e in errors: print('  ' + e, file=sys.stderr)
    sys.exit(1)
