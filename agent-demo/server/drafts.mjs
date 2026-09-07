import {randomUUID} from 'node:crypto';
import {SessionError} from './sessions.mjs';

export function createDraftBatch(session,drafts) {
  if(!Array.isArray(drafts)||drafts.length<1||drafts.length>4)throw new SessionError('Prepare between one and four email drafts per batch.');
  const clean=drafts.map(d=>{
    if(!d||typeof d.to!=='string'||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.to)||d.to.length>254||typeof d.subject!=='string'||!d.subject.trim()||d.subject.length>200||/[\r\n]/.test(d.subject)||typeof d.text!=='string'||!d.text.trim()||d.text.length>10000)throw new SessionError('Each draft needs a recipient, subject, and message.');
    return {id:randomUUID(),to:d.to,subject:d.subject,text:d.text,...(d.inboxId?{inboxId:d.inboxId}:{})};
  });
  session.drafts??=new Map();for(const draft of clean)session.drafts.set(draft.id,draft);
  return {id:randomUUID(),drafts:clean};
}
