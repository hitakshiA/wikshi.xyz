const summaries={list_services:'Service availability and prices checked.',service_instructions:'Service requirements loaded.',prepare_operation:'Request prepared for your review. Nothing has been paid or sent.',check_operation:'Latest operation status retrieved.',cancel_operation:'Cancellation status checked.',read_inbox:'Inbox details retrieved.',read_messages:'Messages retrieved.',show_email_drafts:'Drafts ready for your review. Nothing has been sent.',revise_email_draft:'Draft revised. Fresh approval is required.'};
// Only a small public projection crosses the stream. Never forward SDK
// snapshots, tool arguments, raw errors, provider payloads or credentials.
export function publicToolEvent(event,started,now=Date.now()) {
  if(!['tool-started','tool-finished'].includes(event.type))return null;
  const id=event.toolCall.toolCallId,name=event.toolCall.toolName;
  if(event.type==='tool-started'){started.set(id,now);return {type:'tool',id,name,status:'running'};}
  const start=started.get(id);started.delete(id);
  const failed=event.message?.content?.some(part=>part.type==='tool-result'&&part.isError);
  return {type:'tool',id,name,status:failed?'failed':'finished',durationMs:start===undefined?undefined:Math.max(0,now-start),summary:failed?'This step could not be completed.':summaries[name]||'Step completed.'};
}
