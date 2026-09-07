import test from 'node:test';
import assert from 'node:assert/strict';
import {atomic,rowsOf,safeUrl,scanLink} from '../src/card-data.mjs';
import {createDraftBatch} from '../server/drafts.mjs';

test('research preserves all 100 records, including nested results',()=>{
  const rows=Array.from({length:100},(_,id)=>({id,name:`Company ${id}`}));
  assert.equal(rowsOf({data:{companies:rows}}).length,100);
});
test('currency formatting does not lose atomic precision',()=>{
  assert.equal(atomic('1234567890123456789',8),'12345678901.23456789');
  assert.equal(atomic('500000',6),'0.5');assert.equal(atomic('1',8),'0.00000001');
  assert.equal(atomic('no'), 'Not available');
});
test('explorer links require real-shaped identifiers, never arbitrary URLs',()=>{
  assert.equal(scanLink('transaction','0.0.123@1720000000.123456789'),'https://hashscan.io/testnet/transaction/0.0.123-1720000000-123456789');
  assert.equal(scanLink('topic','0.0.123'),'https://hashscan.io/testnet/topic/0.0.123');
  assert.equal(scanLink('topic',undefined),null);assert.equal(scanLink('transaction','https://evil.test'),null);
  assert.equal(safeUrl('javascript:alert(1)'),null);
});
test('draft batches enforce four, preserve recipients, isolate sessions',()=>{
  const session={},other={};const draft={to:'guest@example.com',subject:'An introduction',text:'Hello'};
  const first=createDraftBatch(session,Array.from({length:4},(_,i)=>({...draft,to:`guest${i}@example.com`})));
  const second=createDraftBatch(session,[draft]);createDraftBatch(other,[draft]);
  assert.equal(first.drafts.length,4);assert.equal(second.drafts.length,1);assert.equal(session.drafts.size,5);
  assert.equal(other.drafts.has(first.drafts[0].id),false);
  assert.throws(()=>createDraftBatch(session,Array(5).fill(draft)));
  assert.throws(()=>createDraftBatch(session,[{...draft,subject:'Hello\nBcc: someone'}]));
});
