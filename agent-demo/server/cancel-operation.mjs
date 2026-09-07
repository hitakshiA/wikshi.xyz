import {SessionError} from './sessions.mjs';

const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const unpaid=new Set(['awaiting_payment','expired']);

// Used by both the direct card action and the agent tool. Updating the actual
// backend operation, not a hidden-card flag, releases the next-action gate.
export async function cancelSessionOperation(session,id,request){
  if(!uuid.test(id)||!session.operations.has(id))throw new SessionError('Operation not found.',404);
  if(session.actionPreparation)throw new SessionError('Wait for the current request to finish before cancelling.',409);
  session.actionPreparation=true;
  try{
    const batch=[...(session.draftBatches?.values()||[])].find(item=>item.drafts.some(draft=>draft.operationId===id));
    const ids=[...new Set([id,...(batch?.drafts.map(draft=>draft.operationId).filter(Boolean)||[])])];
    // Never forward a batch identifier not owned by this session.
    if(ids.some(operationId=>!uuid.test(operationId)||!session.operations.has(operationId)))throw new SessionError('This payment group could not be verified. Check its status before continuing.',409);
    const updates=new Map(),cancelledIds=[],remainingIds=[];
    let cancellationError;
    const remember=op=>{
      if(!op||!ids.includes(op.id)||typeof op.status!=='string')throw new SessionError('Cancellation status could not be verified.',503);
      const saved={...session.operations.get(op.id),...op};
      session.operations.set(op.id,saved);updates.set(op.id,saved);return saved;
    };
    for(const operationId of ids){
      let current;
      try{
        current=remember(await request(session,`/v1/operations/${operationId}`));
        if(operationId===id&&!unpaid.has(current.status)&&current.status!=='cancelled')throw new SessionError('This request has already started payment or execution and cannot be cancelled as an unpaid request.',409);
        if(unpaid.has(current.status)){
          try{current=remember(await request(session,`/v1/operations/${operationId}/cancel`,{},'POST'));}
          catch(error){
            // A payment claim may have won, or cancellation may have succeeded
            // before a response was lost. Re-read before reporting either.
            try{current=remember(await request(session,`/v1/operations/${operationId}`));}catch{}
            if(current.status!=='cancelled'){
              cancellationError='Some requests could not be cancelled. Their latest status is shown; check again before continuing.';
              remainingIds.push(operationId);continue;
            }
          }
        }
        if(current.status==='cancelled')cancelledIds.push(operationId);
      }catch(error){
        if(operationId===id&&error instanceof SessionError&&error.status===409)throw error;
        remainingIds.push(operationId);
        cancellationError='Cancellation could not be confirmed for every request. Check again before continuing.';
      }
    }
    const unresolvedUnpaid=remainingIds.some(operationId=>!updates.has(operationId)||unpaid.has(updates.get(operationId).status)||['unknown','execution_unknown'].includes(updates.get(operationId).status));
    if(batch&&!unresolvedUnpaid){
      // Unquoted drafts have no side effect to undo. Resolve their review so a
      // cancelled partial preparation cannot keep this chat's gate locked.
      for(const draft of batch.drafts)if(!draft.operationId)draft.decision='denied';
      batch.cancelled=true;batch.preparationIncomplete=false;delete batch.preparationError;
    }
    return {...session.operations.get(id),operationUpdates:[...updates.values()],...(batch?{batch}:{}),cancellation:{cancelledIds,remainingIds},...(cancellationError?{cancellationError}:{})};
  }finally{session.actionPreparation=false;}
}
