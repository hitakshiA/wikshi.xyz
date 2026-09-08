// All chat API calls are intercepted, including sponsor/cancel. These are UI
// fixtures only: no actual model, payment, provider, or inbox calls are made.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)('playwright');
const base=process.env.WIKSHI_BROWSER_TEST_URL||'http://127.0.0.1:5180';
const operationId='00000000-0000-0000-0000-000000000901';
const prompt='find a few interesting receptionist startups and see who is behind them';
const draft='then help me decide who is worth contacting';
const summary='I found three useful results and kept their source details together.';
const browser=await chromium.launch();

async function fixture(width,scenario,{clock=false,backendDeadline=true}={}){
  const page=await browser.newPage({viewport:{width,height:1000},reducedMotion:'reduce'});
  // Deliver the real response events in separate chunks, keeping the final
  // done event back long enough to detect an early raw-data attachment.
  await page.addInitScript(()=>{
    const original=window.fetch;
    window.fetch=async(...args)=>{
      const response=await original(...args);
      if(!String(args[0]).endsWith('/chat-api/message'))return response;
      const text=await response.text();
      if(!text.includes('I found three useful results'))return new Response(text,{headers:response.headers,status:response.status});
      const encoder=new TextEncoder();
      return new Response(new ReadableStream({async start(controller){
        const events=text.trim().split('\n');
        for(const event of events){
          if(JSON.parse(event).type==='done'){
            await new Promise(resolve=>setTimeout(resolve,800));
            window.__earlyResearchAttachment=!!document.querySelector('.research-attachment');
          }
          controller.enqueue(encoder.encode(event+'\n'));
        }
        controller.close();
      }}),{headers:response.headers,status:response.status});
    };
  });
  const epoch=Date.now();
  if(clock)await page.clock.install({time:new Date(epoch)});
  const state={turns:0,reads:0,sponsors:0,cancels:[],requests:[],errors:[],violations:[],completed:false,cancelled:false,deadline:null,fundedAt:null,heldStarted:null,releaseHeld:null};
  let signalHeld;const heldReady=new Promise(resolve=>{signalHeld=resolve;});
  const quote={id:operationId,service:width===390?'contacts.enrich':'discovery.companies',status:'awaiting_payment',input:width===390?{email:'founder@example.test'}:{query:'Receptionist startups worldwide'},expiresAt:new Date(epoch+600_000).toISOString(),paymentRequired:{accepts:[{scheme:'exact',network:'hedera:testnet',asset:'0.0.429274',amount:'1',payTo:'0.0.123'},{scheme:'exact',network:'hedera:testnet',asset:'0.0.0',amount:'1000',payTo:'0.0.123'}]}};
  const payment={confirmed:true,asset:'0.0.429274',currency:'USDC',amountAtomic:'1'};
  const running=()=>({...quote,status:'running',payment,...(backendDeadline&&state.deadline?{researchDeadlineAt:new Date(state.deadline).toISOString(),researchStartedAt:new Date(state.fundedAt).toISOString()}: {})});
  const completed=()=>({...running(),status:'completed',result:{results:Array.from({length:3},(_,i)=>({name:`Research result ${i+1}`,email:`founder${i+1}@example.test`,url:`https://example.test/${i+1}`}))},receipt:{currency:'USDC',decimals:6,prepaidAtomic:'1',chargedAtomic:'1',refundDueAtomic:'0',units:1,unit:'request',issuedAt:'2026-09-08T10:00:00Z',paymentTransaction:'0.0.123@1720000001.123456789',topicId:'0.0.456',signature:'fixture-only'}});
  const cancelled=reason=>({...running(),status:'cancelled',cancellation:{reason,requestedAt:new Date(state.deadline||epoch).toISOString()},refund:{status:'pending',currency:'USDC',decimals:6,amountAtomic:'1'}});
  page.on('pageerror',error=>state.errors.push(error.message));
  await page.route('**/chat-api/**',async route=>{
    const request=route.request(),path=new URL(request.url()).pathname;
    state.requests.push({path,method:request.method()});
    const json=(value,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(value)});
    if(path==='/chat-api/sessions')return json({token:'t'.repeat(43)});
    if(path==='/chat-api/sponsorship')return json({available:true});
    if(path==='/chat-api/inboxes')return json({inboxes:[]});
    if(path===`/chat-api/operations/${operationId}/sponsor`){
      state.sponsors++;if(request.postDataJSON().approved!==true)state.violations.push('Payment without approval');
      state.fundedAt=await page.evaluate(()=>Date.now());state.deadline=state.fundedAt+120_000;
      return json({...running(),status:'queued'});
    }
    if(path===`/chat-api/operations/${operationId}/cancel`){
      const body=request.postDataJSON()||{};
      state.cancels.push({body,at:await page.evaluate(()=>Date.now())});
      if(scenario==='completion-wins'){
        state.completed=true;return json(completed());
      }
      if(scenario==='cancel-retry'&&state.cancels.length===1)return json({error:'Temporary connection failure.'},503);
      state.cancelled=true;
      if(scenario==='cancel-retry')return json({...cancelled(body.reason||'user'),refund:{status:'confirmed',currency:'USDC',decimals:6,amountAtomic:'1',transaction:'0.0.123@1720000002.123456789'}});
      return json(cancelled(body.reason||'user'));
    }
    if(path===`/chat-api/operations/${operationId}`){
      state.reads++;
      if(state.cancelled)return json(cancelled(state.cancels.at(-1)?.body.reason||'user'));
      if(scenario==='manual-stale'||scenario==='completion-wins'){
        if(state.reads===1){state.heldStarted=true;signalHeld();await new Promise(resolve=>{state.releaseHeld=resolve;});try{return await json(completed());}catch{return;}}
        return json(running());
      }
      if(scenario==='timeout'||scenario==='cancel-retry')return json(running());
      if(scenario==='network-retry'&&state.reads===1)return json({error:'Temporary connection failure.'},503);
      if(state.reads<(scenario==='network-retry'?3:2))return json(running());
      state.completed=true;return json(completed());
    }
    if(path==='/chat-api/message'){
      state.turns++;
      const body=request.postDataJSON();let events;
      if(state.turns===1){
        if(body.message!==prompt)state.violations.push('Wrong original prompt');
        events=[{type:'text',text:'I’ll follow those leads.'},{type:'operation',operation:quote},{type:'done'}];
      }else{
        if(!state.completed||state.cancelled)state.violations.push('A cancelled or unfinished request triggered a model continuation');
        events=[{type:'operation',operation:completed()},{type:'text',text:summary},{type:'done'}];
      }
      return route.fulfill({contentType:'application/x-ndjson',body:events.map(event=>JSON.stringify(event)).join('\n')+'\n'});
    }
    if(['/chat-api/heartbeat','/chat-api/session'].includes(path))return json({ok:true});
    state.violations.push(`Unexpected request ${request.method()} ${path}`);return json({error:'Unexpected fixture request.'},400);
  });
  await page.goto(base);
  await page.locator('#mission').fill(prompt);
  await page.getByRole('button',{name:'Send message',exact:true}).click();
  await page.getByRole('button',{name:'Sponsor this',exact:true}).waitFor();
  await page.waitForFunction(()=>!document.querySelector('.composer span'));
  await page.locator('#mission').fill(draft);
  await page.getByRole('button',{name:'Sponsor this',exact:true}).click();
  await page.getByRole('button',{name:'Approve sponsored payment',exact:true}).click();
  const progress=page.getByRole('status',{name:'Research in progress'});
  await progress.waitFor();
  assert.equal(await progress.locator('.bird').count(),1,'research progress keeps its branded bird visible');
  const birdBox=await progress.locator('.bird').boundingBox(),dotsBox=await progress.locator('.thought-dots').boundingBox();
  assert(dotsBox.x>=birdBox.x-8&&dotsBox.x+dotsBox.width<=birdBox.x+birdBox.width+8&&dotsBox.y>=birdBox.y-8&&dotsBox.y+dotsBox.height<=birdBox.y+birdBox.height+8,'search animation dots remain attached to the bird rather than a distant layout ancestor');
  assert.match(await progress.innerText(),/\d:\d\d left/,'progress shows the research countdown');
  await page.getByRole('button',{name:'Cancel research',exact:true}).waitFor();
  return {page,state,progress,heldReady,quote};
}

