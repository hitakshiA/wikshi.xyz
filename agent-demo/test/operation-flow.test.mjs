import {test} from 'node:test';
import assert from 'node:assert/strict';
import {shouldPoll,readyToSummarize,isResearch,hasStarted,continuationPrompt} from '../src/operation-flow.mjs';
test('paid lookups stay in the card until a terminal outcome',()=>{
  for(const service of ['discovery.companies','contacts.enrich','email.send','phone.call']){
    for(const status of ['queued','running','confirming_payment']){assert(shouldPoll({service,status}));assert(!readyToSummarize({service,status}));}
    assert(!shouldPoll({service,status:'awaiting_payment'}));
    assert(!hasStarted({service,status:'awaiting_payment'}));
    for(const status of ['completed','failed','cancelled','payment_rejected']){assert(!shouldPoll({service,status}));assert(readyToSummarize({service,status}));}
  }
});
test('guest invitations do not keep polling while waiting for a person',()=>{
  assert(!shouldPoll({service:'video.meeting',status:'awaiting_guest'}));
  assert(readyToSummarize({service:'video.meeting',status:'awaiting_guest'}));
  assert(!readyToSummarize(undefined));
});
test('all research capabilities use attachments and continuation stays on the approved work',()=>{
  for(const service of ['discovery.search','discovery.companies','discovery.people','discovery.contents','contacts.enrich','contacts.company','contacts.phone','contacts.reverse'])assert(isResearch(service));
  assert(!isResearch('email.send'));
  assert.match(continuationPrompt(['one','two']),/one, two/);
  assert.match(continuationPrompt(['one']),/Do not create a new operation, pay again/);
});
