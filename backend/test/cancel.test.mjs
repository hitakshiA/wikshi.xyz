import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {Store,hash} from '../src/store.mjs';
import {Engine} from '../src/engine.mjs';
import {createApi} from '../src/server.mjs';
import {cancelUnpaidOperation} from '../src/cancel.mjs';

const credential=randomBytes(32).toString('base64url');
function setup(state='awaiting_payment'){
  const store=new Store(':memory:','23'.repeat(32));
  const op={id:randomUUID(),auth:hash(credential),idem:randomUUID(),request_hash:'fixture',state,created:Date.now(),data:{service:'network.inspect',input:{account:'0.0.123'},expires:Date.now()+60000,requirements:{asset:'0.0.429274',amount:'1'},price:{rateAtomic:'1',unit:'request'}}};
  store.insert(op);return {store,op};
}

test('unpaid and expired requests cancel durably without payment, refund, or dispatch',()=>{
  for(const state of ['awaiting_payment','expired']){
    const {store,op}=setup(state);
    const cancelled=cancelUnpaidOperation(store,op.id,credential);
    assert.equal(cancelled.state,'cancelled');assert.equal(store.get(op.id).state,'cancelled');
    assert.equal(cancelled.data.payment,undefined);assert.equal(cancelled.data.refund,undefined);assert.equal(cancelled.data.cleanupPending,undefined);
    assert.equal(store.db.prepare('SELECT COUNT(*) n FROM payments').get().n,0);
    const eventCount=store.db.prepare('SELECT COUNT(*) n FROM events').get().n;
    assert.equal(cancelUnpaidOperation(store,op.id,credential).state,'cancelled');
    assert.equal(store.db.prepare('SELECT COUNT(*) n FROM events').get().n,eventCount);
    store.close();
  }
});

test('cancellation authorizes the private credential and never mutates paid or uncertain states',()=>{
  for(const state of ['verifying_payment','settling_payment','confirming_payment','queued','dispatching','running','awaiting_guest','joining','completed','failed','execution_unknown','payment_rejected']){
    const {store,op}=setup(state);
    assert.throws(()=>cancelUnpaidOperation(store,op.id,'wrong'),{status:404});
    assert.throws(()=>cancelUnpaidOperation(store,op.id,credential),{status:409});
    assert.equal(store.get(op.id).state,state);assert.equal(store.get(op.id).data.refund,undefined);store.close();
  }
});

test('a retained payment claim prevents cancellation even with a stale unpaid state',()=>{
  const {store,op}=setup();
  store.db.prepare('INSERT INTO payments VALUES(?,?)').run('fixture-claimed-transaction',op.id);
  assert.throws(()=>cancelUnpaidOperation(store,op.id,credential),{status:409});
  assert.equal(store.get(op.id).state,'awaiting_payment');store.close();
});

test('payment claims and cancellation cannot both win',async()=>{
  let verificationRelease,settlements=0;
  const {store,op}=setup();
  const engine=new Engine({store,env:{},providers:{},inspect:()=>({tx:'fixture',payer:'0.0.999'}),confirm:async()=>false,blocky:{envelope(){},verify:()=>new Promise(resolve=>verificationRelease=()=>resolve({payer:'0.0.999'})),settle:async()=>{settlements++;return {payer:'0.0.999',transaction:'fixture'};}}});
  engine.services=()=>[{id:'network.inspect',enabled:true}];
  const payment=engine.pay(op.id,credential,{});
  assert.equal(store.get(op.id).state,'verifying_payment');
  await assert.rejects(engine.cancel(op.id,credential),{status:409});
  verificationRelease();await payment;assert.equal(settlements,1);assert.equal(store.get(op.id).data.refund,undefined);store.close();
  const second=setup(),other=new Engine({store:second.store,env:{},providers:{},blocky:{envelope(){assert.fail('cancelled operation must not inspect a payment');}}});
  await other.cancel(second.op.id,credential);assert.equal((await other.pay(second.op.id,credential,{})).state,'cancelled');second.store.close();
});

test('HTTP cancellation uses the bearer credential and rejects paid operations',async()=>{
  const {store,op}=setup(),engine=new Engine({store,env:{},providers:{}}),server=createApi(engine);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${server.address().port}/v1/operations/${op.id}/cancel`;
  try{
    assert.equal((await fetch(url,{method:'POST'})).status,401);
    assert.equal((await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${randomBytes(32).toString('base64url')}`}})).status,404);
    const response=await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${credential}`}});
    assert.equal(response.status,200);assert.equal((await response.json()).status,'cancelled');
    const paid=store.get(op.id);paid.state='queued';paid.data.payment={confirmed:true};store.save(paid);
    assert.equal((await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${credential}`}})).status,409);
  }finally{await new Promise(resolve=>server.close(resolve));store.close();}
});
