import test from 'node:test';
import assert from 'node:assert/strict';
import {requestedRevision,assertRevisionTool,createDraftBatch,decideDraft,reviseDraft} from '../server/drafts.mjs';
test('inline revision requires an owned requested change and cannot mutate another card',()=>{
  const session={};const batch=createDraftBatch(session,[{to:'guest@example.test',subject:'Original',text:'Original body'}]);
  const id=batch.drafts[0].id;
  assert.throws(()=>requestedRevision(session,id));
  assert.throws(()=>requestedRevision(session,'other'));
  decideDraft(session,id,'changes_requested','Shorten it');
  assert.equal(requestedRevision(session,id).feedback,'Shorten it');
  session.revisionId=id;
  for(const name of ['prepare_operation','show_email_drafts','cancel_operation'])assert.throws(()=>assertRevisionTool(session,name,{id}));
  assert.throws(()=>assertRevisionTool(session,'revise_email_draft',{id:'other'}));
  assertRevisionTool(session,'revise_email_draft',{id});
  reviseDraft(session,id,'Shorter','Short body');
  assert.equal(batch.drafts[0].to,'guest@example.test');
  assert.equal(batch.drafts[0].decision,'pending');
  assert.throws(()=>requestedRevision(session,id));
});
