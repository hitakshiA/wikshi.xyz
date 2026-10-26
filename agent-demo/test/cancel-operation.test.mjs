import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {cancelSessionOperation,parseCancellationRequest,isResearchOperation,rememberOperation} from '../server/cancel-operation.mjs';
import {beginActionTurn,withNewAction,withBatchPreparation,assertPaymentGroupReady} from '../server/action-gate.mjs';
import {SessionError} from '../server/sessions.mjs';

function fixture(statuses=['awaiting_payment']){
  const operations=statuses.map(status=>({id:randomUUID(),service:'network.inspect',status})),remote=new Map(operations.map(op=>[op.id,{...op}]));
  const session={operations:new Map(operations.map(op=>[op.id,{...op,input:{query:'Preserved input'}}])),credential:'private-fixture-credential'};
  const calls=[];
  const request=async(s,path,data,method='GET')=>{
    assert.equal(s,session);calls.push({path,method,data});
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

function researchFixture(status='queued',service='discovery.search'){
  const f=fixture([status]),id=f.operations[0].id;
  const timing={researchStartedAt:'2026-09-08T00:00:00.000Z',researchDeadlineAt:'2026-09-08T00:02:00.000Z'};
  Object.assign(f.remote.get(id),{service,...timing});Object.assign(f.session.operations.get(id),{service,...timing});
  const researchRequest=async(s,path,data,method='GET')=>{
    if(method!=='POST')return f.request(s,path,data,method);
    f.calls.push({path,method,data});
    const op=f.remote.get(id),pending=['verifying_payment','settling_payment','confirming_payment'].includes(op.status);
    if(['completed','failed'].includes(op.status))throw new SessionError('cannot_cancel_current_state',409);
    Object.assign(op,{status:'cancelled',cancellation:{reason:data.reason,requestedAt:'2026-09-08T00:02:00.001Z',paymentStatus:pending?'confirmation_pending':'confirmed'}});
    if(!pending){op.refund={status:'pending',amountAtomic:'100000000',currency:'HBAR'};op.receipt={chargedAtomic:'0',refundDueAtomic:'100000000'};}
    return {...op};
  };
  return {...f,id,researchRequest};
}

test('only the two supported cancellation reasons cross the bridge',()=>{
  assert.deepEqual(parseCancellationRequest(),{reason:'user'});assert.deepEqual(parseCancellationRequest({reason:'timeout'}),{reason:'timeout'});
  for(const value of [null,[],{reason:'force'},{reason:3},{reason:'timeout',deadline:0},{reason:'user',service:'phone.call'}])assert.throws(()=>parseCancellationRequest(value),{status:400});
  assert.equal(isResearchOperation({service:'discovery.search'}),true);assert.equal(isResearchOperation({service:'contacts.company'}),true);assert.equal(isResearchOperation({service:'phone.call'}),false);assert.equal(isResearchOperation({service:'discovery'}),false);
});

test('paid research forwards cancellation and preserves authoritative timing, receipts, and refund state',async()=>{
  for(const status of ['verifying_payment','settling_payment','confirming_payment','queued','dispatching','running','execution_unknown']){
    for(const service of ['discovery.companies','contacts.enrich']){
      const f=researchFixture(status,service),result=await cancelSessionOperation(f.session,f.id,f.researchRequest,{reason:'user'});
      assert.equal(result.status,'cancelled');assert.equal(result.researchDeadlineAt,'2026-09-08T00:02:00.000Z');
      assert.equal(result.cancellation.reason,'user');assert.deepEqual(result.cancellation.cancelledIds,[f.id]);
      if(['verifying_payment','settling_payment','confirming_payment'].includes(status)){assert.equal(result.cancellation.paymentStatus,'confirmation_pending');assert.equal(result.refund,undefined);assert.equal(result.receipt,undefined);}
      else{assert.equal(result.cancellation.paymentStatus,'confirmed');assert.equal(result.refund.status,'pending');assert.equal(result.receipt.chargedAtomic,'0');}
      assert.deepEqual(f.calls.find(call=>call.method==='POST').data,{reason:'user'});
    }
  }
});

test('research timeout is forwarded, but only the backend may declare the deadline reached',async()=>{
  const f=researchFixture();
  await assert.rejects(cancelSessionOperation(f.session,f.id,async(...args)=>{
    if(args[3]==='POST'){assert.deepEqual(args[2],{reason:'timeout'});throw new SessionError('research_deadline_not_reached',409);}
    return f.researchRequest(...args);
  },{reason:'timeout'}),{status:409});
  assert.equal(f.session.operations.get(f.id).status,'queued');
  const result=await cancelSessionOperation(f.session,f.id,f.researchRequest,{reason:'timeout'});
  assert.equal(result.cancellation.reason,'timeout');assert.equal(result.status,'cancelled');
});

test('research cancellation bypasses model busy/preparation without unlocking it or starting another action',async()=>{
  const f=researchFixture();f.session.busy=true;f.session.actionPreparation=true;f.session.actionTurn={claimed:false};
  const results=await Promise.all([cancelSessionOperation(f.session,f.id,f.researchRequest),cancelSessionOperation(f.session,f.id,f.researchRequest)]);
  assert.equal(results[0].status,'cancelled');assert.equal(results[1].status,'cancelled');
  assert.equal(f.calls.filter(call=>call.method==='POST').length,1);assert.equal(f.session.busy,true);assert.equal(f.session.actionPreparation,true);assert.equal(f.session.actionTurn.claimed,true);
  f.session.actionPreparation=false;
  await assert.rejects(withNewAction(f.session,async id=>f.session.operations.get(id),async()=>assert.fail('do not automatically replace cancelled research')),{status:409});
});

test('lost research cancellation response is reconciled without inventing a completed refund',async()=>{
  const f=researchFixture('confirming_payment');
  const result=await cancelSessionOperation(f.session,f.id,async(...args)=>{const op=await f.researchRequest(...args);if(args[3]==='POST')throw Error('response lost');return op;});
  assert.equal(result.status,'cancelled');assert.equal(result.cancellation.paymentStatus,'confirmation_pending');assert.equal(result.refund,undefined);assert.equal(f.calls.filter(call=>call.method==='POST').length,1);
});

test('completed research remains completed when cancellation loses the race',async()=>{
  const f=researchFixture('completed');await assert.rejects(cancelSessionOperation(f.session,f.id,f.researchRequest),{status:409});
  assert.equal(f.session.operations.get(f.id).status,'completed');assert.equal(f.session.operations.get(f.id).cancellation,undefined);
});

test('late poll and payment responses cannot resurrect cancelled research; confirmed refund updates remain visible',async()=>{
  const f=researchFixture('confirming_payment');await cancelSessionOperation(f.session,f.id,f.researchRequest);
  const stale=rememberOperation(f.session,{id:f.id,service:'discovery.search',status:'running',result:{results:[{title:'late data'}]}});
  assert.equal(stale.status,'cancelled');assert.equal(stale.result,undefined);assert.equal(stale.cancellation.paymentStatus,'confirmation_pending');
  const confirmed=rememberOperation(f.session,{id:f.id,status:'cancelled',cancellation:{reason:'user',paymentStatus:'confirmed'},refund:{status:'confirmed',transaction:'confirmed-refund'},receipt:{chargedAtomic:'0'}});
  assert.equal(confirmed.refund.transaction,'confirmed-refund');assert.equal(confirmed.cancellation.paymentStatus,'confirmed');assert.equal(confirmed.researchStartedAt,'2026-09-08T00:00:00.000Z');
});

test('email, calls, and video do not inherit research timeouts or paid cancellation',async()=>{
  for(const service of ['email.send','phone.call','video.meeting','network.inspect']){
    const f=fixture(['running']),id=f.operations[0].id;f.session.operations.get(id).service=service;f.remote.get(id).service=service;
    await assert.rejects(cancelSessionOperation(f.session,id,f.request),{status:409});
    await assert.rejects(cancelSessionOperation(f.session,id,f.request,{reason:'timeout'}),{status:400});
    assert.equal(f.calls.filter(call=>call.method==='POST').length,0);
  }
});
