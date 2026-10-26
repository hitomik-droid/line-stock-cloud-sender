import fs from 'node:fs';
import {chromium} from 'playwright';
const [,,input,output]=process.argv;
const rows=JSON.parse(fs.readFileSync(input));const accepted=[],audit=[];
const b=await chromium.launch({headless:true});const p=await b.newPage({locale:'ja-JP'});
const norm=s=>(s||'').replace(/株式会社|有限会社|合同会社|医療法人社団|医療法人|[\\s　]/g,'');
try{
for(const r of rows){
 const domain=new URL(r.landing).hostname.replace(/^www\\./,'');
 const url='https://adstransparency.google.com/?region=JP&domain='+encodeURIComponent(domain);
 await p.goto(url,{waitUntil:'domcontentloaded',timeout:45000});await p.waitForTimeout(3500);
 const text=await p.locator('body').innerText();
 if(/ロボットではありません|unusual traffic|通常と異なるトラフィック|セキュリティチェック|一時的にブロック|利用制限|Too Many Requests|ログインしてください/i.test(text)||/accounts\\.google\\.com|\\/sorry\\//.test(p.url()))throw Error('Googleの確認・制限画面で停止');
 const urls=await p.locator('a[href*="/advertiser/"][href*="/creative/"]').evaluateAll(es=>es.map(e=>e.href));
 const ok=urls.length>0&&norm(text).includes(norm(r.name));
 audit.push({name:r.name,domain,source_url:p.url(),advertisements_rendered:urls.length,name_matched:norm(text).includes(norm(r.name)),ok});
 if(ok)accepted.push({...r,source_url:p.url(),ad_evidence_url:urls[0],ad_media:'Google広告',ad_purpose:''});
 console.log(domain,ok,urls.length);await p.waitForTimeout(1500);
}
}finally{fs.writeFileSync(output,JSON.stringify(accepted,null,2));fs.writeFileSync(output+'.audit.json',JSON.stringify(audit,null,2));await b.close();}
