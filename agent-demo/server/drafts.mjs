import {randomUUID} from 'node:crypto';
import {SessionError} from './sessions.mjs';

export function createDraftBatch(session,drafts) {
  if(!Array.isArray(drafts)||drafts.length<1||drafts.length>4)throw new SessionError('Prepare between one and four email drafts per batch.');
  const clean=drafts.map(d=>{
    if(!d||typeof d.to!=='string'||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.to)||d.to.length>254||typeof d.subject!=='string'||!d.subject.trim()||d.subject.length>200||/[\r\n]/.test(d.subject)||typeof d.text!=='string'||!d.text.trim()||d.text.length>10000)throw new SessionError('Each draft needs a recipient, subject, and message.');
    return {id:randomUUID(),to:d.to,subject:d.subject,text:d.text,...(d.inboxId?{inboxId:d.inboxId}:{})};
  });
  const batch={id:randomUUID(),drafts:clean.map(d=>({...d,decision:'pending'}))};
  session.drafts??=new Map();session.draftBatches??=new Map();for(const draft of batch.drafts)session.drafts.set(draft.id,draft);
  session.draftBatches.set(batch.id,batch);return batch;
}
export function decideDraft(session,id,decision,feedback='') {
  const d=session.drafts?.get(id),batch=[...(session.draftBatches?.values()||[])].find(b=>b.drafts.some(x=>x.id===id));
  if(!d||!batch)throw new SessionError('Draft not found.',404);
  if(batch.drafts.some(x=>x.operationId))throw new SessionError('This batch has already moved to payment.',409);
  if(!['approved','denied','changes_requested'].includes(decision))throw new SessionError('Invalid draft decision.');
  if(decision==='changes_requested'&&(typeof feedback!=='string'||!feedback.trim()||feedback.length>1500))throw new SessionError('Describe the requested changes.');
  if(d.decision==='changes_requested'&&decision==='approved')throw new SessionError('Review the revised draft before approving it.',409);
  d.decision=decision;d.feedback=decision==='changes_requested'?feedback:'';return batch;
}
export function approvedDrafts(session,id) {
  const batch=session.draftBatches?.get(id);if(!batch)throw new SessionError('Batch not found.',404);
  if(!batch.drafts.every(d=>['approved','denied'].includes(d.decision)))throw new SessionError('Review every draft before continuing.',409);
  const drafts=batch.drafts.filter(d=>d.decision==='approved');if(!drafts.length)throw new SessionError('No approved emails in this batch.',409);return drafts;
}
export function reviseDraft(session,id,subject,text) {
  const d=session.drafts?.get(id),batch=[...(session.draftBatches?.values()||[])].find(b=>b.drafts.some(x=>x.id===id));
  if(!d||!batch)throw new SessionError('Draft not found.',404);
  if(d.decision!=='changes_requested'||batch.drafts.some(x=>x.operationId))throw new SessionError('Only requested revisions can be changed.',409);
  if(typeof subject!=='string'||!subject.trim()||subject.length>200||/[\r\n]/.test(subject)||typeof text!=='string'||!text.trim()||text.length>10000)throw new SessionError('Invalid revised draft.');
  Object.assign(d,{subject,text,decision:'pending',feedback:''});return batch;
}
