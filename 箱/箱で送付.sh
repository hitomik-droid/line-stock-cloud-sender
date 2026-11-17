#!/usr/bin/env bash
# 2026-11-17 13:17 ひとみ「GitHubの送信用PCはもう使わない…全部Grok BotのクラウドPCで一元管理」：
# 朝の自動送付.yml → send.yml（GitHubのrunner）と同じ流れを、Grok箱で動かす。
#   1) 台帳をそろえる（D1が読める時だけ・CLOUDFLARE_* と SUPABASE_* がある時だけ）
#   2) 送る会社を選ぶ（登録/朝の送付対象.py・上限は既定80、80より上は受け付けない）
#   3) 在庫の数を D1 inventory_snapshots に残す（--send の時だけ・CLOUDFLARE_* がある時だけ）
#   4) 一括送信.mjs を4組に分けて送る（--send の時だけ）
# 既定は dry：選ぶところまでと、Chromiumが起動するかだけを確かめる。会社のページは開かない・送らない・D1に書かない。
# 使い方：箱で送付.sh [--dry|--send] [--limit=80] [--ignore-hours（dryだけ）]
# 秘密は環境変数か LS_BOX_ENV（既定 ~/.config/line-stock/box-send.env、chmod 600）から読む。値はログに出さない。
# 同時1本は呼び出し側（ops/scripts/箱で送付.sh の flock）で守る。二重送付は送る直前の状態の読み直し（送信.mjs）でも防ぐ。
set -uo pipefail
cd "$(dirname "$0")/.."
MODE=dry; LIMIT=80; IGNORE_HOURS=0
for a in "$@"; do case "$a" in
  --dry) MODE=dry;; --send) MODE=send;; --limit=*) LIMIT="${a#--limit=}";; --ignore-hours) IGNORE_HOURS=1;;
  *) echo "知らない引数：$a" >&2; exit 2;; esac; done
[[ "$LIMIT" =~ ^[0-9]+$ ]] || { echo "limit は数字" >&2; exit 2; }
if [ "$LIMIT" -gt 80 ]; then echo "送付量は増やさない：limit は80まで" >&2; exit 2; fi
if [ "$MODE" = send ] && [ "$IGNORE_HOURS" = 1 ]; then echo "--ignore-hours は dry だけ" >&2; exit 2; fi

