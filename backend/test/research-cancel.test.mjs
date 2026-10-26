import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createPublicKey,verify} from 'node:crypto';
import {Store,hash} from '../src/store.mjs';
import {Engine} from '../src/engine.mjs';
import {Providers} from '../src/providers.mjs';
import {createApi} from '../src/server.mjs';

const credential=randomBytes(32).toString('base64url');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function setup({state='queued',confirmed=true,asset='0.0.429274',service='discovery.search',execute=async()=>({done:true,result:{results:[{title:'Actual result'}]}})}={}){
  const store=new Store(':memory:','65'.repeat(32)),id=randomUUID(),start=Date.now(),counts={prepare:0,submit:0,settle:0,dispatch:0},confirmations=[];
  let mirror=confirmed;
  const op={id,auth:hash(credential),idem:randomUUID(),request_hash:'fixture',state,created:start,data:{service,input:{query:'Research companies',limit:3},expires:start+300000,requirements:{asset,amount:'1000',payTo:'0.0.123'},price:{unit:'request',rateAtomic:'1000'}}};
  if(state!=='awaiting_payment'){Object.assign(op.data,{researchStartedAt:start,researchDeadlineAt:start+120000,payment:{payer:'0.0.999',tx:'0.0.999@1.1',confirmed}});}
  store.insert(op);
  const blocky={envelope(){},verify:async()=>({payer:'0.0.999'}),settle:async()=>{counts.settle++;return {payer:'0.0.999',transaction:'0.0.999@1.1'};}};
  const engine=new Engine({store,env:{WIKSHI_MERCHANT_ACCOUNT:'0.0.123'},providers:{execute:async(...args)=>{counts.dispatch++;return execute(...args);}},blocky,
    inspect:()=>({payer:'0.0.999',tx:'0.0.999@1.1'}),confirm:async(tx,args)=>{confirmations.push({tx,...args});return tx.startsWith('refund-')?true:mirror;},
    refundSigner:{prepare:async(payer,amount,operation,paidAsset)=>{counts.prepare++;assert.equal(paidAsset,asset);assert.equal(amount,'1000');return {tx:`refund-${operation}`,bytes:'signed-fixture'};},submit:async()=>{counts.submit++;}}});
  engine.services=()=>[{id:service,enabled:true}];
  return {engine,store,op,blocky,counts,confirmations,setMirror:value=>mirror=value,close:()=>{for(const timer of engine.researchTimers.values())clearTimeout(timer);store.close();}};
}

for(const asset of ['0.0.429274','0.0.0'])test(`${asset}: paid research cancellation signs zero charge and refunds once in the paid asset`,async()=>{
  const f=setup({asset});
  try{
    const cancelled=await f.engine.cancel(f.op.id,credential);
    assert.equal(cancelled.state,'cancelled');assert.equal(cancelled.data.cancellation.paymentStatus,'confirmed');
    assert.equal(cancelled.data.receipt.chargedAtomic,'0');assert.equal(cancelled.data.receipt.refundDueAtomic,'1000');
    const receipt=cancelled.data.receipt;
    assert.equal(verify(null,Buffer.from(receipt.signedPayload,'base64'),createPublicKey({key:f.engine.receiptKey,format:'jwk'}),Buffer.from(receipt.signature,'base64')),true);
    assert.equal(receipt.asset,asset);assert.equal(receipt.outcome,'cancelled');
    await Promise.all([f.engine.cancel(f.op.id,credential),f.engine.reconcileResearchCancellations(),f.engine.refund(f.store.get(f.op.id)),f.engine.tick()]);
    await f.engine.reconcileResearchCancellations();
    const saved=f.store.get(f.op.id);assert.equal(saved.state,'cancelled');assert.equal(saved.data.refund.status,'confirmed');
    assert.equal(f.counts.prepare,1);assert.equal(f.counts.submit,1);assert.equal(f.counts.dispatch,0);
    assert.equal(saved.data.receipt.signature,receipt.signature);
  }finally{f.close();}
});

test('payment claim publishes a durable 120-second deadline, never a quote-time countdown',async()=>{
  const wait=deferred(),f=setup({state:'awaiting_payment',confirmed:false});
  f.blocky.verify=()=>wait.promise;
  try{
    assert.equal(f.engine.view(f.op).researchDeadlineAt,undefined);
    const payment=f.engine.pay(f.op.id,credential,{}),claimed=f.store.get(f.op.id),view=f.engine.view(claimed);
    assert.equal(claimed.data.researchDeadlineAt-claimed.data.researchStartedAt,120000);
    assert.equal(Date.parse(view.researchDeadlineAt)-Date.parse(view.researchStartedAt),120000);
    await f.engine.cancel(f.op.id,credential);wait.resolve({payer:'0.0.999'});await payment;await f.engine.reconcileResearchCancellations();
    assert.equal(f.counts.settle,0);assert.equal(f.store.get(f.op.id).state,'cancelled');
    assert.equal(f.store.get(f.op.id).data.cancellation.paymentStatus,'confirmation_pending');assert.equal(f.store.get(f.op.id).data.refund,undefined);
  }finally{f.close();}
});

