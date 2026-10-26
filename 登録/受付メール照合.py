# 受付メール（フォームの自動返信）と人からの返信を、D1の会社に対応づけて mail_receipts に残す（2026-10-26）。
# 使い方：python3 受付メール照合.py メール.json [--write] [--reply-out 返信.md]
#   メール.json：定期実行（【毎時30分】LINEストック｜受付メールで届いたかを確かめる）がGmailから読んだ物。
#     [{"msg_id","from","date"(ISO),"subject","body"(先頭3000字), "kind":"受付|返信|関係なし", "reply_type":"興味あり|日程|質問|お断り|その他"}]
#   --write：D1の mail_receipts に書く（無ければ照合の結果を出すだけ）。会社のステータスは変えない。
# 出力（標準出力のJSON）：新しく対応づいた件数、「送れたか不明」に受付メールが来た会社（送付完了に直す候補）、返信の件数と種類、対応づかなかったメール。
import json, os, re, subprocess, sys, datetime
from urllib.parse import urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
ME = 'hitomi.k@lincle-dreams.com'
# 送り手のドメインだけでは会社が決まらない共用のドメイン（フォームの代行・無料メール・レンタルサーバー）
SHARED = re.compile(r'(^|\.)(gmail\.com|yahoo\.co\.jp|icloud\.com|outlook\.(com|jp)|hotmail\.com|powerfulform\.com|form-mailer\.jp|crcn\.jp|formzu\.net|formrun\.com|form\.run|jimdo\.(jp|com)|wix\.com|wixsite\.com|sakura\.ne\.jp|xsrv\.jp|lolipop\.jp|heteml\.jp|secure\.ne\.jp|wpx\.jp|conoha\.jp|onamae\.com|hubspot\.com|tayori\.com|amazonses\.com|sendgrid\.net)$', re.I)
SENT = ('送付完了', '送付失敗', '返信あり', 'アポ獲得', '除外')


def d1(sql, as_json=True):
    cmd = ['npx', '--yes', 'wrangler@4.150.0', 'd1', 'execute', 'line-stock-sales', '--remote', '--config', HERE + '/wrangler.jsonc', '--command', sql]
    if as_json: cmd.append('--json')
    r = subprocess.run(cmd, capture_output=True, text=True, cwd=HERE)
    if r.returncode: raise SystemExit('D1に届かない：' + (r.stderr or r.stdout)[-300:])
    return [x for c in json.loads(r.stdout) for x in c['results']] if as_json else r.stdout


def base(u):
    h = (urlparse(u if '//' in (u or '') else '//' + (u or '')).hostname or '').lower()
    h = h[4:] if h.startswith('www.') else h
    p = h.split('.')
    return '.'.join(p[-3:]) if len(p) >= 3 and p[-2] in ('co', 'or', 'ne', 'ac', 'go', 'ed', 'lg') else '.'.join(p[-2:])


def norm(n):
    n = re.sub(r'(株式会社|有限会社|合同会社|一般社団法人|医療法人社団|医療法人|\(株\)|（株）|\(有\)|（有）|[\s　・\-－]|様)', '', n or '')
    return n.lower()