async function commonAssertions(page,state){
  assert.equal(state.sponsors,1);
  assert.equal(await page.locator('.message-user').count(),1,'only the actual user prompt appears');
  assert.equal(await page.locator('.message-assistant').count(),1,'research stays in its original response');
  assert.equal(await page.locator('#mission').inputValue(),draft);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.deepEqual(state.errors,[]);assert.deepEqual(state.violations,[]);
}

async function automaticResult(width,scenario){
  const {page,state}=await fixture(width,scenario);
  await page.getByText(summary,{exact:true}).waitFor({timeout:20_000});
  await page.locator('.research-attachment').waitFor();
  assert.equal(await page.evaluate(()=>window.__earlyResearchAttachment),false,'records stay hidden while the answer is streaming');
  assert(state.reads>=(scenario==='network-retry'?3:2));
  assert.equal(state.turns,2);
  assert.equal(state.cancels.length,0);
  assert.equal(await page.getByRole('button',{name:'Cancel research',exact:true}).count(),0);
  const reads=state.reads;
  await page.waitForTimeout(2300);
  assert.equal(state.reads,reads,'completed research stops background status reads');
  await commonAssertions(page,state);
  await page.screenshot({path:`/tmp/wikshi-research-poll-${scenario}-${width}.png`});
  console.log(`PASS ${width}px ${scenario}: paid queued/running research reaches results automatically, no manual refresh, no extra model/payment`);
  await page.close();
}

