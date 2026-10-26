import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {planForm} from './入力の判定.js';
test('営業の用件に合う選択肢だけを選び、選べない必須欄は停止する', async () => {
  const b=await chromium.launch({headless:true});
  const page=await b.newPage();
  const cases=[
    {options:['工事前のご質問','業務提携の申込み'],want:'業務提携'},
    {options:['工事前のご質問','工事中のご質問'],stop:true},
    {options:['工事前のご質問','その他'],want:'その他'},
    {options:['質問・お問い合わせ','資料請求'],want:'質問・お問い合わせ'},
    {options:['工事前のご質問','業務提携の申込み'],hint:'工事前のご質問',want:'業務提携'},
    {options:['営業お断り','工事前のご質問'],stop:true},
    {options:['電話','メール'],want:'メール'},
    {options:['業務提携の申込み','その他'],hint:'その他',want:'その他'},
  ];
  try {for(const c of cases){
    await page.setContent('<form><textarea name="body"></textarea><fieldset><legend>必須 お問い合わせ内容</legend>'+c.options.map((s,i)=>`<label><input type="checkbox" name="kind" value="${s}">${s}</label>`).join('')+'</fieldset><button type="submit">送信</button></form>');
    const r=await page.evaluate(planForm,{body:'営業本文',fields:c.hint?[{input_value:'「'+c.hint+'」を選ぶ'}]:[]});
    const choices=r.plan.filter(x=>x.act==='check'&&x.what.startsWith('選択 '));
    if(c.stop){assert.equal(choices.length,0);assert.ok(r.unknown.length>0);}else{assert.equal(choices.length,1);assert.ok(choices[0].what.includes(c.want),choices[0].what);}
  }}finally{await b.close();}
});
