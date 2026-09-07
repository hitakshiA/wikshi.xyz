import {SessionError} from './sessions.mjs';

const uuid='[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
const messagesRoute=new RegExp(`^/chat-api/inboxes/(${uuid})/messages(?:/(${uuid}))?$`);

// Construct only known read paths. Never forward a browser-supplied URL,
// authorization value, encoded path, or arbitrary query string to the API.
export function inboxApiPath(target) {
  if(typeof target!=='string'||!/^\/chat-api\/inboxes(?:[/?]|$)/.test(target))return null;
  if(target.includes('#'))throw new SessionError('Invalid inbox request.');
  const [path]=target.split('?');
  const params=new URL(target,'http://localhost').searchParams;
  if(path==='/chat-api/inboxes') {
    if([...params].length)throw new SessionError('Invalid inbox query.');
    return '/v1/inboxes';
  }
  const match=messagesRoute.exec(path);
  if(!match)throw new SessionError('Inbox not found.',404);
  const [,inboxId,messageId]=match;
  const values=[...params];
  if(values.some(([key])=>key!=='before')||params.getAll('before').length>1||(messageId&&values.length))throw new SessionError('Invalid inbox query.');
  let suffix='';
  if(params.has('before')) {
    const raw=params.get('before');
    if(!/^[1-9]\d*$/.test(raw)||!Number.isSafeInteger(Number(raw)))throw new SessionError('Invalid message cursor.');
    suffix=`?before=${raw}`;
  }
  return `/v1/inboxes/${inboxId}/messages${messageId?`/${messageId}`:''}${suffix}`;
}

export async function readInboxRoute(session,target,api) {
  const path=inboxApiPath(target);
  if(path===null)return null;
  // The existing API client forwards this session's credential. Backend
  // resource ownership remains authoritative, including every paginated read.
  return {data:await api(session,path)};
}
