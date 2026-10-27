# フォーム営業の「候補 → 判定 → 登録」をGitHub Actionsの上で行う（2026-10-24。Macの 作業/営業リスト20261022_動画広告Pro/ の prep.py・assemble.py・登録して送る.py を1本にした版）。
# 使い方（WORK は作業フォルダ。ワークフロー「全部.yml」が呼ぶ）:
#   python3 登録/流れ.py cands  WORK 候補TSV...      … 公式サイトとフォームが分かった候補TSVから、D1・除外表と重ならない会社だけを WORK/cands.json にする
#   python3 登録/流れ.py plan   WORK                … WORK/results.jsonl（フォーム検品の結果）を判定し、番号・文面（堀田さんの版v8）を決めて WORK/投入.sql・WORK/ids.txt を作る
#   python3 登録/流れ.py check  WORK                … 登録後にD1を読み直し、ids.txt の会社が「確認中」で、社名が合っているか確かめる
import csv, json, os, re, subprocess, sys, urllib.request
from collections import Counter
from urllib.parse import urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
API = os.environ.get('LS_API', 'https://line-stock-product-plan.hitomi-k.workers.dev/api/sales')
ORDER = ['自動車学校', 'パーソナルジム', '美容クリニック', 'オンラインスクール', '住宅・リフォーム', '太陽光', '結婚相談所', '自由診療歯科', '不動産']
# 10/22 20時 勝良さん指示・10/23 勝良さん指示「堀田さんのバージョンで全部送る」：文面は全部 v8
V8 = {'パーソナルジム': 'MSG-ジム-v8', '住宅・リフォーム': 'MSG-太陽光住宅-v8', '太陽光': 'MSG-太陽光住宅-v8', '美容クリニック': 'MSG-美容クリニック-v8', 'オンラインスクール': 'MSG-オンラインスクール-v8', '自動車学校': 'MSG-自動車学校-v8'}
# 10/26 勝良さんOK：営業対象の業種表のうち3業種は、v8を業種に合わせた本文（v3）で送る
V8.update({'結婚相談所': 'MSG-結婚相談所-v3', '自由診療歯科': 'MSG-自由診療歯科-v3', '不動産': 'MSG-不動産-v3'})
# 10/27 勝良さんOKの追加8業種。本文は承認待ちの仮ID（-v3案）で登録する。送付（朝の送付対象.py・送信.mjs）は -v3案 を選ばない・送らない
V8.update({"整体・整骨院": "MSG-整体-v3案", "エステ・脱毛": "MSG-エステ-v3案", "学習塾・英会話": "MSG-学習塾-v3案", "税理士・士業": "MSG-士業-v3案", "予約制の飲食店": "MSG-飲食-v3案", "ペット関連": "MSG-ペット-v3案", "美容室": "MSG-美容室-v3案", "ホテル・旅館": "MSG-ホテル-v3案"})
IDP = 'LS-20261022-'  # 10/22から続けている番号の頭。動画広告Proなどは1000〜1999、Metaは3000〜3999
FORMSVC = {'formrun.com', 'form.run', 'formzu.net', 'google.com', 'forms.gle', 'tayori.com', 'hubspot.com', 'jotform.com', 'formmailer.jp', 'ssl-form.com', 'form-mailer.jp', 'synergy-marketing.co.jp', 'cuenote.jp', 'typeform.com', 'wixsite.com', 'jimdofree.com', 'jimdosite.com', 'studio.site', 'fc2.com', 'blogspot.com', 'ameblo.jp', 'wpcomstaging.com'}
# 10/22〜23に手で外した理由のうち、社名・説明・URLで分かるもの（住宅展示場、不動産の仲介・販売、写真検索・比較サイト、団体、大手グループ）
NG_TYPE = re.compile(r'住宅展示場|住宅公園|ハウジングプラザ|ハウジングステージ|住宅展示|総合展示場|モデルハウスが集|不動産(販売|仲介|売買)|仲介|写真検索|比較サイト|ポータル|ランキング|口コミサイト|協会|組合|一般社団|公益|NPO|商工会|市役所|町役場|パナホーム|積水ハウス|大和ハウス|住友林業|ミサワホーム|トヨタホーム|一条工務店|タマホーム|ヘーベル|ホームページの閲覧が出来ない|閲覧できません|エクササイズコーチ|chocoZAP|ライザップ|RIZAP|湘南美容|TCB|品川美容|聖心美容|共立美容', re.I)
# 10/26 勝良さん決定：営業対象表の「不動産周辺」で動画広告Proに広告を出している会社だけ、不動産の仲介・販売を外す理由にしない（ほかの外す条件はそのまま）
NG_TYPE_FUDOSAN = re.compile(NG_TYPE.pattern.replace('不動産(販売|仲介|売買)|仲介|', ''), re.I)
def ng_type(c):
    rx = NG_TYPE_FUDOSAN if c.get('industry') == '不動産' and (c.get('list_source') or '').startswith('動画広告Pro') else NG_TYPE
    return rx.search(' '.join([c['name'], c.get('memo') or '', c['official_url']]))


