# Metaの広告ライブラリ・Googleの広告の透明性センターで集めた広告主（meta_候補.json・google_候補.json）から、
# まだ調べていない広告主だけを、在庫づくり.yml の候補の元（cand_file）にする。2026-10-27 勝良さん「入れる」（Meta・Googleも送り先に）。
# 判定は 登録/取り込み.py（動画広告Pro）と同じ：調べた広告主・既存社名・調べ済みのドメインと重なる会社を外す。D1との重複は登録の直前に 流れ.py が外す。
# 対象は承認済みの本文がある業種だけ（不動産は動画広告Pro経由だけなので外す）。
# 使い方：python3 登録/取り込み_広告ライブラリ.py <出力の候補の元.json> <meta_候補.json か google_候補.json> ...
#   今回の広告主は 調べた広告主_広告ライブラリ.txt・調べた遷移先ドメイン_広告ライブラリ.txt に足す（動画広告Proの一覧とは分け、同時の push でぶつからないようにする）
import json, os, re, sys
from urllib.parse import urlsplit
HERE = os.path.dirname(os.path.abspath(__file__))
TARGET = {'パーソナルジム', '住宅・リフォーム', '太陽光', '美容クリニック', 'オンラインスクール', '自動車学校', '結婚相談所', '自由診療歯科'}
def n(s): return re.sub(r'[\s\W_]+', '', s or '').lower()
def base(u):
    h = (urlsplit(u if '://' in (u or '') else 'https://' + (u or '')).hostname or '').lower().removeprefix('www.'); p = h.split('.')
    return '.'.join(p[-3:]) if len(p) >= 3 and '.'.join(p[-2:]) in {'co.jp','or.jp','ne.jp','ac.jp','go.jp','gr.jp','lg.jp'} else '.'.join(p[-2:])
def lines(f):
    p = os.path.join(HERE, f)
    return [l.strip() for l in open(p, encoding='utf-8') if l.strip() and not l.startswith('#')] if os.path.exists(p) else []

out_p, srcs = sys.argv[1], sys.argv[2:]
names = set(lines('調べた広告主.txt')) | set(lines('調べた広告主_広告ライブラリ.txt'))
for f in ('既存社名.txt', '調べ済み社名.txt'): names |= {n(x) for x in lines(f)}
doms = set(lines('調べた遷移先ドメイン.txt')) | set(lines('調べた遷移先ドメイン_広告ライブラリ.txt'))
for f in ('検品済みドメイン.txt', '調べ済みドメイン.txt'): doms |= {base(x) for x in lines(f)}
doms.discard('')
out, new_names, new_doms, why = [], [], [], {}
for f in srcs:
    if not os.path.exists(f): print(f'{f} が無い（その経路は読めなかった）'); continue
    google = 'google' in os.path.basename(f)
    for r in json.load(open(f, encoding='utf-8')):
        k, d = n(r.get('name')), base(r.get('landing'))
        w = (r.get('skip') or '').split('（')[0] or ('対象外の業種' if r.get('industry') not in TARGET else '') or ('リンク先なし' if not r.get('landing') else '') \
            or ('調べた広告主・既存社名' if not k or k in names else '') or ('調べ済みのドメイン' if d in doms else '')
        if w: why[w] = why.get(w, 0) + 1; continue
        names.add(k); new_names.append(k)
        if d: doms.add(d); new_doms.append(d)
        out.append({'industry': r['industry'], 'name': r['name'], 'landing': r['landing'], 'ads': r.get('google_ads') or r.get('ads') or 1,
                    'source_url': r.get('source_url') or '', 'ad_evidence_url': r.get('ad_evidence_url') or '',
                    'list_source': 'Google広告の透明性センター' if google else 'Meta広告ライブラリ',
                    'ad_media': (r.get('ad_media') or 'Google広告') if google else 'Facebook・Instagram（Meta）', 'ad_purpose': ''})
json.dump(out, open(out_p, 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
with open(os.path.join(HERE, '調べた広告主_広告ライブラリ.txt'), 'a', encoding='utf-8') as f: f.write(''.join(x + '\n' for x in new_names))
with open(os.path.join(HERE, '調べた遷移先ドメイン_広告ライブラリ.txt'), 'a', encoding='utf-8') as f: f.write(''.join(x + '\n' for x in new_doms))
by = {}
for r in out: by[r['list_source'][:4] + '・' + r['industry']] = by.get(r['list_source'][:4] + '・' + r['industry'], 0) + 1
print(f'新しい広告主{len(out)}', json.dumps(by, ensure_ascii=False), '外した', json.dumps(why, ensure_ascii=False))
