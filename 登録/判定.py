# 検品結果（results.jsonl）から採用・除外を決める
import json,re,os,sys
# 10/24 クラウド用に写した版（元：Macの 作業/営業リスト20261022_動画広告Pro/judge.py）。検品結果と候補は環境変数 WORK のフォルダから読む
S=os.environ.get('WORK') or os.path.dirname(os.path.abspath(__file__))
res={}
for l in open(S+'/results.jsonl'):
  if l.strip(): r=json.loads(l); res[r['key']]=r
cands={c['key']:c for c in json.load(open(S+'/cands.json'))}
REF=re.compile(r'(営業|セールス|勧誘|売り込み|販売促進|業者)[^。\n]{0,30}(お断り|ご遠慮|禁止|控え|受け付けて|受付して|お受け(して|でき)|対応(いた)?しかね|お答え(でき|いた)|返信(は)?(いた)?しかね|ご返信(でき|いたしません)|回答(でき|いたしません|は致しかね)|お返事)|(お断り|ご遠慮)[^。\n]{0,15}(営業|セールス|勧誘)')
BADCAP=('v2（チェック）','v2（見えない形式）','hCaptcha','Turnstile','画像の文字','計算問題','v2スクリプト')
WRONG=re.compile(r'工事前|工事中|施工|工事|無料診断|資料請求|見積|予約|申込|申し込み|体験|入会|入校|来店|来場|採用|応募|求人|購入|注文|キャンセル|在校生|教習生|会員の方')
BUSINESS=re.compile(r'(?:業務提携|ビジネス|お取引|事業提案|営業提案|営業窓口)(?:の)?(?:申込(?:み)?|申し込み|お問い合わせ|ご相談|相談)?')
def business_choice(value):
  return bool(BUSINESS.fullmatch(re.sub(r'\s+', '', value or '')))
def wrong_choice(value):
  return bool(WRONG.search(value or '')) and not business_choice(value)
NEUTRAL=re.compile(r'その他|お問い?合わ?せ|ご?質問|一般|メール|Eメール|E-mail|指定なし|特になし|どちらでも|ご意見|お知らせ|同意|承諾|プライバシー|個人情報|規約|法人|企業')
PERSONAL=re.compile(r'男|女|性別|歳|代$|店|校|院|希望|予算|時期|年齢|生年|都道府県|県|市|区|車種|免許|コース|プラン')
def clean(lbl,name):
  t=re.sub(r'〔[^〕]*〕','',lbl or '')
  t=re.sub(r'必須|任意|※|\*|＊|［|］|\[|\]|【|】','',t).strip()
  t=re.split(r'\s{1,}(?=\S{0,3}例)|例[：:]',t)[0].strip()
  if not t:
    m=re.search(r'〔([^〕]*)〕',lbl or ''); t=m.group(1) if m else (name or '')
  return t[:30].strip()
