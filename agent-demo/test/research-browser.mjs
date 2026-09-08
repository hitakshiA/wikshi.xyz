// UI-only fixtures. Every chat API request, including sponsored payment, is
// intercepted. No real signatures, payments, model calls, or research runs.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)('playwright');
const base=process.env.WIKSHI_BROWSER_TEST_URL||'http://127.0.0.1:5180';
const operationId='00000000-0000-0000-0000-000000000801';
const userPrompt='hey find some smaller ai receptionist startups around the world, not just the obvious ones';
const draft='which of these would be worth talking to first?';
const summary='I found 100 companies. The more focused receptionist products look useful; the full research is attached below.';
const longText='This product handles incoming questions, appointment changes, and customer calls. '.repeat(45);
const records=Array.from({length:100},(_,index)=>({
  name:`Research company ${String(index+1).padStart(3,'0')}`,
  location:index%2===0?'Europe':'North America',
  website:`https://example.test/company/${index+1}`,
  text:`Research record ${index+1}. ${longText} Final evidence marker ${index+1}.`,
  contact:{name:`Contact ${index+1}`,email:`contact${index+1}@example.test`},
}));
const quote={id:operationId,service:'discovery.companies',status:'awaiting_payment',input:{query:'Smaller AI receptionist companies worldwide',limit:100},expiresAt:new Date(Date.now()+600_000).toISOString(),paymentRequired:{accepts:[{scheme:'exact',network:'hedera:testnet',asset:'0.0.429274',amount:'1',payTo:'0.0.123'},{scheme:'exact',network:'hedera:testnet',asset:'0.0.0',amount:'1000',payTo:'0.0.123'}]}};
const completed={...quote,status:'completed',result:{companies:records},receipt:{currency:'USDC',decimals:6,prepaidAtomic:'1',chargedAtomic:'1',refundDueAtomic:'0',units:1,unit:'request',issuedAt:'2026-09-07T10:00:00Z',paymentTransaction:'0.0.123@1720000001.123456789',topicId:'0.0.456',signature:'browser-fixture-only'}};

async function downloadText(page,button){
  const event=page.waitForEvent('download');await button.click();
  const download=await event,stream=await download.createReadStream(),chunks=[];
  for await(const chunk of stream)chunks.push(Buffer.from(chunk));
  return {filename:download.suggestedFilename(),text:Buffer.concat(chunks).toString('utf8')};
}
function csvRows(text){
  text=text.replace(/^\uFEFF/,'');
  const rows=[];let row=[],value='',quoted=false;
  for(let i=0;i<text.length;i++){
    const char=text[i];
    if(char==='"'){
      if(quoted&&text[i+1]==='"'){value+='"';i++;}else quoted=!quoted;
    }else if(char===','&&!quoted){row.push(value);value='';}
    else if((char==='\r'||char==='\n')&&!quoted){
      if(char==='\r'&&text[i+1]==='\n')i++;
      row.push(value);rows.push(row);row=[];value='';
    }else value+=char;
  }
  if(value||row.length){row.push(value);rows.push(row);}
  return rows;
}

