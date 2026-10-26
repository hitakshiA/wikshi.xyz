import {ApiError} from './catalog.mjs';
import {hash} from './store.mjs';

export const isResearchService=service=>/^(discovery|contacts)\./.test(service||'');
const researchCancellable=new Set(['awaiting_payment','expired','verifying_payment','settling_payment','confirming_payment','queued','dispatching','running','execution_unknown']);

export function cancelResearchOperation(store,id,credential,{reason='user',internal=false,now=Date.now(),receipt}={}){
  return store.atomic(()=>{
    const op=store.get(id);
    if(!op || (!internal && op.auth!==hash(credential)))throw new ApiError('not_found',404);
    if(!isResearchService(op.data.service))throw new ApiError('cannot_cancel_current_state',409);
    if(op.state==='cancelled')return op;
    if(!researchCancellable.has(op.state))throw new ApiError('cannot_cancel_current_state',409);
    if(!['user','timeout'].includes(reason))throw new ApiError('invalid_cancellation_reason');
    if(reason==='timeout' && (!Number.isFinite(op.data.researchDeadlineAt)||now<op.data.researchDeadlineAt))throw new ApiError('research_deadline_not_reached',409);
    const requestedAt=new Date(now).toISOString();
    op.state='cancelled';op.data.cancelledAt=requestedAt;
    op.data.cancellation={reason,requestedAt,paymentStatus:op.data.payment?.confirmed?'confirmed':op.data.payment?'confirmation_pending':'not_submitted'};
    op.data.result=null;
    if(op.data.payment?.confirmed && receipt)receipt(op);
    store.save(op);return op;
  });
}

// Cancellation competes for the same durable state claim as payment. Never
// await between authorization, checking the unpaid state, and saving it.
export function cancelUnpaidOperation(store,id,credential){
  return store.atomic(()=>{
    const op=store.get(id);
    if(!op||op.auth!==hash(credential))throw new ApiError('not_found',404);
    if(op.state==='cancelled')return op;
    if(!['awaiting_payment','expired'].includes(op.state)||op.data.payment||store.db.prepare('SELECT tx FROM payments WHERE operation=?').get(id))throw new ApiError('cannot_cancel_current_state',409);
    op.state='cancelled';
    op.data.cancelledAt=new Date().toISOString();
    store.save(op);
    return op;
  });
}
