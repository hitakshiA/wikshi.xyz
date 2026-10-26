import {SessionError} from './sessions.mjs';

const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const unpaid=new Set(['awaiting_payment','expired']);
export const isResearchOperation=op=>typeof op?.service==='string'&&/^(discovery|contacts)\./.test(op.service);

export function parseCancellationRequest(value={}){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>key!=='reason')||value.reason!==undefined&&!['user','timeout'].includes(value.reason))throw new SessionError('Cancellation reason must be user or timeout.',400);
  return {reason:value.reason||'user'};
}

// A delayed poll/payment response must not resurrect research whose backend
// cancellation has already been observed. Later refund updates still merge.
export function rememberOperation(session,incoming){
  if(!incoming||!session.operations.has(incoming.id)||typeof incoming.status!=='string')throw new SessionError('Operation status could not be verified.',503);
  const previous=session.operations.get(incoming.id);
  if(isResearchOperation(previous)&&previous.status==='cancelled'&&incoming.status!=='cancelled')return previous;
  const saved={...previous,...incoming};session.operations.set(incoming.id,saved);return saved;
}

async function cancelResearch(session,id,request,reason){
  session.researchCancellations??=new Map();
  const previous=session.researchCancellations.get(id);
  if(previous?.reason===reason)return previous.promise;
  // Cancelling a card is not permission for a running model response to prepare
  // replacement work. A later real visitor message starts a fresh action turn.
  session.actionTurn??={claimed:false};session.actionTurn.claimed=true;
  const execute=async()=>{
    const remember=op=>{if(op?.id!==id)throw new SessionError('Cancellation status could not be verified.',503);return rememberOperation(session,op);};
    let current=remember(await request(session,`/v1/operations/${id}`));
    if(current.id!==id||!isResearchOperation(current))throw new SessionError('This request is not a research operation.',409);
    if(current.status!=='cancelled'){
      try{current=remember(await request(session,`/v1/operations/${id}/cancel`,{reason},'POST'));}
      catch(error){
        try{current=remember(await request(session,`/v1/operations/${id}`));}catch{}
        if(current.status!=='cancelled')throw error instanceof SessionError?error:new SessionError('Cancellation could not be confirmed. Check this request again.',503);
      }
    }
    if(current.status!=='cancelled')throw new SessionError('Cancellation could not be confirmed. Check this request again.',409);
    return {...current,operationUpdates:[current],cancellation:{...current.cancellation,cancelledIds:[id],remainingIds:[]}};
  };
  // One operation can be cancelled while a model streams, without sharing the
  // broad session busy lock. Identical requests coalesce; differing reasons wait.
  const promise=(previous?previous.promise.catch(()=>{}):Promise.resolve()).then(execute);
  const entry={reason,promise};session.researchCancellations.set(id,entry);
  try{return await promise;}finally{if(session.researchCancellations.get(id)===entry)session.researchCancellations.delete(id);}
}

// Used by both the direct card action and the agent tool. Updating the actual
// backend operation, not a hidden-card flag, releases the next-action gate.
export async function cancelSessionOperation(session,id,request,options={}){
  if(!uuid.test(id)||!session.operations.has(id))throw new SessionError('Operation not found.',404);
  const {reason}=parseCancellationRequest(options);
  if(isResearchOperation(session.operations.get(id)))return cancelResearch(session,id,request,reason);
  if(reason==='timeout')throw new SessionError('Automatic cancellation applies only to research requests.',400);
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
      const saved=rememberOperation(session,op);updates.set(op.id,saved);return saved;
    };
    for(const operationId of ids){
      let current;
      try{
        current=remember(await request(session,`/v1/operations/${operationId}`));
        if(operationId===id&&!unpaid.has(current.status)&&current.status!=='cancelled')throw new SessionError('This request has already started payment or execution and cannot be cancelled as an unpaid request.',409);
        if(unpaid.has(current.status)){
          try{current=remember(await request(session,`/v1/operations/${operationId}/cancel`,{reason},'POST'));}
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
    return {...session.operations.get(id),operationUpdates:[...updates.values()],...(batch?{batch}:{}),cancellation:{...session.operations.get(id).cancellation,cancelledIds,remainingIds},...(cancellationError?{cancellationError}:{})};
  }finally{session.actionPreparation=false;}
}
