# 動画広告Proの検索語の元表（動画広告Pro_組み合わせ_元.txt：言葉|期間|並べ替え|業種）から、
# 登録/対象業種.json の業種の行だけを 動画広告Pro_組み合わせ.txt に書き出す（douga-parallel.yml はこのファイルを読む。WFは変えない）。
# 2026-11-17 ひとみ「業種のチェックシート作って、俺のチェック入れたやつにフォーム営業する」。業種は語に付ける（広告のジャンルで大ざっぱに決めない）。
# 使い方：python3 広告候補集め/組み合わせを作る.py   （--check で書き出さずに数だけ出す）
import json, os, sys, collections
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
SRC, OUT = os.path.join(HERE, '動画広告Pro_組み合わせ_元.txt'), os.path.join(HERE, '動画広告Pro_組み合わせ.txt')
T = set(json.load(open(os.path.join(ROOT, '登録', '対象業種.json'), encoding='utf-8'))['industries'])
rows, seen = [], set()
for l in open(SRC, encoding='utf-8'):
    l = l.rstrip('\n')
    if not l or l.startswith('#'): continue
    p = l.split('|')
    if len(p) != 4 or not p[3]: sys.exit(f'業種の無い行：{l}')
    if (p[0], p[1], p[2]) in seen: continue
    seen.add((p[0], p[1], p[2])); rows.append(p)
keep = [p for p in rows if p[3] in T]
by = collections.Counter(p[3] for p in keep)
print(f'元{len(rows)}行 → 対象{len(keep)}行', dict(by), '語の無い対象業種:', sorted(T - set(by)) or 'なし')
if '--check' not in sys.argv:
    if not keep: sys.exit('対象の行が0。書き出さない（前の表のまま）')
    open(OUT, 'w', encoding='utf-8').write(''.join('|'.join(p) + '\n' for p in keep))
