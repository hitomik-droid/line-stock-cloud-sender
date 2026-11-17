# 2026-11-17 ひとみ「俺と堀田さんの営業文でどちらの方がクリックされるの、問い合わせが来るの、を検証したい」の版別集計（読むだけ）。
# 使い方：python3 登録/文面の比較_集計.py [クリックのJSON]
#   台帳は /api/sales（D1）を読む。クリックは環境変数 SUPABASE_URL・SUPABASE_SERVICE_ROLE_KEY があれば line_stock_company_clicks を読む。
#   無い時は、Supabaseで下のSQLを実行した結果（[{"company_id":..,"views":..,"daily_visitors":..}]）をJSONで渡す：
#   select company_id, views, daily_visitors from public.line_stock_company_clicks where views > 0;
# 比べるのは 文面の比較.json の業種・版だけ。会社名・URLは出さない。
import json, os, sys, urllib.request, collections
HERE = os.path.dirname(os.path.abspath(__file__))
AB = json.load(open(os.path.join(HERE, '文面の比較.json')))
NAME = AB['版の名前']
API = os.environ.get('LS_API', 'https://line-stock-product-plan.hitomi-k.workers.dev/api/sales')
d = json.load(urllib.request.urlopen(urllib.request.Request(API, headers={'User-Agent': 'Mozilla/5.0'}), timeout=120))
if len(sys.argv) > 1:
    clicks = json.load(open(sys.argv[1]))
elif os.environ.get('SUPABASE_URL') and os.environ.get('SUPABASE_SERVICE_ROLE_KEY'):
    k = os.environ['SUPABASE_SERVICE_ROLE_KEY']
    r = urllib.request.Request(os.environ['SUPABASE_URL'].rstrip('/') + '/rest/v1/line_stock_company_clicks?views=gt.0&select=company_id,views,daily_visitors', headers={'apikey': k, 'Authorization': 'Bearer ' + k})
    clicks = json.load(urllib.request.urlopen(r, timeout=60))
else:
    clicks = None
clicked = {c['company_id'] for c in (clicks or []) if int(c.get('views') or 0) > 0}
since = os.environ.get('LS_AB_SINCE', '2026-11-17')  # 比較を始めた日（日本時間の日付）。それより前の送付は数えない
SENT = {'送付完了', '返信あり', 'アポ獲得'}
t = collections.defaultdict(collections.Counter)
for c in d['companies']:
    m = c.get('message_id')
    if m not in NAME: continue
    if c['status'] in SENT and (c.get('sent_at') or '')[:10] < since: continue
    if c['status'] == '送付失敗' and (c.get('updated_at') or '')[:10] < since: continue
    key = (NAME[m], c['industry'])
    for k2 in (key, (NAME[m], '計')):
        t[k2]['割当（確認中）'] += c['status'] == '確認中'
        t[k2]['送付失敗'] += c['status'] == '送付失敗'
        if c['status'] in SENT:
            t[k2]['送付完了'] += 1
            t[k2]['クリック社'] += c['id'] in clicked
            t[k2]['返信'] += c['status'] in ('返信あり', 'アポ獲得')
            t[k2]['アポ'] += c['status'] == 'アポ獲得'
print(f'版別の集計（{since} 以降の送付。クリックは' + ('未取得' if clicks is None else '会社別追跡リンク') + '）')
print('| 版 | 業種 | 確認中 | 送付完了 | 送付失敗 | クリック社 | クリック率 | 返信 | アポ |')
print('|---|---|---|---|---|---|---|---|---|')
for k in sorted(t, key=lambda k: (k[0], k[1] == '計', k[1])):
    x = t[k]; n = x['送付完了']
    rate = f"{x['クリック社'] / n:.1%}" if n and clicks is not None else '-'
    print(f"| {k[0]} | {k[1]} | {x['割当（確認中）']} | {n} | {x['送付失敗']} | {x['クリック社'] if clicks is not None else '未取得'} | {rate} | {x['返信']} | {x['アポ']} |")
print('※返信は台帳の状態（返信あり・アポ獲得）で数える。返信見張りが台帳に書いていない返信は入らない。開封はフォーム営業では取れないので、クリック（設計図リンクを開いた会社）で見る。')
