import {terminal} from './card-data.mjs';

export const isResearch=service=>typeof service==='string'&&(service.startsWith('discovery.')||service.startsWith('contacts.'));
export const shouldPoll=op=>!['awaiting_payment','expired'].includes(op.status)&&(!terminal.has(op.status)||['phone.call','video.meeting'].includes(op.service)&&refundPending(op));
function refundPending(op){
  if(op.refund?.status==='confirmed'||op.refund?.status==='failed')return false;
  if(['pending','confirming','submitting'].includes(op.refund?.status))return true;
  try{return BigInt(op.receipt?.refundDueAtomic||0)>0n;}catch{return false;}
}
export const readyToSummarize=op=>!!op&&(terminal.has(op.status)||op.service==='video.meeting'&&op.status==='awaiting_guest');
export const hasStarted=op=>!!op&&!['awaiting_payment','expired'].includes(op.status);
export const deferResearchResult=(op,streaming,awaitingSummary)=>isResearch(op.service)&&op.status==='completed'&&(streaming||awaitingSummary);
export function mergeOperation(previous,incoming){
  if(!previous)return incoming;
  // Out-of-order status reads must never revive a terminal cancellation.
  if(previous.status==='cancelled'&&incoming.status!=='cancelled')return previous;
  if(previous.clientCancelling&&incoming.status!=='cancelled'&&!Object.hasOwn(incoming,'clientCancelling'))return previous;
  if(terminal.has(previous.status)&&!terminal.has(incoming.status))return previous;
  const merged={...previous,...incoming};
  if(incoming.status==='cancelled')merged.clientCancelling=false;
  if(previous.refund?.status==='confirmed')merged.refund=previous.refund;
  if(previous.payment?.confirmed&&!incoming.payment?.confirmed)merged.payment=previous.payment;
  return merged;
}
export function continuationPrompt(ids){
  return `The approved requests have reached an outcome: ${ids.join(', ')}. Read their actual status, result, and receipt. Continue the original mission using the earlier conversation and these results. Give the useful answer now, not another payment or status introduction. A downloadable records attachment and receipt will appear BELOW your answer only after you finish streaming. Do not say records are above or already visible, and do not dump the records as a long table. Do not create a new operation, pay again, send outreach, or ask the user to check up. Treat this as an internal completion event, not a new message from the user.`;
}
