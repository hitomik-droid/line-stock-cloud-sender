#!/bin/bash
# 「動画広告Proを並べて読む」の次の回を起動する。言葉・期間・並べ替えの組み合わせ（広告候補集め/動画広告Pro_組み合わせ.txt）を、
# 次の位置（広告候補集め/動画広告Pro_次の位置.txt）から タブ数×12 個ずつ、重ねずに順に渡す（Macの サーバー回し.sh と同じ）。
# 既に読み込みが動いている・待っている時は起動しない（ログインは1つだけ）。使い方：bash .github/scripts/次の読み込み.sh [タブ数]
set -e
TABS=${1:-3}; C=広告候補集め/動画広告Pro_組み合わせ.txt; P=広告候補集め/動画広告Pro_次の位置.txt
busy=$(gh run list -R "$R" --workflow douga-parallel.yml -L 10 --json status --jq '[.[]|select(.status=="in_progress" or .status=="queued" or .status=="pending" or .status=="waiting")]|length')
[ "$busy" != 0 ] && { echo "読み込みが動いている・待っている（$busy）。起動しない"; exit 0; }
git pull -q --rebase origin main || true
i=$(cat "$P" 2>/dev/null || echo 0); N=$(grep -c . "$C"); [ "$i" -ge "$N" ] && i=0
k=$((TABS*12)); combos=$(sed -n "$((i+1)),$((i+k))p" "$C" | paste -sd';' -)
gh workflow run douga-parallel.yml -R "$R" -f combos="$combos" -f tabs="$TABS" -f pages=15
echo $((i+k)) > "$P"
git config user.name "github-actions[bot]"; git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git add "$P"; git commit -q -m "読み込みの次の位置 $((i+k))" || true
for t in 1 2 3 4 5; do git pull -q --rebase origin main && git push -q origin HEAD:main && break; sleep $((t*5)); done
echo "次の読み込みを起動：組み合わせ $((i+1))〜$((i+k))（タブ$TABS）"
