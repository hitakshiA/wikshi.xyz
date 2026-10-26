import test from 'node:test';
import assert from 'node:assert/strict';
import {beginActionTurn,isBlockingOperation,withNewAction,withBatchPreparation,prepareEmailBatch,assertPaymentGroupReady,validateDraftInboxes} from '../server/action-gate.mjs';
import {SessionError} from '../server/sessions.mjs';
import {createDraftBatch,decideDraft,reviseDraft} from '../server/drafts.mjs';
import {createRuntimeEvents} from '../server/runtime.mjs';

const session=()=>({operations:new Map()});
const refresh=s=>async id=>s.operations.get(id);
const operation=(id,status='awaiting_payment')=>({id,service:'discovery.search',status,expiresAt:new Date(Date.now()+60_000).toISOString()});
const draft={to:'guest@example.com',subject:'An introduction',text:'Hello'};

test('parallel prepare attempts create only one operation, and the next response cannot bypass it',async()=>{
  const s=session();beginActionTurn(s);
  let release,created=0;
  const waiting=new Promise(resolve=>release=resolve);
  const first=withNewAction(s,refresh(s),async()=>{await waiting;created++;s.operations.set('one',operation('one'));return 'one';});
  await assert.rejects(withNewAction(s,refresh(s),async()=>{created++;}),{status:409});
  release();assert.equal(await first,'one');assert.equal(created,1);
  beginActionTurn(s);
  await assert.rejects(withNewAction(s,refresh(s),async()=>{created++;}),{status:409});
  assert.equal(created,1);
  s.operations.get('one').status='completed';beginActionTurn(s);
  await withNewAction(s,refresh(s),async()=>{created++;});assert.equal(created,2);
});

test('unknown, rejected reads, and in-flight payments keep the gate closed',async()=>{
  for(const state of ['awaiting_payment','verifying_payment','settling_payment','confirming_payment','queued','running','unknown']) {
    const s=session();s.operations.set('prior',operation('prior',state));beginActionTurn(s);
    await assert.rejects(withNewAction(s,refresh(s),async()=>assert.fail('must not create')),{status:409});
  }
  const s=session();s.operations.set('prior',operation('prior'));beginActionTurn(s);
  await assert.rejects(withNewAction(s,async()=>{throw new Error('unavailable');},async()=>assert.fail('must not create')),/unavailable/);
  assert.equal(s.actionPreparation,false);
});

test('authoritative completion or expiry releases the previous approval but never an in-flight payment',async()=>{
  const s=session();s.operations.set('prior',operation('prior'));beginActionTurn(s);
  await withNewAction(s,async id=>{const op=operation(id,'completed');s.operations.set(id,op);return op;},async()=>{});
  const expired={...operation('expired'),expiresAt:'2020-01-01T00:00:00Z'};
  s.operations.set('expired',expired);beginActionTurn(s);
  await withNewAction(s,refresh(s),async()=>{});assert.equal(s.operations.get('expired').status,'expired');
  s.operations.set('uncertain',{...expired,id:'uncertain',status:'confirming_payment'});beginActionTurn(s);
  await assert.rejects(withNewAction(s,refresh(s),async()=>assert.fail('must wait')),{status:409});
});

test('a paid video invitation can be emailed while awaiting its guest',async()=>{
  const s=session();s.operations.set('video',{...operation('video','awaiting_guest'),service:'video.meeting'});beginActionTurn(s);
  await withNewAction(s,refresh(s),async()=>{});
  assert.equal(isBlockingOperation({...operation('phone','awaiting_guest'),service:'phone.call'}),true);
});

test('email review and revisions stay in one group until all decisions and payments finish',async()=>{
  const s=session();beginActionTurn(s);
  const batch=await withNewAction(s,refresh(s),async()=>createDraftBatch(s,[draft,draft]));
  decideDraft(s,batch.drafts[0].id,'approved');decideDraft(s,batch.drafts[1].id,'changes_requested','Shorter');
  beginActionTurn(s);
  await assert.rejects(withNewAction(s,refresh(s),async()=>createDraftBatch(s,[draft])),{status:409});
  reviseDraft(s,batch.drafts[1].id,'A note','Shorter');decideDraft(s,batch.drafts[1].id,'denied');
  beginActionTurn(s);
  await assert.rejects(withNewAction(s,refresh(s),async()=>{}),{status:409});
  await withBatchPreparation(s,batch.id,refresh(s),async()=>{batch.drafts[0].operationId='email';s.operations.set('email',{...operation('email'),service:'email.send'});});
  beginActionTurn(s);
  await assert.rejects(withNewAction(s,refresh(s),async()=>{}),{status:409});
  // Retrying the same group is allowed without a new independent action.
  await withBatchPreparation(s,batch.id,refresh(s),async()=>{});
  s.operations.get('email').status='completed';beginActionTurn(s);
  await withNewAction(s,refresh(s),async()=>createDraftBatch(s,[draft]));
});

test('a fully denied email group is resolved, but unrelated pending requests block batch preparation',async()=>{
  const s=session();const batch=createDraftBatch(s,[draft]);decideDraft(s,batch.drafts[0].id,'denied');beginActionTurn(s);
  await withNewAction(s,refresh(s),async()=>{});
  s.operations.set('other',operation('other'));
  await assert.rejects(withBatchPreparation(s,batch.id,refresh(s),async()=>assert.fail('must wait')),{status:409});
});

test('an uncertain creation consumes the response slot without locking a different tab',async()=>{
  const a=session(),b=session();beginActionTurn(a);beginActionTurn(b);
  await assert.rejects(withNewAction(a,refresh(a),async()=>{throw new Error('timeout');}),/timeout/);
  await assert.rejects(withNewAction(a,refresh(a),async()=>assert.fail('no hidden retry')),{status:409});
  await withNewAction(b,refresh(b),async()=>{});assert.equal(a.actionPreparation,false);
});

