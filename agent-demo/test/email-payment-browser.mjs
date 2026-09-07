// Browser-only fixtures. Every chat request and signature is intercepted.
// This test never sends an email, signs a transaction, or contacts a provider.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)('playwright');

const base=process.env.WIKSHI_BROWSER_TEST_URL||'http://127.0.0.1:5180';
const uuid=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const clone=value=>JSON.parse(JSON.stringify(value));
const browser=await chromium.launch();
try{
  for(const width of [1280,390]){
    const page=await browser.newPage({viewport:{width,height:960}});
    page.setDefaultTimeout(15_000);
    const errors=[],payments=[],preparations=[],messages=[],unexpected=[];
    page.on('pageerror',error=>errors.push(error.message));
    let batch={id:uuid(1),drafts:[
      {id:uuid(2),to:'first@example.test',subject:'First approved note',text:'The first recipient approved for this test.',inboxId:uuid(6),decision:'approved'},
      {id:uuid(3),to:'second@example.test',subject:'Second approved note',text:'The second recipient approved for this test.',inboxId:uuid(6),decision:'approved'},
    ]};
    const makeOperation=(id,draft)=>({id,service:'email.send',status:'awaiting_payment',input:{inboxId:draft.inboxId,to:draft.to,subject:draft.subject,text:draft.text},expiresAt:new Date(Date.now()+600_000).toISOString(),paymentRequired:{accepts:['USDC','HBAR'].map(currency=>({scheme:'exact',network:'hedera:testnet',asset:currency==='HBAR'?'0.0.0':'0.0.429274',amount:currency==='HBAR'?'1000':'1',payTo:'0.0.456',extra:{feePayer:'0.0.789'}}))}});
    const first=makeOperation(uuid(10),batch.drafts[0]),second=makeOperation(uuid(11),batch.drafts[1]);
    let replacement;
    const operations=new Map([[first.id,first],[second.id,second]]);
    const json=(route,body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
    const stream=(route,events)=>route.fulfill({contentType:'application/x-ndjson',body:[...events,{type:'done'}].map(event=>JSON.stringify(event)).join('\n')+'\n'});
    // Keep the regression completely independent of wallets and external services.
    await page.route('**/*',route=>{
      const url=new URL(route.request().url());
      if(url.origin===new URL(base).origin)return route.continue();
      if(route.request().resourceType()==='image')return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'});
      return route.abort();
    });
    await page.route('**/src/wallet.ts*',route=>route.fulfill({contentType:'text/javascript',body:'export async function walletOptions(){return {accounts:[],extensions:[]}}; export async function signPayment(){throw new Error("Unexpected wallet signature in sponsored fixture")};'}));
    await page.route('**/chat-api/**',async route=>{
      const request=route.request(),path=new URL(request.url()).pathname;
      if(path.endsWith('/sessions'))return json(route,{token:'t'.repeat(43)});
      if(path.endsWith('/session')||path.endsWith('/heartbeat'))return json(route,{});
      if(path.endsWith('/sponsorship'))return json(route,{available:true});
      if(path.endsWith('/inboxes'))return json(route,{inboxes:[]});
      if(path.endsWith('/message')){
        messages.push(request.postDataJSON());
        if(messages.length===1)return stream(route,[{type:'text',text:'Here are the two approved emails.'},{type:'draft_batch',batch:clone(batch)}]);
        return stream(route,[{type:'text',text:'The first email is sent. The remaining request needs a fresh quote.'},...Array.from(operations.values()).map(operation=>({type:'operation',operation:clone(operation)}))]);
      }
      if(path===`/chat-api/draft-batches/${batch.id}/prepare`){
        preparations.push(request.postDataJSON());
        if(preparations.length===1){
          batch={...batch,preparationIncomplete:true,preparationError:'One quote is ready. Retry to prepare the remaining approved email.',drafts:batch.drafts.map((draft,index)=>index===0?{...draft,operationId:first.id}:draft)};
          return json(route,{batch,operations:[first],operationUpdates:[],preparationError:batch.preparationError});
        }
        if(preparations.length===2){
          batch={...batch,preparationIncomplete:false,preparationError:undefined,drafts:batch.drafts.map((draft,index)=>({...draft,operationId:index===0?first.id:second.id}))};
          return json(route,{batch,operations:[first,second],operationUpdates:[]});
        }
        assert.equal(preparations.length,3,'Expired groups must be refreshed once through the batch endpoint.');
        second.status='expired';
        replacement=makeOperation(uuid(12),batch.drafts[1]);
        operations.set(replacement.id,replacement);
        batch={...batch,drafts:batch.drafts.map((draft,index)=>({...draft,operationId:index===0?first.id:replacement.id}))};
        return json(route,{batch,operations:[first,replacement],operationUpdates:[second]});
      }
      const payment=/\/operations\/([^/]+)\/(pay|sponsor)$/.exec(path);
      if(payment){
        const [,id,mode]=payment,operation=operations.get(id);
        payments.push({id,mode,body:request.postDataJSON()});
        assert.equal(mode,'sponsor','No wallet transaction should be requested.');
        assert(operation,'Only an approved operation can be paid.');
        assert.notEqual(operation.status,'completed','A completed email must never be paid again.');
        if(id===second.id){
          // The first payment settles. The second expires before settlement.
          // Its next status update remains awaiting_payment so the client must
          // detect the expired timestamp, not rely only on a server status tag.
          operation.expiresAt=new Date(Date.now()-1_000).toISOString();
          return json(route,{error:'The quote expired. Refresh the remaining email quote.'},410);
        }
        operation.status='completed';operation.result={messageId:`fixture-${id}`,sent:true};
        return json(route,operation);
      }
      const read=/\/operations\/([^/]+)$/.exec(path);
      if(read&&operations.has(read[1]))return json(route,operations.get(read[1]));
      unexpected.push(`${request.method()} ${path}`);
      return json(route,{error:'Unexpected fixture request'},500);
    });

    await page.goto(base);
    await page.locator('#mission').fill('send these two notes');
    await page.getByRole('button',{name:'Send message',exact:true}).click();
    await page.getByRole('button',{name:'Continue with 2 approved emails ↗',exact:true}).click();
    const retry=page.getByRole('button',{name:'Retry payment preparation ↗',exact:true});
    await retry.waitFor();
    assert.equal(await page.locator('.payment-wrap').count(),0,'Partial preparation must not expose a payable group.');
    assert.equal(await page.locator('.op-payment').count(),0,'Known partial operations must not appear as standalone payment cards.');
    assert.equal(payments.length,0);
    await retry.click();
    await page.getByRole('button',{name:'Sign 2 payments ↗',exact:true}).waitFor();
    assert.equal(await page.locator('.payment-wrap').count(),1,'A ready email batch needs exactly one payment card.');
    assert.equal(await page.locator('.email-batch-payment').count(),1);
    assert.equal(await page.locator('.op-payment').count(),0);

    await page.getByRole('button',{name:'Sponsor this',exact:true}).click();
    assert.equal(payments.length,0,'Opening sponsorship is not approval.');
    await page.getByRole('button',{name:'Approve sponsored payment',exact:true}).click();
    const refresh=page.getByRole('button',{name:'Refresh quote ↻',exact:true});
    await refresh.waitFor();
    await page.waitForFunction(()=>!document.querySelector('.composer span'));
    assert.deepEqual(payments.map(payment=>payment.id),[first.id,second.id]);
    assert.equal(await page.locator('.email-batch-payment .payment-wrap').count(),1);
    assert.equal(await page.locator('.payment-wrap').count(),1,'An expired remainder stays in its existing group.');
    assert.equal(await page.locator(`[data-operation="${first.id}"] .state-label`).textContent(),'completed');
    await page.locator('.sponsor-dialog[open] [role="alert"]').filter({hasText:'The quote expired.'}).waitFor();
    await page.getByRole('button',{name:'Back',exact:true}).click();
    await refresh.click();
    await page.getByRole('button',{name:'Sign 1 payment ↗',exact:true}).waitFor();
    assert.equal(preparations.length,3,'Refresh must use the group preparation handler.');
    assert.equal(messages.length,2,'Refreshing a batch must not ask the model to create a separate quote.');
    assert.equal(await page.locator('.payment-wrap').count(),1);
    assert.equal(await page.locator('.expired-request').count(),0,'A superseded batch quote must not reappear as a separate refresh action.');
    assert.equal(await page.locator('.payment-brief-summary').textContent(),'second@example.test','A completed email must be excluded from the remaining approval.');
    await page.screenshot({path:`/tmp/wikshi-email-recovery-${width}.png`,fullPage:true});

    await page.getByRole('button',{name:'Sponsor this',exact:true}).click();
    await page.getByRole('button',{name:'Approve sponsored payment',exact:true}).click();
    await page.waitForFunction(()=>document.querySelectorAll('.state-label').length===2&&[...document.querySelectorAll('.state-label')].every(label=>label.textContent==='completed'));
    await page.waitForFunction(()=>document.querySelectorAll('.payment-wrap').length===0);
    assert.deepEqual(payments.map(payment=>payment.id),[first.id,second.id,replacement.id]);
    assert(payments.every(payment=>payment.body.approved===true&&payment.body.currency==='USDC'));
    assert.equal(payments.filter(payment=>payment.id===first.id).length,1,'The previously sent email is paid exactly once.');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    assert.deepEqual(unexpected,[]);assert.deepEqual(errors,[]);
    console.log(`PASS ${width}px email recovery: partial preparation hidden, one grouped card, exact refresh handler, no completed payment repeated`);
    await page.close();
  }
}finally{await browser.close();}
