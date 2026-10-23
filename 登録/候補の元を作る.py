# 動画広告Proの広告一覧データ（GitHub Actionsの成果物）から、まだ営業リストに無い広告主を選び、
# 公式サイト確定.mjs に渡す形（name・industry・landing・source_url・ad_evidence_url・ad_media）にする。
# 使い方: python3 -I 候補の元を作る.py 広告一覧データ.json sales.json 出力.json
# 10/24 クラウド用に写した版（元：Macの 作業/営業リスト20261022_動画広告Pro/）。読む表は、このファイルと同じフォルダの物
import json, sys, re, importlib.util
from collections import Counter, defaultdict
from urllib.parse import quote
D = __import__('os').path.dirname(__import__('os').path.abspath(__file__)) + '/'
data = json.load(open(sys.argv[1])); sales = json.load(open(sys.argv[2]))['companies']
NOT_OFF = re.compile(r'(^|\.)(facebook\.com|fb\.me|instagram\.com|line\.me|lin\.ee|youtube\.com|youtu\.be|tiktok\.com|x\.com|twitter\.com|apps\.apple\.com|play\.google\.com|google\.com|bit\.ly|linktr\.ee|lit\.link|peraichi\.com|utage-system\.com|ameblo\.jp|note\.com|hotpepper\.jp|forms\.gle|tayori\.com|formrun\.com|hubspot\.com|calendly\.com|stores\.jp|base\.shop|amazon\.co\.jp|rakuten\.co\.jp|myshopify\.com|lstep\.app|proline\.app|myasp\.jp|l-tra\.com|lme\.jp|wellcome\.love|vcvc01\.com|liny\.jp)', re.I)
IND = {'パーソナルジム': 'パーソナルジム', 'パーソナルトレーニング': 'パーソナルジム', 'ダイエットジム': 'パーソナルジム', '美容皮膚科': '美容クリニック', '美容外科': '美容クリニック', '医療脱毛': '美容クリニック', '教習所': '自動車学校', '自動車学校': '自動車学校', '合宿免許': '自動車学校', '太陽光': '太陽光', '蓄電池': '太陽光', '外壁塗装': '住宅・リフォーム', 'リフォーム': '住宅・リフォーム', '工務店': '住宅・リフォーム', '注文住宅': '住宅・リフォーム', 'オンライン講座': 'オンラインスクール', 'オンラインスクール': 'オンラインスクール',
       '外構': '住宅・リフォーム', 'エクステリア': '住宅・リフォーム', '屋根': '住宅・リフォーム', 'リノベーション': '住宅・リフォーム', '平屋': '住宅・リフォーム', '新築': '住宅・リフォーム', '分譲住宅': '住宅・リフォーム', '塗装': '住宅・リフォーム',
       '二重整形': '美容クリニック', '脂肪吸引': '美容クリニック', 'アートメイク': '美容クリニック', '美容クリニック': '美容クリニック', 'ピラティス': 'パーソナルジム', 'ボディメイク': 'パーソナルジム',
       'プログラミングスクール': 'オンラインスクール', '英会話': 'オンラインスクール', 'コーチング': 'オンラインスクール', '資格講座': 'オンラインスクール', 'スクール': 'オンラインスクール',
       'ドライビングスクール': '自動車学校', '免許': '自動車学校', 'ソーラー': '太陽光', 'エコキュート': '太陽光'}

IND.update({'雨漏り': '住宅・リフォーム', '防水': '住宅・リフォーム', '外壁': '住宅・リフォーム', 'キッチン': '住宅・リフォーム', '浴室': '住宅・リフォーム', '水回り': '住宅・リフォーム', '断熱': '住宅・リフォーム', 'ZEH': '住宅・リフォーム', 'ガレージ': '住宅・リフォーム', 'シミ取り': '美容クリニック', 'ボトックス': '美容クリニック', '糸リフト': '美容クリニック', '医療ダイエット': '美容クリニック', 'ハイフ': '美容クリニック', '加圧': 'パーソナルジム', 'ストレッチ': 'パーソナルジム', '女性専用ジム': 'パーソナルジム', 'キックボクシング': 'パーソナルジム', 'オンライン英会話': 'オンラインスクール', 'ネイルスクール': 'オンラインスクール', '料理教室': 'オンラインスクール', '動画編集': 'オンラインスクール', 'Webデザイン': 'オンラインスクール', '起業塾': 'オンラインスクール', 'ボイストレーニング': 'オンラインスクール', '運転免許': '自動車学校', '蓄電システム': '太陽光'})
IND.update({'フィットネス': 'パーソナルジム', 'ヨガ': 'パーソナルジム', '24時間ジム': 'パーソナルジム', 'トレーニングジム': 'パーソナルジム', 'AGA': '美容クリニック', 'メンズ脱毛': '美容クリニック', 'ダーマペン': '美容クリニック', '医療痩身': '美容クリニック', 'ハウスメーカー': '住宅・リフォーム', 'モデルハウス': '住宅・リフォーム', 'トイレ': '住宅・リフォーム', '窓': '住宅・リフォーム', '住宅': '住宅・リフォーム', 'V2H': '太陽光', '副業': 'オンラインスクール', 'AIスクール': 'オンラインスクール', '投資スクール': 'オンラインスクール', 'カウンセラー': 'オンラインスクール', 'オンラインサロン': 'オンラインスクール', 'マーケティング講座': 'オンラインスクール'})  # 5周目の検索語
IND.update({'ダイエット': 'パーソナルジム', '筋トレ': 'パーソナルジム', 'マシンピラティス': 'パーソナルジム', 'ホットヨガ': 'パーソナルジム', '暗闇フィットネス': 'パーソナルジム', 'パーソナルトレーナー': 'パーソナルジム', 'クマ取り': '美容クリニック', '豊胸': '美容クリニック', '小顔': '美容クリニック', '肌育': '美容クリニック', 'ほうれい線': '美容クリニック', '鼻整形': '美容クリニック', '美容整形': '美容クリニック', 'GLP-1': '美容クリニック', 'TOEIC': 'オンラインスクール', '簿記': 'オンラインスクール', 'Webマーケティング': 'オンラインスクール', 'Webライター': 'オンラインスクール', 'プログラミング': 'オンラインスクール', '中国語': 'オンラインスクール', '韓国語': 'オンラインスクール', 'イラスト': 'オンラインスクール', '占い': 'オンラインスクール', '二世帯住宅': '住宅・リフォーム', 'ローコスト住宅': '住宅・リフォーム', '建売': '住宅・リフォーム', '家づくり': '住宅・リフォーム', '耐震': '住宅・リフォーム', 'シロアリ': '住宅・リフォーム', '内装': '住宅・リフォーム', 'オール電化': '太陽光', '電気代': '太陽光'})  # 10/23 6周目の検索語
GEN = {'パーソナルジム': {'ジム・フィットネス'}, '美容クリニック': {'美容医療', '医療脱毛', 'メンズ医療脱毛', '医療痩身', 'AGAクリニック'}, '自動車学校': {'車・バイク', '資格取得', '学校', '教育'}, '太陽光': {'不動産設備'}, '住宅・リフォーム': {'注文住宅', '中古物件・リフォーム', '外壁塗装'}, 'オンラインスクール': {'教育', 'フリーランス育成', '資格取得', '言語教育', '趣味教養', 'セミナー・ウェビナー'}}
BADN = {'', '-', '更新中', 'None', 'Video ad upload channel'}
def host(u):
    m = re.match(r'https?://([^/:?#]+)', u or ''); h = (m.group(1) if m else '').lower()
    return h[4:] if h.startswith('www.') else h
