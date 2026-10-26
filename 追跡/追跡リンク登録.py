# 確認中・動画広告Pro経由で、本文に設計図リンクがあるのに会社別追跡リンクが無い会社に、Supabaseで追跡リンクを発行し、会社別リンク.json に足す（2026-10-26）。
# Macの 在庫づくり_追跡リンク待ち.py＋MCPでのINSERT＋在庫づくり_追跡リンクを写す.py を、GitHubで動く形にした。発行の中身（token は既定値でランダム、既存の会社は再発行しない）は同じ。
# 使い方：python3 追跡/追跡リンク登録.py <D1の会社.json> <D1の文面.json>
#   環境変数 SUPABASE_URL・SUPABASE_SERVICE_ROLE_KEY が無い時は、発行せずに待ちの会社を出すだけ（終了コード0）
import json, os, re, sys, urllib.request
HERE = os.path.dirname(os.path.abspath(__file__))
P = os.path.join(HERE, '会社別リンク.json')
cs = [r for c in json.load(open(sys.argv[1])) for r in c['results']]
ms = {r['id']: r['body'] for c in json.load(open(sys.argv[2])) for r in c['results']}
conf = json.load(open(P)); links = conf['links']
want = []
for c in cs:
    if c['status'] != '確認中' or not (c.get('list_source') or '').startswith('動画広告Pro') or c['id'] in links: continue
    pg = re.findall(r'line-stock-flow\.hitomi-k\.workers\.dev/([a-z-]+)', ms.get(c.get('message_id'), '') or '')
    if pg: want.append({'company_id': c['id'], 'company_name': c['name'], 'industry': c['industry'], 'page': pg[0]})
url, key = os.environ.get('SUPABASE_URL'), os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
if not want: print('追跡リンクの待ち：0社'); sys.exit()
if not (url and key):
    print(f'追跡リンクの待ち：{len(want)}社（SupabaseのSecretsが無いので発行していない）：' + ','.join(w['company_id'] for w in want)); sys.exit()
h = {'apikey': key, 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json', 'Prefer': 'resolution=ignore-duplicates,return=representation'}
req = urllib.request.Request(url.rstrip('/') + '/rest/v1/line_stock_tracking_links?on_conflict=company_id&select=company_id,token,page', data=json.dumps(want).encode(), headers=h, method='POST')
json.load(urllib.request.urlopen(req, timeout=60))
# 発行済みの行を読み直す（既にあった会社も含め、表の値を正にする）
ids = ','.join(w['company_id'] for w in want)
req = urllib.request.Request(url.rstrip('/') + f'/rest/v1/line_stock_tracking_links?select=company_id,token,page&is_test=eq.false&company_id=in.({ids})', headers=h)
n = 0
for r in json.load(urllib.request.urlopen(req, timeout=60)):
    if r['company_id'] not in links: links[r['company_id']] = {'token': r['token'], 'page': r['page']}; n += 1
json.dump(conf, open(P, 'w'), ensure_ascii=False, indent=2); open(P, 'a').write('\n')
print(f'追跡リンクを発行して会社別リンク.json に足した：{n}社')
