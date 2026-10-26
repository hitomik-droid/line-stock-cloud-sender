# 2026-10-26 勝良さん指示：その日に届かなかった分は翌朝8:00から自動で送る。
# GOを待たずに送ってよい範囲：承認済みの本文（v8・3業種v3）で、動画広告Pro経由（ターゲット業種）の「確認中」の会社だけ。
# 設計図リンクのある本文は、会社別追跡リンクが登録済みの会社だけ（未登録だと送信.mjsが止まるため）。
import json, os, re, sys, urllib.request
API = os.environ.get('LS_API_BASE', 'https://line-stock-product-plan.hitomi-k.workers.dev/api/sales')
APPROVED = {'MSG-ジム-v8', 'MSG-美容クリニック-v8', 'MSG-オンラインスクール-v8', 'MSG-太陽光住宅-v8', 'MSG-自動車学校-v8',
            'MSG-結婚相談所-v3', 'MSG-自由診療歯科-v3', 'MSG-不動産-v3'}
HERE = os.path.dirname(os.path.abspath(__file__))
req = urllib.request.Request(API, headers={'User-Agent': 'Mozilla/5.0'})
d = json.load(urllib.request.urlopen(req, timeout=120))
msgs = {m['id']: m['body'] for m in d['messages']}
links = json.load(open(os.path.join(HERE, '..', '追跡', '会社別リンク.json')))['links']
# 10/27 登録済みでも 手で外した会社.json にある会社（番号か社名が一致）は送らない
manual = json.load(open(os.path.join(HERE, '手で外した会社.json')))
man_ids = {x['id'] for x in manual if x.get('id')}; man_names = {x['name'] for x in manual if x.get('name')}
ids, skip = [], {}
for c in sorted(d['companies'], key=lambda c: c['id']):
    if c['status'] != '確認中': continue
    why = None
    if c['id'] in man_ids or c.get('name') in man_names: why = '手で外した会社'
    elif not (c.get('list_source') or '').startswith('動画広告Pro'): why = '動画広告Pro経由ではない'
    elif c.get('message_id') not in APPROVED: why = '承認済みの本文ではない'
    elif 'line-stock-flow.hitomi-k.workers.dev' in msgs.get(c['message_id'], '') and c['id'] not in links: why = '会社別追跡リンクが未登録'
    if why: skip[why] = skip.get(why, 0) + 1; continue
    ids.append(c['id'])
limit = int(sys.argv[1]) if len(sys.argv) > 1 else 1000
ids = ids[:limit]
print('送る', len(ids), '外した', skip, file=sys.stderr)
print(','.join(ids))