def judge(r):
  why=[]
  if r.get('error'): return ['フォームを開けない（'+r['error'][:60]+'）'],None
  ex=r.get('ex') or {}; fields=ex.get('fields') or []
  if not fields: return ['フォームが無い（入力欄が見つからない）'],None
  if not any(f['kind']=='textarea' for f in fields): return ['本文を書く欄が無い'],None
  eig=[s for s in (ex.get('eigyo') or [])+(r.get('refuse') or []) if REF.search(s)]
  if eig: why.append('営業お断りの表記：「'+eig[0].strip()[:60]+'」')
  caps=ex.get('captcha') or []
  bad=[c for c in caps if any(b in c for b in BADCAP)]+(r.get('capVisible') or [])+(r.get('capAfter') or [])
  if 'reCAPTCHA v3' in caps: bad=[c for c in bad if c!='reCAPTCHA v2スクリプト']
  if bad: why.append('人の操作が要る認証（'+'・'.join(sorted(set(bad)))+'）')
  # 10/22 送付で reCAPTCHA・CF7のspam判定に止められたため、v3を含む認証の読み込みがあるフォームは全部外す（突破はしない）
  if caps and not bad: why.append('認証の読み込みあり（'+'・'.join(sorted(set(caps)))+'）')
  bl=r.get('bodyLen',1000)
  for f in fields:
    if f['kind']=='textarea' and f.get('maxlength') and f['maxlength']<bl: why.append(f'本文欄の上限が{f["maxlength"]}字')
  for s in ex.get('limits') or []:
    for n in re.findall(r'(\d{2,5})\s*(?:文字|字)',s):
      if 100<=int(n)<bl and re.search(r'内容|本文|問い?合わ?せ|ご質問|ご相談|メッセージ|備考|詳細|ご要望',s): why.append(f'本文の文字数上限（「{s.strip()[:40]}」）')
  if not r.get('bodyOk'): why.append('本文が一字一句入らない')
  p=r.get('plan') or {}
  if p.get('unknown'): why.append('自動で埋められない必須欄：'+' / '.join(p['unknown'])[:80])
  if r.get('invalid'): why.append('入力後も必須が埋まらない：'+' / '.join(r['invalid'])[:80])
  # 10/22 必須欄が空のまま確認画面に進めなかったため、入力後に空の必須欄が1つでも残るフォームは外す
  emp=[clean(f.get('label'),f.get('name'))[:12] for f in r.get('after') or [] if f.get('required') and not f.get('disabled') and (
    (f['kind'] in ('radiogroup','checkboxgroup') and not f.get('checked')) or (f['kind']=='select' and not f.get('selected')) or
    (f['kind']=='checkbox' and not f.get('checked')) or (f['kind'] not in ('radiogroup','checkboxgroup','select','checkbox','radio','file') and not (f.get('value') or '').strip()))]
  if emp: why.append('入力後も空の必須欄：'+' / '.join(emp)[:80])
  # 10/22 必須の印が無くても送信時に「必須項目です／未入力です」で止まったため、「任意」と書かれていない空欄が残るフォームも外す
  emp2=[clean(f.get('label'),f.get('name'))[:12] for f in r.get('after') or [] if not f.get('required') and not f.get('disabled') and '任意' not in (f.get('label') or '') and (
    (f['kind'] in ('radiogroup',) and not f.get('checked')) or (f['kind']=='select' and not f.get('selected')) or
    (f['kind'] not in ('radiogroup','checkboxgroup','select','checkbox','radio','file','hidden','submit','button') and not (f.get('value') or '').strip()))]
  # 10/23 17:20 勝良さん決定「1（緩める）」：必須の印が無い空欄だけが残るフォームも送る（送信時に「必須です」で止まれば送付失敗になる）
  # if emp2: why.append('空欄が残る（必須の印なし）：'+' / '.join(emp2)[:80])
  # 10/22夜 勝良さんの決定：送信者の住所・郵便番号は入れない。住所・郵便番号が必須のフォームは外す
  adr=[clean(f.get('label'),f.get('name'))[:12] for f in r.get('after') or [] if f.get('required') and re.search(r'住所|郵便|〒|番地|zip|postal|address|pref|都道府県',(f.get('label') or '')+' '+(f.get('name') or ''),re.I) and not re.search(r'メール|mail',(f.get('label') or '')+' '+(f.get('name') or ''),re.I)]
  if adr: why.append('住所・郵便番号が必須：'+' / '.join(adr)[:60])
  if any(f['kind'] in ('checkbox','checkboxgroup') and re.search(r'営業|セールス|勧誘',f.get('label') or '') for f in r.get('after') or []): why.append('「営業目的ではない」等の確認欄がある')
  if any('初期値' in n for n in p.get('notes') or []): why.append('選択欄に初期値：'+' / '.join(p['notes'])[:80])
  for f in r.get('after') or []:
    if f['kind'] in ('radiogroup','checkboxgroup') and f.get('checked'):
      for c in f['checked']:
        if (not NEUTRAL.search(c) and not business_choice(c)) or wrong_choice(c): why.append(f'選択欄に事実と違う値が入る「{c}」（{clean(f["label"],"")[:20]}）')
    if f['kind']=='file' and f.get('required'): why.append('添付ファイルが必須')
    if f['kind']=='select' and f.get('selected') and wrong_choice(f['selected']): why.append(f'選択欄に事実と違う値が入る「{f["selected"]}」')
    if f['kind'] not in ('select','textarea','checkbox','radio','radiogroup','checkboxgroup') and (f.get('value') or '') and re.search(r'〒|郵便|FAX|ファックス|ファクス|住所|番地|生年|年齢|会員番号|教習生番号',clean(f.get('label'),'')+' '+(f.get('name') or '')) and not re.search(r'メール|mail',clean(f.get('label'),'')): why.append(f'住所・郵便番号などの欄に値が入ってしまう（{clean(f.get("label"),"")[:15]}＝{f["value"][:15]}）')
  af=r.get('after') or []
  vals=[(clean(f.get('label'),''),f.get('value') or '') for f in af if f['kind'] not in ('select','textarea','checkbox','radiogroup','checkboxgroup')]
  for (l1,v1),(l2,v2) in zip(vals,vals[1:]):
    if v1 and v1==v2 and v1 in ('勝良仁海','カツラ ヒトミ','かつら ひとみ') : why.append(f'姓と名に分かれた欄に氏名がそのまま入る（{l1[:10]}）')
  for l,v in vals:
    if not v: continue
    if re.search(r'ふりがな|ひらがな|せい|めい|かな',l) and not re.search(r'カナ|カタカナ|フリガナ',l) and not re.fullmatch(r'[ぁ-ん　 ]+',v): why.append(f'ひらがなの欄に「{v}」が入る（{l[:12]}）')
    if re.search(r'フリガナ|カナ|カタカナ|セイ|メイ',l) and not re.search(r'ひらがな|ふりがな',l) and not re.fullmatch(r'[ァ-ヶー　 ]+',v): why.append(f'カタカナの欄に「{v}」が入る（{l[:12]}）')
  for f in af:
    if f['kind']=='textarea':
      for n in re.findall(r'(\d{2,5})\s*(?:文字|字)',f.get('label') or ''):
        if int(n)<r.get('bodyLen',1000): why.append(f'本文欄に{n}字までの表記')
  if not p.get('buttons'): why.append('送信・確認ボタンが見つからない')
  if why: return why,None
  fl=build(r)
  w2=[]
  for l,q,v in fl:
    if q=='必須' and v.startswith('空欄'): w2.append(f'必須の欄が埋まらない（{l[:20]}）')
    if re.search(r'確認しました|確認いただき|送信確認|内容を確認',l) and v.startswith('空欄'): w2.append(f'確認のチェック欄が埋まらない（{l[:20]}）')
    if re.search(r'所在地|住所|番地',l) and v not in ('空欄','空欄（選ばない）') and not re.search(r'メール',l): w2.append(f'住所の欄に値が入ってしまう（{l[:15]}＝{v[:10]}）')
    if re.fullmatch(r'0\d{1,4}',v) and v not in ('070',): w2.append(f'電話番号の分割欄に誤った値が入る（{v}）')
    if re.fullmatch(r'名[：:]?|お名前（名）|名（名）',l) and v=='勝良仁海': w2.append('名の欄に氏名がそのまま入る')
  vs=[v for _,_,v in fl]
  if 'hitomi.k@lincle-dreams.com' not in vs: w2.append('メールアドレスの欄に値が入らない')
  if any(re.search(r'名前|氏名|なまえ',l) for l,_,_ in fl) and not any(v in ('勝良仁海','勝良') for v in vs): w2.append('氏名の欄に氏名が入らない')
  for l,q,v in fl:
    if re.search(r'名前|氏名',l) and v in ('ADNEXT','07089803196'): w2.append(f'氏名の欄に「{v}」が入る')
  if ('8980' in vs or '3196' in vs) and not ('070' in vs and '8980' in vs and '3196' in vs): w2.append('電話番号の分割欄が一部しか埋まらない')
  if vs.count('07089803196')>2: w2.append('電話番号が3つ以上の欄に入る（隠れた欄の可能性）')
  for l,q,v in fl:
    if re.search(r'半角英|ローマ字|英字|TARO|Taro',l) and re.search(r'[一-龥ぁ-んァ-ヶ]',v): w2.append(f'英字の欄に「{v}」が入る（{l[:12]}）')
  if not any(v=='下の文面を貼る' for _,_,v in fl): w2.append('本文を貼る欄が特定できない')
  if w2: return w2,None
  return [],fl
