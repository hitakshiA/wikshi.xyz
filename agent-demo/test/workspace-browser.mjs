// Browser-only fixtures. All chat API calls are intercepted. No messages,
// wallet signatures, payments, calls, or private inbox reads leave this test.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)('playwright');
const base=process.env.WIKSHI_BROWSER_TEST_URL||'http://127.0.0.1:5180';
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const inboxes=[{id:id(100),address:'first-bird@wikshi.xyz'},{id:id(101),address:'second-bird@wikshi.xyz'}];
const messages=[
  {id:id(201),direction:'inbound',from:'Mira <mira@example.test>',to:[inboxes[0].address],subject:'A useful reply',text:'Tuesday works. Please bring the company comparison.',createdAt:'2026-09-07T10:10:00Z',cursor:50},
  {id:id(202),direction:'inbound',from:'Research desk <desk@example.test>',to:[inboxes[0].address],subject:'Research follow-up',html:'<p>Hello &amp; thanks.</p><img src="https://mail-tracker.invalid/pixel.gif" onerror="window.__mailExecuted=true"><script>window.__mailExecuted=true</script><p>Please compare the products, not their slogans.</p><a href="javascript:window.__mailExecuted=true">Unsafe link</a>',createdAt:'2026-09-07T09:10:00Z',cursor:49},
  {id:id(203),direction:'outbound',from:inboxes[0].address,to:['recipient@example.test'],subject:'Your research brief',text:'Here is the research you asked for.',createdAt:'2026-09-07T08:10:00Z',cursor:48},
];
const older={id:id(204),direction:'inbound',from:'Older contact <old@example.test>',to:[inboxes[0].address],subject:'An older invitation',text:'I would be happy to answer those questions.',createdAt:'2026-09-06T10:10:00Z',cursor:47};
const second={id:id(205),direction:'inbound',from:'Separate contact <separate@example.test>',to:[inboxes[1].address],subject:'Second inbox only',text:'This belongs to the second payer inbox.',createdAt:'2026-09-07T10:10:00Z',cursor:75};
const receipt=(n,currency='USDC')=>({currency,decimals:currency==='HBAR'?8:6,prepaidAtomic:currency==='HBAR'?'1000000':'50000',chargedAtomic:currency==='HBAR'?'750000':'50000',refundDueAtomic:currency==='HBAR'?'250000':'0',units:1,unit:'request',issuedAt:'2026-09-07T10:00:00Z',paymentTransaction:`0.0.123@172000000${n}.123456789`,topicId:'0.0.456',signature:'browser-fixture-only'});
const operations=[
  {id:id(1),service:'discovery.companies',status:'completed',input:{query:'Smaller AI receptionist companies'},result:{companies:[{name:'Example company',location:'Worldwide',website:'https://example.test'}]},receipt:receipt(1)},
  {id:id(2),service:'phone.call',status:'completed',input:{phone:'+10000000000',mission:'Ask which product looked most useful.'},result:{transcript:[{role:'guest',text:'The focused receptionist product looked most useful.'}]},receipt:receipt(2,'HBAR'),refund:{status:'confirmed',currency:'HBAR',amountAtomic:'250000',transaction:'0.0.123@1720000009.123456789'}},
  {id:id(3),service:'video.meeting',status:'awaiting_guest',input:{mission:'Discuss the next product question with our guest.'},result:{meetingUrl:'https://bey.chat/browser-fixture',scheduledAt:'2026-09-08T10:00:00Z'},receipt:receipt(3)},
  {id:id(4),service:'discovery.search',status:'awaiting_payment',input:{query:'A follow-up search not yet approved'},paymentRequired:{accepts:[{asset:'0.0.429274',amount:'1',payTo:'0.0.123',scheme:'exact',network:'hedera:testnet'},{asset:'0.0.0',amount:'1000',payTo:'0.0.123',scheme:'exact',network:'hedera:testnet'}]},expiresAt:new Date(Date.now()+600_000).toISOString()},
];
const near=(a,b,label)=>assert(Math.abs(a-b)<=1,`${label}: ${a} vs ${b}`);
const sameBox=(a,b,label)=>{for(const field of ['x','y','width','height'])near(a[field],b[field],`${label} ${field}`);};
const browser=await chromium.launch();