def clean_name(n):
    """宛名に使う社名を整える（10/23に手で直した形：【】や絵文字を外し、「|」「｜」「/」の前だけを残す）"""
    t = re.sub(r'【[^】]*】|\[[^\]]*\]', '', n or '')
    t = re.sub(r'[\U0001F000-\U0001FFFF\u2600-\u27BF\uFE0F]', '', t)
    t = next((x.strip() for x in re.split(r'\s*[|｜/／]\s*', t) if x.strip()), t).strip(' -－_')
    return t[:40] or (n or '').strip()


def host(u):
    h = (urlparse(u if '://' in (u or '') else 'http://' + (u or '')).hostname or '').lower()
    return h[4:] if h.startswith('www.') else h


def base(h):
    p = h.split('.')
    if len(p) >= 3 and p[-2] in ('co', 'or', 'ne', 'ac', 'go', 'gr', 'ed', 'lg') and p[-1] == 'jp': return '.'.join(p[-3:])
    return '.'.join(p[-2:])


norm = lambda n: re.sub(r'(株式会社|有限会社|合同会社|一般社団法人|医療法人社団|医療法人|\(株\)|（株）|\s|　)', '', n or '')


def sales():
    return json.load(urllib.request.urlopen(urllib.request.Request(API, headers={'User-Agent': 'Mozilla/5.0'}), timeout=60))['companies']


def seen_sets(d1):
    """D1の全社・過去に調べた会社・手で外した会社・除外表の、ドメインと社名"""
    dom = {base(host(x.get(f))) for x in d1 for f in ('official_url', 'form_url') if x.get(f)}
    nm = {norm(x.get(f)) for x in d1 for f in ('name', 'legal_name') if x.get(f)}
    dom |= {base(x) for x in json.load(open(HERE + '/used_domains.json'))}
    # 10/27 点検し直し（LS_RECHECK=1）の時は、点検の履歴（調べ済み・検品済みドメイン）では外さない。D1・使用済み・既存社名・手で外した会社・除外は今までどおり
    if not os.environ.get('LS_RECHECK'):
        dom |= {base(x.strip()) for x in open(HERE + '/調べ済みドメイン.txt') if x.strip()}
        dom |= {x.strip() for x in open(HERE + '/検品済みドメイン.txt') if x.strip() and not x.startswith('#')}
    nm |= {norm(x) for x in open(HERE + '/既存社名.txt').read().split('\n') if x}
    for x in json.load(open(HERE + '/手で外した会社.json')):
        dom.add(base(host(x['official_url']))); nm.add(norm(x['name']))
    ex = HERE + '/../広告候補集め/候補化/'
    for f, s in (('除外ドメイン.txt', dom), ('除外社名.txt', nm)):
        # 10/27 除外ドメイン.txt は「調べたことのあるドメイン」の写し（5,057件）なので、点検し直し（LS_RECHECK）では使わない。送った会社は D1・used_domains で外れる
        if os.environ.get('LS_RECHECK'): continue  # 除外ドメイン.txt・除外社名.txt はどちらも「調べたことがある」の写し
        if os.path.exists(ex + f):
            for x in open(ex + f):
                x = x.strip()
                if x and not x.startswith('#'): s.add(base(x) if s is dom else norm(x))
    dom.discard(''); nm.discard('')
    return dom, nm