test('late verification failure cannot overwrite cancellation or invent a refund',async()=>{
  const wait=deferred(),f=setup({state:'awaiting_payment',confirmed:false});f.blocky.verify=()=>wait.promise;
  try{
    const payment=f.engine.pay(f.op.id,credential,{});await f.engine.cancel(f.op.id,credential);wait.reject(Error('late rejection'));await payment;
    await f.engine.reconcileResearchCancellations();
    assert.equal(f.store.get(f.op.id).state,'cancelled');assert.equal(f.store.get(f.op.id).data.receipt,undefined);assert.equal(f.counts.settle,0);
  }finally{f.close();}
});

test('cancel during settlement preserves intent until independent confirmation and then refunds',async()=>{
  const settled=deferred(),entered=deferred(),f=setup({state:'awaiting_payment',confirmed:false});
  f.blocky.settle=()=>{f.counts.settle++;entered.resolve();return settled.promise;};
  try{
    const payment=f.engine.pay(f.op.id,credential,{});await entered.promise;
    await f.engine.cancel(f.op.id,credential);await f.engine.reconcileResearchCancellations();
    assert.equal(f.store.get(f.op.id).data.refund,undefined);
    f.setMirror(true);settled.resolve({payer:'0.0.999',transaction:'0.0.999@1.1'});await payment;await f.engine.reconcileResearchCancellations();
    const saved=f.store.get(f.op.id);assert.equal(saved.state,'cancelled');assert.equal(saved.data.payment.confirmed,true);
    assert.equal(saved.data.receipt.chargedAtomic,'0');assert.equal(saved.data.refund.status,'confirmed');assert.equal(f.counts.settle,1);assert.equal(f.counts.submit,1);
  }finally{f.close();}
});

test('late Mirror response cannot requeue a cancelled operation',async()=>{
  const mirror=deferred(),f=setup({state:'confirming_payment',confirmed:false});f.engine.confirm=async()=>mirror.promise;
  try{
    const confirmation=f.engine.reconcilePayment(f.op);await Promise.resolve();await f.engine.cancel(f.op.id,credential);
    mirror.resolve(true);await confirmation;await f.engine.reconcileResearchCancellations();
    assert.equal(f.store.get(f.op.id).state,'cancelled');assert.equal(f.store.get(f.op.id).data.receipt.chargedAtomic,'0');assert.equal(f.counts.dispatch,0);
  }finally{f.close();}
});

test('deadline timer cancels and refunds without polling even while provider ignores abort',async()=>{
  const provider=deferred(),entered=deferred();let signal;
  const f=setup({execute:async(op,store,options)=>{signal=options.signal;entered.resolve();return provider.promise;}});
  try{
    const work=f.engine.tick();await entered.promise;
    const op=f.store.get(f.op.id);op.data.researchDeadlineAt=Date.now()+25;f.store.save(op);f.engine.armResearchDeadline(op);
    await delay(60);await f.engine.reconcileResearchCancellations();
    const saved=f.store.get(op.id);assert.equal(saved.state,'cancelled');assert.equal(saved.data.cancellation.reason,'timeout');assert.equal(saved.data.refund.status,'confirmed');
    assert.equal(f.engine.busy,true);assert.equal(signal.aborted,true);
    provider.resolve({done:true,result:{results:[{title:'Too late'}]}});await work;
    assert.equal(f.store.get(op.id).state,'cancelled');assert.equal(f.store.get(op.id).data.result,null);assert.equal(f.counts.submit,1);
  }finally{f.close();}
});

test('late provider callbacks check stored deadline even if its timer did not run',async()=>{
  for(const reject of [false,true]){
    const provider=deferred(),entered=deferred(),f=setup({execute:async()=>{entered.resolve();return provider.promise;}});
    try{
      const work=f.engine.dispatch(f.op);await entered.promise;
      const op=f.store.get(f.op.id);op.data.researchDeadlineAt=Date.now()-1;f.store.save(op);
      if(reject)provider.reject(Error('late failure'));else provider.resolve({done:true,result:{results:[{title:'Late'}]}});
      await work;await f.engine.reconcileResearchCancellations();
      assert.equal(f.store.get(op.id).state,'cancelled');assert.equal(f.store.get(op.id).data.cancellation.reason,'timeout');assert.equal(f.store.get(op.id).data.receipt.chargedAtomic,'0');
    }finally{f.close();}
  }
});

test('a late poll from a running research operation cannot resurrect its cancelled snapshot',async()=>{
  const poll=deferred(),entered=deferred(),f=setup({state:'running',service:'contacts.enrich'});
  f.engine.providers.poll=async()=>{entered.resolve();return poll.promise;};
  try{
    const work=f.engine.tick();await entered.promise;
    await f.engine.cancel(f.op.id,credential);await f.engine.reconcileResearchCancellations();
    const receipt=f.store.get(f.op.id).data.receipt;
    poll.resolve({seconds:10,transcript:[{text:'Late answer'}]});await work;
    const saved=f.store.get(f.op.id);assert.equal(saved.state,'cancelled');assert.equal(saved.data.receipt.signature,receipt.signature);
    assert.equal(saved.data.receipt.chargedAtomic,'0');assert.equal(saved.data.result,null);assert.equal(saved.data.refund.status,'confirmed');
  }finally{f.close();}
});

