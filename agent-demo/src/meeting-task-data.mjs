import {safeUrl} from './card-data.mjs';
import {statusName,transcriptRows} from './workspace-data.mjs';

export function meetingTasks(operations){
  return operations.filter(op=>op.service==='video.meeting'&&
    (safeUrl(op.result?.meetingUrl)||op.status==='completed')).map(op=>({
      id:op.id,
      title:typeof op.input?.mission==='string'&&op.input.mission.trim()||'Guest video meeting',
      status:transcriptRows(op.result).length?'Transcript available':statusName(op.status),
    })).reverse();
}
export function meetingStatusPrompt(meeting){
  return `Check the guest video meeting “${meeting.title}” (request ${meeting.id}). Has anyone attended, has it ended, and is a transcript available? Read the existing meeting’s actual status and summarize its transcript if ready. Do not create another meeting or payment.`;
}