def cmd_cands(W, files):
    d1 = sales(); dom, nm = seen_sets(d1)
    out, skip, seenB, seenN = [], Counter(), set(), set()
    for f in [f for f in files if os.path.exists(f)]:
        for r in csv.DictReader(open(f), delimiter='\t'):
            if not r.get('official_url') or not (r.get('form_url') or '').startswith('http'): skip['フォームURLなし'] += 1; continue
            b = base(host(r['official_url']))
            if b in FORMSVC: b = host(r['official_url'])
            fb = base(host(r['form_url']))
            n = norm(r['name'])
            if b in seenB or n in seenN: skip['この回で重複'] += 1; continue
            seenB.add(b); seenN.add(n)
            if b in dom or (fb not in FORMSVC and fb in dom): skip['D1・調べ済みとドメインが重なる'] += 1; continue
            if n in nm: skip['D1・調べ済みと社名が重なる'] += 1; continue
            if 'menkira' in r['form_url']: skip['menkira'] += 1; continue
            if ng_type(r): skip['業種違い（展示場・仲介・団体・大手など）'] += 1; continue
            out.append({'key': 'C%03d' % (len(out) + 1), 'base': b, **{k: (r.get(k) or '').strip() for k in ('industry', 'name', 'official_url', 'form_url', 'memo', 'list_source', 'source_url', 'ad_media', 'ad_purpose', 'ad_evidence_url')}})
    json.dump(out, open(W + '/cands.json', 'w'), ensure_ascii=False, indent=0)
    print('検品へ', len(out), dict(skip))


def form_note(r, c):
    import 判定 as judge
    ex = r['ex']; caps = ex.get('captcha') or []
    capn = 'reCAPTCHA v3（画面に出ない形式）' if any('v3' in x or 'CF7' in x for x in caps) else '画面に出る認証なし'
    btn = r['plan']['buttons']; conf = [b for b in btn if b.startswith('confirm:')]; sub = [b for b in btn if b.startswith('submit:')]
    bn = f"確認画面あり（ボタン「{conf[0].split(':', 1)[1][:20]}」）" if conf else f"確認画面なし（ボタン「{sub[0].split(':', 1)[1][:20]}」で送信）"
    ta = [f for f in ex['fields'] if f['kind'] == 'textarea']
    lim = f"本文欄の上限{ta[0]['maxlength']}字（本文{r['bodyLen']}字が入ることを確認）" if ta and ta[0].get('maxlength') else f"本文{r['bodyLen']}字が一字一句入ることを確認"
    fn = '営業お断りの表記なし。' + capn + '。' + bn + '。' + lim + '。'
    if judge.dom(r.get('final_url') or c['form_url']) != judge.dom(c['form_url']): fn += f"開くと {r['final_url'][:80]} に移る。"
    return fn


