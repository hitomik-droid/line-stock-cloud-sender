# 動画広告Proを並べて読んだ結果（広告一覧データ*.json）から、まだ調べていない広告主だけを、公式サイト探しの入力（候補の元）にする。
# 2026-10-26 23時台 勝良さん「ローカルで作業しないで」：Macの 取り込み.py・照合.py・流す.py の判定をGitHubで動く形に移した。判定の中身は同じ。
# 使い方：python3 登録/取り込み.py <広告一覧データのフォルダ> <出力の候補の元.json> <D1の会社.json>
#   D1の会社.json：wrangler d1 execute ... --json の出力（id・name・official_url）
#   調べた広告主.txt・調べた遷移先ドメイン.txt に、今回の広告主を足す（次から重ならない）
import json, os, re, sys, glob, collections
from urllib.parse import urlsplit
HERE = os.path.dirname(os.path.abspath(__file__))
G = {'注文住宅': '住宅・リフォーム', '中古物件・リフォーム': '住宅・リフォーム', '不動産設備': '住宅・リフォーム',
     '賃貸情報': '不動産', '分譲マンション': '不動産', '不動産査定': '不動産',
     '美容医療': '美容クリニック', '医療脱毛': '美容クリニック', '医療痩身': '美容クリニック',
     'ジム・フィットネス': 'パーソナルジム', '恋愛・結婚支援': '結婚相談所',
     '教育': 'オンラインスクール', '資格取得': 'オンラインスクール', '言語教育': 'オンラインスクール', 'フリーランス育成': 'オンラインスクール',
     '副業': 'オンラインスクール', 'セミナー・ウェビナー': 'オンラインスクール', '趣味教養': 'オンラインスクール'}
SHARED = {'instagram.com','facebook.com','lin.ee','line.me','google.com','youtube.com','tiktok.com','hotpepper.jp','x.com','twitter.com','fb.me','linktr.ee','page.line.me','liff.line.me','utage-system.com','lステップ.com','lstep.app','peraichi.com','studio.site','wixsite.com','jimdofree.com','amazon.co.jp','rakuten.co.jp'}
JP = re.compile(r'[ぁ-んァ-ヶ一-龠]')
def n(s): return re.sub(r'[\s\W_]+', '', s or '').lower()
def base(u):
    h = (urlsplit(u or '').hostname or '').lower().removeprefix('www.'); p = h.split('.')
    return '.'.join(p[-3:]) if len(p) >= 3 and '.'.join(p[-2:]) in {'co.jp','or.jp','ne.jp','ac.jp','go.jp','gr.jp','lg.jp'} else '.'.join(p[-2:])
def industry(i):
    t = ' '.join(str(i.get(k) or '') for k in ('advertiser_name', 'product_name', 'account_name', 'genre_name'))
    if re.search(r'教習|自動車学校|ドライビングスクール|免許', t): return '自動車学校'
    if re.search(r'太陽光|蓄電|ソーラー|V2H|エコキュート', t): return '太陽光'
    if re.search(r'歯科|矯正|インプラント|ホワイトニング', t) and i.get('genre_name') in ('医療サービス', '美容医療'): return '自由診療歯科'
    return G.get(i.get('genre_name'))
def ok(name, url):  # 海外・名前の無い動画チャンネルを外す（日本語の名前か、.jp の遷移先だけ残す）
    if re.search(r'Video ad upload channel', name, re.I): return False
    return bool(JP.search(name)) or '.jp/' in (str(url) + '/').split('?')[0]
def lines(f):
    p = os.path.join(HERE, f)
    return [l.strip() for l in open(p, encoding='utf-8') if l.strip() and not l.startswith('#')] if os.path.exists(p) else []

src, out_p, d1_p = sys.argv[1:4]
# 既に知っている会社：D1の全社、調べた広告主、既存社名・調べ済み社名、検品済み・調べ済みドメイン
C = [r for c in json.load(open(d1_p)) for r in c['results']]
names = {n(c['name']) for c in C} | set(lines('調べた広告主.txt'))
for f in ('既存社名.txt', '調べ済み社名.txt'): names |= {n(x) for x in lines(f)}
doms = {base(c.get('official_url')) for c in C} | set(lines('調べた遷移先ドメイン.txt'))
for f in ('検品済みドメイン.txt', '調べ済みドメイン.txt'): doms |= {base('https://' + x.removeprefix('https://').removeprefix('http://')) for x in lines(f)}
doms -= SHARED | {''}

by = collections.defaultdict(lambda: {'n': 0})
files = glob.glob(os.path.join(src, '**', '広告一覧データ*.json'), recursive=True)
for f in files:
    for x in json.load(open(f)):
        for i in (x.get('data') or {}).get('items') or []:
            name = (i.get('advertiser_name') or '').strip()
            if not name or name in ('更新中', 'None', '-'): name = (i.get('account_name') or '').strip()
            # 10/27 集める担当が検索ごとに業種（industry）を付けた（追加8業種）。あればそれを使う
            ind = x.get('industry') or industry(i)
            if not name or not ind or name == 'None' or not ok(name, i.get('transition_url')): continue
            r = by[(ind, name)]; r['n'] += 1
            if not r.get('landing') and (i.get('transition_url') or 'None') != 'None':
                r.update(landing=i['transition_url'], source_url=x.get('url'), ad_evidence_url=i.get('thumbnail_url') or i.get('production_url'))
out, new_names, new_doms = [], [], []
for (ind, name), r in by.items():
    k, d = n(name), base(r.get('landing'))
    if not r.get('landing') or not k or k in names or (d and d in doms): continue
    names.add(k); new_names.append(k)
    if d and d not in SHARED: doms.add(d); new_doms.append(d)
    out.append({'industry': ind, 'name': name, 'landing': r['landing'], 'ads': r['n'], 'source_url': r.get('source_url'), 'ad_evidence_url': r.get('ad_evidence_url'),
                'list_source': '動画広告Pro', 'ad_media': '動画広告Pro', 'ad_purpose': ''})
json.dump(out, open(out_p, 'w'), ensure_ascii=False, indent=0)
with open(os.path.join(HERE, '調べた広告主.txt'), 'a', encoding='utf-8') as f: f.write(''.join(x + '\n' for x in new_names))
with open(os.path.join(HERE, '調べた遷移先ドメイン.txt'), 'a', encoding='utf-8') as f: f.write(''.join(x + '\n' for x in new_doms))
print(f'読んだファイル{len(files)}・広告主{len(by)}・新しい広告主{len(out)}')
