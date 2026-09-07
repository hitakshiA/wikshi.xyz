import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {cancelSessionOperation} from '../server/cancel-operation.mjs';
import {beginActionTurn,withNewAction,withBatchPreparation,assertPaymentGroupReady} from '../server/action-gate.mjs';
import {SessionError} from '../server/sessions.mjs';

function fixture(statuses=['awaiting_payment']){
  const operations=statuses.map(status=>({id:randomUUID(),service:'discovery.search',status})),remote=new Map(operations.map(op=>[op.id,{...op}]));
  const session={operations:new Map(operations.map(op=>[op.id,{...op,input:{query:'Preserved input'}}])),credential:'private-fixture-credential'};
  const calls=[];
  const request=async(s,path,data,method='GET')=>{
    assert.equal(s,session);calls.push({path,method});
    const parts=path.split('/'),op=remote.get(parts[3]);assert.ok(op);
    if(method==='POST'){
      assert.equal(parts[4],'cancel');
      if(!['awaiting_payment','expired','cancelled'].includes(op.status))throw new SessionError('cannot_cancel_current_state',409);
      op.status='cancelled';
    }
    return {...op};
  };
  return {operations,remote,session,request,calls};
}

test('confirmed cancellation updates the real operation and releases the action gate',async()=>{
  const f=fixture(),id=f.operations[0].id;
  const result=await cancelSessionOperation(f.session,id,f.request);
  assert.equal(result.status,'cancelled');assert.deepEqual(result.cancellation,{cancelledIds:[id],remainingIds:[]});
  assert.equal(f.remote.get(id).status,'cancelled');assert.equal(f.session.operations.get(id).input.query,'Preserved input');
  beginActionTurn(f.session);let created=0;await withNewAction(f.session,async id=>f.session.operations.get(id),async()=>created++);assert.equal(created,1);
  assert.equal(f.calls.filter(call=>call.method==='POST').length,1);
  await cancelSessionOperation(f.session,id,f.request);assert.equal(f.calls.filter(call=>call.method==='POST').length,1);
});

test('unowned IDs and malformed targets never reach the backend',async()=>{
  const f=fixture();
  for(const id of [randomUUID(),'../../other','bad'])await assert.rejects(cancelSessionOperation(f.session,id,f.request),{status:404});
  assert.equal(f.calls.length,0);
});

test('paid or uncertain target cannot be cancelled, and still blocks replacement',async()=>{
  for(const state of ['verifying_payment','settling_payment','confirming_payment','queued','running','completed']){
    const f=fixture([state]);await assert.rejects(cancelSessionOperation(f.session,f.operations[0].id,f.request),{status:409});
    assert.equal(f.calls.filter(call=>call.method==='POST').length,0);assert.equal(f.session.actionPreparation,false);
  }
});

test('email group cancellation resolves only remaining unpaid requests and partial preparation',async()=>{
  const f=fixture(['awaiting_payment','expired','completed','running']);
  const batch={id:randomUUID(),preparationIncomplete:true,preparationError:'retry',drafts:f.operations.map(op=>({id:randomUUID(),decision:'approved',operationId:op.id}))};
  batch.drafts.push({id:randomUUID(),decision:'approved'});f.session.draftBatches=new Map([[batch.id,batch]]);
  const result=await cancelSessionOperation(f.session,f.operations[0].id,f.request);
  assert.equal(result.batch.cancelled,true);assert.equal(batch.preparationIncomplete,false);assert.equal(batch.drafts.at(-1).decision,'denied');
  assert.equal(f.calls.filter(call=>call.method==='POST').length,2);
  assert.deepEqual(result.operationUpdates.map(op=>op.status),['cancelled','cancelled','completed','running']);
  await assert.rejects(withBatchPreparation(f.session,batch.id,async()=>{},async()=>assert.fail('cancelled batch must not prepare')), {status:409});
  assert.throws(()=>assertPaymentGroupReady(f.session,f.operations[0].id),{status:409});
  beginActionTurn(f.session);await assert.rejects(withNewAction(f.session,async id=>f.session.operations.get(id),async()=>assert.fail('running paid operation must still block')),{status:409});
});

test('a lost successful cancel response is reconciled without repeat cancellation',async()=>{
  const f=fixture(),id=f.operations[0].id;
  const result=await cancelSessionOperation(f.session,id,async(...args)=>{const op=await f.request(...args);if(args[3]==='POST')throw new Error('lost response');return op;});
  assert.equal(result.status,'cancelled');assert.equal(result.cancellationError,undefined);assert.deepEqual(result.cancellation.remainingIds,[]);
  assert.equal(f.calls.filter(call=>call.method==='POST').length,1);
});

test('a payment winning during group cancellation remains visible without leaving unquoted drafts blocked forever',async()=>{
  const f=fixture(['awaiting_payment','awaiting_payment']),id=f.operations[0].id;
  const batch={id:randomUUID(),preparationIncomplete:true,drafts:[...f.operations.map(op=>({id:randomUUID(),decision:'approved',operationId:op.id})),{id:randomUUID(),decision:'approved'}]};
  f.session.draftBatches=new Map([[batch.id,batch]]);
  const result=await cancelSessionOperation(f.session,id,async(...args)=>{
    if(args[3]==='POST'&&args[1].includes(id)){f.remote.get(id).status='verifying_payment';throw new SessionError('cannot_cancel_current_state',409);}
    return f.request(...args);
  });
  assert.equal(result.status,'verifying_payment');assert.ok(result.cancellationError);assert.deepEqual(result.cancellation.remainingIds,[id]);
  assert.equal(result.operationUpdates[1].status,'cancelled');assert.equal(batch.drafts.at(-1).decision,'denied');assert.equal(batch.cancelled,true);
  beginActionTurn(f.session);await assert.rejects(withNewAction(f.session,async id=>f.session.operations.get(id),async()=>assert.fail('payment still blocks')),{status:409});
  f.session.operations.get(id).status='completed';beginActionTurn(f.session);let created=0;await withNewAction(f.session,async id=>f.session.operations.get(id),async()=>created++);assert.equal(created,1);
});

test('an unconfirmed cancellation retains its pending gate and explicit error',async()=>{
  const f=fixture(),id=f.operations[0].id;
  const result=await cancelSessionOperation(f.session,id,async(...args)=>{if(args[3]==='POST')throw Error('unavailable');return f.request(...args);});
  assert.equal(result.status,'awaiting_payment');assert.ok(result.cancellationError);assert.deepEqual(result.cancellation.remainingIds,[id]);
  beginActionTurn(f.session);await assert.rejects(withNewAction(f.session,async id=>f.session.operations.get(id),async()=>assert.fail('must not replace pending quote')),{status:409});
});

test('cancellation cannot overlap new action preparation or another cancellation',async()=>{
  const f=fixture();let release;const waiting=new Promise(resolve=>release=resolve);
  const cancel=cancelSessionOperation(f.session,f.operations[0].id,async(...args)=>{await waiting;return f.request(...args);});
  await assert.rejects(cancelSessionOperation(f.session,f.operations[0].id,f.request),{status:409});
  beginActionTurn(f.session);await assert.rejects(withNewAction(f.session,async()=>{},async()=>assert.fail('must not prepare')),{status:409});
  release();await cancel;assert.equal(f.session.actionPreparation,false);
});
