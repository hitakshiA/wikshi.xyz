import {createServer} from 'node:http';
import {Sessions,SessionError} from './sessions.mjs';
import {createRuntime,api,refresh} from './runtime.mjs';

const sessions=new Sessions();
setInterval(()=>sessions.sweep(),30_000).unref();
const allowedOrigin=process.env.WIKSHI_CHAT_ORIGIN||'http://127.0.0.1:5173';
async function body(req){let size=0,parts=[];for await(const part of req){size+=part.length;if(size>65536)throw new SessionError('Request too large.',413);parts.push(part);}try{return JSON.parse(Buffer.concat(parts).toString()||'{}');}catch{throw new SessionError('Invalid request.');}}
function bearer(req){const token=req.headers.authorization?.replace(/^Bearer /,'');if(!/^[\w-]{43}$/.test(token||''))throw new SessionError('Start a new chat.',401);return token;}
export const server=createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');res.setHeader('X-Content-Type-Options','nosniff');
  const send=(status,data)=>{res.writeHead(status);res.end(JSON.stringify(data));};
  try{
    if(req.headers.origin && req.headers.origin!==allowedOrigin)throw new SessionError('Origin not allowed.',403);
    const path=new URL(req.url,'http://localhost').pathname;
    if(req.method==='POST'&&path==='/chat-api/sessions'){const s=sessions.create();return send(201,{token:s.token,id:s.id,model:'cline-pass/glm-5.3',sponsorship:{hbar:10,usdc:0.5,available:false}});}
    const token=bearer(req),session=sessions.get(token);
    if(req.method==='POST'&&path==='/chat-api/heartbeat')return send(200,{ok:true});
    if(req.method==='DELETE'&&path==='/chat-api/session'){sessions.close(token);return send(200,{ok:true});}
    if(req.method==='POST'&&path==='/chat-api/message'){
      const data=await body(req);if(typeof data.message!=='string'||!data.message.trim()||data.message.length>8000)throw new SessionError('Write a message under 8,000 characters.');
      return await sessions.exclusive(token,async s=>{
        const emit=event=>{if(!res.destroyed)res.write(JSON.stringify(event)+'\n');};
        // An emit indirection keeps follow-up turns on their own response stream.
        s.emit=emit;s.agent??=createRuntime(s,event=>s.emit?.(event));
        res.writeHead(200,{'Content-Type':'application/x-ndjson','X-Accel-Buffering':'no'});
        const onClose=()=>{if(!res.writableEnded)s.agent.abort('Connection closed');};res.on('close',onClose);
        try{const result=await s.agent.run(data.message);if(result.status==='failed')emit({type:'error',message:'The agent could not finish this request. Please try again.'});emit({type:'done'});}catch{emit({type:'error',message:'The agent could not connect. Your message has not triggered a payment.'});}
        finally{s.emit=null;res.end();res.off('close',onClose);}
      });
    }
    const match=/^\/chat-api\/operations\/([a-f0-9-]{36})(?:\/(pay|sponsor))?$/.exec(path);
    if(match){
      const [_,id,action]=match;
      if(!session.operations.has(id))throw new SessionError('Operation not found.',404);
      if(req.method==='GET'&&!action)return send(200,await refresh(session,id));
      if(req.method==='POST'&&action==='sponsor')throw new SessionError('Sponsorship is not available right now. You can use your testnet wallet.',503);
      if(req.method==='POST'&&action==='pay')return await sessions.exclusive(token,async s=>{
        const data=await body(req),stored=s.operations.get(id);
        if(data.approved!==true)throw new SessionError('Review and approve this operation first.');
        if(stored.status!=='awaiting_payment')return send(200,await refresh(s,id));
        const q=stored.paymentRequired?.accepts?.find(q=>q.asset===data.payment?.accepted?.asset);
        if(!q||JSON.stringify(q)!==JSON.stringify(data.payment.accepted))throw new SessionError('The signed quote does not match this operation.');
        const op=await api(s,`/v1/operations/${id}/pay`,{payment:data.payment});s.operations.set(id,{...stored,...op});return send(200,s.operations.get(id));
      });
    }
    if(req.method==='GET'&&path==='/chat-api/inboxes')return send(200,await api(session,'/v1/inboxes'));
    throw new SessionError('Not found.',404);
  }catch(e){if(res.headersSent){res.end();return;}send(e instanceof SessionError?e.status:500,{error:e instanceof SessionError?e.message:'Request could not be completed.'});}
});
server.listen(Number(process.env.PORT||8081),'127.0.0.1',()=>console.log('Wikshi agent server listening on 127.0.0.1:8081'));