def cmd_plan(W):
    os.environ['WORK'] = W
    sys.path.insert(0, HERE)
    import 判定 as judge
    ok, ng = [], Counter()
    for k, r in judge.res.items():
        if k not in judge.cands: continue
        why, fields = judge.judge(r)
        if why: ng[re.sub(r'[（(：:「].*', '', why[0])[:20]] += 1; continue
        ok.append((k, fields))
    d1 = sales(); dom, nm = seen_sets(d1)  # 検品の間にほかの担当が入れた会社を、登録の直前にもう一度外す
    have = {x['id'] for x in d1}
    def nxt(lo, hi):
        ns = [int(x[len(IDP):]) for x in have if x.startswith(IDP) and x[len(IDP):].isdigit() and lo <= int(x[len(IDP):]) < hi]
        return (max(ns) + 1) if ns else lo
    # 10/26 別の送付担当と番号が重ならないよう、Meta以外の帯を指定できる（例：LS_ID_BAND=5000 → 5000〜5999）
    band = int(os.environ.get('LS_ID_BAND') or 1000)
    n1, n3 = nxt(band, band + 1000), nxt(3000, 4000)
    adopt, dup = [], []
    ok.sort(key=lambda t: (ORDER.index(judge.cands[t[0]]['industry']) if judge.cands[t[0]]['industry'] in ORDER else 9, t[0]))
    for k, fields in ok:
        c = judge.cands[k]; r = judge.res[k]
        if ng_type(c): ng['業種違い（展示場・仲介・団体・大手など）'] += 1; continue
        c = {**c, 'name': clean_name(c['name'])}
        if c['industry'] not in V8: ng['業種が対象外'] += 1; continue
        if base(host(c['official_url'])) in dom or norm(c['name']) in nm: dup.append(c['name']); continue
        dom.add(base(host(c['official_url']))); nm.add(norm(c['name']))  # 10/27 複数の dry をまとめて登録する時、同じ会社を2回入れない
        ex = r['ex']; top = r.get('top') or {}
        tl = top.get('line') or []; fl = ex.get('line') or []; has = bool(tl or fl)
        jr = f"公式サイトのトップに {tl[0][:60]} へのリンクあり。" if tl else (f"問い合わせページに {fl[0][:60]} へのリンクあり。" if fl else "公式サイトのトップと問い合わせページに lin.ee / line.me へのリンクや「LINEで相談」の表記なし。")
        meta = (c.get('list_source') or '').startswith('Meta')
        if meta: i = n3; n3 += 1
        else: i = n1; n1 += 1
        obs = (c.get('memo') or '').rstrip('…').rstrip('、').strip() or c['name']
        if obs.startswith(('貴校', '貴社', '貴院')): obs = c['name']
        adopt.append({'id': IDP + str(i), 'cand_no': k, 'industry': c['industry'], 'name': c['name'], 'legal_name': c['name'], 'addressee': c['name'],
                      'official_url': c['official_url'], 'form_url': c['form_url'], 'line_status': 'あり' if has else 'サイトに見当たらない',
                      'offer': '公式LINE運用コンサル（見直し）' if has else '公式LINE運用コンサル（導入）', 'message_id': V8[c['industry']], 'observation': obs,
                      'list_source': c.get('list_source') or '動画広告Pro', 'source_url': c.get('source_url') or None, 'judge_reason': jr, 'form_note': form_note(r, c),
                      'fields': fields, 'ad_evidence_url': c.get('ad_evidence_url') or None, 'ad_media': c.get('ad_media') or None, 'ad_purpose': c.get('ad_purpose') or None})
    assert not ({x['id'] for x in adopt} & have), '同じIDがD1にある'
    json.dump(adopt, open(W + '/採用一覧.json', 'w'), ensure_ascii=False, indent=1)
    sql = subprocess.run([sys.executable, HERE + '/投入SQL作成.py', W + '/採用一覧.json', '5000'], check=True, capture_output=True, text=True).stdout if adopt else ''
    open(W + '/投入.sql', 'w').write(sql)
    open(W + '/ids.txt', 'w').write(','.join(x['id'] for x in adopt))
    lines = [f'## 判定の結果', f'- 検品した会社 {len(judge.res)}、合格 {len(adopt)}、登録の直前にD1と重なって外した {len(dup)}', f'- 落ちた理由（多い順）：' + '、'.join(f'{k} {v}' for k, v in ng.most_common(8)), '', '| 番号 | 業種 | 社名 | 公式サイト | 文面 |', '|---|---|---|---|---|']
    lines += [f"| {x['id']} | {x['industry']} | {x['name']} | {x['official_url']} | {x['message_id']} |" for x in adopt]
    md = '\n'.join(lines); print(md)
    if os.environ.get('GITHUB_STEP_SUMMARY'): open(os.environ['GITHUB_STEP_SUMMARY'], 'a').write(md + '\n')


def cmd_check(W):
    ids = [x for x in open(W + '/ids.txt').read().strip().split(',') if x]
    a = {x['id']: x for x in json.load(open(W + '/採用一覧.json'))}
    now = {x['id']: x for x in sales()}
    bad = [i for i in ids if i not in now or now[i]['status'] != '確認中' or now[i]['name'] != a[i]['name']]
    print('登録', len(ids), '読み戻しで合わない', bad)
    if bad: sys.exit(1)


if __name__ == '__main__':
    c, W = sys.argv[1], sys.argv[2]
    os.makedirs(W, exist_ok=True)
    {'cands': lambda: cmd_cands(W, sys.argv[3:]), 'plan': lambda: cmd_plan(W), 'check': lambda: cmd_check(W)}[c]()
