# 2026-10-27 23時台 作業管理の判断（勝良さん「任せる」）：業界団体の名簿などから登録した「確認中」の会社（広告経路ではない約200社）も、在庫が足りない分を埋める送り先にする。
# 条件：古い本文を承認済みのv8に付け替えてから送る／大手・FC（除外社名・除外ドメイン）と手で外した会社は外す／ロボット確認・住所必須は送る時に今までどおり止まる／広告経路の会社を先に送る（順番は 朝の送付対象.py）。
# D1が読める時だけ動く。送らない。やること：1) 本文の付け替え（D1、履歴に理由を残す） 2) 設計図リンクのある本文の会社に追跡リンクを発行 3) 送ってよい会社を 登録/名簿の送り先.txt に書く。
# 何度動かしても同じ結果になる（付け替え済み・発行済みの会社は飛ばす）。要る環境変数：CLOUDFLARE_API_TOKEN・CLOUDFLARE_ACCOUNT_ID・SUPABASE_URL・SUPABASE_SERVICE_ROLE_KEY
import json, os, re, subprocess, sys, tempfile, urllib.request, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SOURCES = ('動画広告Pro', 'Meta', 'Google')
# 古い本文 → 承認済みのv8（同じ業種の本文）。ここに無い本文（LINE導入-v2 など）の会社は送らない
TO_V8 = {'MSG-住宅リフォーム-v5': 'MSG-太陽光住宅-v8', 'MSG-太陽光-v5': 'MSG-太陽光住宅-v8', 'MSG-ジム-v5': 'MSG-ジム-v8',
         'MSG-オンラインスクール-v5': 'MSG-オンラインスクール-v8', 'MSG-美容クリニック-v5': 'MSG-美容クリニック-v8'}
V8 = {'MSG-ジム-v8', 'MSG-美容クリニック-v8', 'MSG-オンラインスクール-v8', 'MSG-太陽光住宅-v8', 'MSG-自動車学校-v8'}

def d1(sql=None, file=None):
    cmd = ['npx', '-y', 'wrangler@4.150.0', 'd1', 'execute', 'line-stock-sales', '--remote', '--json'] + (['--file', file] if file else ['--command', sql])
    p = subprocess.run(cmd, capture_output=True, text=True, cwd=HERE)
    # 10/28 --file の時は先頭に進み具合の文字が付くので、JSONの始まり（行頭の [ ）から読む
    try: out = json.loads(p.stdout[p.stdout.find('\n[') + 1:] if not p.stdout.lstrip().startswith('[') and '\n[' in p.stdout else p.stdout)
    except Exception: raise RuntimeError('D1を読めない：' + (p.stdout + p.stderr)[-300:])
    if isinstance(out, dict) and out.get('error'): raise RuntimeError('D1を読めない：' + json.dumps(out['error'], ensure_ascii=False)[:300])
    return out[0].get('results', [])

def norm(s): return re.sub(r'[\s　・（）()株式会社有限会社合同会社]', '', s or '').lower()
def dom(u):
    m = re.match(r'https?://([^/]+)', u or ''); h = (m.group(1) if m else '').lower()
    return h[4:] if h.startswith('www.') else h

try: d1("SELECT 1 AS ok FROM companies LIMIT 1")
except RuntimeError as e: print('D1が読めないので、今回は何もしない：', e); sys.exit(0)

cs = d1("SELECT id,name,industry,official_url,list_source,message_id FROM companies WHERE status = '確認中'")
bodies = {r['id']: r['body'] for r in d1("SELECT id,body FROM messages WHERE id LIKE '%-v8'")}
# 10/28 除外社名.txt・除外ドメイン.txt は「調べたことがある会社」の写し（流れ.py）で、名簿の会社も全部入っているので使わない。
# 大手・FCは 共通.mjs の BIG（名前）と 流れ.py の NG_TYPE（展示場・仲介・団体・大手グループ）で外す
sys.path.insert(0, HERE); from 流れ import NG_TYPE
BIG = re.compile(re.search(r'export const BIG = /(.*)/i;', open(os.path.join(ROOT, '広告候補集め', '候補化', '共通.mjs')).read()).group(1), re.I)
manual = json.load(open(os.path.join(HERE, '手で外した会社.json')))
man = {x.get('id') for x in manual} | {x.get('name') for x in manual}

