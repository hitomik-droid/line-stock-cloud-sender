#!/bin/bash
# 承認待ちの仮ID（MSG-○○-v3案）を、勝良さんの「送って」の後に本番のID（MSG-○○-v3）へ付け替える（2026-10-27）。
# 使い方（このフォルダ＝クラウド送信 で）：bash 登録/仮IDを本番にする.sh [仮ID ...]　引数が無ければ -v3案 の8本全部
# すること：D1 messages に本番IDの行を足す（本文は仮IDと同じ、題名の【承認待ち】を外す）→ D1 companies の message_id を付け替え →
#           コード（流れ.py・フォーム検品.mjs・投入SQL作成.py・messages.json）の仮IDを本番IDに替え、朝の送付対象.py の APPROVED に足す → コミットしてpush
# 本文は変えない。送付は、この後の「自動送付（8〜19時・毎時）」が承認済みとして選ぶ。
set -eu
cd "$(dirname "$0")/.."
IDS=("$@"); [ ${#IDS[@]} -eq 0 ] && IDS=(MSG-整体-v3案 MSG-エステ-v3案 MSG-学習塾-v3案 MSG-士業-v3案 MSG-飲食-v3案 MSG-ペット-v3案 MSG-美容室-v3案 MSG-ホテル-v3案)
SQL=""
for T in "${IDS[@]}"; do
  P="${T%案}"
  SQL+="INSERT OR IGNORE INTO messages (id,title,body,updated_at) SELECT '$P', REPLACE(title,'【承認待ち】',''), body, strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM messages WHERE id='$T';"
  SQL+="UPDATE companies SET message_id='$P' WHERE message_id='$T';"
  for f in 登録/流れ.py 広告候補集め/候補化/フォーム検品.mjs 登録/投入SQL作成.py 広告候補集め/候補化/messages.json; do sed -i.bak "s/$T/$P/g" "$f" && rm -f "$f.bak"; done
  python3 - "$P" <<'PY'
import re, sys
p = '登録/朝の送付対象.py'; s = open(p, encoding='utf-8').read(); mid = sys.argv[1]
if f"'{mid}'" not in s: s = re.sub(r"(APPROVED = \{[^}]*)\}", lambda m: m.group(1) + f", '{mid}'}}", s, count=1, flags=re.S)
open(p, 'w', encoding='utf-8').write(s)
PY
done
(cd 登録 && npx --yes wrangler@4.150.0 d1 execute line-stock-sales --remote --command="$SQL")
(cd 登録 && npx --yes wrangler@4.150.0 d1 execute line-stock-sales --remote --command="SELECT message_id, COUNT(*) n FROM companies WHERE message_id LIKE 'MSG-%-v3%' GROUP BY message_id")
git add 登録/流れ.py 広告候補集め/候補化/フォーム検品.mjs 登録/投入SQL作成.py 広告候補集め/候補化/messages.json 登録/朝の送付対象.py
git commit -q -m "承認された本文の仮IDを本番IDに付け替える：${IDS[*]}" && git pull -q --rebase && git push -q
echo "付け替えた：${IDS[*]}。ダッシュボードの在庫の数（商品設計/src/index.js の APPROVED）にも足すこと"
