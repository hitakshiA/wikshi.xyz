import {timingSafeEqual} from 'node:crypto';
import {ApiError} from './catalog.mjs';

// Provider webhooks currently have no documented signing/retry contract. Use
// a private callback token and treat every event ONLY as a reconciliation hint.
// Transcripts, duration, billing, and completion must come from the provider API.
export function receiveVideoEvent(engine,token,event){
  const expected=engine.env.WIKSHI_VIDEO_WEBHOOK_TOKEN;
  if(!/^[A-Za-z0-9_-]{43}$/.test(expected||'')||typeof token!=='string'||token.length!==expected.length||!timingSafeEqual(Buffer.from(token),Buffer.from(expected)))throw new ApiError('not_found',404);
  if(event?.event_type==='test')return {ok:true};
  if(event?.event_type!=='call_ended'||typeof event.call_id!=='string'||event.call_id.length>100)throw new ApiError('invalid_video_event');
  // The worker is coalesced and reads only our durable operations. Never follow
  // an event URL or use its transcript/usage, even with a valid callback token.
  void engine.tick().catch(()=>{});
  return {ok:true};
}
