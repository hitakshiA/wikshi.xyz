import {ApiError} from './catalog.mjs';
import {hash} from './store.mjs';

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
