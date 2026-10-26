#!/bin/bash
# 登録/登録待ち.txt に残った dry を、1本ずつ register（from_run）する（2026-10-27）。D1が読めるようになってから動かす（登録待ち.yml が毎朝9:02に動かす）
# 登録できた dry は登録待ち.txt から消し、登録した会社のIDを 登録/追跡リンク待ち.txt に足す（在庫化担当が追跡リンクを発行する）。採用一覧.json は各 register の成果物「全部の記録」にある
set -u; R=${R:-$GITHUB_REPOSITORY}; F=登録/登録待ち.txt; [ -s "$F" ] || { echo "登録待ちは無い"; exit 0; }
LEFT=$(mktemp); OK=0; NG=0
while read -r DRY TAG _; do
  [ -z "$DRY" ] && continue
  done_=""
  for a in $(seq 1 10); do
    while [ -n "$(gh run list -R "$R" --workflow 全部.yml -L 20 --json status,displayTitle --jq '.[]|select((.status=="queued" or .status=="pending" or .status=="waiting") and (.displayTitle|startswith("全部 register") or startswith("全部 send")))|.status' | head -1)" ]; do sleep 90; done
    T2="$TAG-後$a"
    gh workflow run 全部.yml -R "$R" -f mode=register -f source=file -f q=- -f from_run="$DRY" -f tag="$T2" -f id_band=5000 -f sender=自動の在庫づくり >/dev/null || continue
    id=""; for t in $(seq 1 20); do sleep 20; id=$(gh run list -R "$R" --workflow 全部.yml -L 50 --json databaseId,displayTitle --jq ".[]|select(.displayTitle==\"全部 register $T2\")|.databaseId" | head -1); [ -n "$id" ] && break; done
    [ -z "$id" ] && continue
    gh run watch "$id" -R "$R" --interval 120 >/dev/null 2>&1
    c=$(gh run view "$id" -R "$R" --json conclusion --jq .conclusion)
    [ "$c" = cancelled ] && continue
    if [ "$c" = success ]; then
      T=$(mktemp -d); gh run download "$id" -R "$R" -n 全部の記録 -D "$T" >/dev/null 2>&1
      ids=$(cat "$T/ids.txt" 2>/dev/null); [ -n "$ids" ] && echo "$ids" | tr ',' '\n' >> 登録/追跡リンク待ち.txt
      echo "dry $DRY → register $id：登録 ${ids:-なし}"; done_=1; OK=$((OK+1))
    else echo "dry $DRY → register $id：$c"; fi
    break
  done
  [ -z "$done_" ] && { echo "$DRY $TAG" >> "$LEFT"; NG=$((NG+1)); }
done < "$F"
cp "$LEFT" "$F"
git config user.name "github-actions[bot]"; git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
touch 登録/追跡リンク待ち.txt; git add "$F" 登録/追跡リンク待ち.txt; git commit -q -m "登録待ちを流した：登録 $OK 本・残り $NG 本" || true
for i in 1 2 3 4 5; do git pull -q --rebase origin main && git push -q origin HEAD:main && break; sleep $((i*5)); done
echo "登録 $OK 本・残り $NG 本"
