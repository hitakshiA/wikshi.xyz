// UI-only fixtures intercepted in the test browser. Never imported by the app.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{chromium}=require('playwright');
const browser=await chromium.launch();
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const quote=asset=>({asset,amount:asset==='0.0.0'?'100000000':'50000',payTo:'0.0.123',scheme:'exact',network:'hedera:testnet'});
const operations=[
 {id:id(1),service:'discovery.companies',status:'awaiting_payment',input:{query:'Useful companies'},paymentRequired:{accepts:[quote('0.0.429274'),quote('0.0.0')]},expiresAt:new Date(Date.now()+60000).toISOString()},
 {id:id(2),service:'discovery.companies',status:'completed',result:{companies:Array.from({length:100},(_,i)=>({name:`Company ${i+1}`,location:'Worldwide',website:'https://example.com',context:'A sourced business record',contact:{name:'A contact',role:'Founder'}}))},receipt:{currency:'USDC',decimals:6,prepaidAtomic:'50000',chargedAtomic:'50000',refundDueAtomic:'0',units:1,unit:'request',issuedAt:'2026-09-07T10:00:00Z',paymentTransaction:'0.0.123@1720000000.123456789',topicId:'0.0.456',signature:'fixture-only'}},
 {id:id(3),service:'video.meeting',status:'awaiting_guest',input:{mission:'Discuss the launch with our guest.'},result:{meetingUrl:'https://bey.chat/example',scheduledAt:'2026-09-08T10:00:00Z'}},
 {id:id(4),service:'phone.call',status:'running',input:{phone:'+10000000000',mission:'Ask about availability.'}}
];
try{for(const width of [1280,390]){
 const page=await browser.newPage({viewport:{width,height:960}});const errors=[];page.on('pageerror',e=>errors.push(e.message));let pollCount=0;let turns=0;
 await page.route('**/chat-api/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  let body={};
  if(path.endsWith('/sessions'))body={token:'t'.repeat(43)};
  else if(path.endsWith('/message')){turns++;const events=turns===1?[{type:'text',text:'Here are the prepared requests and results.'},...operations.map(operation=>({type:'operation',operation})),...([4,1].map((count,b)=>({type:'draft_batch',batch:{id:`batch${b}`,drafts:Array.from({length:count},(_,i)=>({id:id(10+b*4+i),to:`guest${b*4+i}@example.com`,subject:'A specific invitation',text:'Hello,\nI would like to hear about your work. May we arrange a short conversation?'}))}}))),{type:'done'}]:[{type:'text',text:'The call is complete. The returned answer is Thursday.'},{type:'done'}];return route.fulfill({contentType:'application/x-ndjson',body:events.map(x=>JSON.stringify(x)).join('\n')+'\n'});}
  else if(path.includes('/operations/')){pollCount++;body={...operations[3],status:pollCount>=2?'completed':'running',result:pollCount>=2?{transcript:[{role:'guest',text:'Thursday works.'}]}:undefined};}
  else if(path.endsWith('/inboxes'))body={inboxes:[]};
  return route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
 });
 await page.goto('http://127.0.0.1:5174');await page.locator('#mission').fill('UI fixture');await page.getByRole('button',{name:'Send message',exact:true}).click();
 await page.getByRole('button',{name:'HBAR',exact:true}).click();assert.equal(await page.getByRole('button',{name:'HBAR',exact:true}).getAttribute('aria-pressed'),'true');
 assert.equal(await page.locator('.draft-batch').count(),2);assert.equal(await page.locator('.draft-letter').count(),5);
 await page.getByRole('button',{name:'Explore all 100'}).click();assert.equal(await page.locator('.research-results tbody tr').count(),20);
 await page.getByRole('button',{name:'Next →',exact:true}).click();assert.match(await page.locator('.table-pager').innerText(),/21–40 of 100/);
 await page.locator('.result-filter input').fill('Company 100');assert.equal(await page.locator('.research-results tbody tr').count(),1);
 await page.locator('.receipt-disclosure > summary').click();assert.equal(await page.getByRole('link',{name:'Payment on HashScan'}).getAttribute('href'),'https://hashscan.io/testnet/transaction/0.0.123-1720000000-123456789');
 assert.equal(await page.getByRole('link',{name:'Topic on HashScan'}).getAttribute('href'),'https://hashscan.io/testnet/topic/0.0.456');
 await page.locator('.op-call').scrollIntoViewIfNeeded();await page.waitForFunction(()=>document.querySelector('.op-call')?.textContent.includes('Thursday works.'),{},{timeout:15000});
 assert(pollCount>=2);await page.waitForFunction(()=>document.querySelector('.messages')?.textContent.includes('The call is complete.'));
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.mouse.move(0,0);await page.locator('.payment-card').scrollIntoViewIfNeeded();await page.waitForTimeout(400);assert.equal(await page.locator('.payment-card').evaluate(x=>x.scrollTop),0);await page.screenshot({path:`/tmp/wikshi-cards-${width}.png`});
 await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('.payment-card').evaluate(x=>getComputedStyle(x).transitionDuration),'0s');
 assert.deepEqual(errors,[]);console.log(`PASS ${width}: inline cards, dual currency, 4+1 drafts, 100-row results, receipt links, call polling and automatic follow-up, reduced motion.`);await page.close();
}}finally{await browser.close()}