def main():
    a = sys.argv[1:]
    mails = json.load(open(a[0], encoding='utf-8'))
    write = '--write' in a
    rep_out = a[a.index('--reply-out') + 1] if '--reply-out' in a else None
    cs = d1("SELECT id,name,legal_name,addressee,official_url,form_url,status FROM companies WHERE status IN (" + ','.join("'" + s + "'" for s in SENT) + ")")
    seen = {r['msg_id'] for r in d1('SELECT msg_id FROM mail_receipts')}
    last = {r['company_id']: r['note'] or '' for r in d1("SELECT h.company_id, h.note FROM status_history h JOIN (SELECT company_id, MAX(id) m FROM status_history GROUP BY company_id) x ON h.id=x.m")}
    by_dom = {}
    for c in cs:
        for u in (c['official_url'], c['form_url']):
            b = base(u)
            if b: by_dom.setdefault(b, set()).add(c['id'])
    by_id = {c['id']: c for c in cs}
    names = [(c['id'], norm(x)) for c in cs for x in (c['addressee'], c['name'], c['legal_name']) if x and len(norm(x)) >= 3]

    def match(m):
        body = m.get('body') or ''
        # 1. 本文の宛名（送った本文の1行目「〇〇 ご担当者様」が受付メールに写っている）
        for g in re.findall(r'([^\s　\n]{2,40})[ 　]*ご担当者様', body):
            ids = {i for i, n in names if n == norm(g)}
            if len(ids) == 1: return ids.pop(), '宛名'
        # 2. 送り手のドメイン（共用のドメインは使わない）
        frm = (m.get('from') or '').split('@')[-1].strip('> ').lower()
        b = base(frm)
        if b and not SHARED.search(frm) and len(by_dom.get(b, ())) == 1: return next(iter(by_dom[b])), 'ドメイン'
        # 2b. 件名・本文に書かれたURLのドメイン（Jimdo等の転送で「新しいメッセージ https://…/contact/」と来る返信）
        for u in re.findall(r'https?://[^\s<>"）)]+', (m.get('subject') or '') + ' ' + body):
            b = base(u)
            if b and not SHARED.search(b) and len(by_dom.get(b, ())) == 1: return next(iter(by_dom[b])), 'URL'
        # 3. 件名・本文に会社名
        text = norm((m.get('subject') or '') + ' ' + body[:1500])
        ids = {i for i, n in names if len(n) >= 4 and n in text}
        if len(ids) == 1: return ids.pop(), '社名'
        # 3b. 公式サイトのドメイン名（antiq.jp の「antiq」）が件名・本文にある（代行フォームから来る受付メール）
        ids = {i for b, s in by_dom.items() for i in s if len(b.split('.')[0]) >= 5 and b.split('.')[0] in text}
        if len(ids) == 1: return ids.pop(), 'サイト名'
        return None, None

    now = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.000Z')
    q = lambda v: 'NULL' if v in (None, '') else "'" + str(v).replace("'", "''") + "'"
    out = {'読んだメール': len(mails), '新しく対応づいた': 0, '受付メール': 0, '返信': {}, '送付完了に直す候補': [], '対応づかなかった': [], '既に記録済み': 0}
    sql, replies = [], []
    for m in mails:
        kind = m.get('kind') or ('受付' if ME in (m.get('body') or '') else '関係なし')
        if kind == '関係なし': continue
        if m['msg_id'] in seen: out['既に記録済み'] += 1; continue
        cid, how = match(m)
        if not cid:
            out['対応づかなかった'].append({'from': m.get('from'), 'subject': (m.get('subject') or '')[:60], 'date': m.get('date')})
            continue
        c = by_id[cid]
        out['新しく対応づいた'] += 1
        if kind == '受付':
            out['受付メール'] += 1
            if c['status'] == '送付失敗' and re.search(r'不明|見込み', last.get(cid, '')):
                out['送付完了に直す候補'].append({'id': cid, 'name': c['name'], 'received_at': m.get('date'), 'subject': (m.get('subject') or '')[:60], '今のメモ': last.get(cid, '')[:60]})
        else:
            t = m.get('reply_type') or 'その他'
            out['返信'][t] = out['返信'].get(t, 0) + 1
            replies.append((c, m, t))
        sql.append(f"INSERT OR IGNORE INTO mail_receipts (msg_id,company_id,received_at,from_addr,subject,kind,reply_type,matched_by,checked_at) VALUES ({q(m['msg_id'])},{q(cid)},{q(m.get('date'))},{q(m.get('from'))},{q((m.get('subject') or '')[:200])},{q(kind)},{q(m.get('reply_type') if kind == '返信' else None)},{q(how)},{q(now)});")
    if write and sql:
        import tempfile
        with tempfile.NamedTemporaryFile('w', suffix='.sql', delete=False, encoding='utf-8') as f: f.write('\n'.join(sql))
        r = subprocess.run(['npx', '--yes', 'wrangler@4.150.0', 'd1', 'execute', 'line-stock-sales', '--remote', '--config', HERE + '/wrangler.jsonc', '--file', f.name], capture_output=True, text=True, cwd=HERE)
        os.unlink(f.name)
        if r.returncode: raise SystemExit('D1に書けない：' + (r.stderr or r.stdout)[-300:])
        out['D1に書いた'] = len(sql)
    if rep_out and replies:
        # 人からの返信の中身は、勝良さんに見せる用に別ファイルへ（作業管理には件数と種類だけ）
        with open(rep_out, 'a', encoding='utf-8') as f:
            for c, m, t in replies:
                f.write(f"\n## {m.get('date')}｜{c['name']}（{c['id']}）｜{t}\n\n- 送り手：{m.get('from')}\n- 件名：{m.get('subject')}\n\n```\n{(m.get('body') or '')[:2000]}\n```\n")
        out['返信の中身'] = rep_out
    print(json.dumps(out, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main()
