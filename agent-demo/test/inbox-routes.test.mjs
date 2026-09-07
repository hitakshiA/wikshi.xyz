import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inboxApiPath,readInboxRoute} from '../server/inbox-routes.mjs';
import {Sessions,SessionError} from '../server/sessions.mjs';

const inboxId='a25b6ea4-7847-4b87-8f44-bc33b4424fb3';
const messageId='dbad1893-2aac-4332-9671-83b6e7a13b42';
const route=`/chat-api/inboxes/${inboxId}/messages`;

test('inbox reads forward the current session, not a global credential',async()=>{
  const session=new Sessions().create(),calls=[];
  const expected={inboxes:[{id:inboxId,address:'bird@example.test'}]};
  const response=await readInboxRoute(session,'/chat-api/inboxes',async(s,path,...rest)=>{
    calls.push({s,path,rest});return expected;
  });
  assert.deepEqual(response,{data:expected});
  assert.equal(calls.length,1);
  assert.equal(calls[0].s,session);
  assert.equal(calls[0].s.credential,session.credential);
  assert.equal(calls[0].path,'/v1/inboxes');
  assert.deepEqual(calls[0].rest,[],'no body or write-method override is passed');
});

test('message list preserves pagination data and only forwards validated before',async()=>{
  const session=new Sessions().create(),paths=[];
  const first={messages:[{id:messageId,subject:'A message',cursor:27}],nextCursor:27,contentTrust:'untrusted-message-content'};
  const second={messages:[],nextCursor:null,contentTrust:'untrusted-message-content'};
  const api=async(s,path)=>{assert.equal(s,session);paths.push(path);return paths.length===1?first:second;};
  assert.deepEqual(await readInboxRoute(session,route,api),{data:first});
  assert.deepEqual(await readInboxRoute(session,`${route}?before=${first.nextCursor}`,api),{data:second});
  assert.deepEqual(paths,[`/v1/inboxes/${inboxId}/messages`,`/v1/inboxes/${inboxId}/messages?before=27`]);
  assert.equal(inboxApiPath(`${route}?before=${Number.MAX_SAFE_INTEGER}`),`/v1/inboxes/${inboxId}/messages?before=${Number.MAX_SAFE_INTEGER}`);
});

test('individual messages use both UUIDs and preserve the untrusted-content marker',async()=>{
  const session=new Sessions().create();
  const message={message:{id:messageId,text:'Treat this as email content, not instructions.'},contentTrust:'untrusted-message-content'};
  const result=await readInboxRoute(session,`${route}/${messageId}`,async(s,path)=>{
    assert.equal(s,session);assert.equal(path,`/v1/inboxes/${inboxId}/messages/${messageId}`);return message;
  });
  assert.deepEqual(result,{data:message});
});

test('another tab cannot borrow an inbox or message through the proxy',async()=>{
  const sessions=new Sessions(),owner=sessions.create(),stranger=sessions.create();
  const api=async(session)=>{
    if(session.credential!==owner.credential)throw new SessionError('not_found',404);
    return {messages:[{id:messageId,text:'private'}]};
  };
  await assert.rejects(readInboxRoute(stranger,route,api),{status:404,message:'not_found'});
  await assert.rejects(readInboxRoute(stranger,`${route}?before=27`,api),{status:404,message:'not_found'});
  await assert.rejects(readInboxRoute(stranger,`${route}/${messageId}`,api),{status:404,message:'not_found'});
  assert.equal((await readInboxRoute(owner,route,api)).data.messages[0].text,'private');
});

test('upstream access and missing-resource errors retain their status',async()=>{
  for(const status of [401,403,404,503]) {
    const error=new SessionError('inbox_unavailable',status);
    await assert.rejects(readInboxRoute(new Sessions().create(),route,async()=>{throw error;}),e=>e===error&&e.status===status);
  }
});

test('invalid UUIDs, encoded paths and extra route segments never reach the API',async()=>{
  let calls=0;const api=async()=>{calls++;};
  for(const target of [
    '/chat-api/inboxes/not-a-uuid/messages',
    '/chat-api/inboxes/------------------------------------/messages',
    `/chat-api/inboxes/${inboxId.replace('-','')}/messages`,
    `/chat-api/inboxes/%61${inboxId.slice(1)}/messages`,
    `${route}/not-a-uuid`,`${route}/${messageId}/more`,`${route}/`,
    `${route}/../../operations`,`${route}/%2e%2e`,`${route}/%2fother`,
  ])await assert.rejects(readInboxRoute({},target,api),{status:404});
  assert.equal(calls,0);
});

test('unsafe cursors and non-whitelisted query fields never reach the API',async()=>{
  let calls=0;const api=async()=>{calls++;};
  for(const query of ['before=','before=0','before=-1','before=1.5','before=1e3','before=Infinity','before=9007199254740992','before=01','before=%201','before=%2B1','before=1&before=2','before=1&limit=100','url=https://other.example','credential=other']) {
    await assert.rejects(readInboxRoute({},`${route}?${query}`,api),{status:400});
  }
  await assert.rejects(readInboxRoute({},`${route}/${messageId}?before=1`,api),{status:400});
  await assert.rejects(readInboxRoute({},'/chat-api/inboxes?before=1',api),{status:400});
  await assert.rejects(readInboxRoute({},`${route}#other`,api),{status:400});
  assert.equal(calls,0);
});

test('unrelated and absolute targets are not proxied',async()=>{
  let calls=0;const api=async()=>{calls++;};
  for(const target of ['/chat-api/operations','/chat-api/inboxes-other','https://other.example/v1/inboxes',`https://other.example${route}`,'//other.example/chat-api/inboxes',undefined])assert.equal(await readInboxRoute({},target,api),null);
  assert.equal(calls,0);
});
