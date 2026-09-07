import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {validateCompletionIds,assertMutableTurn,completionMessage} from '../server/completion-turn.mjs';
import {beginActionTurn,withNewAction} from '../server/action-gate.mjs';

const fixture=(status='completed',service='discovery.search')=>{const op={id:randomUUID(),status,service};return {op,session:{operations:new Map([[op.id,op]])}};};

test('completion validation rejects malformed, duplicate, excessive, and foreign IDs before fetching',async()=>{
  const {op,session}=fixture();let reads=0;
  for(const ids of [null,[],[op.id,op.id],['../../other'],Array.from({length:5},()=>randomUUID())])await assert.rejects(validateCompletionIds(session,ids,async()=>{reads++;}),{status:400});
  await assert.rejects(validateCompletionIds(session,[randomUUID()],async()=>{reads++;}),{status:404});assert.equal(reads,0);
});

test('completion waits for the authoritative result, never a stale completed client state',async()=>{
  for(const status of ['awaiting_payment','verifying_payment','settling_payment','confirming_payment','queued','running','dispatching','execution_unknown','joining']){
    const {op,session}=fixture();await assert.rejects(validateCompletionIds(session,[op.id],async()=>({...op,status})),{status:409});
  }
});

test('terminal states and a ready guest invitation can be summarized',async()=>{
  for(const status of ['completed','failed','cancelled','expired','payment_rejected']){
    const {op,session}=fixture(status);assert.deepEqual(await validateCompletionIds(session,[op.id],async()=>op),[op]);
  }
  const {op,session}=fixture('awaiting_guest','video.meeting');assert.equal((await validateCompletionIds(session,[op.id],async()=>op))[0].status,'awaiting_guest');
  await assert.rejects(validateCompletionIds(session,[op.id],async()=>({...op,service:'phone.call'})),{status:409});
});

test('every group member must be owned and ready before the model resumes',async()=>{
  const ops=Array.from({length:4},()=>({id:randomUUID(),status:'completed',service:'email.send'})),session={operations:new Map(ops.map(op=>[op.id,op]))};
  assert.equal((await validateCompletionIds(session,ops.map(op=>op.id),async id=>session.operations.get(id))).length,4);
  await assert.rejects(validateCompletionIds(session,ops.map(op=>op.id),async id=>({...session.operations.get(id),status:id===ops[3].id?'running':'completed'})),{status:409});
});

test('read-only continuation blocks mutations and new cards, but a later natural turn works',async()=>{
  const {session}=fixture();beginActionTurn(session);session.readOnlyContinuation=true;session.actionTurn.claimed=true;
  assert.throws(()=>assertMutableTurn(session),{status:409});
  await assert.rejects(withNewAction(session,async id=>session.operations.get(id),async()=>assert.fail('summary must not prepare a new card')),{status:409});
  beginActionTurn(session);assert.doesNotThrow(()=>assertMutableTurn(session));let prepared=0;
  await withNewAction(session,async id=>session.operations.get(id),async()=>prepared++);assert.equal(prepared,1);
});

test('server completion prompt is internal and has no payment permission',()=>{
  const id=randomUUID(),message=completionMessage([id]);assert.match(message,/Internal completion event/);assert.match(message,new RegExp(id));assert.match(message,/Do not introduce another payment card/);assert.match(message,/untrusted source data/);
});
