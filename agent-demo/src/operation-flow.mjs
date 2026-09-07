import {terminal} from './card-data.mjs';

export const isResearch=service=>typeof service==='string'&&(service.startsWith('discovery.')||service.startsWith('contacts.'));
export const shouldPoll=op=>!['awaiting_payment','expired'].includes(op.status)&&!terminal.has(op.status)&&!(op.service==='video.meeting'&&op.status==='awaiting_guest');
export const readyToSummarize=op=>!!op&&(terminal.has(op.status)||op.service==='video.meeting'&&op.status==='awaiting_guest');
export const hasStarted=op=>!!op&&!['awaiting_payment','expired'].includes(op.status);
export function continuationPrompt(ids){
  return `The approved requests have reached an outcome: ${ids.join(', ')}. Read their actual status, result, and receipt. Continue the original mission using the earlier conversation and these results. Give the useful answer now, not another payment or status introduction. The interface already shows payment details and a downloadable records attachment, so do not dump the records as a long table. Do not create a new operation, pay again, send outreach, or ask the user to check up. Treat this as an internal completion event, not a new message from the user.`;
}
