"""検品結果（採用）から、10/20送信分の企業をD1に入れるSQLを作る。
使い方: python3 100社投入SQL作成.py 採用一覧.json [並び順の開始番号] > 投入20261020.sql
既にある企業は上書きしない（INSERT OR IGNORE）。ステータスは確認中。"""
import json, sys, datetime
data = json.load(open(sys.argv[1]))
now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
q = lambda v: "NULL" if v in (None, "") else "'" + str(v).replace("'", "''") + "'"
REQ = {"必須", "任意", "不明"}
MSG = {"MSG-自動車学校-v8", "MSG-ジム-v8", "MSG-美容クリニック-v8", "MSG-オンラインスクール-v8", "MSG-太陽光住宅-v8", "MSG-LINE導入-v2", "MSG-LINE見直し-v2", "MSG-ジム-v5", "MSG-美容クリニック-v5", "MSG-オンラインスクール-v5", "MSG-住宅リフォーム-v5", "MSG-太陽光-v5",
       "MSG-結婚相談所-v3", "MSG-自由診療歯科-v3", "MSG-不動産-v3"} | {"MSG-エステ-v3", "MSG-ペット-v3", "MSG-ホテル-v3", "MSG-士業-v3", "MSG-学習塾-v3", "MSG-整体-v3", "MSG-美容室-v3", "MSG-飲食-v3"}  # 10/27 追加8業種（承認待ちの仮ID）  # 10/26 勝良さんOKの3業種（流れ.py の V8 と同じ）
START = int(sys.argv[2]) if len(sys.argv) > 2 else 100
out = []
for i, c in enumerate(data):
    assert c["form_url"].startswith("http"), c["id"]
    assert c["message_id"] in MSG, c["id"]
    assert c.get("observation") and not c["observation"].startswith(("貴校","貴社","貴院")), c["id"]
    cols = ["id","name","legal_name","addressee","industry","official_url","form_url","ad_evidence_url","status","message_id","form_note","sort_order","updated_at","offer","line_status","judge_reason","observation","list_source","ad_media","ad_purpose"]
    vals = [c["id"], c["name"], c.get("legal_name"), c["addressee"], c.get("industry") or "自動車学校", c.get("official_url"), c["form_url"], c.get("ad_evidence_url"), "確認中", c["message_id"], c.get("form_note"), START + i, now, c.get("offer"), c.get("line_status"), c.get("judge_reason"), c["observation"], c.get("list_source"), c.get("ad_media"), c.get("ad_purpose")]
    out.append(f"INSERT OR IGNORE INTO companies ({','.join(cols)}) VALUES ({','.join(q(v) if k!='sort_order' else str(v) for k,v in zip(cols,vals))});")
    for j, (label, req, value) in enumerate(c.get("fields", [])):
        assert req in REQ, (c["id"], label, req)
        out.append(f"INSERT OR IGNORE INTO form_fields (company_id,ord,label,required,input_value) VALUES ({q(c['id'])},{j+1},{q(label)},{q(req)},{q(value)});")
    out.append(f"INSERT INTO status_history (company_id,from_status,to_status,note,changed_at,source) SELECT {q(c['id'])},NULL,'確認中','広告経路の候補として登録（公式フォームを点検。GitHubの「全部」で登録）',{q(now)},'登録' WHERE NOT EXISTS (SELECT 1 FROM status_history WHERE company_id={q(c['id'])});")
print("\n".join(out))