async function manualCancel(width){
  const {page,state,heldReady}=await fixture(width,'manual-stale');
  await heldReady;
  await page.waitForFunction(()=>{const image=document.querySelector('.research-progress .bird img');return image?.complete&&image.naturalWidth>0;});
  await page.screenshot({path:`/tmp/wikshi-research-poll-active-${width}.png`});
  await page.getByRole('button',{name:'Cancel research',exact:true}).click();
  await page.getByText('Research cancelled',{exact:true}).waitFor();
  assert.equal(await page.getByText('Refund pending.',{exact:true}).count(),1,'an unconfirmed refund is not called completed');
  assert.equal(await page.getByText('Payment refunded.',{exact:true}).count(),0);
  assert.equal(state.cancels.length,1);
  assert.equal(state.cancels[0].body.reason||'user','user');
  state.releaseHeld();
  await page.waitForTimeout(2600);
  assert.equal(state.turns,1,'manual cancellation does not trigger a model summary');
  assert.equal(await page.locator('.research-attachment').count(),0,'late completed GET cannot resurrect cancelled research');
  assert.equal(await page.getByText(summary,{exact:true}).count(),0);
  assert.equal(state.reads,1,'manual cancellation stops the data polling loop');
  assert.equal(await page.getByRole('button',{name:'Cancel research',exact:true}).count(),0);
  await commonAssertions(page,state);
  await page.screenshot({path:`/tmp/wikshi-research-poll-cancel-${width}.png`});
  console.log(`PASS ${width}px manual cancellation: one POST, no model/fake user, polling stops, late completed read ignored`);
  await page.close();
}

async function cancellationRetry(width){
  const {page,state}=await fixture(width,'cancel-retry');
  await page.getByRole('button',{name:'Cancel research',exact:true}).click();
  const progress=page.getByRole('status',{name:'Research in progress'});
  await progress.getByText('Cancellation is pending. Reconnecting automatically.',{exact:true}).waitFor();
  assert.equal(await progress.getByRole('button',{name:'Cancel research',exact:true}).isDisabled(),true);
  assert.equal(await progress.getByText('Cancelling research…',{exact:true}).count(),1);
  assert.equal(await page.getByText('Research cancelled',{exact:true}).count(),0,'failed cancellation transport is not a confirmed cancellation');
  assert.equal(await page.getByText('Payment refunded.',{exact:true}).count(),0,'pending cancellation cannot claim a refund');
  assert.equal(state.turns,1,'pending cancellation does not trigger a model continuation');
  const reads=state.reads;
  await page.screenshot({path:`/tmp/wikshi-research-poll-cancel-pending-${width}.png`});
  await page.getByText('Research cancelled',{exact:true}).waitFor({timeout:10_000});
  assert.equal(await page.getByText('Payment refunded.',{exact:true}).count(),1,'confirmed refund text follows the authoritative response');
  assert.equal(await page.getByText('Refund pending.',{exact:true}).count(),0);
  assert.equal(state.cancels.length,2,'one failed cancellation is automatically retried');
  assert(state.cancels[1].at-state.cancels[0].at>=2500,'cancellation retries back off instead of busy polling');
  assert(state.cancels.every(attempt=>attempt.body.reason==='user'));
  assert.equal(state.requests.filter(request=>request.path.endsWith('/cancel')).every(request=>request.path===`/chat-api/operations/${operationId}/cancel`&&request.method==='POST'),true,'all retries reconcile the same operation');
  await page.waitForTimeout(3300);
  assert.equal(state.cancels.length,2,'confirmed cancellation ends the retry loop');
  assert.equal(state.reads,reads,'cancel retry does not restart research status polling');
  assert.equal(state.turns,1);
  assert.equal(await page.locator('.research-attachment').count(),0);
  await commonAssertions(page,state);
  await page.screenshot({path:`/tmp/wikshi-research-poll-cancel-refunded-${width}.png`});
  console.log(`PASS ${width}px cancellation retry: disabled pending control, same operation retried automatically, confirmed refund, no model/payment or false result`);
  await page.close();
}

