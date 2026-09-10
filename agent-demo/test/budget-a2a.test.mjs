import test from 'node:test';
import assert from 'node:assert/strict';
import {authorizeBudget,reserveBudget,budgetView} from '../server/budget.mjs';
import {a2aRequest,agentCard} from '../server/a2a.mjs';
const grant={approved:true,currency:'USDC',amountAtomic:'10',services:['discovery.search'],expiresAt:new Date(Date.now()+60000).toISOString()};
const op=id=>({id,service:'discovery.search',paymentRequired:{accepts:[{asset:'0.0.429274',amount:'6',network:'hedera:testnet',scheme:'exact'}]}});
test('budget reserves before submission, does not double reserve retries, and blocks overspend',()=>{
  const s={};authorizeBudget(s,grant);assert.ok(reserveBudget(s,op('1')));assert.ok(reserveBudget(s,op('1')));assert.equal(reserveBudget(s,op('2')),null);assert.equal(budgetView(s).remainingAtomic,'4');
  assert.equal(reserveBudget(s,{...op('3'),service:'email.send'}),null);s.budget.revoked=true;assert.equal(reserveBudget(s,op('4')),null);
});
test('authority requires explicit approval, supported services, bounded amount and future expiry',()=>{
  for(const invalid of [{approved:false},{services:['phone.call']},{amountAtomic:'999999999'},{expiresAt:'invalid'},{currency:'USD'}])assert.throws(()=>authorizeBudget({}, {...grant,...invalid}));
  const s={};authorizeBudget(s,grant);assert.equal(reserveBudget(s,op('1'),Date.now()+120000),null);assert.throws(()=>authorizeBudget(s,grant));
});
test('an expired budget can be replaced with a fresh explicit grant',()=>{
  const now=Date.now(),s={};authorizeBudget(s,grant,now);
  s.budget.expiresAt=new Date(now-1).toISOString();
  assert.equal(reserveBudget(s,op('expired'),now),null);
  authorizeBudget(s,grant,now);assert.equal(budgetView(s).remainingAtomic,'10');
});
test('A2A tasks isolate sessions and deduplicate message IDs',async()=>{
  const s={id:'context'};let calls=0;
  const request={jsonrpc:'2.0',id:1,method:'message/send',params:{message:{role:'user',messageId:'one',parts:[{kind:'text',text:'hello'}]}}};
  const deps={run:async()=>{calls++;return [{type:'text',text:'Hello'}];},cancel:()=>{}};
  const first=await a2aRequest(s,request,deps);await new Promise(r=>setImmediate(r));
  assert.equal((await a2aRequest(s,request,deps)).result.id,first.result.id);assert.equal(calls,1);
  const get={jsonrpc:'2.0',id:2,method:'tasks/get',params:{id:first.result.id}};
  assert.equal((await a2aRequest({},get,deps)).error.code,-32001);assert.equal((await a2aRequest(s,get,deps)).result.status.state,'completed');
  assert.equal(agentCard('https://wikshi.xyz').capabilities.streaming,false);
});
test('A2A cancellation cannot be overwritten by a late model result',async()=>{
  const s={id:'c'};let finish,cancelled=0;const deps={run:()=>new Promise(r=>finish=r),cancel:()=>cancelled++};
  const result=await a2aRequest(s,{jsonrpc:'2.0',id:1,method:'message/send',params:{message:{role:'user',messageId:'one',parts:[{kind:'text',text:'go'}]}}},deps);
  await a2aRequest(s,{jsonrpc:'2.0',id:2,method:'tasks/cancel',params:{id:result.result.id}},deps);finish([]);await new Promise(r=>setImmediate(r));
  assert.equal(result.result.status.state,'canceled');assert.equal(cancelled,1);
});
