import {randomUUID} from 'node:crypto';
import {verifyDirectory} from '../../agent-demo/server/directory.mjs';
import {verifyOperation,verifyAnchor} from './verify-receipt.mjs';

if(process.env.WIKSHI_LIVE_TEST!=='research')throw Error('Set WIKSHI_LIVE_TEST=research to authorize a real sponsored research purchase');
const origin='https://wikshi.xyz',apiOrigin='https://api.wikshi.xyz';
let token;
async function request(path,data,method=data?'POST':'GET'){
  const r=await fetch(origin+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:data?JSON.stringify(data):undefined,signal:AbortSignal.timeout(20000)});
  const result=await r.json();if(!r.ok)throw Error(`Request failed (${r.status})`);return result;
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const session=await request('/chat-api/sessions',{});token=session.token;
const heartbeat=setInterval(()=>request('/chat-api/heartbeat',{}).catch(()=>{}),30000);
try{
  const key=await(await fetch(apiOrigin+'/v1/receipt-key')).json();
  const directory=await(await fetch(apiOrigin+'/v1/directory')).json();
  verifyDirectory(directory,key,apiOrigin);
  if(directory.anchor)await verifyAnchor({version:1,type:'directory',manifestHash:directory.hash},directory.anchor);
  console.log(JSON.stringify({directorySignatureVerified:true,directoryHcsVerified:!!directory.anchor}));
  await request('/chat-api/budget',{approved:true,currency:'USDC',amountAtomic:'10',services:['discovery.companies'],expiresAt:new Date(Date.now()+600000).toISOString()});
  const result=await request('/chat-api/a2a',{jsonrpc:'2.0',id:1,method:'message/send',params:{message:{role:'user',messageId:randomUUID(),parts:[{kind:'text',text:'Use the approved research budget to find one company building voice AI for healthcare. Discover the live services first and buy one discovery.companies search with limit 1. Return its actual result and receipt. Do not create an inbox, send email, make a call, or create a meeting.'}]}}});
  if(result.error)throw Error('A2A task rejected');
  const id=result.result.id;let task;
  for(let i=0;i<100;i++){
    await sleep(2000);task=(await request('/chat-api/a2a',{jsonrpc:'2.0',id:2,method:'tasks/get',params:{id}})).result;
    if(task&&task.status.state!=='working')break;
  }
  const events=task?.artifacts?.flatMap(a=>a.parts).filter(p=>p.kind==='data').map(p=>p.data)||[];
  const ops=new Map(events.filter(e=>e.type==='operation').map(e=>[e.operation.id,e.operation]));
  const purchased=[...ops.values()].find(op=>op.receipt);
  console.log(JSON.stringify({taskState:task?.status.state,operations:[...ops.values()].map(op=>({id:op.id,status:op.status,service:op.service})),budget:(await request('/chat-api/budget')).budget}));
  if(!purchased)throw Error('No completed paid research receipt returned');
  let op=purchased;
  for(let i=0;i<30&&!op.audit?.find(a=>a.record.type==='receipt')?.anchor;i++){await sleep(2000);op=await request(`/chat-api/operations/${op.id}`);}
  console.log(JSON.stringify(await verifyOperation(op,key)));
}finally{
  await request('/chat-api/budget',undefined,'DELETE').catch(()=>{});
  clearInterval(heartbeat);
}