async function timeout(width,backendDeadline){
  const {page,state}=await fixture(width,'timeout',{clock:true,backendDeadline});
  const freezeAt=await page.evaluate(()=>Date.now()+1000);
  await page.clock.pauseAt(new Date(freezeAt));
  const remaining=state.deadline-await page.evaluate(()=>Date.now());
  assert(remaining>1&&remaining<=120_000);
  await page.clock.fastForward(remaining-1);
  assert.equal(state.cancels.length,0,'research cannot cancel before its 120-second deadline');
  await page.clock.runFor(25);
  await page.getByText('Research timed out',{exact:true}).waitFor();
  assert.equal(state.cancels.length,1);
  assert.equal(state.cancels[0].body.reason,'timeout');
  assert(state.cancels[0].at>=state.deadline,'timeout cancellation uses the absolute deadline');
  assert(state.cancels[0].at<=state.deadline+1000,'timeout is not postponed to a later polling cycle');
  const reads=state.reads;
  await page.clock.fastForward(15_000);
  assert.equal(state.cancels.length,1,'timeout is not repeatedly resubmitted');
  assert.equal(state.reads,reads,'timed-out research stops data polling');
  assert.equal(state.turns,1,'timeout does not trigger a model continuation');
  assert.equal(await page.locator('.research-attachment').count(),0);
  await commonAssertions(page,state);
  await page.screenshot({path:`/tmp/wikshi-research-poll-timeout-${backendDeadline?'backend':'fallback'}-${width}.png`});
  console.log(`PASS ${width}px ${backendDeadline?'backend':'local fallback'} deadline: no early cancel, one timeout POST at120s, no real two-minute wait, no result resurrection`);
  await page.close();
}

async function completionWins(width){
  const {page,state,heldReady}=await fixture(width,'completion-wins');
  await heldReady;
  await page.getByRole('button',{name:'Cancel research',exact:true}).click();
  await page.getByText(summary,{exact:true}).waitFor({timeout:15_000});
  state.releaseHeld();
  await page.locator('.research-attachment').waitFor();
  assert.equal(state.cancels.length,1,'the cancellation attempt is reconciled with the actual server outcome');
  assert.equal(state.turns,2,'authoritative completion still receives its one useful summary');
  assert.equal(state.cancelled,false);
  assert.equal(await page.getByText('Research cancelled',{exact:true}).count(),0);
  assert.equal(await page.getByText('Research timed out',{exact:true}).count(),0);
  assert.equal(await page.getByRole('link',{name:'Refund on HashScan',exact:false}).count(),0,'completion is not assigned a fabricated refund');
  await commonAssertions(page,state);
  console.log(`PASS ${width}px completion wins cancellation race: authoritative result shown, no false cancellation or refund`);
  await page.close();
}

try{
  for(const width of [1920,390]){
    await automaticResult(width,'success');
    await automaticResult(width,'network-retry');
    await manualCancel(width);
    await cancellationRetry(width);
    await timeout(width,true);
    await timeout(width,false);
    await completionWins(width);
  }
}finally{await browser.close();}