try{
  for(const width of [1920,390]){
    const page=await browser.newPage({viewport:{width,height:1080},reducedMotion:'reduce'});
    const errors=[],requests=[],remoteMailRequests=[];
    let turns=0,listAttempts=0,failFirstList=true,failFirstRead=true,delayRead=false,releaseDelayedRead;
    page.on('pageerror',error=>errors.push(error.message));
    page.on('request',request=>{if(request.url().includes('mail-tracker.invalid'))remoteMailRequests.push(request.url());});
    await page.route('https://mail-tracker.invalid/**',route=>route.abort());
    await page.route('**/chat-api/**',async route=>{
      const request=route.request(),url=new URL(request.url()),path=url.pathname;
      requests.push({path,search:url.search,method:request.method(),authorization:request.headers().authorization});
      const json=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
      if(path==='/chat-api/sessions')return json({token:'t'.repeat(43)});
      if(path==='/chat-api/sponsorship')return json({available:true});
      if(path==='/chat-api/inboxes')return json({inboxes});
      if(path==='/chat-api/message'){
        const events=++turns===1?[{type:'text',text:'The research and conversations are in your workspace.'},...operations.map(operation=>({type:'operation',operation})),{type:'inboxes',inboxes},{type:'done'}]:[{type:'text',text:'The call result is available in your workspace.'},{type:'done'}];
        return route.fulfill({contentType:'application/x-ndjson',body:events.map(event=>JSON.stringify(event)).join('\n')+'\n'});
      }
      if(path===`/chat-api/inboxes/${inboxes[0].id}/messages`){
        listAttempts++;
        if(failFirstList){failFirstList=false;return json({error:'Could not load this inbox. Try again.'},503);}
        return json(url.searchParams.has('before')?{messages:[older],nextCursor:null,contentTrust:'untrusted-message-content'}:{messages,nextCursor:48,contentTrust:'untrusted-message-content'});
      }
      if(path===`/chat-api/inboxes/${inboxes[1].id}/messages`)return json({messages:[second],nextCursor:null,contentTrust:'untrusted-message-content'});
      const messageMatch=/^\/chat-api\/inboxes\/([^/]+)\/messages\/([^/]+)$/.exec(path);
      if(messageMatch){
        const message=[...messages,older,second].find(item=>item.id===messageMatch[2]);
        if(failFirstRead){failFirstRead=false;return json({error:'Could not read this message. Try again.'},503);}
        if(delayRead){delayRead=false;await new Promise(resolve=>{releaseDelayedRead=resolve;});}
        return json({message,contentTrust:'untrusted-message-content'});
      }
      if(path.startsWith('/chat-api/operations/'))return json(operations.find(operation=>path.endsWith(operation.id))||{});
      if(['/chat-api/heartbeat','/chat-api/session'].includes(path))return json({ok:true});
      throw Error(`Unexpected mocked request ${request.method()} ${path}`);
    });

    await page.goto(base);
    await page.locator('#mission').fill('Show the results from this conversation.');
    await page.getByRole('button',{name:'Send message',exact:true}).click();
    await page.locator('.inbox-heading-button').waitFor({state:'attached'});
    await page.waitForFunction(()=>!document.querySelector('.composer span'));
    if(width<1000)await page.getByRole('button',{name:'Your workspace',exact:false}).click();
    const workspace=page.getByRole('complementary',{name:'This chat’s workspace'});
    await workspace.waitFor();
    const workspaceBefore=await workspace.boundingBox(),composerBefore=await page.locator('.composer').boundingBox();
    await workspace.getByRole('button',{name:'Your agent’s inbox',exact:false}).click();
    const mail=page.getByRole('region',{name:'Agent email inbox'});
    await mail.waitFor();
    sameBox(workspaceBefore,await workspace.boundingBox(),`${width}px inbox stays in workspace rectangle`);
    sameBox(composerBefore,await page.locator('.composer').boundingBox(),`${width}px inbox does not shift composer`);
    await mail.getByRole('alert').filter({hasText:'Could not load this inbox.'}).waitFor();
    await mail.getByRole('button',{name:'Try again',exact:true}).click();
    await mail.locator('.mail-row').filter({hasText:'A useful reply'}).waitFor();
    assert.equal(listAttempts,2);
    assert.equal(await mail.locator('.mail-row').count(),2,'Inbox initially shows only incoming messages');
    await mail.getByRole('button',{name:'Sent',exact:true}).click();
    assert.equal(await mail.locator('.mail-row').count(),1);
    assert.match(await mail.locator('.mail-row').innerText(),/Your research brief/);
    await mail.getByRole('button',{name:'All',exact:true}).click();
    assert.equal(await mail.locator('.mail-row').count(),3);
    await mail.getByRole('searchbox',{name:'Search loaded mail'}).fill('research brief');
    assert.equal(await mail.locator('.mail-row').count(),1);
    await mail.getByRole('searchbox',{name:'Search loaded mail'}).fill('nothing-matches-this');
    await mail.getByRole('heading',{name:'No matches in loaded mail'}).waitFor();
    await mail.getByRole('searchbox',{name:'Search loaded mail'}).fill('');
    await mail.getByRole('button',{name:'Inbox',exact:true}).click();
    await mail.getByRole('button',{name:'Load older messages',exact:true}).click();
    await mail.locator('.mail-row').filter({hasText:'An older invitation'}).waitFor();
    assert.equal(await mail.locator('.mail-row').count(),3);
    assert.equal(await mail.getByRole('button',{name:'Load older messages',exact:true}).count(),0);
    assert(requests.some(request=>request.search==='?before=48'));
    await mail.locator('.mail-row').filter({hasText:'Research follow-up'}).click();
    await mail.getByRole('alert').filter({hasText:'Could not read this message.'}).waitFor();
    await mail.getByRole('button',{name:'Try again',exact:true}).click();
    await mail.locator('.mail-body').filter({hasText:'Hello & thanks.'}).waitFor();
    assert.match(await mail.locator('.mail-body').innerText(),/Please compare the products/);
    assert.equal(await mail.locator('.mail-body img,.mail-body script,.mail-body a,.mail-body iframe').count(),0);
    assert.equal(await page.evaluate(()=>window.__mailExecuted),undefined);
    assert.deepEqual(remoteMailRequests,[]);
    sameBox(composerBefore,await page.locator('.composer').boundingBox(),`${width}px message detail does not shift composer`);
    await page.screenshot({path:`/tmp/wikshi-sidebar-mail-${width}.png`});
    await mail.getByRole('button',{name:'Messages',exact:true}).click();
    await mail.locator('.mail-row').filter({hasText:'Research follow-up'}).waitFor();

    // An earlier inbox's slow detail response must never replace a new inbox.
    delayRead=true;
    await mail.locator('.mail-row').filter({hasText:'A useful reply'}).click();
    await page.waitForFunction(()=>document.querySelector('.mail-reader')?.getAttribute('aria-busy')==='true');
    await mail.getByLabel('Agent inbox', {exact:true}).selectOption(inboxes[1].id);
    await mail.locator('.mail-row').filter({hasText:'Second inbox only'}).waitFor();
    assert.equal(typeof releaseDelayedRead,'function');
    releaseDelayedRead();
    await page.waitForTimeout(100);
    assert.equal(await mail.locator('.mail-reader').count(),0);
    assert.equal(await mail.locator('.mail-row').count(),1);
    assert.match(await mail.locator('.mail-row').innerText(),/Second inbox only/);
    await mail.getByRole('button',{name:'Back to workspace',exact:true}).click();
    await workspace.getByRole('button',{name:'Your agent’s inbox',exact:false}).waitFor();
    assert.equal(await page.getByRole('region',{name:'Agent email inbox'}).count(),0);
    sameBox(workspaceBefore,await workspace.boundingBox(),`${width}px workspace restored in place`);
    sameBox(composerBefore,await page.locator('.composer').boundingBox(),`${width}px return leaves composer fixed`);

    // Scope these checks to the sidebar so chat copies cannot satisfy them.
    await checkActivity(workspace,width,page);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    assert.equal(requests.some(request=>/\/(pay|sponsor)$/.test(request.path)),false);
    const reads=requests.filter(request=>request.path.includes('/messages'));
    assert(reads.length>=7);
    for(const request of reads){assert.equal(request.method,'GET');assert.equal(request.authorization,`Bearer ${'t'.repeat(43)}`);}
    assert.deepEqual(errors,[]);
    console.log(`PASS ${width}px: same-panel inbox, folders/search/pagination/retry, safe mail text, stale-read isolation, receipts/activity, fixed composer, no payment or live API reads`);
    await page.close();
  }
}finally{await browser.close();}

