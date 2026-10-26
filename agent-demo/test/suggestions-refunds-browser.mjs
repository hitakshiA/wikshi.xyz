// Isolated browser fixtures: no provider calls, emails, payments, or live accounts.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)('playwright');
const base=process.env.WIKSHI_BROWSER_TEST_URL||'http://127.0.0.1:5182';
const browser=await chromium.launch();
try{for(const width of [1920,390]){
  const page=await browser.newPage({viewport:{width,height:1080},reducedMotion:'reduce'});
  const op={id:'meeting-refund',service:'video.meeting',status:'completed',input:{mission:'Discuss the project'},receipt:{currency:'HBAR',decimals:8,prepaidAtomic:'300000',chargedAtomic:'54000',refundDueAtomic:'246000'},refund:{currency:'HBAR',decimals:8,amountAtomic:'246000',status:'confirming'}};
  let reads=0;const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(operation=>{
    const original=window.fetch;window.fixturePrompts=[];
    window.fetch=async(input,options)=>{
      if(String(input)!=='/chat-api/message')return original(input,options);
      window.fixturePrompts.push(JSON.parse(options.body));
      const first=window.fixturePrompts.length===1,encode=e=>new TextEncoder().encode(JSON.stringify(e)+'\n');
      return new Response(new ReadableStream({start(controller){
        controller.enqueue(encode({type:'text',text:first?'The meeting is complete.':'I can check the inbox.'}));
        if(first){controller.enqueue(encode({type:'operation',operation}));controller.enqueue(encode({type:'suggestions',suggestions:[{label:'Check for replies',prompt:'Check whether Alex replied to the invitation.'}]}));}
        setTimeout(()=>{controller.enqueue(encode({type:'done'}));controller.close();},1500);
      }}),{headers:{'Content-Type':'application/x-ndjson'}});
    };
  },op);
  await page.route('**/chat-api/**',route=>{
    const path=new URL(route.request().url()).pathname;
    const result=path.endsWith('/sessions')?{token:'t'.repeat(43)}:path.endsWith('/inboxes')?{inboxes:[]}:path.includes('/operations/')?(reads++,{...op,refund:{...op.refund,status:'confirmed',transaction:'0.0.10397138@1788861457.229295857'}}):{ok:true};
    return route.fulfill({contentType:'application/json',body:JSON.stringify(result)});
  });
  await page.goto(base);
  await page.locator('#mission').fill('How did the meeting go?');
  await page.getByRole('button',{name:'Send message',exact:true}).click();
  await page.getByText('The meeting is complete.',{exact:true}).waitFor();
  assert.equal(await page.getByRole('navigation',{name:'Suggested next steps'}).count(),0,'No buttons before stream completion');
  const button=page.getByRole('button',{name:'Check for replies'});
  await button.waitFor();
  await page.screenshot({path:`/tmp/wikshi-suggestions-${width}.png`});
  await button.click();
  await page.getByText('Check whether Alex replied to the invitation.',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.fixturePrompts.length),2);
  assert.equal(await page.evaluate(()=>window.fixturePrompts[1].completionIds),undefined,'Suggestion is a normal user prompt');
  if(width<800)await page.getByRole('button',{name:'Your workspace'}).click();
  const record=page.locator('.workspace-activity-record');
  await record.locator('summary').first().getByText('Refund pending · 0.00246 HBAR',{exact:true}).waitFor();
  await record.locator('summary').first().getByText('Refund confirmed · 0.00246 HBAR',{exact:true}).waitFor({timeout:20000});
  assert.equal(reads,1);
  await record.locator('summary').first().click();
  assert.match(await record.getByRole('link',{name:'Refund on HashScan'}).getAttribute('href'),/1788861457/);
  assert.equal(await page.evaluate(()=>window.fixturePrompts.length),2,'Refund polling sends no chat prompt');
  assert.deepEqual(errors,[]);
  await page.screenshot({path:`/tmp/wikshi-suggestions-refunds-${width}.png`});
  console.log(`${width}px: stream-gated suggestion, normal prompt click, automatic refund confirmation and explorer link passed`);
  await page.close();
}}finally{await browser.close();}
