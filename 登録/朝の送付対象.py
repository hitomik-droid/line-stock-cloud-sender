# 2026-10-26 勝良さん指示：その日に届かなかった分は翌朝8:00から自動で送る。
# GOを待たずに送ってよい範囲：承認済みの本文（v8・3業種v3）で、広告経路（動画広告Pro・Meta・Google）の「確認中」の会社だけ（10/27に Meta・Google を足した）。
# 設計図リンクのある本文は、会社別追跡リンクが登録済みの会社だけ（未登録だと送信.mjsが止まるため）。
import json, os, re, sys, urllib.request
API = os.environ.get('LS_API_BASE', 'https://line-stock-product-plan.hitomi-k.workers.dev/api/sales') + '?lite=1'  # 10/27 夕：確認中の会社と本文だけの軽い一覧（D1の読み取りを減らす）
APPROVED = {'MSG-ジム-v8', 'MSG-美容クリニック-v8', 'MSG-オンラインスクール-v8', 'MSG-太陽光住宅-v8', 'MSG-自動車学校-v8',
            'MSG-結婚相談所-v3', 'MSG-自由診療歯科-v3', 'MSG-不動産-v3', 'MSG-整体-v3', 'MSG-エステ-v3', 'MSG-学習塾-v3', 'MSG-士業-v3', 'MSG-飲食-v3', 'MSG-ペット-v3', 'MSG-美容室-v3', 'MSG-ホテル-v3'}
# 10/27 9:4x 勝良さん「入れる」：Meta広告ライブラリ・Googleの広告主も送り先に入れる（業種の絞り・大手・FC・ロボット確認などの決まりはそのまま。不動産の例外は動画広告Pro経由だけのまま）
SOURCES = ('動画広告Pro', 'Meta', 'Google')
HERE = os.path.dirname(os.path.abspath(__file__))
# 10/27 D1が無料枠の上限で読めない時は、代わりの置き場（Supabase）の写しから選ぶ。代わりの置き場に書き戻し待ちの履歴がある会社は、どちらで選ぶ時も外す
SB_URL, SB_KEY = os.environ.get('SUPABASE_URL'), os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
def sb(path):
    r = urllib.request.Request(f"{SB_URL}/rest/v1/{path}", headers={'apikey': SB_KEY, 'Authorization': f'Bearer {SB_KEY}'})
    return json.load(urllib.request.urlopen(r, timeout=60))
try:
    d = json.load(urllib.request.urlopen(urllib.request.Request(API, headers={'User-Agent': 'Mozilla/5.0'}), timeout=120))
    src = 'D1'
except Exception as e:
    if not (SB_URL and SB_KEY): raise
    print('D1が読めないので、代わりの置き場（Supabase）から選ぶ：', str(e)[:80], file=sys.stderr)
    d = {'companies': sb('ls_companies?status=eq.%E7%A2%BA%E8%AA%8D%E4%B8%AD&select=id,name,industry,official_url,status,message_id,list_source'),
         'messages': sb('ls_messages?select=id,body')}
    src = 'Supabase'
pending = {r['company_id'] for r in sb('ls_status_history?written_back_at=is.null&select=company_id')} if (SB_URL and SB_KEY) else set()
msgs = {m['id']: m['body'] for m in d['messages']}
links = json.load(open(os.path.join(HERE, '..', '追跡', '会社別リンク.json')))['links']
# 10/27 登録済みでも 手で外した会社.json にある会社（番号か社名が一致）は送らない
manual = json.load(open(os.path.join(HERE, '手で外した会社.json')))
man_ids = {x['id'] for x in manual if x.get('id')}; man_names = {x['name'] for x in manual if x.get('name')}
ids, skip = [], {}
for c in sorted(d['companies'], key=lambda c: c['id']):
    if c['status'] != '確認中': continue
    why = None
    if c['id'] in pending: why = '代わりの置き場で変更済み（D1への書き戻し待ち）'
    elif c['id'] in man_ids or c.get('name') in man_names: why = '手で外した会社'
    elif not (c.get('list_source') or '').startswith(SOURCES): why = '広告経路（動画広告Pro・Meta・Google）ではない'
    elif c.get('message_id') == 'MSG-不動産-v3' and not (c.get('list_source') or '').startswith('動画広告Pro'): why = '不動産は動画広告Pro経由だけ'
    elif c.get('message_id') not in APPROVED: why = '承認済みの本文ではない'
    elif 'line-stock-flow.hitomi-k.workers.dev' in msgs.get(c['message_id'], '') and c['id'] not in links: why = '会社別追跡リンクが未登録'
    if why: skip[why] = skip.get(why, 0) + 1; continue
    ids.append(c['id'])
limit = int(sys.argv[1]) if len(sys.argv) > 1 else 1000
if len(sys.argv) > 2: open(sys.argv[2], 'w').write(str(len(ids)))  # 10/27 夕：在庫の数を同じ読み取りで書き出す（2回読まない）
ids = ids[:limit]
print('送る', len(ids), '外した', skip, '（読んだ台帳：' + src + '）', file=sys.stderr)
print(','.join(ids))
