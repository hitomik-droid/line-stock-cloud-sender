#!/bin/bash
# 候補の元（リポジトリの .json）を、全部.yml の dry（公式サイト探し・点検。同時に動く）→ register（D1登録。1本ずつ、from_run で検品を使い回す）の順に流す。
# register は待ちが2本になると古い方が取り消されるので、取り消されたら起動し直す（Macの 在庫づくり_1回分.sh の zenbu() と同じ）。
# 使い方：bash .github/scripts/全部を流す.sh <候補の元.json> <印>　結果は $W/流した結果.txt
set -u
Q=$1; TAG=$2; OUT="$W/流した結果.txt"
start() {  # $1 mode、$2 tag、残りは -f。起動した実行の番号を返す
  local mode=$1 tg=$2; shift 2
  gh workflow run 全部.yml -R "$R" -f mode="$mode" -f tag="$tg" -f id_band=5000 -f sender=自動の在庫づくり "$@" >/dev/null || return 1
  for t in $(seq 1 30); do
    sleep 10
    local id=$(gh run list -R "$R" --workflow 全部.yml -L 100 --json databaseId,displayTitle --jq ".[]|select(.displayTitle==\"全部 $mode $tg\")|.databaseId" | head -1)
    [ -n "$id" ] && { echo "$id"; return 0; }
  done; return 1
}
DRY=$(start dry "$TAG" -f source=file -f q="$Q" -f recheck="${RECHECK:-false}") || { echo "dry を起動できない" | tee "$OUT"; exit 1; }
echo "dry $DRY" ; gh run watch "$DRY" -R "$R" --interval 30 >/dev/null 2>&1
[ "$(gh run view "$DRY" -R "$R" --json conclusion --jq .conclusion)" = success ] || { echo "dry $DRY が失敗" | tee "$OUT"; exit 1; }
T=$(mktemp -d); gh run download "$DRY" -R "$R" -n 全部の記録 -D "$T" >/dev/null 2>&1
P=$(tr ',' '\n' < "$T/ids.txt" 2>/dev/null | grep -c . || true)
echo "dry $DRY：点検 $(cat "$T/results.jsonl" 2>/dev/null | grep -c . ) 件、合格 $P 社" | tee "$OUT"
[ "$P" = 0 ] && exit 0
for a in $(seq 1 20); do
  sleep $((RANDOM % 40))  # 組がいくつも同時に終わった時に、登録の起動がぶつからないよう少しずらす
  # 登録は1本ずつ：ほかの register・send が待っている間は起動しない
  while [ -n "$(gh run list -R "$R" --workflow 全部.yml -L 20 --json status,displayTitle --jq '.[]|select((.status=="queued" or .status=="pending" or .status=="waiting") and (.displayTitle|startswith("全部 register") or startswith("全部 send")))|.status' | head -1)" ]; do sleep 30; done
  REG=$(start register "$TAG-$a" -f source=file -f q=- -f from_run="$DRY") || continue
  gh run watch "$REG" -R "$R" --interval 20 >/dev/null 2>&1
  c=$(gh run view "$REG" -R "$R" --json conclusion --jq .conclusion)
  [ "$c" = cancelled ] && { echo "register $REG が取り消された。起動し直す"; continue; }
  if [ "$c" != success ]; then
    # 10/27 D1の無料枠の上限などで登録できない時は、dry の番号を残して後で登録する（bash .github/scripts/登録待ちを流す.sh）
    echo "$DRY $TAG $(date -u +%Y-%m-%dT%H:%MZ)" >> 登録/登録待ち.txt
    git add 登録/登録待ち.txt; git commit -q -m "登録待ち：dry $DRY（$TAG）" || true
    for i in 1 2 3 4 5; do git pull -q --rebase origin main && git push -q origin HEAD:main && break; sleep $((i*5)); done
    echo "register $REG：$c。dry $DRY を 登録/登録待ち.txt に残した" | tee -a "$OUT"; exit 0
  fi
  T2=$(mktemp -d); gh run download "$REG" -R "$R" -n 全部の記録 -D "$T2" >/dev/null 2>&1
  echo "register $REG：$c 登録ID=$(cat "$T2/ids.txt" 2>/dev/null)" | tee -a "$OUT"; exit 0
done
echo "register を起動できなかった" | tee -a "$OUT"; exit 1
