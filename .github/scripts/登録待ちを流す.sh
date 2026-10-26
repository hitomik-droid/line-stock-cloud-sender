#!/bin/bash
# 登録/登録待ち.txt に残った dry を、1本ずつ register（from_run）する。D1が読めるようになってから手で動かす（2026-10-27）
# 使い方：R=hitomik-droid/line-stock-cloud-sender bash .github/scripts/登録待ちを流す.sh
set -u; R=${R:-hitomik-droid/line-stock-cloud-sender}
while read -r DRY TAG _; do
  [ -z "$DRY" ] && continue
  gh workflow run 全部.yml -R "$R" -f mode=register -f source=file -f q=- -f from_run="$DRY" -f tag="$TAG-後" -f id_band=5000 -f sender=自動の在庫づくり
  sleep 15; id=$(gh run list -R "$R" --workflow 全部.yml -L 30 --json databaseId,displayTitle --jq ".[]|select(.displayTitle==\"全部 register $TAG-後\")|.databaseId" | head -1)
  gh run watch "$id" -R "$R" --interval 20 >/dev/null 2>&1; echo "$DRY → register $id $(gh run view "$id" -R "$R" --json conclusion --jq .conclusion)"
done < 登録/登録待ち.txt
