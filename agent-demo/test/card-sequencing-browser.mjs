// Browser-only fixtures. No model, funding, email, or provider requests.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)('playwright');
const browser=await chromium.launch();
const base=process.env.WIKSHI_BROWSER_TEST_URL||'http://127.0.0.1:5180';
const batch={id:'batch-1',drafts:Array.from({length:4},(_,i)=>({id:'draft-'+i,to:'test@example.test',subject:'Company '+i,text:('Useful company information. ').repeat(50),decision:'pending'}))};
for(const width of [1920,390]){
  for(const kind of ['payment','inbox','drafts']){
    const page=await browser.newPage({viewport:{width,height:1000}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    let current=structuredClone(batch),turn=0;
    await page.addInitScript(()=>{
      const original=fetch;
      window.fetch=async(...args)=>{
        const response=await original(...args);
        if(!String(args[0]).endsWith('/message'))return response;
        const lines=(await response.text()).trim().split('\n');
        window.__streamEnded=false;
        return new Response(new ReadableStream({async start(controller){
          const encoder=new TextEncoder();
          for(const line of lines){
            if(JSON.parse(line).type==='text')await new Promise(r=>setTimeout(r,700));
            if(JSON.parse(line).type==='done'){
              window.__beforeDone=true;
              await new Promise(r=>{window.__finish=r;});
              window.__streamEnded=true;
            }
            controller.enqueue(encoder.encode(line+'\n'));
          }
          controller.close();
        }}),{status:200,headers:response.headers});
      };
    });
    await page.route('**/chat-api/**',async route=>{
      const path=new URL(route.request().url()).pathname;
      const json=value=>route.fulfill({contentType:'application/json',body:JSON.stringify(value)});
      if(path.endsWith('/sessions'))return json({token:'t'.repeat(43)});
      if(path.endsWith('/inboxes'))return json({inboxes:[]});
      if(path.endsWith('/sponsorship'))return json({available:true});
      if(path.endsWith('/decision')){
        const input=route.request().postDataJSON();Object.assign(current.drafts[0],{decision:input.decision,feedback:input.feedback});
        return json(current);
      }
      if(path.endsWith('/message')){
        turn++;
        let events=[];
        if(turn===2){
          assert.equal(route.request().postDataJSON().revisionId,'draft-0');
          current.drafts[0]={...current.drafts[0],subject:'Revised company',text:'A much shorter email.',decision:'pending'};
          events=[{type:'draft_batch',batch:current},{type:'text',text:'This explanation should never appear below the cards.'}];
        }else{
          if(kind==='drafts')events.push({type:'draft_batch',batch:current});
          else events.push({type:'operation',operation:{id:'op-1',service:kind==='inbox'?'email.inbox':'discovery.search',status:kind==='inbox'?'completed':'awaiting_payment',input:{query:'Companies'},result:kind==='inbox'?{address:'hello@example.test',inboxId:'inbox-1'}:undefined,paymentRequired:{accepts:[{asset:'0.0.429274',amount:'1',payTo:'0.0.123',network:'hedera:testnet'}]}}});
          events.push({type:'tool',id:'tool-1',name:'read_inbox',status:'finished'});
          events.push({type:'text',text:'Here is the response for your request.'});
        }
        events.push({type:'done'});
        return route.fulfill({contentType:'application/x-ndjson',body:events.map(JSON.stringify).join('\n')+'\n'});
      }
      return json({ok:true});
    });
    await page.goto(base);
    await page.locator('#mission').fill('Help with this request');
    await page.getByRole('button',{name:'Send message'}).click();
    await page.waitForFunction(()=>window.__beforeDone);
    assert.equal(await page.locator('.payment-surface,.email-mini,.draft-batch').count(),0,'no actionable cards before the stream ends');
    assert.equal(await page.locator('.tool-activity').count(),1,'working indicator persists after tools finish');
    await page.evaluate(()=>window.__finish());
    const selector=kind==='payment'?'.payment-surface':kind==='inbox'?'.email-mini':'.draft-batch';
    await page.locator(selector).waitFor();
    if(kind==='payment')assert.equal(await page.getByRole('button',{name:'Sponsor this',exact:true}).isEnabled(),true);
    if(kind==='inbox'){
      assert.match(await page.locator(selector).innerText(),/Your agent’s inbox is ready/);
      assert.doesNotMatch(await page.locator(selector).innerText(),/To your contact|Email request|Read the message/);
    }
    if(kind==='drafts'){
      assert.equal(await page.locator('.draft-content[open]').count(),0);
      const first=page.locator('.draft-letter').first();
      assert((await first.boundingBox()).height<360,'collapsed drafts are compact');
      await first.locator('.draft-content>summary').click();
      assert.equal(await first.locator('.letter-body').isVisible(),true);
      await first.getByRole('button',{name:'Ask for changes'}).click();
      await first.locator('textarea').fill('Make it shorter');
      await page.evaluate(()=>{window.__beforeDone=false;});
      await first.getByRole('button',{name:'Request rewrite'}).click();
      await first.locator('.draft-revision-loader').waitFor();
      assert.equal(await page.locator('#mission').isDisabled(),true);
      await page.waitForFunction(()=>window.__beforeDone);
      assert.match(await first.innerText(),/Company 0/,'revised content waits for completion');
      assert.equal(await page.locator('.message-assistant').count(),1);
      await page.evaluate(()=>window.__finish());
      await first.getByText('Revised company',{exact:true}).waitFor();
      assert.equal(await page.locator('#mission').isDisabled(),false);
      assert.equal(await page.getByText('This explanation should never appear below the cards.',{exact:true}).count(),0);
      assert.equal(await page.locator('.message-user').count(),1);
      await first.getByRole('button',{name:'Approve',exact:false}).isEnabled().then(v=>assert(v));
    }
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    assert.deepEqual(errors,[]);
    await page.screenshot({path:'/tmp/wikshi-cards-'+kind+'-'+width+'.png'});
    console.log('PASS',width,kind,'stream-gated reveal, working feedback and correct card behavior');
    await page.close();
  }
}
await browser.close();