move, keep, skip = {}, [], {}
for c in cs:
    if (c.get('list_source') or '').startswith(SOURCES): continue
    why, mid = None, c.get('message_id')
    if c['id'] in man or c['name'] in man: why = '手で外した会社'
    elif BIG.search(c['name']): why = '大手・FC（社名）'
    elif NG_TYPE.search(' '.join([c['name'], c.get('official_url') or ''])): why = '業種違い（展示場・仲介・団体・大手など）'
    elif mid not in V8 and mid not in TO_V8: why = f'v8の無い本文（{mid}）'
    if why: skip[why] = skip.get(why, 0) + 1; continue
    if mid in TO_V8: move.setdefault(TO_V8[mid], []).append((c['id'], mid))
    keep.append(c['id'])

# 1) 本文の付け替え（履歴に理由を残す。状態は確認中のまま）
now = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.000Z')
sql = []
for new, rows in move.items():
    ids = ','.join(f"'{i}'" for i, _ in rows)
    sql.append(f"UPDATE companies SET message_id = '{new}' WHERE status = '確認中' AND id IN ({ids});")
    for i, old in rows:
        sql.append(f"INSERT INTO status_history (company_id, from_status, to_status, note, changed_at, source) VALUES "
                   f"('{i}', '確認中', '確認中', '本文を {old} から承認済みの {new} に付け替え（10/27 作業管理の判断・勝良さん「任せる」）', '{now}', 'Claude');")
if sql:
    with tempfile.NamedTemporaryFile('w', suffix='.sql', delete=False) as f: f.write('\n'.join(sql)); path = f.name
    d1(file=path)
print(f'本文を付け替えた：{sum(len(v) for v in move.values())}社 ' + json.dumps({k: len(v) for k, v in move.items()}, ensure_ascii=False))

# 2) 追跡リンク（設計図リンクのあるv8の会社。既にある会社は発行しない）
P = os.path.join(ROOT, '追跡', '会社別リンク.json'); conf = json.load(open(P)); links = conf['links']
cur = {r['id']: r for r in d1("SELECT id,name,industry,message_id FROM companies WHERE status = '確認中' AND id IN (" + ','.join(f"'{i}'" for i in keep) + ")")} if keep else {}
want = []
for i in keep:
    c = cur.get(i)
    if not c or i in links: continue
    pg = re.findall(r'line-stock-flow\.hitomi-k\.workers\.dev/([a-z-]+)', bodies.get(c['message_id'], ''))
    if pg: want.append({'company_id': i, 'company_name': c['name'], 'industry': c['industry'], 'page': pg[0]})
url, key = os.environ['SUPABASE_URL'], os.environ['SUPABASE_SERVICE_ROLE_KEY']
h = {'apikey': key, 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json', 'Prefer': 'resolution=ignore-duplicates,return=representation'}
if want:
    urllib.request.urlopen(urllib.request.Request(url.rstrip('/') + '/rest/v1/line_stock_tracking_links?on_conflict=company_id', data=json.dumps(want).encode(), headers=h, method='POST'), timeout=60).read()
    ids = ','.join(w['company_id'] for w in want)
    for r in json.load(urllib.request.urlopen(urllib.request.Request(url.rstrip('/') + f'/rest/v1/line_stock_tracking_links?select=company_id,token,page&is_test=eq.false&company_id=in.({ids})', headers=h), timeout=60)):
        links.setdefault(r['company_id'], {'token': r['token'], 'page': r['page']})
    json.dump(conf, open(P, 'w'), ensure_ascii=False, indent=2); open(P, 'a').write('\n')
print(f'追跡リンクを発行した：{len(want)}社')

# 3) 送ってよい会社（追跡リンクの要る会社は、発行できた会社だけ）
ok = [i for i in keep if i in links or not re.search(r'line-stock-flow', bodies.get((cur.get(i) or {}).get('message_id'), ''))]
open(os.path.join(HERE, '名簿の送り先.txt'), 'w').write('\n'.join(sorted(ok)) + '\n')
print(f'名簿の送り先：{len(ok)}社／外した ' + json.dumps(skip, ensure_ascii=False))