async function checkActivity(workspace,width,page){
  const activity=workspace.getByRole('region',{name:'Requests and receipts'});
  await activity.waitFor();
  assert.equal(await activity.locator('.workspace-activity-record').count(),4);
  assert.match(await activity.locator('header').innerText(),/3 receipts/);
  const pending=activity.locator('.workspace-activity-record').filter({hasText:'Web search'});
  await pending.locator(':scope > summary').click();
  await pending.getByText('No confirmed payment recorded.',{exact:true}).waitFor();
  assert.equal(await pending.locator('.workspace-paper-receipt,.workspace-explorer-links').count(),0,'an unapproved quote is not rendered as a receipt');
  assert.match(await pending.locator(':scope > summary').innerText(),/Quoted/);
  await pending.locator('.workspace-request-details > summary').click();
  assert.match(await pending.locator('.workspace-request-details').innerText(),/A follow-up search not yet approved/);
  const composer=await page.locator('.composer').boundingBox();

  await activity.getByRole('button',{name:'Calls',exact:true}).click();
  assert.equal(await activity.locator('.workspace-activity-record').count(),1);
  const call=activity.locator('.workspace-activity-record');
  assert.match(await call.locator(':scope > summary').innerText(),/Phone call.*Completed/s);
  await call.locator(':scope > summary').click();
  const callReceipt=call.getByRole('region',{name:'Phone call receipt'});
  await callReceipt.waitFor();
  assert.match(await callReceipt.innerText(),/0\.0075 HBAR/);
  assert.match(await callReceipt.innerText(),/Refund confirmed.*0\.0025 HBAR/s);
  assert.equal(await call.getByRole('link',{name:'Payment on HashScan',exact:true}).getAttribute('href'),'https://hashscan.io/testnet/transaction/0.0.123-1720000002-123456789');
  assert.equal(await call.getByRole('link',{name:'Refund on HashScan',exact:true}).getAttribute('href'),'https://hashscan.io/testnet/transaction/0.0.123-1720000009-123456789');
  assert.equal(await call.getByRole('link',{name:'Topic on HashScan',exact:true}).getAttribute('href'),'https://hashscan.io/testnet/topic/0.0.456');
  await call.locator('.workspace-transcript > summary').click();
  assert.match(await call.locator('.workspace-transcript').innerText(),/The focused receptionist product looked most useful/);
  await call.locator('.workspace-request-details > summary').click();
  assert.match(await call.locator('.workspace-request-details').innerText(),/\+10000000000/);
  await call.locator('.workspace-request-identifiers > summary').click();
  assert.match(await call.locator('.workspace-request-identifiers').innerText(),/browser-fixture-only/);
  sameBox(composer,await page.locator('.composer').boundingBox(),`${width}px expanded receipt leaves composer fixed`);
  await page.screenshot({path:`/tmp/wikshi-sidebar-receipt-${width}.png`});

  await activity.getByRole('button',{name:'Meetings',exact:true}).click();
  assert.equal(await activity.locator('.workspace-activity-record').count(),1);
  const meeting=activity.locator('.workspace-activity-record');
  assert.match(await meeting.locator(':scope > summary').innerText(),/Guest video meeting.*Invitation created/s);
  await meeting.locator(':scope > summary').click();
  await meeting.getByRole('region',{name:'Guest video meeting receipt'}).waitFor();
  await meeting.getByRole('button',{name:'Copy guest invitation',exact:true}).waitFor();
  assert.match(await meeting.locator('.workspace-guest-link').innerText(),/Share the invitation with your guest/);
  assert.equal(await meeting.getByRole('link',{name:'Payment on HashScan',exact:true}).getAttribute('href'),'https://hashscan.io/testnet/transaction/0.0.123-1720000003-123456789');
  assert.equal(await meeting.locator('a[href^="https://bey.chat"]').count(),0,'guest links are shared, not presented as a meeting for the visitor to attend');
  await activity.getByRole('button',{name:'All',exact:true}).click();
  const research=activity.locator('.workspace-activity-record').filter({hasText:'Company search'});
  await research.locator(':scope > summary').click();
  await research.getByRole('region',{name:'Company search receipt'}).waitFor();
  assert.match(await research.innerText(),/1 source record returned/);
  await research.locator('.workspace-request-details > summary').click();
  assert.match(await research.locator('.workspace-request-details').innerText(),/Smaller AI receptionist companies/);
  assert.equal(await research.getByRole('link',{name:'Payment on HashScan',exact:true}).getAttribute('href'),'https://hashscan.io/testnet/transaction/0.0.123-1720000001-123456789');
  for(const link of await activity.locator('.workspace-explorer-links a').all()){
    assert.match(await link.getAttribute('href'),/^https:\/\/hashscan\.io\/testnet\/(transaction|topic)\//);
    assert.equal(await link.getAttribute('target'),'_blank');
    assert.equal(await link.getAttribute('rel'),'noopener noreferrer');
  }
  await page.screenshot({path:`/tmp/wikshi-sidebar-workspace-${width}.png`});
}
