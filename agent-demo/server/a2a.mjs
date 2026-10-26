import {randomUUID} from 'node:crypto';

export function agentCard(origin) {
  return {name:'Wikshi',description:'Research people and companies, find business contacts, and arrange email, phone, and video conversations through paid services on Hedera.',
    url:`${origin}/chat-api/a2a`,version:'1.0.0',protocolVersion:'0.3.0',preferredTransport:'JSONRPC',
    capabilities:{streaming:false,pushNotifications:false},defaultInputModes:['text/plain'],defaultOutputModes:['text/plain','application/json'],
    securitySchemes:{session:{type:'http',scheme:'bearer',description:'Create a session with POST /chat-api/sessions. Keep its token private and send a heartbeat within two minutes.'}},security:[{session:[]}],
    skills:[{id:'research-and-communication',name:'Research and communication',description:'Discover services, prepare quotes and drafts, and retrieve purchased results. Payment and outreach approval are separate. Research can use an explicitly authorized session budget.',tags:['research','email','x402','hedera']} ]};
}
const terminal=new Set(['completed','failed','canceled','rejected']);
export async function a2aRequest(session,request,{run,cancel}) {
  const id=request?.id??null;
  const error=(code,message)=>({jsonrpc:'2.0',id,error:{code,message}});
  if(request?.jsonrpc!=='2.0'||!['string','number'].includes(typeof request.id)||!request.method)return error(-32600,'Invalid Request');
  session.a2aTasks??=new Map();session.a2aMessages??=new Map();
  const params=request.params||{};
  if(request.method==='tasks/get'||request.method==='tasks/cancel') {
    const task=session.a2aTasks.get(params.id);if(!task)return error(-32001,'Task not found');
    if(request.method==='tasks/cancel') {
      if(terminal.has(task.status.state))return error(-32002,'Task cannot be canceled');
      cancel(task.id);task.status={state:'canceled',timestamp:new Date().toISOString()};
    }
    return {jsonrpc:'2.0',id,result:task};
  }
  if(request.method!=='message/send')return error(-32601,'Method not found');
  if(session.a2aMessages.size>=200)return error(-32602,'Session message limit reached');
  const message=params.message;
  if(message?.role!=='user'||typeof message.messageId!=='string'||message.messageId.length>128||!message.messageId||!Array.isArray(message.parts)||!message.parts.length||message.parts.some(p=>p.kind!=='text'||typeof p.text!=='string'))return error(-32602,'A user message with text parts and a messageId is required');
  const text=message.parts.map(p=>p.text).join('\n');if(!text.trim()||text.length>8000)return error(-32602,'Message must contain 1 to 8000 characters');
  const prior=session.a2aMessages.get(message.messageId);
  if(prior){if(prior.text!==text)return error(-32602,'messageId already used for different content');return {jsonrpc:'2.0',id,result:session.a2aTasks.get(prior.taskId)};}
  if(message.contextId&&message.contextId!==session.id)return error(-32602,'Unknown context');
  let task=message.taskId?session.a2aTasks.get(message.taskId):null;
  if(message.taskId&&!task)return error(-32001,'Task not found');
  if(task&&task.status.state!=='input-required')return error(-32602,'Task cannot accept more input');
  if([...session.a2aTasks.values()].some(t=>t.status.state==='working'))return error(-32602,'A task is already working');
  if(!task&&session.a2aTasks.size>=30)return error(-32602,'Session task limit reached');
  task??={kind:'task',id:randomUUID(),contextId:session.id,history:[]};
  task.history.push(message);task.status={state:'working',timestamp:new Date().toISOString()};
  session.a2aTasks.set(task.id,task);session.a2aMessages.set(message.messageId,{text,taskId:task.id});
  // Return immediately; authenticated tasks/get retrieves progress and artifacts.
  void Promise.resolve().then(()=>run(text,task.id)).then(events=>{
    if(task.status.state==='canceled')return;
    const answer=events.filter(e=>e.type==='text').map(e=>e.text).join('');
    const data=events.filter(e=>['operation','draft_batch','inboxes','suggestions'].includes(e.type));
    const operations=new Map(data.filter(e=>e.type==='operation').map(e=>[e.operation.id,e.operation]));
    const needsInput=data.some(e=>e.type==='draft_batch')||[...operations.values()].some(op=>!['completed','failed','cancelled','expired','payment_rejected'].includes(op.status));
    task.artifacts=[{artifactId:randomUUID(),parts:[{kind:'text',text:answer||'Check the structured results for this task.'},...data.map(e=>({kind:'data',data:e}))]}];
    task.status={state:events.some(e=>e.type==='error')?'failed':needsInput?'input-required':'completed',timestamp:new Date().toISOString()};
  }).catch(()=>{if(task.status.state!=='canceled')task.status={state:'failed',timestamp:new Date().toISOString()};});
  return {jsonrpc:'2.0',id,result:task};
}