const browser=await chromium.launch();
try{
  for(const width of [1920,2560,390]){
    const page=await browser.newPage({viewport:{width,height:1080},reducedMotion:'reduce'});
    const errors=[],requests=[],earlyContinuations=[];
    let turns=0,sponsorCalls=0,statusReads=0,terminal=false;
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/chat-api/**',async route=>{
      const request=route.request(),path=new URL(request.url()).pathname;
      requests.push({path,method:request.method(),body:request.postData()});
      const json=(value,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(value)});
      if(path==='/chat-api/sessions')return json({token:'t'.repeat(43)});
      if(path==='/chat-api/sponsorship')return json({available:true});
      if(path==='/chat-api/inboxes')return json({inboxes:[]});
      if(path===`/chat-api/operations/${operationId}/sponsor`){
        sponsorCalls++;
        const body=request.postDataJSON();assert.equal(body.approved,true);assert.equal(body.currency,'USDC');
        return json({...quote,status:'queued',payment:{confirmed:true,asset:'0.0.429274',amountAtomic:'1'}});
      }
      if(path===`/chat-api/operations/${operationId}`){
        statusReads++;terminal=statusReads>=2;
        return json(terminal?completed:{...quote,status:'running',payment:{confirmed:true,asset:'0.0.429274',amountAtomic:'1'}});
      }
      if(path==='/chat-api/message'){
        const message=request.postDataJSON().message;
        let events;
        if(++turns===1){assert.equal(message,userPrompt);events=[{type:'text',text:'I’ll start with one company search.'},{type:'operation',operation:quote},{type:'done'}];}
        else{
          if(!terminal)earlyContinuations.push(message);
          events=[{type:'operation',operation:completed},{type:'text',text:summary},{type:'done'}];
        }
        return route.fulfill({contentType:'application/x-ndjson',body:events.map(event=>JSON.stringify(event)).join('\n')+'\n'});
      }
      if(['/chat-api/heartbeat','/chat-api/session'].includes(path))return json({ok:true});
      throw Error(`Unexpected research fixture request ${request.method()} ${path}`);
    });

    await page.goto(base);
    await page.locator('#mission').fill(userPrompt);
    await page.getByRole('button',{name:'Send message',exact:true}).click();
    const sponsor=page.getByRole('button',{name:'Sponsor this',exact:true});
    await sponsor.waitFor();
    await page.waitForFunction(()=>!document.querySelector('.composer span'));
    assert.equal(await page.locator('.payment-wrap').count(),1);
    assert.equal(await page.locator('.message-user').count(),1);
    assert.equal(await page.locator('.message-assistant').count(),1);
    await page.locator('#mission').fill(draft);
    await sponsor.click();
    assert.equal(sponsorCalls,0,'opening the sponsor dialog is not approval');
    await page.getByRole('button',{name:'Approve sponsored payment',exact:true}).click();
    try{await page.getByText(summary,{exact:true}).waitFor({timeout:25_000});}
    catch(error){
      await page.screenshot({path:`/tmp/wikshi-research-failure-${width}.png`});
      console.error(JSON.stringify({width,turns,sponsorCalls,statusReads,terminal,earlyContinuations,requests,errors,visibleChat:await page.locator('.messages').innerText()},null,2));
      throw error;
    }
    await page.waitForFunction(()=>!document.querySelector('.composer span'));
    const attachment=page.locator('.research-attachment');
    await attachment.waitFor();
    assert.equal(sponsorCalls,1);
    assert(statusReads>=2,'queued and running operations are polled until the actual result');
    assert.equal(turns,2,'only the initial request and terminal internal continuation run the model');
    assert.deepEqual(earlyContinuations,[],'the agent must not summarize a queued payment as its final result');
    assert.equal(await page.locator('.message-user').count(),1,'internal check-up must not be rendered as another YOU message');
    assert.equal(await page.locator('.message-assistant').count(),1,'the result updates the original response instead of adding another bubble');
    assert.equal(await page.locator('.message-user p').innerText(),userPrompt);
    assert.equal(await page.locator('#mission').inputValue(),draft,'automatic continuation preserves the unsent next message');
    assert.equal(await attachment.count(),1);
    assert.equal(await page.locator('.messages table').count(),0,'large result tables are not placed inline in chat');
    assert.equal(await page.locator('.messages .payment-wrap').count(),0);
    assert.equal(await page.getByText('I’ll start with one company search.',{exact:true}).count(),0,'stale payment-introduction prose is replaced by actual result summary');
    const positions=await page.evaluate(()=>{
      const summary=document.querySelector('.message-assistant .message-markdown'),attachment=document.querySelector('.research-attachment');
      return {sameMessage:summary.closest('.message')===attachment.closest('.message'),summaryBottom:summary.getBoundingClientRect().bottom,attachmentTop:attachment.getBoundingClientRect().top,attachmentHeight:attachment.getBoundingClientRect().height};
    });
    assert.equal(positions.sameMessage,true);
    assert(positions.attachmentTop>=positions.summaryBottom-1,'attachment follows the summary');
    assert(positions.attachmentHeight<170,`attachment stays compact: ${positions.attachmentHeight}px`);
    const wrapper=await attachment.evaluate(element=>{
      const wrapper=element.closest('.research-operation'),style=getComputedStyle(wrapper);
      return {width:wrapper.getBoundingClientRect().width,borders:[style.borderTopWidth,style.borderRightWidth,style.borderBottomWidth,style.borderLeftWidth],shadow:style.boxShadow,background:style.backgroundColor};
    });
    assert(wrapper.width<=480.5,`attachment wrapper stays compact: ${wrapper.width}px`);
    assert.deepEqual(wrapper.borders,['0px','0px','0px','0px'],'no second framed card surrounds the attachment');
    assert.equal(wrapper.shadow,'none');
    assert.equal(wrapper.background,'rgba(0, 0, 0, 0)');
    await page.screenshot({path:`/tmp/wikshi-research-attachment-${width}.png`});

    await attachment.click();
    const panel=page.locator('.research-panel');
    await panel.waitFor();
    const panelBox=await panel.boundingBox();
    assert(panelBox.x<=1,'research opens against the left edge');
    assert(panelBox.width<=width,'research panel stays within viewport');
    if(width>=1000){
      const messageBox=await page.locator('.messages').boundingBox(),composerBox=await page.locator('.composer').boundingBox();
      assert(panelBox.x+panelBox.width<=messageBox.x+1,'desktop research panel does not cover message beginnings');
      assert(panelBox.x+panelBox.width<=composerBox.x+1,'desktop research panel does not cover the composer');
    }
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'open research panel must not cause horizontal document overflow');
    assert.equal(await panel.locator('.research-sheet tbody tr').count(),25);
    const rowHeights=await panel.locator('.research-sheet tbody tr').evaluateAll(rows=>rows.map(row=>row.getBoundingClientRect().height));
    assert(rowHeights.every(height=>height<=56),`long research text must not expand rows: ${rowHeights.join(',')}`);
    const cell=panel.locator('.research-cell[data-column="text"]').first();
    await cell.click();
    const inspector=panel.locator('.research-inspector');
    await inspector.waitFor();
    assert.match(await inspector.locator('.research-field-value').innerText(),/Final evidence marker 1\./);
    assert((await inspector.locator('.research-field-value').innerText()).length>2000,'full cell detail retains the original long content');
    await page.screenshot({path:`/tmp/wikshi-research-detail-${width}.png`});
    await inspector.getByRole('button',{name:/View full record/}).click();
    assert.match(await inspector.innerText(),/contact1@example\.test/);
    await inspector.getByRole('button',{name:/Back to cell/}).click();
    await page.keyboard.press('Escape');
    await inspector.waitFor({state:'detached'});
    await panel.waitFor();
    assert.equal(await page.locator('#mission').inputValue(),draft);

    await panel.getByRole('button',{name:'Next page',exact:true}).click();
    assert.match(await panel.locator('.research-sheet tbody tr').first().innerText(),/Research company 026/);
    await panel.getByRole('button',{name:'Previous page',exact:true}).click();
    assert.match(await panel.locator('.research-sheet tbody tr').first().innerText(),/Research company 001/);
    await panel.getByRole('searchbox',{name:'Search records',exact:true}).fill('Research company 100');
    assert.equal(await panel.locator('.research-sheet tbody tr').count(),1);
    assert.match(await panel.locator('.research-sheet tbody tr').innerText(),/Research company 100/);
    const csv=await downloadText(page,panel.getByRole('button',{name:'Download CSV',exact:true}));
    const json=await downloadText(page,panel.getByRole('button',{name:'Download JSON',exact:true}));
    assert.match(csv.filename,/\.csv$/);assert.match(json.filename,/\.json$/);
    const decoded=JSON.parse(json.text),csvData=csvRows(csv.text);
    assert.equal(decoded.length,100,'JSON exports the full dataset, not the filtered row');
    assert.equal(csvData.length,101,'CSV exports one header and all 100 records');
    const nameColumn=csvData[0].findIndex(column=>column.toLowerCase()==='name'),textColumn=csvData[0].findIndex(column=>column.toLowerCase()==='text');
    assert(nameColumn>=0&&textColumn>=0);
    assert.equal(csvData[1][nameColumn],records[0].name);
    assert.equal(csvData[100][nameColumn],records[99].name);
    assert.equal(csvData[100][textColumn],records[99].text,'CSV export does not truncate long cell values');
    assert.equal(decoded[99].text,records[99].text,'JSON export does not truncate long cell values');
    await panel.getByRole('searchbox',{name:'Search records',exact:true}).fill('no-such-company');
    assert.equal(await panel.locator('.research-sheet tbody tr').count(),0);
    await panel.getByRole('searchbox',{name:'Search records',exact:true}).fill('');
    await page.screenshot({path:`/tmp/wikshi-research-panel-${width}.png`});
    await page.keyboard.press('Escape');
    await panel.waitFor({state:'detached'});
    await page.waitForFunction(()=>document.activeElement?.classList.contains('research-attachment'));
    assert.equal(await page.locator('#mission').inputValue(),draft);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    assert.equal(requests.filter(request=>/\/(pay|sponsor)$/.test(request.path)).length,1);
    assert.deepEqual(errors,[]);
    console.log(`PASS ${width}px: one paid flow, terminal polling, same response, preserved composer, compact attachment, dense left panel, full details and 100-row exports, Escape/focus, no overflow`);
    await page.close();
    await checkCancellation(browser,width);
    await checkSummaryRetry(browser,width);
  }
}finally{await browser.close();}

async function checkCancellation(browser,width){
  const page=await browser.newPage({viewport:{width,height:1080},reducedMotion:'reduce'});
  const errors=[],requests=[],nextId='00000000-0000-0000-0000-000000000802';
  const nextPrompt='actually look for smaller companies handling appointment calls instead';
  const nextQuote={...quote,id:nextId,input:{query:'Smaller appointment-call companies',limit:8}};
  let turns=0,cancellations=0,cancelled=false;
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/chat-api/**',async route=>{
    const request=route.request(),path=new URL(request.url()).pathname;
    requests.push({path,method:request.method()});
    const json=value=>route.fulfill({contentType:'application/json',body:JSON.stringify(value)});
    if(path==='/chat-api/sessions')return json({token:'t'.repeat(43)});
    if(path==='/chat-api/sponsorship')return json({available:true});
    if(path==='/chat-api/inboxes')return json({inboxes:[]});
    if(path===`/chat-api/operations/${operationId}/cancel`){
      assert.equal(request.method(),'POST');
      cancellations++;cancelled=true;
      return json({...quote,status:'cancelled',operationUpdates:[]});
    }
    if(path==='/chat-api/message'){
      const message=request.postDataJSON().message;
      const first=++turns===1;
      if(first)assert.equal(message,userPrompt);
      else{assert.equal(cancelled,true);assert.equal(message,nextPrompt);}
      const events=[{type:'text',text:first?'I’ll start with one company search.':'I’ll use that narrower direction.'},{type:'operation',operation:first?quote:nextQuote},{type:'done'}];
      return route.fulfill({contentType:'application/x-ndjson',body:events.map(event=>JSON.stringify(event)).join('\n')+'\n'});
    }
    if(['/chat-api/heartbeat','/chat-api/session'].includes(path))return json({ok:true});
    throw Error(`Unexpected cancellation fixture request ${request.method()} ${path}`);
  });
  await page.goto(base);
  await page.locator('#mission').fill(userPrompt);
  await page.getByRole('button',{name:'Send message',exact:true}).click();
  await page.getByRole('button',{name:'Cancel request',exact:true}).waitFor();
  await page.waitForFunction(()=>!document.querySelector('.composer span'));
  await page.locator('#mission').fill(nextPrompt);
  await page.getByRole('button',{name:'Cancel request',exact:true}).click();
  await page.getByText('Research cancelled',{exact:true}).waitFor();
  assert.equal(cancellations,1);
  assert.equal(turns,1,'cancelling a quote does not run the model');
  assert.equal(await page.locator('.message-user').count(),1,'cancel action is not a synthetic user message');
  assert.equal(await page.locator('.payment-wrap').count(),0);
  assert.equal(await page.locator('#mission').inputValue(),nextPrompt,'cancelling preserves a drafted next message');
  assert.match(await page.locator('.cancelled-request').innerText(),/No payment was made/);
  await page.getByRole('button',{name:'Send message',exact:true}).click();
  await page.locator(`[data-operation="${nextId}"] .payment-wrap`).waitFor();
  await page.waitForFunction(()=>!document.querySelector('.composer span'));
  assert.equal(turns,2);
  assert.equal(await page.locator('.message-user').count(),2,'only the two actual typed prompts appear as user messages');
  assert.equal(await page.locator('.message-assistant').count(),2);
  assert.equal(await page.locator('.payment-wrap').count(),1,'only the new request remains actionable');
  assert.equal(await page.locator('.cancelled-request').count(),1);
  assert.equal(requests.filter(request=>request.path.endsWith('/cancel')).length,1);
  assert.equal(requests.some(request=>/\/(pay|sponsor)$/.test(request.path)),false);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.deepEqual(errors,[]);
  await page.screenshot({path:`/tmp/wikshi-research-cancel-${width}.png`});
  console.log(`PASS ${width}px: unpaid quote cancellation, no model or synthetic user turn, preserved draft, next natural request gets one fresh card`);
  await page.close();
}

async function checkSummaryRetry(browser,width){
  const page=await browser.newPage({viewport:{width,height:1080},reducedMotion:'reduce'});
  const errors=[],requests=[];let turns=0,sponsorCalls=0;
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/chat-api/**',async route=>{
    const request=route.request(),path=new URL(request.url()).pathname;
    requests.push({path,method:request.method()});
    const json=(value,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(value)});
    if(path==='/chat-api/sessions')return json({token:'t'.repeat(43)});
    if(path==='/chat-api/sponsorship')return json({available:true});
    if(path==='/chat-api/inboxes')return json({inboxes:[]});
    if(path===`/chat-api/operations/${operationId}/sponsor`){
      sponsorCalls++;assert.equal(request.postDataJSON().approved,true);return json(completed);
    }
    if(path===`/chat-api/operations/${operationId}`)return json(completed);
    if(path==='/chat-api/message'){
      const body=request.postDataJSON();turns++;
      if(turns===1){
        assert.equal(body.message,userPrompt);
        return route.fulfill({contentType:'application/x-ndjson',body:[{type:'text',text:'I’ll start with one company search.'},{type:'operation',operation:quote},{type:'done'}].map(event=>JSON.stringify(event)).join('\n')+'\n'});
      }
      assert.deepEqual(body.completionIds,[operationId],'retry remains scoped to the existing completed request');
      if(turns===2)return json({error:'All agents are busy. Please try again shortly.'},503);
      const events=[{type:'operation',operation:completed},{type:'text',text:summary},{type:'done'}];
      return route.fulfill({contentType:'application/x-ndjson',body:events.map(event=>JSON.stringify(event)).join('\n')+'\n'});
    }
    if(['/chat-api/heartbeat','/chat-api/session'].includes(path))return json({ok:true});
    throw Error(`Unexpected summary-retry fixture request ${request.method()} ${path}`);
  });
  await page.goto(base);
  await page.locator('#mission').fill(userPrompt);
  await page.getByRole('button',{name:'Send message',exact:true}).click();
  await page.getByRole('button',{name:'Sponsor this',exact:true}).waitFor();
  await page.waitForFunction(()=>!document.querySelector('.composer span'));
  await page.locator('#mission').fill(draft);
  await page.getByRole('button',{name:'Sponsor this',exact:true}).click();
  await page.getByRole('button',{name:'Approve sponsored payment',exact:true}).click();
  const retry=page.getByRole('button',{name:'Retry summary',exact:true});
  await retry.waitFor({timeout:15_000});
  assert.equal(turns,2,'a failed summary waits for an explicit retry rather than a retry loop');
  assert.equal(sponsorCalls,1);
  assert.equal(await page.locator('.message-user').count(),1);
  assert.equal(await page.locator('.message-assistant').count(),1);
  assert.equal(await page.locator('#mission').inputValue(),draft);
  assert.equal(await page.locator('.payment-wrap').count(),0,'summary failure never returns a paid request to payment');
  assert.match(await page.locator('.message-assistant .message-markdown').innerText(),/I’ll start with one company search/,'a failed empty summary does not erase the existing response');
  await page.screenshot({path:`/tmp/wikshi-research-summary-retry-${width}.png`});
  await retry.click();
  await page.getByText(summary,{exact:true}).waitFor({timeout:15_000});
  await page.waitForFunction(()=>!document.querySelector('.composer span'));
  assert.equal(turns,3);
  assert.equal(sponsorCalls,1,'summary retry never sponsors or signs again');
  assert.equal(await page.locator('.message-user').count(),1);
  assert.equal(await page.locator('.message-assistant').count(),1);
  assert.equal(await page.locator('.research-attachment').count(),1);
  assert.equal(await page.locator('#mission').inputValue(),draft);
  assert.equal(await retry.count(),0);
  assert.equal(requests.filter(request=>/\/(pay|sponsor)$/.test(request.path)).length,1);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.deepEqual(errors,[]);
  console.log(`PASS ${width}px: failed completion HTTP503 can retry its summary, same response and draft retained, no new payment or synthetic user message`);
  await page.close();
}
