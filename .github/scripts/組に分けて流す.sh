#!/bin/bash
# 候補の元（.json か .tsv）を N 社ずつの組に分けてリポジトリに置き、組ごとに 全部を流す.sh（dry → register）を同時に動かす（2026-10-27）。
# dry は組ごとに同時（GitHubの枠が空くまで待つのはGitHub側）。register は 全部を流す.sh の中で1本ずつ。
# 使い方：bash .github/scripts/組に分けて流す.sh <候補の元> <印> [1組の社数]
set -u
Q=$1; TAG=$2; N=${3:-80}; D=広告候補集め/候補化/入力/組; mkdir -p "$D"
B=$(basename "${Q%.*}")
LIST=$(python3 - "$Q" "$D/$B" "$N" <<'PY'
import json, sys
src, pre, n = sys.argv[1], sys.argv[2], int(sys.argv[3])
if src.endswith('.tsv'):
    L = open(src, encoding='utf-8').read().splitlines(); head, rows = L[0], [l for l in L[1:] if l.strip()]
    parts = [rows[i:i + n] for i in range(0, len(rows), n)]
    for k, p in enumerate(parts): open(f'{pre}_{k + 1:02d}.tsv', 'w', encoding='utf-8').write('\n'.join([head] + p) + '\n')
    print(' '.join(f'{pre}_{k + 1:02d}.tsv' for k in range(len(parts))))
else:
    rows = json.load(open(src)); parts = [rows[i:i + n] for i in range(0, len(rows), n)]
    for k, p in enumerate(parts): json.dump(p, open(f'{pre}_{k + 1:02d}.json', 'w'), ensure_ascii=False, indent=0)
    print(' '.join(f'{pre}_{k + 1:02d}.json' for k in range(len(parts))))
PY
)
set -- $LIST; echo "組の数：$#"
if [ $# -le 1 ]; then rm -f $LIST; exec bash .github/scripts/全部を流す.sh "$Q" "$TAG"; fi
git config user.name "github-actions[bot]"; git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git add $LIST; git commit -q -m "在庫づくり：$B を $# 組に分ける" || true
for i in 1 2 3 4 5; do git pull -q --rebase origin main && git push -q origin HEAD:main && break; sleep $((i*5)); done
OUT0="$W/流した結果.txt"; : > "$OUT0"; k=0
for f in $LIST; do
  k=$((k+1)); mkdir -p "$W/組$k"
  ( W="$W/組$k" bash .github/scripts/全部を流す.sh "$f" "$TAG-$k" > "$W/組$k/ログ.txt" 2>&1 ) &
  sleep 3
done
wait
for i in $(seq 1 $k); do echo "組$i：$(tr '\n' ' ' < "$W/組$i/流した結果.txt" 2>/dev/null)" >> "$OUT0"; done
cat "$OUT0"
