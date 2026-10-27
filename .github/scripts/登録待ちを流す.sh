#!/bin/bash
# 登録/登録待ち.txt に残った dry を register（from_run）する（2026-10-27）。D1が読めるようになってから動かす（登録待ち.yml が毎朝9:02に動かす）
# 10/27 速くするため、dry を BATCH 本ずつまとめて1回の register で登録する（同じ会社は流れ.py が1回だけにする）。終わりは20秒おきに見る
# 登録できた dry は登録待ち.txt から消し、登録した会社のIDを 登録/追跡リンク待ち.txt に足す（在庫化担当が追跡リンクを発行する）。採用一覧.json は各 register の成果物「全部の記録」にある
# 1回終わるごとに登録待ち.txt を push する（途中で止めても、済んだ分は二度流さない）
set -u; R=${R:-$GITHUB_REPOSITORY}; F=登録/登録待ち.txt; BATCH=${BATCH:-8}; [ -s "$F" ] || { echo "登録待ちは無い"; exit 0; }
git config user.name "github-actions[bot]"; git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
OK=0; NG=0; N=0
save() {  # $1=済んだ dry（空白区切り） $2=見出し
  for d in $1; do grep -v "^$d " "$F" > "$F.tmp"; mv "$F.tmp" "$F"; done
  touch 登録/追跡リンク待ち.txt; git add "$F" 登録/追跡リンク待ち.txt; git commit -q -m "$2" || true
  for i in 1 2 3 4 5; do
    git pull -q --rebase origin main || { git rebase --abort 2>/dev/null || true; sleep $((i*5)); continue; }
    git push -q origin HEAD:main && return 0; sleep $((i*5))
  done
}
mapfile -t L < <(grep -v '^[[:space:]]*$' "$F")
for ((s=0; s<${#L[@]}; s+=BATCH)); do
  G=("${L[@]:s:BATCH}"); DRYS=$(printf '%s\n' "${G[@]}" | awk '{print $1}' | paste -sd, -); N=$((N+1))
  TAG=$(echo "${G[0]}" | awk '{print $2}'); T2="まとめ$N-$TAG"; c=""
  for a in 1 2 3; do
    while [ -n "$(gh run list -R "$R" --workflow 全部.yml -L 20 --json status,displayTitle --jq '.[]|select((.status=="queued" or .status=="pending" or .status=="waiting") and (.displayTitle|startswith("全部 register") or startswith("全部 send")))|.status' | head -1)" ]; do sleep 20; done
    gh workflow run 全部.yml -R "$R" -f mode=register -f source=file -f q=- -f from_run="$DRYS" -f tag="$T2-$a" -f id_band=5000 -f sender=自動の在庫づくり >/dev/null || { sleep 20; continue; }
    id=""; for t in $(seq 1 30); do sleep 10; id=$(gh run list -R "$R" --workflow 全部.yml -L 50 --json databaseId,displayTitle --jq ".[]|select(.displayTitle==\"全部 register $T2-$a\")|.databaseId" | head -1); [ -n "$id" ] && break; done
    [ -z "$id" ] && continue
    gh run watch "$id" -R "$R" --interval 20 >/dev/null 2>&1
    c=$(gh run view "$id" -R "$R" --json conclusion --jq .conclusion)
    [ "$c" = cancelled ] && continue
    break
  done
  if [ "$c" = success ]; then
    T=$(mktemp -d); gh run download "$id" -R "$R" -n 全部の記録 -D "$T" >/dev/null 2>&1
    ids=$(cat "$T/ids.txt" 2>/dev/null); [ -n "$ids" ] && echo "$ids" | tr ',' '\n' >> 登録/追跡リンク待ち.txt
    done_=$(cat "$T/まとめたdry.txt" 2>/dev/null | paste -sd' ' -); miss=$(cat "$T/取れなかったdry.txt" 2>/dev/null | paste -sd' ' -)
    k=$(echo "$done_" | wc -w); OK=$((OK+k)); NG=$((NG+$(echo "$miss" | wc -w)))
    echo "dry ${k}本 → register $id：登録 ${ids:-なし}${miss:+（成果物が取れず残した dry：$miss）}"
    save "$done_" "登録待ちを流した：dry ${k}本（register $id）"
  else
    echo "dry $DRYS → register ${id:-起動できず}：${c:-不明}（残した）"; NG=$((NG+${#G[@]}))
  fi
done
echo "登録 $OK 本・残り $NG 本"