test('only confirmed non-creating validation errors permit a corrected attempt in the same response',async()=>{
  const s=session();beginActionTurn(s);let created=0;
  const invalid=Object.assign(new SessionError('invalid_query',400),{safeToRetryPreparation:true});
  await assert.rejects(withNewAction(s,refresh(s),async()=>{throw invalid;}),{status:400});
  await withNewAction(s,refresh(s),async()=>{created++;});assert.equal(created,1);
  await assert.rejects(withNewAction(s,refresh(s),async()=>{created++;}),{status:409});
  beginActionTurn(s);
  await assert.rejects(withNewAction(s,refresh(s),async()=>{throw new SessionError('uncertain',400);}),{status:400});
  await assert.rejects(withNewAction(s,refresh(s),async()=>{created++;}),{status:409});
  assert.equal(created,1);
});

test('all draft inboxes are validated before a single operation can be created',async()=>{
  const s=session(),batch=createDraftBatch(s,[draft,{...draft,inboxId:'not-owned'}]);
  batch.drafts.forEach(d=>decideDraft(s,d.id,'approved'));let creations=0;
  await assert.rejects(prepareEmailBatch(s,batch,batch.drafts,[{id:'owned'}],async()=>{creations++;return operation('never');}),{status:400});
  assert.equal(creations,0);assert.equal(s.operations.size,0);
  assert.equal(batch.drafts.some(d=>d.operationId),false);assert.equal(batch.preparationIncomplete,undefined);
  assert.throws(()=>validateDraftInboxes([{...draft,inboxId:'another-chat'}],[{id:'owned'}]),{status:400});
});

test('partial quote failures return known operations and retry uncertain creation with the same idempotency key',async()=>{
  const s=session(),batch=createDraftBatch(s,[draft,{...draft,to:'second@example.com'}]);
  batch.drafts.forEach(d=>decideDraft(s,d.id,'approved'));
  const remote=new Map(),attempts=[];let loseSecondResponse=true;
  const create=async(input,key)=>{
    attempts.push(key);
    if(!remote.has(key))remote.set(key,{...operation(`email-${remote.size+1}`),service:'email.send'});
    if(input.to==='second@example.com'&&loseSecondResponse){loseSecondResponse=false;throw new Error('response lost after remote quote creation');}
    return remote.get(key);
  };
  const partial=await prepareEmailBatch(s,batch,batch.drafts,[{id:'owned'}],create);
  assert.equal(partial.operations.length,1);assert.equal(partial.batch.preparationIncomplete,true);
  assert.equal(partial.operations[0].id,batch.drafts[0].operationId);
  assert.equal(typeof partial.preparationError,'string');
  assert.throws(()=>assertPaymentGroupReady(s,partial.operations[0].id),{status:409});
  const finished=await prepareEmailBatch(s,batch,batch.drafts,[{id:'owned'}],create);
  assert.equal(finished.batch.preparationIncomplete,false);assert.equal(finished.preparationError,undefined);
  assert.equal(finished.operations.length,2);assert.equal(remote.size,2);
  assert.equal(attempts.length,3);assert.equal(attempts[1],attempts[2]);
  assert.doesNotThrow(()=>assertPaymentGroupReady(s,finished.operations[0].id));
  await prepareEmailBatch(s,batch,batch.drafts,[{id:'owned'}],create);assert.equal(attempts.length,3);
});

test('a failed first quote remains retryable and an expired replacement keeps its stable key after timeout',async()=>{
  const s=session(),batch=createDraftBatch(s,[draft]);decideDraft(s,batch.drafts[0].id,'approved');
  const keys=[];let loseResponse=true;
  const create=async(input,key)=>{keys.push(key);if(loseResponse){loseResponse=false;throw new Error('timeout');}return {...operation(`email-${keys.length}`),service:'email.send'};};
  const initial=await prepareEmailBatch(s,batch,batch.drafts,[{id:'owned'}],create);
  assert.equal(initial.operations.length,0);assert.equal(initial.batch.preparationIncomplete,true);
  await prepareEmailBatch(s,batch,batch.drafts,[{id:'owned'}],create);assert.equal(keys[0],keys[1]);
  s.operations.get(batch.drafts[0].operationId).status='expired';loseResponse=true;
  const partial=await prepareEmailBatch(s,batch,batch.drafts,[{id:'owned'}],create);
  assert.equal(partial.batch.preparationIncomplete,true);assert.notEqual(keys[1],keys[2]);
  await prepareEmailBatch(s,batch,batch.drafts,[{id:'owned'}],create);assert.equal(keys[2],keys[3]);
});

test('stream boundaries separate model iterations without splitting tokens or leaking private events',()=>{
  const events=[],receive=createRuntimeEvents(event=>events.push(event));
  receive({type:'run-started'});
  receive({type:'assistant-text-delta',iteration:1,text:'First'});
  receive({type:'assistant-text-delta',iteration:1,text:' sentence.'});
  receive({type:'assistant-reasoning-delta',iteration:2,text:'private'});
  receive({type:'assistant-text-delta',iteration:2,text:'Next paragraph.'});
  receive({type:'run-finished'});receive({type:'run-started'});
  receive({type:'assistant-text-delta',iteration:1,text:'New response.'});
  assert.deepEqual(events,[{type:'text',text:'First'},{type:'text',text:' sentence.'},{type:'text_boundary'},{type:'text',text:'Next paragraph.'},{type:'text',text:'New response.'}]);
});
