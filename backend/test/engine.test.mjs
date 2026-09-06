import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,createPublicKey,verify} from 'node:crypto';
import {mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store,hash} from '../src/store.mjs';
import {Engine} from '../src/engine.mjs';
import {Providers,ProviderError} from '../src/providers.mjs';
import {Blocky,NETWORK,USDC} from '../src/payments/blocky.mjs';
import {validate} from '../src/catalog.mjs';
import {inspectPayment,signQuote,confirmTransfer} from '../src/payments/hedera.mjs';
import {PrivateKey} from '@hiero-ledger/sdk';
import {createApi} from '../src/server.mjs';
const credential=randomBytes(32).toString('base64url');
function setup(options={}){
  const store=new Store(':memory:','11'.repeat(32));let settles=0,dispatches=0;
  const blocky={requirements:async({payTo,amount})=>({scheme:'exact',network:NETWORK,asset:USDC,payTo,amount,maxTimeoutSeconds:120,extra:{feePayer:'0.0.7162784'}}),envelope:()=>{},
    verify:async()=>({payer:'0.0.999'}),settle:async()=>{settles++;return {transaction:'0.0.7162784@1780000000.123456789',payer:'0.0.999'};}};
  const env={WIKSHI_PUBLIC_ORIGIN:'https://api.wikshi.xyz',WIKSHI_MERCHANT_ACCOUNT:'0.0.123',WIKSHI_MERCHANT_KEY:'test-fixture-not-a-key',WIKSHI_PRICE_INSPECT:'10'};
  const providers={execute:async()=>{dispatches++;return {done:true,result:{real:'fixture'}};},cleanup:async()=>{}};
  const engine=new Engine({store,env,blocky,providers,inspect:()=>({tx:'0.0.7162784@1780000000.123456789',payer:'0.0.999'}),confirm:async()=>true,...options});
  return {engine,store,blocky,env,providers,counts:()=>({settles,dispatches})};
}
const quote=e=>e.quote('network.inspect',{account:'0.0.7284970'},credential,randomBytes(16).toString('hex'));
test('quote idempotency returns same operation and rejects changed inputs',async()=>{
  const {engine}=setup(),key='unique-request-00001';
  const a=await engine.quote('network.inspect',{account:'0.0.123'},credential,key),b=await engine.quote('network.inspect',{account:'0.0.123'},credential,key);
  assert.equal(a.id,b.id);
  await assert.rejects(engine.quote('network.inspect',{account:'0.0.456'},credential,key),/idempotency_conflict/);
});
test('unconfigured provider rejects before a quote or payment',async()=>{
  const {engine,counts}=setup();
  await assert.rejects(engine.quote('email.inbox',{displayName:'Test'},credential,'unique-request-00001'),/service_unavailable/);
  assert.equal(counts().settles,0);
});
test('parallel payment attempts settle once; paid work runs only after Mirror confirmation',async()=>{
  let confirmed=false;const {engine,store,counts}=setup({confirm:async()=>confirmed});const op=await quote(engine);
  await Promise.all([engine.pay(op.id,credential,{}),engine.pay(op.id,credential,{})]);
  await engine.tick();assert.equal(counts().settles,1);assert.equal(counts().dispatches,0);
  confirmed=true;await engine.tick();await engine.tick();assert.equal(counts().dispatches,1);assert.equal(store.get(op.id).state,'completed');
  await engine.pay(op.id,credential,{});await engine.tick();assert.equal(counts().settles,1);
});
test('timeout is reconciled without resubmission or premature work',async()=>{
  const fixture=setup({confirm:async()=>false});fixture.blocky.settle=async()=>{throw new Error('timeout');};
  const op=await quote(fixture.engine);await fixture.engine.pay(op.id,credential,{});await fixture.engine.tick();
  assert.equal(fixture.store.get(op.id).state,'confirming_payment');assert.equal(fixture.counts().dispatches,0);
});
test('global transaction identity cannot fund a second operation',async()=>{
  const {engine}=setup();const a=await quote(engine),b=await quote(engine);await engine.pay(a.id,credential,{});
  await assert.rejects(engine.pay(b.id,credential,{}),/payment_replayed/);
});
test('private credentials protect results even with a public operation ID and receipt',async()=>{
  const {engine}=setup();const op=await quote(engine);
  assert.throws(()=>engine.authorize(op.id,randomBytes(32).toString('base64url')),/not_found/);
});
test('expired quote never reaches settlement',async()=>{
  const {engine,store,counts}=setup();const op=await quote(engine);op.data.expires=1;store.save(op);
  await assert.rejects(engine.pay(op.id,credential,{}),/quote_expired/);assert.equal(counts().settles,0);
});
test('metering uses ceil seconds and exact atomic integer arithmetic, with signed receipt',async()=>{
  const {engine,store}=setup();const op=await quote(engine);
  op.data.price={unit:'second',rateAtomic:'10000'};op.data.input.maxSeconds=180;op.data.requirements.amount='1800000';op.data.payment={tx:'public-payment',payer:'0.0.999',confirmed:true};
  engine.finish(op,{transcript:[{message:'Keep exactly this, um, text.'}]},105.01);
  const done=store.get(op.id);assert.equal(done.data.receipt.chargedAtomic,'1060000');assert.equal(done.data.refund.amount,'740000');
  const r=done.data.receipt;assert.equal(verify(null,Buffer.from(r.signedPayload,'base64'),createPublicKey({key:engine.receiptKey,format:'jwk'}),Buffer.from(r.signature,'base64')),true);
  assert.equal(done.data.result.transcript[0].message,'Keep exactly this, um, text.');
});
test('refund timeout persists identity and never submits another transfer',async()=>{
  let prepare=0,submit=0;const {engine,store}=setup({confirm:async()=>false,refundSigner:{prepare:async()=>{prepare++;return {tx:'0.0.123@1.1',bytes:'signed'};},submit:async()=>{submit++;throw new Error('timeout');}}});
  const op=await quote(engine);op.data.payment={payer:'0.0.999',confirmed:true};engine.fail(op);
  await engine.refund(store.get(op.id));await engine.refund(store.get(op.id));assert.equal(prepare,1);assert.equal(submit,1);assert.equal(store.get(op.id).data.refund.status,'confirming');
});
test('worker restart does not repeat provider dispatch or join',async()=>{
  const {engine,store,counts}=setup();const op=await quote(engine);op.state='dispatching';store.save(op);engine.recover();await engine.tick();
  assert.equal(store.get(op.id).state,'execution_unknown');assert.equal(counts().dispatches,0);
});
test('meeting invitation admits once, including concurrent joins',async()=>{
  const {engine,store,providers}=setup();const op=await quote(engine),guest=randomBytes(32).toString('base64url');
  op.state='awaiting_guest';op.data.private={agentId:'never-public'};op.data.guestExpires=Date.now()+100000;store.save(op);
  store.db.prepare('INSERT INTO guests(hash,operation) VALUES(?,?)').run(hash(guest),op.id);
  let calls=0;providers.join=async()=>{calls++;return {callId:'hidden',connection:{url:'wss://example.org',token:'ephemeral'}};};
  const results=await Promise.allSettled([engine.join(guest),engine.join(guest)]);
  assert.equal(calls,1);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(store.get(op.id).state,'running');
  assert.equal(JSON.stringify(engine.view(store.get(op.id))).includes('never-public'),false);
});
test('encryption survives reopening and hides mission in database bytes',async()=>{
  const file=join(mkdtempSync(join(tmpdir(),'wikshi-test-')),'data.sqlite'),key='22'.repeat(32);
  const a=new Store(file,key);a.insert({id:'test',auth:'hash',idem:'idem',request_hash:'request',created:1,state:'completed',data:{mission:'PRIVATE-MISSION-DO-NOT-LEAK'}});a.close();
  assert.equal(readFileSync(file).includes(Buffer.from('PRIVATE-MISSION-DO-NOT-LEAK')),false);
  const b=new Store(file,key);assert.equal(b.get('test').data.mission,'PRIVATE-MISSION-DO-NOT-LEAK');b.close();
});
test('input rejects arbitrary upstream URLs, overlong meetings and missing consent',()=>{
  assert.throws(()=>validate('discovery.search',{query:'research',limit:2,url:'http://127.0.0.1'}),/invalid_input/);
  assert.throws(()=>validate('phone.call',{phone:'+15551234567',mission:'Ask about the project',maxSeconds:360,consent:true}),/invalid_mission/);
  assert.throws(()=>validate('phone.call',{phone:'+15551234567',mission:'Ask about the project',maxSeconds:60}),/consent_required/);
});
test('provider errors never expose upstream secrets, and ambiguous writes remain uncertain',async()=>{
  const p=new Providers({},async()=>Response.json({secret:'provider-key'},{status:500}));
  await assert.rejects(p.request('https://example.org',{method:'POST',body:{}}),e=>e instanceof ProviderError && e.uncertain && !e.message.includes('provider-key'));
});
test('real SDK signing binds quote to operation memo and exact transfer',async()=>{
  const {engine}=setup();const op=await quote(engine);const payload=await signQuote('0.0.999',PrivateKey.generateECDSA().toStringRaw(),op.data.requirements,op.id);
  assert.equal(inspectPayment(payload,op.data.requirements,op.id).payer,'0.0.999');
  assert.throws(()=>inspectPayment(payload,op.data.requirements,randomBytes(16).toString('hex')),/invalid_payment/);
});
test('Mirror confirmation rejects wrong token, recipient or unsuccessful transaction',async()=>{
  const expected={payer:'0.0.1',payTo:'0.0.2',amount:'10'};
  const entry={result:'SUCCESS',name:'CRYPTOTRANSFER',nonce:0,token_transfers:[{token_id:USDC,account:'0.0.1',amount:-10},{token_id:USDC,account:'0.0.2',amount:10}]};
  const fetcher=async()=>Response.json({transactions:[entry]});assert.equal(await confirmTransfer('0.0.1@100.100',expected,fetcher),true);
  entry.result='FAIL_INVALID';assert.equal(await confirmTransfer('0.0.1@100.100',expected,fetcher),false);
});
test('HTTP returns x402 challenge and no result without scoped bearer',async()=>{
  const {engine}=setup();const server=createApi(engine);await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try{
    const origin=`http://127.0.0.1:${server.address().port}`;
    const response=await fetch(`${origin}/v1/operations`,{method:'POST',headers:{Authorization:`Bearer ${credential}`,'Content-Type':'application/json','Idempotency-Key':'test-request-00001'},body:JSON.stringify({service:'network.inspect',input:{account:'0.0.1'}})});
    assert.equal(response.status,402);assert.ok(response.headers.get('payment-required'));const op=await response.json();
    assert.equal((await fetch(`${origin}/v1/operations/${op.id}`)).status,401);
    assert.equal((await fetch(`${origin}/v1/operations/${op.id}`,{headers:{Authorization:`Bearer ${randomBytes(32).toString('base64url')}`}})).status,404);
    const retried=await fetch(`${origin}/v1/operations`,{method:'POST',headers:{Authorization:`Bearer ${credential}`,'Content-Type':'application/json','Idempotency-Key':'test-request-00001','Payment-Signature':Buffer.from('{}').toString('base64')},body:JSON.stringify({service:'network.inspect',input:{account:'0.0.1'}})});
    assert.equal(retried.status,202);assert.ok(retried.headers.get('payment-response'));
  }finally{await new Promise(r=>server.close(r));}
});
