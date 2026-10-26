#!/bin/zsh
# 2026-10-21 8:00 に、①10/21分の99社（送信一覧_20261021.json、本人が観察の一覧を見て2026-10-21 0:50に「10/21の8時から送るようにしておいて」）を送り、
# ②送付失敗のうち送れていない43社（送り直し一覧_20261021.json）を1回だけ送り直す。
# 本人の指示（2026-10-20「送信失敗したものは明日の8時から再開するように設定して」）。送れたか不明の会社と手送りに回した会社は一覧に入れていない。
# 呼び出し元：~/Library/LaunchAgents/com.linestock.retry20261021.plist
cd "/Users/hitomikatsura/Desktop/Obsidian Vault/20_仕事/業務基盤/個人戦略（自社事業）/LINEストック/成果物/クラウド送信" || exit 1
# 2026-10-26 勝良さん指示：送信は日本時間8:00〜20:00だけ
H=$(TZ=Asia/Tokyo date +%-H); { [ "$H" -lt 8 ] || [ "$H" -ge 20 ]; } && exit 0
[ "$(date +%F)" = "2026-10-21" ] || exit 0
[ -e 記録/送り直し_20261021.済 ] && exit 0
mkdir -p 記録 && touch 記録/送り直し_20261021.済
export PATH="/Users/hitomikatsura/.local/bin:/opt/homebrew/bin:/usr/bin:/bin"
IDS=$(python3 -c 'import json;print(",".join(json.load(open("送信一覧_20261021.json"))))')
node 一括送信.mjs --mode=send --headed --ids="$IDS" --limit=99 > 記録/送信_20261021.log 2>&1
node 一括送信.mjs --mode=send --headed --retry-list=送り直し一覧_20261021.json --limit=43 > 記録/送り直し_20261021.log 2>&1
