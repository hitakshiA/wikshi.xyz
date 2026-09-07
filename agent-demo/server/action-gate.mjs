import {SessionError} from './sessions.mjs';
import {randomUUID} from 'node:crypto';

const terminal=new Set(['completed','failed','cancelled','canceled','expired','payment_rejected']);

export function isBlockingOperation(operation) {
  if(!operation)return true;
  if(terminal.has(operation.status))return false;
  // A purchased guest invitation is usable while its guest has not joined.
  // Emailing that invitation must remain possible as a separate approval.
  return !(operation.service==='video.meeting'&&operation.status==='awaiting_guest');
}

export function openDraftBatch(session,exceptBatchId) {
  return [...(session.draftBatches?.values()||[])].find(batch=>batch.id!==exceptBatchId&&batch.drafts.some(draft=>{
    if(draft.decision==='denied')return false;
    if(draft.decision!=='approved'||!draft.operationId)return true;
    return isBlockingOperation(session.operations.get(draft.operationId));
  }));
}

export function beginActionTurn(session) {
  session.actionTurn={claimed:false};
}

async function checkOutstanding(session,refreshOperation,exceptBatchId) {
  const ownIds=new Set(session.draftBatches?.get(exceptBatchId)?.drafts.map(d=>d.operationId).filter(Boolean)||[]);
  for(const [id,old] of session.operations) {
    if(terminal.has(old.status))continue;
    // Read the authoritative state before releasing a stale client-side lock.
    // A failed read deliberately retains the existing approval, never creates
    // an additional payment while the previous result is unknown.
    let operation=await refreshOperation(id);
    if(operation.status==='awaiting_payment'&&Number.isFinite(Date.parse(operation.expiresAt))&&Date.parse(operation.expiresAt)<=Date.now()) {
      // The backend rejects expired quotes even before its expiry worker runs.
      operation={...operation,status:'expired'};
      session.operations.set(id,operation);
    }
    if(!ownIds.has(id)&&isBlockingOperation(operation))throw new SessionError(`Finish the existing payment or service operation ${id} before preparing another. Do not create or describe another payment card. Check its actual status and use the result for the next step.`,409);
  }
  const draftBatch=openDraftBatch(session,exceptBatchId);
  if(draftBatch)throw new SessionError(`Finish email draft batch ${draftBatch.id} first. Revise requested drafts in that same batch, wait for every review decision, then use its one grouped payment card. Do not create another draft batch or separate payment.`,409);
}

// Tool execution may be parallel. Claim before the first await, not after an
// operation comes back from the API. An uncertain response consumes the slot;
// only an explicitly confirmed, non-creating validation failure may be fixed.
export async function withNewAction(session,refreshOperation,create) {
  session.actionTurn??={claimed:false};
  if(session.actionTurn.claimed||session.actionPreparation)throw new SessionError('Only one payment or draft-review group may be prepared in this response. Use the existing card and stop preparing more. Wait for approval and the actual result before continuing in a later response.',409);
  session.actionTurn.claimed=true;
  session.actionPreparation=true;
  let creating=false;
  try {await checkOutstanding(session,refreshOperation);creating=true;return await create();}
  catch(error) {
    if(creating&&error instanceof SessionError&&error.safeToRetryPreparation===true&&[400,422].includes(error.status))session.actionTurn.claimed=false;
    throw error;
  }
  finally {session.actionPreparation=false;}
}

// Approved emails retain individual exact x402 payments, but form one user-
// reviewed action group. Retrying this group may reuse its existing operations.
export async function withBatchPreparation(session,batchId,refreshOperation,prepare) {
  if(session.actionPreparation)throw new SessionError('Wait for the current approval request to finish.',409);
  session.actionPreparation=true;
  try {await checkOutstanding(session,refreshOperation,batchId);return await prepare();}
  finally {session.actionPreparation=false;}
}

export function validateDraftInboxes(drafts,inboxes) {
  if(!Array.isArray(inboxes)||!inboxes.length)throw new SessionError('Your inbox is included with your first verified service payment. Complete that payment before reviewing email drafts.',409);
  return drafts.map(draft=>{
    const inbox=draft.inboxId?inboxes.find(box=>box.id===draft.inboxId):inboxes[0];
    if(!inbox)throw new SessionError('Every email must use an inbox belonging to this chat. Check the inbox list and correct the draft inbox before continuing.',400);
    return {draft,input:{inboxId:inbox.id,to:draft.to,subject:draft.subject,text:draft.text,consent:true}};
  });
}

export function assertPaymentGroupReady(session,id) {
  if([...(session.draftBatches?.values()||[])].some(batch=>batch.preparationIncomplete&&batch.drafts.some(draft=>draft.operationId===id)))throw new SessionError('Finish preparing the remaining email quotes before paying this batch.',409);
}

export async function prepareEmailBatch(session,batch,drafts,inboxes,createOperation) {
  // Resolve every target before the first quote. A bad later inbox must never
  // leave the earlier emails prepared but invisible behind an HTTP error.
  const plans=validateDraftInboxes(drafts,inboxes);
  session.draftQuoteAttempts??=new Map();
  batch.preparationIncomplete=true;
  delete batch.preparationError;
  try {
    for(const {draft,input} of plans) {
      const existing=draft.operationId&&session.operations.get(draft.operationId);
      if(existing&&existing.status!=='expired')continue;
      if(existing?.status==='expired'&&session.draftQuoteAttempts.get(draft.id)?.operationId===existing.id)session.draftQuoteAttempts.delete(draft.id);
      const inputJson=JSON.stringify(input);
      let attempt=session.draftQuoteAttempts.get(draft.id);
      if(attempt&&attempt.inputJson!==inputJson)throw new SessionError('Retry this approved batch before changing its prepared content.',409);
      if(!attempt){attempt={inputJson,key:randomUUID()};session.draftQuoteAttempts.set(draft.id,attempt);}
      // Keep this key before awaiting. If the remote quote was created but its
      // response was lost, retry retrieves that same quote instead of another.
      const op=await createOperation(input,attempt.key);
      attempt.operationId=op.id;
      session.operations.set(op.id,{...op,input});draft.operationId=op.id;
    }
    batch.preparationIncomplete=false;
  }catch {
    batch.preparationError='Some email quotes are not ready yet. Retry to finish preparing the batch. Retrying does not pay or resend completed emails.';
  }
  return {batch,operations:drafts.map(draft=>session.operations.get(draft.operationId)).filter(Boolean),...(batch.preparationError?{preparationError:batch.preparationError}:{})};
}
