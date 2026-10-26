"""Post aggregate progress only; detect requests without executing comment text."""
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
from zoneinfo import ZoneInfo


def run(args):
    result = subprocess.run(args, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError('連携先の取得・更新に失敗しました。内容は公開しません。')
    return result.stdout


def gh_json(path, *extra):
    return json.loads(run(['gh', 'api', path, *extra]))


def quoted_ids(values):
    if not values or not all(re.fullmatch(r'LS-\d{8}-\d+', value) for value in values):
        raise ValueError('担当範囲の形式が不正です')
    return ','.join("'" + value + "'" for value in values)


def main():
    config = json.loads(Path('.github/codex/issue1.json').read_text())
    repo = os.environ['GITHUB_REPOSITORY']
    number = config['issue_number']
    issue = gh_json(f'repos/{repo}/issues/{number}')
    body_hash = hashlib.sha256((issue.get('body') or '').strip().encode()).hexdigest()
    if body_hash != config['rules_sha256']:
        raise RuntimeError('Issue本文のルールが更新されています。自動投稿を止めて確認してください。')

    pages = gh_json(f'repos/{repo}/issues/{number}/comments?per_page=100', '--paginate', '--slurp')
    comments = [comment for page in pages for comment in page]
    unread = 0
    owner = repo.split('/')[0]
    for comment in comments:
        if comment.get('author_association') not in ('OWNER', 'MEMBER', 'COLLABORATOR'):
            continue
        if not re.match(r'^@Codex\b', (comment.get('body') or '').lstrip(), re.I):
            continue
        reactions = gh_json(f"repos/{repo}/issues/comments/{comment['id']}/reactions?per_page=100")
        acknowledged = any(
            reaction.get('user', {}).get('login') == owner and reaction.get('content') in ('eyes', '+1')
            for reaction in reactions
        )
        unread += not acknowledged

    now = dt.datetime.now(ZoneInfo('Asia/Tokyo'))
    start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    end = start + dt.timedelta(days=1)
    utc = lambda value: value.astimezone(dt.timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')
    owned = quoted_ids(config['owned_ids'])
    pro = quoted_ids(config['pro_ids'])
    today = f"sent_at >= '{utc(start)}' AND sent_at < '{utc(end)}'"
    query = f"""SELECT
      SUM(CASE WHEN status='送付完了' THEN 1 ELSE 0 END) AS total,
      SUM(CASE WHEN status='送付完了' AND id IN ({owned}) AND {today} THEN 1 ELSE 0 END) AS own_today,
      SUM(CASE WHEN status='送付完了' AND id IN ({pro}) AND {today} THEN 1 ELSE 0 END) AS pro_today,
      SUM(CASE WHEN status='確認中' AND id IN ({pro}) THEN 1 ELSE 0 END) AS pending
      FROM companies"""
    raw = run(['npx', '--yes', 'wrangler@4.150.0', 'd1', 'execute', 'line-stock-sales', '--remote',
               '--config=登録/wrangler.jsonc', '--command=' + query, '--json'])
    chunks = json.loads(raw)
    if not chunks or not all(chunk.get('success') for chunk in chunks):
        raise RuntimeError('D1の最新集計を確認できないため投稿しません')
    rows = [row for chunk in chunks for row in chunk['results']]
    if len(rows) != 1:
        raise RuntimeError('D1集計の形式が想定と異なります')
    row = rows[0]
    if not all(type(row.get(key)) is int and row[key] >= 0 for key in ('total', 'own_today', 'pro_today', 'pending')):
        raise RuntimeError('D1集計値を確認できないため投稿しません')

    if unread:
        next_step = f'宛先付き新着{unread}件を確認待ち'
    elif row['total'] >= 700:
        next_step = '目標到達・追加送付を停止'
    elif not 8 <= now.hour < 20:
        next_step = '翌朝8時までリスト整理・改善'
    elif config.get('progress_mode') == 'hold':
        next_step = '入力停止分を保留・追加割当を確認'
    elif row['pending']:
        next_step = '登録済み分を確認して送付'
    else:
        next_step = '担当分の結果を確認'
    fields = [now.strftime('%H:%M'), 'Codex',
              f"今日の送付完了{row['own_today']}（対象Pro分{row['pro_today']}）",
              f"D1累計{row['total']}", f"候補化0・確認中{row['pending']}", next_step]
    line = '｜'.join(fields)
    if len(fields) != 6 or '\n' in line or 'http' in line or '@' in line:
        raise RuntimeError('公開用コメントの検証に失敗しました')
    print(line)
    if os.environ.get('PUBLISH', '').lower() != 'true':
        print('確認のみ・投稿なし')
        return
    with tempfile.NamedTemporaryFile(mode='w+', encoding='utf-8') as file:
        json.dump({'body': line}, file, ensure_ascii=False)
        file.flush()
        gh_json(f'repos/{repo}/issues/{number}/comments', '--method', 'POST', '--input', file.name)
    print('集計コメントを投稿しました')


if __name__ == '__main__':
    main()
