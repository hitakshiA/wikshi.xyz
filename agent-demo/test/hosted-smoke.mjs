// Opt-in hosted model smoke test. No payments, emails, calls, or funding.
import assert from 'node:assert/strict';
const origin=process.env.CHAT_TEST_ORIGIN||'https://wikshi.xyz';
const request=(path,token,body,method=body?'POST':'GET',extra={})=>fetch(origin+'/chat-api'+path,{method,headers:{Origin:origin,'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{ }),...extra},body:body?JSON.stringify(body):undefined});
assert.equal((await request('/health')).status,200);
assert.equal((await request('/sessions',null,{},'POST',{Origin:'https://untrusted.example'})).status,403);
assert.equal((await request('/inboxes','x'.repeat(43))).status,401);
const sessions=[];
try {
  for(let i=0;i<2;i++){const r=await request('/sessions',null,{});assert.equal(r.status,201);sessions.push(await r.json());}
  assert.notEqual(sessions[0].token,sessions[1].token);
  async function turn(s,message){const r=await request('/message',s.token,{message});assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/ndjson/);const events=(await r.text()).trim().split('\n').filter(Boolean).map(JSON.parse);assert(!events.some(e=>e.type==='error'));assert(events.some(e=>e.type==='done'));return events.filter(e=>e.type==='text').map(e=>e.text).join('');}
  await Promise.all(sessions.map((s,i)=>turn(s,`Remember the word ${i?'apricot':'cedar'} for this chat. Reply briefly. Do not use tools.`)));
  const replies=await Promise.all(sessions.map(s=>turn(s,'What word did I ask you to remember? Reply with only the word. Do not use tools.')));
  assert.match(replies[0],/cedar/i);assert.doesNotMatch(replies[0],/apricot/i);
  assert.match(replies[1],/apricot/i);assert.doesNotMatch(replies[1],/cedar/i);
  assert.equal((await request('/operations/00000000-0000-0000-0000-000000000000',sessions[0].token)).status,404);
  console.log('PASS: hosted GLM streaming, concurrent isolated histories, foreign-origin rejection, credential and operation isolation.');
}finally{
  for(const s of sessions){await request('/session',s.token,undefined,'DELETE');assert.equal((await request('/inboxes',s.token)).status,401);}
  console.log('PASS: closed sessions cannot be reused.');
}