test('restart preserves deadline and cancelled liabilities without repeating refund submission',async()=>{
  const f=setup();
  try{
    let op=f.store.get(f.op.id);op.data.researchDeadlineAt=Date.now()-1;op.state='dispatching';f.store.save(op);
    f.engine.recover();await f.engine.reconcileResearchCancellations();
    assert.equal(f.store.get(op.id).state,'cancelled');assert.equal(f.store.get(op.id).data.researchDeadlineAt,op.data.researchDeadlineAt);
    f.engine.recover();await f.engine.tick();await f.engine.reconcileResearchCancellations();
    assert.equal(f.counts.submit,1);assert.equal(f.counts.dispatch,0);
  }finally{f.close();}
});

test('a fresh engine recovers ambiguous cancelled payment and persisted refund identity',async()=>{
  const f=setup({state:'confirming_payment',confirmed:false});let refundsVisible=false;
  const originalConfirm=f.engine.confirm;
  f.engine.confirm=async(tx,args)=>tx.startsWith('refund-')?refundsVisible:originalConfirm(tx,args);
  try{
    await f.engine.cancel(f.op.id,credential);await f.engine.reconcileResearchCancellations();
    assert.equal(f.store.get(f.op.id).data.refund,undefined);
    f.setMirror(true);
    const fresh=()=>new Engine({store:f.store,env:f.engine.env,providers:f.engine.providers,blocky:f.blocky,confirm:f.engine.confirm,refundSigner:f.engine.refundSigner});
    const restarted=fresh();restarted.recover();await restarted.reconcileResearchCancellations();
    const pending=f.store.get(f.op.id);assert.equal(pending.state,'cancelled');assert.equal(pending.data.refund.status,'confirming');assert.equal(f.counts.submit,1);
    const tx=pending.data.refund.tx,signature=pending.data.receipt.signature;
    refundsVisible=true;const again=fresh();again.recover();await again.reconcileResearchCancellations();
    assert.equal(f.store.get(f.op.id).data.refund.status,'confirmed');assert.equal(f.store.get(f.op.id).data.refund.tx,tx);
    assert.equal(f.store.get(f.op.id).data.receipt.signature,signature);assert.equal(f.counts.prepare,1);assert.equal(f.counts.submit,1);
  }finally{f.close();}
});

test('completed results win the race, timeout cannot be forged early, and other paid services stay uncancellable',async()=>{
  const f=setup();
  try{
    await assert.rejects(f.engine.cancel(f.op.id,'wrong'),{status:404});
    await assert.rejects(f.engine.cancel(f.op.id,credential,'timeout'),{code:'research_deadline_not_reached'});
    f.engine.finish(f.op,{results:[{title:'Finished first'}]});
    await assert.rejects(f.engine.cancel(f.op.id,credential),{status:409});assert.equal(f.store.get(f.op.id).data.refund,undefined);
  }finally{f.close();}
  for(const service of ['phone.call','video.meeting','email.send','email.reply','email.inbox','network.inspect']){
    const g=setup({service});try{await assert.rejects(g.engine.cancel(g.op.id,credential),{status:409});g.engine.sweepResearchDeadlines();assert.equal(g.store.get(g.op.id).state,'queued');}finally{g.close();}
  }
});

test('research provider requests accept cancellation signals without changing call APIs',async()=>{
  for(const service of ['discovery.search','contacts.reverse']){
    const controller=new AbortController();let signal;
    const providers=new Providers({},async(url,options)=>{signal=options.signal;return new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});});
    const work=providers.execute({data:{service,input:service==='discovery.search'?{query:'research',limit:1}:{email:'a@example.com'}}},null,{signal:controller.signal});
    controller.abort();await assert.rejects(work);assert.equal(signal.aborted,true);
  }
});

test('HTTP research cancel validates reason and never grants access through public IDs',async()=>{
  const f=setup(),server=createApi(f.engine);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${server.address().port}/v1/operations/${f.op.id}/cancel`,send=(data,auth=credential)=>fetch(url,{method:'POST',headers:{Authorization:`Bearer ${auth}`,'Content-Type':'application/json'},body:JSON.stringify(data)});
  try{
    assert.equal((await send({reason:'timeout'})).status,409);assert.equal((await send({reason:'invented'})).status,400);
    assert.equal((await send({reason:'user'},randomBytes(32).toString('base64url'))).status,404);
    const response=await send({reason:'user'});assert.equal(response.status,200);assert.equal((await response.json()).status,'cancelled');await f.engine.reconcileResearchCancellations();
  }finally{await new Promise(resolve=>server.close(resolve));f.close();}
});