def base(h):
    p = h.split('.')
    if len(p) >= 3 and p[-2] in ('co', 'or', 'ne', 'ac', 'go', 'gr', 'ed', 'lg') and p[-1] == 'jp': return '.'.join(p[-3:])
    return '.'.join(p[-2:])
norm = lambda n: re.sub(r'(株式会社|有限会社|合同会社|一般社団法人|医療法人社団|医療法人|\(株\)|（株）|\s|　)', '', n or '')
d1dom = {base(host(c.get(k) or '')) for c in sales for k in ('official_url', 'form_url')}
d1nm = {norm(c.get(k)) for c in sales for k in ('name', 'legal_name')}
used = {base(x) for x in json.load(open(D + 'used_domains.json'))} | {base(x.strip()) for x in open(D + '調べ済みドメイン.txt') if x.strip()}
names = {norm(x) for x in open(D + '既存社名.txt').read().split('\n') if x}
tried = {x.strip() for x in open(D + '調べ済み社名.txt') if x.strip() and not x.startswith('#')}  # 10/24 Macで公式サイトを探し済みの広告主
adv = {}
seen = set()
for r in data:
    w = r.get('word')
    if not w: continue
    I0 = IND.get(w)  # 10/24 表に無い検索語は、広告のジャンルから業種を決める
    for it in r['data']['items']:
        I = I0 or next((k for k, g in sorted(GEN.items(), key=lambda kv: kv[0] == '自動車学校') if it.get('genre_name') in g), None)
        if not I: continue
        if (I, it['id']) in seen: continue
        seen.add((I, it['id']))
        if it.get('genre_name') not in GEN[I]: continue
        txt = ' '.join(str(it.get(k) or '') for k in ('advertiser_name', 'product_name', 'account_name', 'ad_all_sentence'))
        if I == '自動車学校' and not re.search(r'教習|自動車学校|免許|ドライビングスクール', txt): continue
        nm = next((x for x in (it.get('advertiser_name'), it.get('account_name')) if (x or '').strip() not in BADN), None)
        if not nm: continue
        u = it.get('transition_url') or ''
        x = adv.setdefault(nm, {'name': nm, 'ind': Counter(), 'land': Counter(), 'n': 0, 'ev': None, 'media': Counter(), 'word': w, 'acc': set()})
        x['ind'][I] += 1; x['n'] += 1; x['media'][it.get('app_name') or ''] += 1
        if it.get('account_name'): x['acc'].add(it['account_name'])
        if u and not NOT_OFF.search(host(u)): x['land'][u] += 1
        if not x['ev']: x['ev'] = it.get('production_url') or it.get('thumbnail_url')
out = []
for nm, x in adv.items():
    if not x['land']: continue
    if nm in tried: continue
    land = x['land'].most_common(1)[0][0]
    ds = {base(host(u)) for u in x['land']}
    if ds & d1dom or ds & used: continue
    if norm(nm) in d1nm or norm(nm) in names or any(norm(a) in d1nm for a in x['acc']): continue
    I = x['ind'].most_common(1)[0][0]
    out.append({'industry': I, 'name': nm, 'landing': land, 'ads': x['n'],
                'source_url': 'https://dpro.kashika-20mile.com/search?interval=2&sort=cost_difference-desc&media_type=video%2Cbanner%2Ccarousel&version=1&ad_objective=ACQUISITION&keyword=' + quote('in:' + x['word']),
                'ad_evidence_url': x['ev'] or '', 'ad_media': x['media'].most_common(1)[0][0], 'ad_purpose': '獲得'})
out.sort(key=lambda c: -c['ads'])
json.dump(out, open(sys.argv[3], 'w'), ensure_ascii=False, indent=0)
print(len(out), Counter(c['industry'] for c in out))
