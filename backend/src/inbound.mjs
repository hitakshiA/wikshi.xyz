import {createHmac,timingSafeEqual} from 'node:crypto';
import {ApiError,emailAddress} from './catalog.mjs';

function mailbox(value) {
  if(typeof value!=='string' || /[\r\n]/.test(value))return undefined;
  const address=value.match(/^[^<>]*<([^<>]+)>$/)?.[1]||value;
  return emailAddress(address)?address:undefined;
}

// Svix raw-body HMAC contract. Timestamp, event identity and body are all signed.
export function verifyWebhook(raw,headers,secret,now=Date.now()) {
  const id=headers['svix-id'], timestamp=headers['svix-timestamp'], signatures=headers['svix-signature'];
  if(!secret?.startsWith('whsec_'))throw new ApiError('receiving_unavailable',503);
  if(typeof id!=='string' || !/^[\w-]{1,200}$/.test(id) || typeof timestamp!=='string' || !/^\d{10}$/.test(timestamp) || Math.abs(now/1000-Number(timestamp))>300 || typeof signatures!=='string')throw new ApiError('invalid_webhook',401);
  const expected=createHmac('sha256',Buffer.from(secret.slice(6),'base64')).update(`${id}.${timestamp}.`).update(raw).digest();
  const valid=signatures.split(' ').some(s=>{if(!s.startsWith('v1,'))return false;const bytes=Buffer.from(s.slice(3),'base64');return bytes.length===expected.length && timingSafeEqual(bytes,expected);});
  if(!valid)throw new ApiError('invalid_webhook',401);
  let event;try{event=JSON.parse(raw.toString());}catch{throw new ApiError('invalid_webhook');}
  return {id,event};
}

export async function receiveEmail(engine,raw,headers) {
  const {id,event}=verifyWebhook(raw,headers,engine.env.RESEND_WEBHOOK_SECRET);
  const {store,providers}=engine;
  if(store.db.prepare('SELECT id FROM mail_events WHERE id=?').get(id))return {received:true};
  if(event.type!=='email.received')return {received:true};
  const source=event.data?.email_id;
  if(typeof source!=='string' || !/^[a-f0-9-]{36}$/i.test(source) || !Array.isArray(event.data?.to))throw new ApiError('invalid_mail_event');
  const inboxes=event.data.to.filter(emailAddress).map(address=>store.inboxForAddress(address)).filter(Boolean);
  if(!inboxes.length){store.db.prepare('INSERT OR IGNORE INTO mail_events VALUES(?,?)').run(id,Date.now());return {received:true};}
  // Fetch only a signed event's ID, never a callback URL or a global mailbox list.
  // A transient failure returns 503, allowing signed delivery retry without message duplication.
  const mail=await providers.mail(`/emails/receiving/${encodeURIComponent(source)}?html_format=cid`);
  if(mail.id!==source || !Array.isArray(mail.to))throw new ApiError('mail_not_ready',503);
  const rfc=typeof mail.message_id==='string' && /^<[^\r\n<>]{1,500}>$/.test(mail.message_id)?mail.message_id:undefined;
  const data={direction:'inbound',from:mailbox(mail.from)||mail.from,to:mail.to,subject:mail.subject,text:mail.text??null,html:mail.html??null,
    replyTo:Array.isArray(mail.reply_to)?mailbox(mail.reply_to[0]):undefined,
    rfcMessageId:rfc,createdAt:mail.created_at,contentTrust:'untrusted-message-content',
    attachments:(mail.attachments||[]).map(a=>({filename:a.filename,contentType:a.content_type,size:a.size,downloadAvailable:false}))};
  store.atomic(()=>{
    if(store.db.prepare('SELECT id FROM mail_events WHERE id=?').get(id))return;
    for(const inbox of inboxes)store.putMessage(inbox.id,`inbound:${source}`,data);
    store.db.prepare('INSERT INTO mail_events VALUES(?,?)').run(id,Date.now());
  });
  return {received:true};
}
