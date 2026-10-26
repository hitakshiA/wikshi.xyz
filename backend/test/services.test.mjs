import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,randomUUID} from 'node:crypto';
import {mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../src/store.mjs';
import {Providers} from '../src/providers.mjs';
import {catalog,validate} from '../src/catalog.mjs';
import {verifyWebhook,receiveEmail} from '../src/inbound.mjs';
const env={WIKSHI_EMAIL_READY:'true',WIKSHI_EMAIL_DOMAIN:'mail.wikshi.xyz',RESEND_API_KEY:'fixture',RESEND_WEBHOOK_SECRET:`whsec_${Buffer.alloc(32,7).toString('base64')}`};
const makeStore=()=>new Store(':memory:','12'.repeat(32));
function signed(event,id='msg_fixture',time=Math.floor(Date.now()/1000)){
  const raw=Buffer.from(JSON.stringify(event));
  return {raw,headers:{'svix-id':id,'svix-timestamp':String(time),'svix-signature':`v1,${createHmac('sha256',Buffer.alloc(32,7)).update(`${id}.${time}.`).update(raw).digest('base64')}`}};
}
test('payer inbox survives restart; payments and credentials never change its address',()=>{
  const path=join(mkdtempSync(join(tmpdir(),'wikshi-inbox-')),'db.sqlite');let store=new Store(path,'12'.repeat(32));
  const p=new Providers(env);store.bindPayer('auth-one','0.0.111');
  const first=p.provisionInbox('0.0.111','auth-one',store);
  store.putMessage(first.id,'inbound:one',{text:'Private unique body'});store.close();
  store=new Store(path,'12'.repeat(32));store.bindPayer('auth-two','0.0.111');
  const second=p.provisionInbox('0.0.111','auth-two',store);
  assert.equal(second.address,first.address);assert.equal(second.id,first.id);
  assert.equal(store.resource(first.id,'auth-two').address,first.address);
  assert.equal(store.messages(first.id)[0].text,'Private unique body');
  assert.equal(store.resource(first.id,'stranger'),null);assert.deepEqual(store.inboxes('stranger'),[]);
  const other=p.provisionInbox('0.0.222','different-auth',store);assert.notEqual(other.id,first.id);
  assert.equal(store.resource(first.id,'different-auth'),null);store.close();
  assert.equal(readFileSync(path).includes(Buffer.from('Private unique body')),false);
});
test('one chat retains its inbox across wallet and sponsor payers without extra grants or provisioning',()=>{
  const store=makeStore(),providers=new Providers(env);
  store.bindPayer('wallet-owner','0.0.111');store.bindPayer('sponsor-owner','0.0.222');
  const wallet=providers.provisionInbox('0.0.111','wallet-owner',store),sponsor=providers.provisionInbox('0.0.222','sponsor-owner',store);
  store.bindPayer('one-chat','0.0.111');store.bindPayer('one-chat','0.0.222');store.bindPayer('one-chat','0.0.333');
  assert.deepEqual(store.inboxes('one-chat'),[]);
  providers.provisionInbox('0.0.111','one-chat',store);
  assert.deepEqual(store.inboxes('one-chat').map(box=>box.id),[wallet.id]);
  assert.equal(providers.provisionInbox('0.0.222','one-chat',store).id,wallet.id);
  assert.equal(providers.provisionInbox('0.0.333','one-chat',store).id,wallet.id);
  assert.equal(store.payerInbox('0.0.333'),null);
  assert.equal(store.resource(sponsor.id,'one-chat'),null);
  assert.equal(store.resource(wallet.id,'sponsor-owner'),null);
  const third=providers.provisionInbox('0.0.333','different-chat',store);
  assert.notEqual(third.id,wallet.id);
  assert.equal(store.resource(third.id,'one-chat'),null);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM payer_inboxes').get().n,3);
});
test('racing explicit inbox provisions for one credential reuse the first durable record',async()=>{
  const store=makeStore(),providers=new Providers(env);
  store.bindPayer('one-chat','0.0.111');store.bindPayer('one-chat','0.0.222');
  const [first,second]=await Promise.all(['0.0.111','0.0.222'].map(payer=>Promise.resolve().then(()=>providers.provisionInbox(payer,'one-chat',store))));
  assert.equal(first.id,second.id);
  assert.equal(store.inboxes('one-chat').length,1);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM resources').get().n,1);
});
test('historical implicit grants do not expose inboxes; stored messages are preserved',()=>{
  const store=makeStore(),providers=new Providers(env);
  const first=providers.provisionInbox('0.0.111','first-owner',store),second=providers.provisionInbox('0.0.222','second-owner',store);
  for(const inbox of [first,second])store.db.prepare('INSERT INTO resource_grants VALUES(?,?)').run(inbox.id,'legacy-chat');
  store.putMessage(second.id,'preserved-history',{text:'Still accessible'});
  store.bindPayer('legacy-chat','0.0.333');
  assert.deepEqual(store.inboxes('legacy-chat'),[]);
  assert.equal(store.primaryInbox('legacy-chat'),null);
  assert.equal(store.messages(second.id)[0].text,'Still accessible');
  assert.equal(store.resource(second.id,'legacy-chat'),null);
});
test('explicit inbox creation requires mail readiness and a quoted price; voice requires configuration',()=>{
  const entries=catalog({...env,WIKSHI_MERCHANT_ACCOUNT:'0.0.1',WIKSHI_MERCHANT_KEY:'fixture',WIKSHI_PRICE_INBOX:'1',WIKSHI_PRICE_PHONE_SECOND:'1',AGENTPHONE_API_KEY:'fixture'});
  assert.equal(entries.length,14);assert.equal(entries.find(s=>s.id==='email.inbox').enabled,true);
  const ready={...env,WIKSHI_MERCHANT_ACCOUNT:'0.0.1',WIKSHI_MERCHANT_KEY:'fixture',WIKSHI_PRICE_INBOX:'1'};
  for(const field of ['RESEND_API_KEY','RESEND_WEBHOOK_SECRET','WIKSHI_EMAIL_READY','WIKSHI_EMAIL_DOMAIN','WIKSHI_PRICE_INBOX'])assert.equal(catalog({...ready,[field]:''}).find(s=>s.id==='email.inbox').enabled,false,field);
  assert.equal(catalog({...ready,WIKSHI_EMAIL_DOMAIN:'invalid'}).find(s=>s.id==='email.inbox').enabled,false);
  assert.equal(catalog({...ready,WIKSHI_PRICE_INBOX:'',WIKSHI_PRICE_INBOX_HBAR:'100'}).find(s=>s.id==='email.inbox').enabled,true);
  const fallback=catalog({...ready,WIKSHI_PRICE_INBOX:'',WIKSHI_PRICE_EMAIL:'7',WIKSHI_PRICE_EMAIL_HBAR:'1000'}).find(s=>s.id==='email.inbox');
  assert.deepEqual(fallback.prices.map(price=>price.rateAtomic),['7','1000']);assert.equal(fallback.rateAtomic,'7');
  const dedicated=catalog({...ready,WIKSHI_PRICE_INBOX:'9',WIKSHI_PRICE_EMAIL:'7',WIKSHI_PRICE_EMAIL_HBAR:'1000'}).find(s=>s.id==='email.inbox');
  assert.deepEqual(dedicated.prices.map(price=>price.rateAtomic),['9','1000']);
  assert.equal(catalog({...ready,WIKSHI_PRICE_INBOX:'invalid',WIKSHI_PRICE_EMAIL:'7'}).find(s=>s.id==='email.inbox').enabled,false);
  assert.equal(entries.find(s=>s.id==='phone.call').availabilityReason,'configuration_required');
  assert.equal(new Providers({}).provisionInbox('0.0.1','auth',makeStore()),null);
});
test('documented Exa categories and contents use distinct bounded contracts',async()=>{
  const requests=[];const p=new Providers({},async(url,options)=>{requests.push({url,body:JSON.parse(options.body)});return Response.json({results:[{title:'Source',url:'https://example.com',text:'Untrusted text',secret:'hidden'}]});});
  for(const service of ['discovery.search','discovery.people','discovery.companies','discovery.contents']){
    const input=validate(service,service==='discovery.contents'?{urls:['https://example.com']}:{query:'find relevant companies',limit:3});
    const result=await p.execute({data:{service,input}});assert.equal(JSON.stringify(result).includes('hidden'),false);
  }
  assert.equal(requests[1].body.category,'people');assert.equal(requests[2].body.category,'company');
  assert.equal(requests[3].url,'https://api.exa.ai/contents');assert.deepEqual(requests[3].body.ids,['https://example.com']);assert.equal(requests[3].body.contents,undefined);
  for(const url of ['http://example.com','https://127.0.0.1','https://a:b@example.com','https://host.internal'])assert.throws(()=>validate('discovery.contents',{urls:[url]}));
});
test('QuickEnrich lookup routes use bearer headers and omit account credit metadata',async()=>{
  const requests=[];const p=new Providers({QUICKENRICH_API_KEY:'private-key'},async(url,options)=>{requests.push({url,options});return Response.json({success:true,data:{email:'a@example.com',employee_phone:'N/A',first_name:'A'},meta:{remaining_credits:12345}});});
  for(const [service,input,path] of [
    ['contacts.enrich',{firstName:'A',lastName:'B',domain:'example.com'},'search'],
    ['contacts.phone',{linkedinUrl:'https://linkedin.com/in/person'},'phone-search'],
    ['contacts.reverse',{email:'a@example.com'},'email-search'],
    ['contacts.company',{domain:'example.com',page:1},'dataset-search'],
  ]){
    const result=await p.execute({data:{service,input:validate(service,input)}});
    assert.equal(new URL(requests.at(-1).url).pathname,`/api/employees/${path}`);
    assert.equal(requests.at(-1).options.headers.Authorization,'Bearer private-key');
    assert.equal(requests.at(-1).url.includes('private-key'),false);assert.equal(JSON.stringify(result).includes('12345'),false);assert.equal(result.result.contacts[0].phone,null);
  }
});
test('webhook verification rejects tamper and stale timestamps; official Svix vector passes',()=>{
  const {raw,headers}=signed({type:'email.received'});assert.equal(verifyWebhook(raw,headers,env.RESEND_WEBHOOK_SECRET).id,'msg_fixture');
  assert.throws(()=>verifyWebhook(Buffer.from('{}'),headers,env.RESEND_WEBHOOK_SECRET));
  const old=signed({},'msg_old',1);assert.throws(()=>verifyWebhook(old.raw,old.headers,env.RESEND_WEBHOOK_SECRET));
  const result=verifyWebhook(Buffer.from('{"event_type":"ping","data":{"success":true}}'),{'svix-id':'msg_loFOjxBNrRLzqYUf','svix-timestamp':'1731705121','svix-signature':'v1,rAvfW3dJ/X/qxhsaXPOyyCGmRKsaKWcsNccKXlIktD0='},'whsec_plJ3nmyCDGBKInavdOK15jsl',1731705121000);
  assert.equal(result.event.data.success,true);
});
test('signed inbound events persist once, isolate inboxes and hide raw download URLs',async()=>{
  const store=makeStore(),p=new Providers(env),inbox=p.provisionInbox('0.0.111','owner',store),other=p.provisionInbox('0.0.222','other',store),source=randomUUID();
  let reads=0;p.mail=async()=>{reads++;return {id:source,to:[inbox.address],from:'a@example.com',text:'Original words, um.',subject:'Hello',message_id:'<original@example.com>',raw:{download_url:'secret-url'},attachments:[]};};
  const event=signed({type:'email.received',data:{email_id:source,to:[inbox.address]}});
  const engine={store,env,providers:p};await receiveEmail(engine,event.raw,event.headers);await receiveEmail(engine,event.raw,event.headers);
  assert.equal(reads,1);assert.equal(store.messages(inbox.id).length,1);assert.equal(store.messages(other.id).length,0);
  assert.equal(store.messages(inbox.id)[0].text,'Original words, um.');assert.equal(JSON.stringify(store.messages(inbox.id)).includes('secret-url'),false);
  const again=signed({type:'email.received',data:{email_id:source,to:[inbox.address]}},'msg_second');await receiveEmail(engine,again.raw,again.headers);assert.equal(store.messages(inbox.id).length,1);
});
test('failed inbound retrieval is retryable and never acknowledges lost email',async()=>{
  const store=makeStore(),p=new Providers(env),inbox=p.provisionInbox('0.0.111','owner',store);
  p.mail=async()=>{throw new Error('transient');};const event=signed({type:'email.received',data:{email_id:randomUUID(),to:[inbox.address]}});
  await assert.rejects(receiveEmail({store,env,providers:p},event.raw,event.headers));
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM mail_events').get().n,0);
});
test('Resend send and reply use owned address, idempotency and original thread header',async()=>{
  const store=makeStore(),requests=[],p=new Providers(env,async(url,options)=>{requests.push({url,options,body:JSON.parse(options.body)});return Response.json({id:'private-transport-id'});});
  const inbox=p.provisionInbox('0.0.111','owner',store);
  const messageId=store.putMessage(inbox.id,'inbound:a',{direction:'inbound',from:'a@example.com',subject:'Question',text:'Hello',rfcMessageId:'<original@example.com>'});
  const op={id:randomUUID(),auth:'owner',data:{service:'email.reply',input:{inboxId:inbox.id,messageId,text:'My answer'}}};
  const result=await p.execute(op,store);assert.equal(requests[0].url,'https://api.resend.com/emails');
  assert.equal(requests[0].body.from,`Wikshi agent <${inbox.address}>`);assert.equal(requests[0].body.headers['In-Reply-To'],'<original@example.com>');
  assert.equal(requests[0].options.headers['Idempotency-Key'],op.id);assert.equal(JSON.stringify(result).includes('private-transport-id'),false);
  await assert.rejects(p.execute({...op,auth:'stranger'},store));
});
test('private message pagination does not skip same-millisecond arrivals',()=>{
  const store=makeStore();for(let i=0;i<43;i++)store.putMessage('inbox',String(i),{text:String(i)});
  const first=store.messages('inbox'),second=store.messages('inbox',first.at(-1).cursor),third=store.messages('inbox',second.at(-1).cursor);
  assert.equal(new Set([...first,...second,...third].map(m=>m.id)).size,43);
});
test('legacy address upgrade preserves aliases, messages and private ownership',()=>{
  const store=makeStore(),p=new Providers(env),id=randomUUID();
  const old={id,kind:'inbox',address:`agent-${id.replaceAll('-','')}@mail.wikshi.xyz`,displayName:'Wikshi agent'};
  store.createPayerInbox('0.0.111','owner',old);store.putMessage(id,'old-thread',{text:'Keep this'});
  const fresh=p.provisionInbox('0.0.111','owner',store);
  assert.match(fresh.address,/^hello-[a-f0-9]{8}@/);
  assert.equal(store.inboxForAddress(old.address).id,id);assert.equal(store.inboxForAddress(fresh.address).id,id);
  assert.equal(store.messages(id)[0].text,'Keep this');assert.equal(store.resource(id,'stranger'),null);
  const other=p.provisionInbox('0.0.222','other',store);
  assert.throws(()=>store.renameInbox('0.0.222',old.address),/address_unavailable/);
  assert.equal(store.payerInbox('0.0.222').address,other.address);
});
test('video quotes require explicit confirmed API entitlement',()=>{
  const config={BEY_API_KEY:'fixture',BEY_AVATAR_ID:'fixture',WIKSHI_PRICE_VIDEO_SECOND:'1',WIKSHI_MERCHANT_ACCOUNT:'0.0.123',WIKSHI_MERCHANT_KEY:'fixture'};
  assert.equal(catalog(config).find(s=>s.id==='video.meeting').enabled,false);
  assert.equal(catalog({...config,WIKSHI_VIDEO_API_READY:'true'}).find(s=>s.id==='video.meeting').enabled,true);
  assert.equal(catalog({...config,WIKSHI_VIDEO_MODE:'hosted'}).find(s=>s.id==='video.meeting').enabled,true);
});
test('phone adapter never requests hangup, even after an old persisted deadline',async()=>{
  const requests=[],p=new Providers({},async(url,options)=>{requests.push({url,method:options.method});return Response.json({status:'in-progress'});});
  assert.equal(await p.poll({data:{service:'phone.call',private:{callId:'call_test',deadline:1}}}),null);
  assert.equal(requests.length,1);assert.equal(requests[0].method,'GET');assert.ok(!requests[0].url.endsWith('/end'));
});
test('hosted discovery uses only the dedicated agent and never creates a programmatic call',async()=>{
  const requests=[],p=new Providers({},async(url,options)=>{requests.push({url,method:options.method});return Response.json({data:[{id:'other',agent_id:'unrelated',status:{type:'completed',started_at:'2026-09-06T00:00:00Z'}},{id:'ours',agent_id:'dedicated',status:{type:'ongoing',started_at:'2026-09-06T01:00:00Z'}}],has_more:false});});
  assert.equal(await p.findHostedCall({data:{private:{agentId:'dedicated'}}}),'ours');assert.equal(requests[0].method,'GET');
});
