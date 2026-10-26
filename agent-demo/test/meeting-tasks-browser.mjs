// Isolated fixtures: no real calls, meetings, emails, or payments.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)('playwright');
const base=process.env.WIKSHI_BROWSER_TEST_URL||'http://127.0.0.1:5180';
const meeting=(id,title)=>({id,service:'video.meeting',status:'awaiting_guest',input:{mission:title},result:{meetingUrl:`https://api.wikshi.xyz/guest/${id}`}});
const browser=await chromium.launch();
try{for(const width of [1920,390]){
 const page=await browser.newPage({viewport:{width,height:1080},reducedMotion:'reduce'});
 const prompts=[],reads=[],errors=[];
 const operations=[meeting('meeting-one','Linda AI product discussion'),meeting('meeting-two','Compare receptionist products'),{id:'email',service:'email.send',status:'completed',input:{to:'test@example.test',subject:'Invitation'},result:{status:'accepted'}},{id:'call',service:'phone.call',status:'running',input:{phone:'+10000000000',mission:'Short briefing'}}];
 page.on('pageerror',e=>errors.push(e.message));
 let release;
 await page.route('**/chat-api/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  const json=value=>route.fulfill({contentType:'application/json',body:JSON.stringify(value)});
  if(path==='/chat-api/sessions')return json({token:'t'.repeat(43)});
  if(path==='/chat-api/inboxes')return json({inboxes:[]});
  if(path==='/chat-api/message'){
   const body=route.request().postDataJSON();prompts.push(body.message);
   if(prompts.length>1)await new Promise(resolve=>{release=resolve});
   const events=prompts.length===1?[{type:'text',text:'Your invitations are ready.'},...operations.map(operation=>({type:'operation',operation})),{type:'done'}]:[{type:'text',text:'Linda AI meeting has ended. Here is the transcript summary.'},{type:'operation',operation:{...operations[0],status:'completed',result:{transcript:[{role:'guest',text:'Linda AI looks useful.'}]}}},{type:'done'}];
   return route.fulfill({contentType:'application/x-ndjson',body:events.map(x=>JSON.stringify(x)).join('\n')+'\n'});
  }
  if(path.startsWith('/chat-api/operations/')){reads.push(path);const op=operations.find(x=>path.endsWith(x.id));return json(op?.id==='meeting-two'?{...op,status:'completed',result:{transcript:[{role:'guest',text:'Automatically retrieved meeting transcript.'}]}}:op);}
  return json({ok:true,available:false});
 });
 await page.goto(base);
 await page.locator('#mission').fill('Show my invitations');
 await page.getByRole('button',{name:'Send message',exact:true}).click();
 await page.getByText('Email sent',{exact:true}).waitFor();
 if(width<800)await page.getByRole('button',{name:'Your workspace'}).click();
 const tasks=page.getByRole('region',{name:'Video meetings',exact:true});
 await tasks.waitFor();
 assert.equal(await tasks.locator('li').count(),2);
 assert.equal(await page.getByText(/Watching your call/).count(),0);
 assert.equal(await page.locator('.workspace').evaluate(el=>{
  const inbox=el.querySelector('.inbox-panel'),meetings=el.querySelector('.workspace-meetings'),receipts=el.querySelector('.workspace-activity');
  return !!(inbox.compareDocumentPosition(meetings)&Node.DOCUMENT_POSITION_FOLLOWING)&&!!(meetings.compareDocumentPosition(receipts)&Node.DOCUMENT_POSITION_FOLLOWING);
 }),true);
 await page.waitForTimeout(5500);
 assert.equal(prompts.length,1);assert.equal(reads.some(x=>x.includes('meeting-')),false);
 await tasks.getByText('Transcript available',{exact:true}).waitFor({timeout:20000});
 assert(reads.some(x=>x.includes('meeting-two')));
 assert.equal(prompts.length,1,'Background status checks must not create user prompts');
 await tasks.getByText('Read transcript',{exact:true}).click();
 await tasks.locator('.meeting-task-transcript p').filter({hasText:'Automatically retrieved meeting transcript.'}).waitFor();
 await tasks.getByRole('button',{name:'Check Status: Linda AI product discussion',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('.workspace-meetings button:disabled')?.textContent==='Checking…'||[...document.querySelectorAll('.workspace-meetings button:disabled')].some(x=>x.textContent==='Checking…'));
 assert.equal(await tasks.locator('button:not(:disabled)').count(),0);
 assert.match(prompts[1],/request meeting-one/);assert.doesNotMatch(prompts[1],/meeting-two/);
 assert.equal(await page.locator('.message-user').filter({hasText:'request meeting-one'}).count(),1);
 release();
 await tasks.locator('li').filter({hasText:'Linda AI product discussion'}).getByText('Transcript available',{exact:true}).waitFor();
 await tasks.getByRole('button',{name:'Check Status: Linda AI product discussion',exact:true}).waitFor();
 assert.deepEqual(errors,[]);
 await page.screenshot({path:`/tmp/wikshi-meeting-tasks-${width}.png`});
 console.log(`${width}px: meeting tasks, explicit status prompt, loading, transcript, email label, call banner passed`);
 await page.close();
}}finally{await browser.close();}