ENVF="${LS_BOX_ENV:-$HOME/.config/line-stock/box-send.env}"
if [ -f "$ENVF" ]; then set -a; . "$ENVF"; set +a; fi
LOGDIR="${LS_BOX_LOGDIR:-/workspace/line-stock-handoff/ops/logs}"; mkdir -p "$LOGDIR/box-send"
STAMP=$(TZ=Asia/Tokyo date +%Y%m%d-%H%M%S)
SUMLOG="$LOGDIR/box-send.log"
say() { echo "$(TZ=Asia/Tokyo date '+%F %T JST') [$MODE] $*" | tee -a "$SUMLOG"; }
have() { [ -n "${!1:-}" ]; }
missing=(); for k in SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID; do have "$k" || missing+=("$k"); done
[ ${#missing[@]} -gt 0 ] && say "箱に無い秘密（名前だけ）：${missing[*]}"
# 送る時は Supabase が必須（書き戻し待ちの会社を外す・D1が読めない時の代わり）。無ければ送らない
if [ "$MODE" = send ] && ! { have SUPABASE_URL && have SUPABASE_SERVICE_ROLE_KEY; }; then say "SUPABASE_* が無いので送らない"; exit 3; fi

H=$(TZ=Asia/Tokyo date +%-H)
if [ "$IGNORE_HOURS" != 1 ] && { [ "$H" -lt 8 ] || [ "$H" -ge 20 ]; }; then say "送付時間外（日本時間 ${H}時）なので何もしない"; exit 0; fi

# 準備：npm と Chromium（無い時だけ入れる）
if [ ! -d node_modules/playwright ]; then npm ci --no-audit --no-fund >/dev/null 2>&1 || { say "npm ci 失敗"; exit 4; }; fi
if ! node -e "const {chromium}=require('playwright');require('fs').accessSync(chromium.executablePath())" 2>/dev/null; then
  # 箱は apt が通らない時がある（2026-11-17 deb.debian.org が500）。箱にはChromeの部品が入っているので、まずブラウザだけ入れる
  for i in 1 2 3; do npx playwright install chromium >/dev/null 2>&1 && break; npx playwright install --with-deps chromium >/dev/null 2>&1 && break; say "playwrightの準備に失敗（${i}回目）"; sleep 30; done
fi
if ! node -e "import('playwright').then(async({chromium})=>{const b=await chromium.launch({headless:true});const p=await b.newPage();await p.goto('about:blank');await b.close();})" 2>"$LOGDIR/box-send/${STAMP}_browser.err"; then
  say "Chromiumが起動しない（$LOGDIR/box-send/${STAMP}_browser.err）"; exit 4; fi
say "Chromium 起動OK"

# 1) 台帳をそろえる（送る時だけ。D1への書き戻しを含むので dry ではやらない）
if [ "$MODE" = send ] && have CLOUDFLARE_API_TOKEN && have CLOUDFLARE_ACCOUNT_ID; then
  python3 登録/台帳の写し.py > "$LOGDIR/box-send/${STAMP}_ledger.log" 2>&1 || say "台帳をそろえるのに失敗（続ける）"
fi

# 2) 選ぶ
export LIMIT; [ "$IGNORE_HOURS" = 1 ] && export LS_IGNORE_HOURS=1
INV=$(mktemp)
IDS=$(python3 登録/朝の送付対象.py "$LIMIT" "$INV" 2> "$LOGDIR/box-send/${STAMP}_pick.err") || { say "選ぶのに失敗（$LOGDIR/box-send/${STAMP}_pick.err）"; exit 5; }
READY=$(cat "$INV" 2>/dev/null || echo 0); rm -f "$INV"
N=$(printf '%s' "$IDS" | tr ',' '\n' | grep -c . || true)
say "選んだ ${N} 社／在庫 ${READY}（内訳：$(tr '\n' ' ' < "$LOGDIR/box-send/${STAMP}_pick.err" | cut -c1-300)）"
if [ "$MODE" = dry ]; then say "dryなのでここで止める（送らない・D1に書かない）"; exit 0; fi
[ "$N" -gt 0 ] || { say "送る会社なし"; exit 0; }

# 3) 在庫の数を D1 に残す
if have CLOUDFLARE_API_TOKEN && have CLOUDFLARE_ACCOUNT_ID && [[ "$READY" =~ ^[0-9]+$ ]]; then
  (cd 登録 && npx -y wrangler@4.150.0 d1 execute line-stock-sales --remote --command "INSERT INTO inventory_snapshots (at, ready, note) VALUES ('$(date -u +%Y-%m-%dT%H:%M:%S.000Z)', ${READY}, '自動送付の前（箱）')" >/dev/null 2>&1) || say "在庫の数を残すのに失敗（続ける）"
fi

# 4) 送る（4組を並べて。send.yml の matrix と同じ分け方）
export LS_SENDER="${LS_SENDER:-自動送付（箱）}"
pids=()
for p in 1 2 3 4; do
  node 一括送信.mjs --mode=send --ids="$IDS" --part=$p/4 --limit=1000 > "$LOGDIR/box-send/${STAMP}_part$p.log" 2>&1 & pids+=($!)
done
rc=0; for pid in "${pids[@]}"; do wait "$pid" || rc=1; done
for p in 1 2 3 4; do say "組$p：$(grep -m1 '^送付完了' "$LOGDIR/box-send/${STAMP}_part$p.log" || echo 'まとめ無し')"; done
exit $rc
