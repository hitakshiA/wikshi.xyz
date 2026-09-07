// Opt-in live model/quote test. Never approves, pays, funds, emails, or calls.
import assert from 'node:assert/strict';
const origin=process.env.CHAT_TEST_ORIGIN||'https://wikshi.xyz';
let token;
const request=(path,body,method=body?'POST':'GET')=>fetch(`${origin}/chat-api${path}`,{method,headers:{Origin:origin,'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(150_000)});
try {
  const created=await request('/sessions',{});assert.equal(created.status,201);token=(await created.json()).token;
  async function turn(message) {
    const response=await request('/message',{message});assert.equal(response.status,200);
    const events=(await response.text()).trim().split('\n').filter(Boolean).map(JSON.parse);
    assert(!events.some(event=>event.type==='error'));assert(events.some(event=>event.type==='done'));
    return events;
  }
  const first=await turn('hey find some startups doing ai receptionists');
  const operations=first.filter(event=>event.type==='operation').map(event=>event.operation);
  assert.equal(new Set(operations.map(operation=>operation.id)).size,1,'First response must prepare exactly one card');
  assert(operations.every(operation=>operation.status==='awaiting_payment'));
  assert.equal(first.filter(event=>event.type==='draft_batch').length,0);
  const id=operations[0].id;
  const next=await turn('also queue up a company database search while i decide on this payment');
  assert(next.filter(event=>event.type==='operation').every(event=>event.operation.id===id&&event.operation.status==='awaiting_payment'),'Pending approval must not be bypassed');
  assert.equal(next.filter(event=>event.type==='draft_batch').length,0);
  const status=await request(`/operations/${id}`);assert.equal(status.status,200);assert.equal((await status.json()).status,'awaiting_payment');
  console.log(`PASS: live GLM prepared one unpaid card and retained it across a follow-up. ${first.filter(event=>event.type==='text_boundary').length} paragraph boundaries emitted. No payments or outreach.`);
}finally{if(token)await request('/session',undefined,'DELETE');}