def build(r):
  after=r.get('after') or r['ex']['fields']
  anyreq=any(f.get('required') or re.search(r'必須|※|\*',f.get('label') or '') for f in after)
  out=[]
  for f in after:
    lbl=clean(f.get('label'),f.get('name'))
    if f['kind'] in ('radiogroup','checkboxgroup'):
      raw=re.sub(r'〔[^〕]*〕','',f.get('label') or '')
      for o in f.get('options') or []:
        if o: raw=raw.replace(o,' ')
      lbl=re.sub(r'必須|任意|※|\*|＊|【|】|\s+',' ',raw).strip()[:30] or (f.get('name') or '選択欄')
    req='必須' if (f.get('required') or re.search(r'必須|※|\*|＊',f.get('label') or '')) else ('任意' if anyreq else '不明')
    if not lbl or re.fullmatch(r'[A-Za-z0-9_\-\[\]]+',lbl):
      v0=f.get('value') or ''
      lbl={'勝良仁海':'お名前','ADNEXT':'会社名','カツラ ヒトミ':'フリガナ','かつら ひとみ':'ふりがな','hitomi.k@lincle-dreams.com':'メールアドレス','07089803196':'電話番号'}.get(v0) or ('お問い合わせ内容' if f['kind']=='textarea' else lbl or f.get('name'))
      lbl+='（欄の見出しなし）'
    k=f['kind']
    if k=='textarea':
      v='下の文面を貼る' if (f.get('value') or '').startswith('〈本文') else '空欄'
    elif k=='select':
      s=f.get('selected') or ''
      v=('「'+s+'」を選ぶ') if s and not re.search(r'選択|--|―|未選択|^$',s) else '空欄（選ばない）'
    elif k=='checkbox':
      v=('同意のチェック' if re.search('同意|プライバシー|個人情報|規約|承諾',lbl+(f.get('optText') or '')) else 'チェックする') if f.get('checked') else '空欄'
    elif k in ('radiogroup','checkboxgroup'):
      v=('「'+f['checked'][0]+'」を選ぶ') if f.get('checked') else '空欄'
      if k=='checkboxgroup' and f.get('checked'): pass
    elif k=='radio':
      v='選ぶ' if f.get('checked') else '空欄'
    elif k=='file': v='空欄'
    else:
      v=f.get('value') or '空欄'
    out.append([lbl or f.get('name') or k,req,v])
  return out
if __name__=='__main__':
  ok=[];ng=[]
  for k,r in res.items():
    why,fields=judge(r)
    (ng if why else ok).append((k,why,fields))
  print('採用候補',len(ok),'除外',len(ng))
  from collections import Counter
  print(Counter(cands[k]['industry'] for k,_,_ in ok))
  c=Counter()
  for k,w,_ in ng: c[re.sub(r'（.*|：.*|「.*','',w[0])]+=1
  print(c.most_common())
from urllib.parse import urlparse
def dom(u):
  h=(urlparse(u).hostname or '').lower()
  return h[4:] if h.startswith('www.') else h
