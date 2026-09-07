// Opt-in live checks. Quotes and cancellation only, never payment or provisioning.
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';

const origin=process.env.WIKSHI_TEST_API_ORIGIN||'https://api.wikshi.xyz';
const credential=randomBytes(32).toString('base64url');
const outstanding=new Set();
async function request(path,body){
  const response=await fetch(origin+path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${credential}`,'Content-Type':'application/json',...(path==='/v1/operations'?{'Idempotency-Key':randomUUID()}:{})},body:body?JSON.stringify(body):undefined});
  return {status:response.status,data:await response.json()};
}
async function quote(service,input){
  const response=await request('/v1/operations',{service,input});
  assert.equal(response.status,402,JSON.stringify(response.data));
  outstanding.add(response.data.id);
  assert.equal(response.data.status,'awaiting_payment');
  return response.data;
}
try{
  const catalog=await request('/v1/services');
  assert.equal(catalog.status,200);
  const inbox=catalog.data.services.find(service=>service.id==='email.inbox');
  assert.equal(inbox.enabled,true,'explicit inbox service must be available');
  assert(inbox.prices.some(price=>price.currency==='USDC'));
  assert(inbox.prices.some(price=>price.currency==='HBAR'));
  assert.deepEqual((await request('/v1/inboxes')).data.inboxes,[]);
  const research=await quote('discovery.search',{query:'Wikshi deployment quote-only smoke check',limit:1});
  const cancelled=await request(`/v1/operations/${research.id}/cancel`,{});
  assert.equal(cancelled.status,200);
  assert.equal(cancelled.data.status,'cancelled');outstanding.delete(research.id);
  assert.equal((await request(`/v1/operations/${research.id}/cancel`,{})).data.status,'cancelled');
  const mailbox=await quote('email.inbox',{displayName:'Quote-only smoke check'});
  assert.deepEqual((await request('/v1/inboxes')).data.inboxes,[],'an unpaid inbox quote must not provision a mailbox');
  const inboxCancelled=await request(`/v1/operations/${mailbox.id}/cancel`,{});
  assert.equal(inboxCancelled.data.status,'cancelled');outstanding.delete(mailbox.id);
  assert.deepEqual((await request('/v1/inboxes')).data.inboxes,[]);
  console.log('PASS: live catalog, dual-asset inbox quote, authoritative cancellation, idempotent cancellation, next request and no unsolicited inbox. No payment made.');
}finally{
  for(const id of outstanding){
    const response=await request(`/v1/operations/${id}/cancel`,{});
    assert.equal(response.data.status,'cancelled','smoke quote cleanup must be confirmed');
  }
}
