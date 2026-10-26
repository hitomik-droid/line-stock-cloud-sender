# 動画広告Proの読み込み（douga-parallel）ごとに、在庫づくりのどの段まで進んだかを数え、記録/在庫づくり_待ち.json に出す。
# 2026-10-27 指揮の割り当て「段ごとの待ちの数を出す係」。GitHub の実行の記録だけを読む（D1・本文には触らない）。
import json, os, re, subprocess, tempfile, glob, datetime
R = os.environ.get('R', 'hitomik-droid/line-stock-cloud-sender'); SINCE = os.environ.get('SINCE', '2026-10-26T13:40:00Z')
def gh(*a):
    return subprocess.run(['gh', *a, '-R', R], capture_output=True, text=True).stdout
def runs(wf, n=100):
    return json.loads(gh('run', 'list', '--workflow', wf, '-L', str(n), '--json', 'databaseId,displayTitle,status,conclusion,createdAt') or '[]')
def has_data(i):
    out = subprocess.run(['gh', 'api', f'repos/{R}/actions/runs/{i}/artifacts', '-q', '[.artifacts[]|select(.name=="動画広告Pro_並列")]|length'], capture_output=True, text=True).stdout.strip()
    return out not in ('', '0')
log = subprocess.run(['git', 'log', '-300', '--format=%s', 'origin/main'], capture_output=True, text=True).stdout
cand = {m.group(1): int(m.group(2)) for m in re.finditer(r'在庫づくり：動画広告Pro (\d+) の新しい広告主 (\d+) 社', log)}
Z = {r['displayTitle'].split()[-1]: r for r in runs('在庫づくり.yml') if r['displayTitle'].startswith('在庫づくり ')}
A = runs('全部.yml', 200)
rows, tot = [], {'取り込み待ち': 0, '取り込み中': 0, '公式サイト探し・点検中': 0, '登録待ち・登録中': 0, '済': 0}
for d in runs('douga-parallel.yml'):
    if d['createdAt'] < SINCE: continue
    i = str(d['databaseId'])
    if d['status'] != 'completed': rows.append({'読み込み': i, '段': '読み込み中'}); continue
    z = Z.get(i)
    if not z:
        if has_data(i):
            # 取り込みが自動で動かなかった回は、終わって10分たったら在庫づくりをその番号で起動する（起動だけ。中身は変えない）
            age = (datetime.datetime.now(datetime.timezone.utc) - datetime.datetime.fromisoformat(d['createdAt'].replace('Z', '+00:00'))).total_seconds()
            ended = subprocess.run(['gh', 'api', f'repos/{R}/actions/runs/{i}', '-q', '.updated_at'], capture_output=True, text=True).stdout.strip()
            late = ended and (datetime.datetime.now(datetime.timezone.utc) - datetime.datetime.fromisoformat(ended.replace('Z', '+00:00'))).total_seconds() > 600
            r = {'読み込み': i, '段': '取り込み待ち'}
            if late and os.environ.get('KICK') == '1':
                subprocess.run(['gh', 'workflow', 'run', '在庫づくり.yml', '-R', R, '-f', f'run_id={i}'], capture_output=True); r['起動した'] = True
            rows.append(r); tot['取り込み待ち'] += 1
        continue
    n = cand.get(i)
    dry = [a for a in A if a['displayTitle'] == f'全部 dry z{i}']
    reg = [a for a in A if a['displayTitle'].startswith(f'全部 register z{i}-')]
    r = {'読み込み': i, '在庫づくり': z['databaseId'], '新しい広告主': n}
    if z['status'] == 'completed':
        r['段'] = '済'; r['結果'] = z['conclusion']
        T = tempfile.mkdtemp()
        subprocess.run(['gh', 'run', 'download', str(z['databaseId']), '-R', R, '-n', '在庫づくりの記録', '-D', T], capture_output=True)
        t = ' '.join(open(f).read() for f in glob.glob(f'{T}/**/流した結果.txt', recursive=True))
        m = re.search(r'点検 (\d+) 件、合格 (\d+) 社', t); r['点検'] = int(m.group(1)) if m else None; r['合格'] = int(m.group(2)) if m else None
        m = re.search(r'登録ID=([^\s]*)', t); r['登録'] = len([x for x in m.group(1).split(',') if x]) if m else 0
        tot['済'] += 1
    elif n is None: r['段'] = '取り込み中'; tot['取り込み中'] += 1
    elif reg or (dry and dry[0]['status'] == 'completed'): r['段'] = '登録待ち・登録中'; tot['登録待ち・登録中'] += 1
    else: r['段'] = '公式サイト探し・点検中'; tot['公式サイト探し・点検中'] += 1
    rows.append(r)
wait = [r for r in rows if r['段'] not in ('済', '読み込み中')]
out = {'時刻': datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=9))).strftime('%Y-%m-%d %H:%M JST'),
       '在庫づくり待ち（読み込みの回数）': len(wait), '待ちの広告主（取り込み済みで未完了の分）': sum(r.get('新しい広告主') or 0 for r in wait),
       '段ごとの回数': tot, '読み込みごと': rows}
os.makedirs('記録', exist_ok=True); json.dump(out, open('記録/在庫づくり_待ち.json', 'w'), ensure_ascii=False, indent=1)
print(json.dumps({k: v for k, v in out.items() if k != '読み込みごと'}, ensure_ascii=False))
