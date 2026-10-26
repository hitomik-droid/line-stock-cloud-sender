# 広告の行き先がSNS・予約サイトなどで公式サイトが分からない会社だけ、社名で Brave Search API を引き、公式サイトの候補を行き先に入れる（2026-10-27 勝良さん「1 作る」）。
# 使い方：python3 登録/公式サイトを名前で探す.py <候補の元.json>（上書きする）
#   環境変数 BRAVE_API_KEY（1Password の op://GitHub/Brave Search API/credential から読む。値はログに出さない）。無ければ何もしない
# 決まり（10/27 0:4x 勝良さん「基本的には無料の範囲内で」）：
#   ・1日の検索は DAILY_CAP 回まで（Braveの無料枠は月5ドル分＝約1,000回。÷31日より少し下）。上限に達したら、その日は止めて残りは翌日
#   ・同じ社名は2回検索しない（D1 search_cache に結果を貯める）。使った回数は D1 search_usage に日ごとに残す
#   ・上限の8割に届いたら、出力の「知らせる」に1行出す（在庫づくり.yml が Summary に書く）
# 見つけた行き先は、ふだんの公式サイト探し（業種の語・広告主名・大手や比較サイトの除外）をそのまま通す。ロボット確認には触らない。
import json, os, re, subprocess, sys, time, urllib.parse, urllib.request, datetime
HERE = os.path.dirname(os.path.abspath(__file__))
DAILY_CAP = int(os.environ.get('BRAVE_DAILY_CAP', '30'))
SNS = re.compile(r'(^|\.)(instagram\.com|facebook\.com|fb\.me|tiktok\.com|x\.com|twitter\.com|youtube\.com|youtu\.be|line\.me|lin\.ee|linktr\.ee|lit\.link|hotpepper\.jp|calendar\.google\.com|google\.com|utage-system\.com|studio\.site|peraichi\.com|ameblo\.jp|note\.com|stores\.jp|base\.shop|wixsite\.com|jimdofree\.com|reserva\.be|coubic\.com|airrsv\.net)$', re.I)
SKIP = re.compile(r'(^|\.)(instagram|facebook|tiktok|twitter|x|youtube|line|linktr|hotpepper|google|wikipedia|amazon|rakuten|yahoo|indeed|townwork|baitoru|minkou|ekiten|epark|jalan|tabelog|retty|gnavi|hitosara|ozmall|minimodel|biyou|beauty|suumo|homes|athome|ameblo|note|prtimes|wantedly|en-japan|mynavi|rikunabi|doda)\.', re.I)

def d1(sql):
    r = subprocess.run(['npx', '--yes', 'wrangler@4.150.0', 'd1', 'execute', 'line-stock-sales', '--remote', '--config', HERE + '/wrangler.jsonc', '--json', '--command', sql], capture_output=True, text=True, cwd=HERE)
    if r.returncode: raise SystemExit('D1に届かない：' + (r.stderr or r.stdout)[-200:])
    return [x for c in json.loads(r.stdout) for x in c['results']]
q = lambda v: "'" + str(v).replace("'", "''") + "'"
norm = lambda s: re.sub(r'[\s\W_]+', '', s or '').lower()
host = lambda u: (urllib.parse.urlsplit(u or '').hostname or '').lower()

def main():
    p = sys.argv[1]; rows = json.load(open(p))
    key = os.environ.get('BRAVE_API_KEY')
    want = [r for r in rows if SNS.search(host(r.get('landing')) or 'x.invalid') or not r.get('landing')]
    out = {'公式サイトが分からない': len(want), '検索した': 0, '貯めた結果を使った': 0, '見つかった': 0, '上限で翌日へ': 0}
    if not want or not key:
        out['メモ'] = '鍵が無い' if want and not key else ''
        print(json.dumps(out, ensure_ascii=False)); return
    d1("CREATE TABLE IF NOT EXISTS search_cache (name TEXT PRIMARY KEY, url TEXT, searched_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS search_usage (date TEXT PRIMARY KEY, n INTEGER NOT NULL)")
    today = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=9))).strftime('%Y-%m-%d')
    names = sorted({norm(r['name']) for r in want})
    cache = {}
    for i in range(0, len(names), 80):
        part = names[i:i + 80]
        for x in d1('SELECT name, url FROM search_cache WHERE name IN (' + ','.join(q(n) for n in part) + ')'): cache[x['name']] = x['url']
    used = (d1(f'SELECT n FROM search_usage WHERE date = {q(today)}') or [{'n': 0}])[0]['n']
    for r in want:
        k = norm(r['name'])
        if k in cache:
            out['貯めた結果を使った'] += 1
        else:
            if used >= DAILY_CAP: out['上限で翌日へ'] += 1; continue
            # 先に回数を数えてから引く（同時に動く組どうしで上限を越えにくくする）
            d1(f"INSERT INTO search_usage (date, n) VALUES ({q(today)}, 1) ON CONFLICT(date) DO UPDATE SET n = n + 1")
            used += 1; out['検索した'] += 1
            url = ''
            try:
                api = 'https://api.search.brave.com/res/v1/web/search?' + urllib.parse.urlencode({'q': f"{r['name']} 公式", 'country': 'jp', 'search_lang': 'jp', 'count': 10})
                res = json.load(urllib.request.urlopen(urllib.request.Request(api, headers={'Accept': 'application/json', 'X-Subscription-Token': key}), timeout=20))
                for it in (res.get('web') or {}).get('results') or []:
                    h = host(it.get('url'))
                    if h and not SNS.search(h) and not SKIP.search(h + '.'): url = it['url']; break
            except Exception as e:
                print('検索に失敗：' + str(e)[:80], file=sys.stderr)
            cache[k] = url
            d1(f"INSERT OR REPLACE INTO search_cache (name, url, searched_at) VALUES ({q(k)}, {q(url)}, {q(datetime.datetime.utcnow().isoformat() + 'Z')})")
            time.sleep(1.1)  # 無料枠は1秒あたりの回数にも上限がある
        if cache.get(k):
            r['landing_original'] = r.get('landing'); r['landing'] = cache[k]; r['found_by'] = 'Brave社名検索'; out['見つかった'] += 1
    json.dump(rows, open(p, 'w'), ensure_ascii=False, indent=0)
    out['今日の回数'] = f'{used}/{DAILY_CAP}'
    if used >= DAILY_CAP * 0.8: out['知らせる'] = f'Brave検索の今日の回数が上限の8割に届いた（{used}/{DAILY_CAP}）'
    print(json.dumps(out, ensure_ascii=False))

if __name__ == '__main__':
    main()
