import {createServer} from 'node:http';
import {Sessions,SessionError} from './sessions.mjs';
import {createRuntime,api,refresh} from './runtime.mjs';
import {requestedRevision,decideDraft,approvedDrafts} from './drafts.mjs';
import {Sponsor} from './sponsor.mjs';
import {beginActionTurn,withBatchPreparation,prepareEmailBatch,assertPaymentGroupReady} from './action-gate.mjs';
import {readInboxRoute} from './inbox-routes.mjs';
import {cancelSessionOperation,parseCancellationRequest,isResearchOperation,rememberOperation} from './cancel-operation.mjs';
import {validateCompletionIds,completionMessage} from './completion-turn.mjs';

const sessions=new Sessions();
const sponsor=new Sponsor();
setInterval(()=>sessions.sweep(),30_000).unref();
const allowedOrigin=process.env.WIKSHI_CHAT_ORIGIN||'http://127.0.0.1:5173';
let activeTurns=0;
const maxConcurrent=Number(process.env.WIKSHI_CHAT_CONCURRENCY||3);
async function body(req){let size=0,parts=[];for await(const part of req){size+=part.length;if(size>65536)throw new SessionError('Request too large.',413);parts.push(part);}try{return JSON.parse(Buffer.concat(parts).toString()||'{}');}catch{throw new SessionError('Invalid request.');}}
function bearer(req){const token=req.headers.authorization?.replace(/^Bearer /,'');if(!/^[\w-]{43}$/.test(token||''))throw new SessionError('Start a new chat.',401);return token;}
export const server=createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');res.setHeader('X-Content-Type-Options','nosniff');
  const send=(status,data)=>{res.writeHead(status);res.end(JSON.stringify(data));};
  try{
    if(req.headers.origin && req.headers.origin!==allowedOrigin)throw new SessionError('Origin not allowed.',403);
    const path=new URL(req.url,'http://localhost').pathname;
    if(req.method==='GET'&&path==='/chat-api/health')return send(200,{ok:!!process.env.CLINE_API_KEY,model:'cline-pass/glm-5.3'});
    if(req.method==='POST'&&path==='/chat-api/sessions'){const s=sessions.create();return send(201,{token:s.token,id:s.id,model:'cline-pass/glm-5.3',sponsorship:sponsor.info()});}
    const token=bearer(req),session=sessions.get(token);
    if(req.method==='POST'&&path==='/chat-api/heartbeat')return send(200,{ok:true});
    if(req.method==='DELETE'&&path==='/chat-api/session'){sessions.close(token);return send(200,{ok:true});}
    if(req.method==='POST'&&path==='/chat-api/message'){
      const data=await body(req);if(typeof data.message!=='string'||!data.message.trim()||data.message.length>8000)throw new SessionError('Write a message under 8,000 characters.');
      return await sessions.exclusive(token,async s=>{
        if(activeTurns>=maxConcurrent)throw new SessionError('All agents are busy. Please try again shortly.',503);
        const completion=Object.hasOwn(data,'completionIds')?await validateCompletionIds(s,data.completionIds,id=>refresh(s,id)):null;
        const revision=Object.hasOwn(data,'revisionId')?requestedRevision(s,data.revisionId):null;
        if(Object.hasOwn(data,'revisionId')&&(!revision||revision.decision!=='changes_requested'||completion))throw new SessionError('Choose an email awaiting your requested changes.',409);
        const emit=event=>{if(!res.destroyed)res.write(JSON.stringify(event)+'\n');};
        // An emit indirection keeps follow-up turns on their own response stream.
        s.emit=emit;s.agent??=createRuntime(s,event=>s.emit?.(event));beginActionTurn(s);
        s.revisionId=revision?.id;
        if(completion){s.readOnlyContinuation=true;s.actionTurn.claimed=true;}
        activeTurns++;s.turns=(s.turns||0)+1;
        const timeout=setTimeout(()=>s.agent.abort('Response time limit'),120_000);
        res.writeHead(200,{'Content-Type':'application/x-ndjson','X-Accel-Buffering':'no'});
        res.flushHeaders();
        if(completion)for(const operation of completion)emit({type:'operation',operation});
        const keepAlive=setInterval(()=>emit({type:'heartbeat'}),15_000);
        const onClose=()=>{if(!res.writableEnded)s.agent.abort('Connection closed');};res.on('close',onClose);
        try{const result=await s.agent.run(completion?completionMessage(completion.map(op=>op.id)):revision?`Revise only email draft ${revision.id} using revise_email_draft. Requested changes: ${revision.feedback}. Preserve its recipient. Update the existing draft, do not prepare any other action. The interface shows the update in its card; no separate explanation is needed.`:data.message);if(result.status==='failed')emit({type:'error',message:'The agent could not finish this request. Please try again.'});emit({type:'done'});}catch{emit({type:'error',message:'The agent could not connect. Your message has not triggered a payment.'});}
        finally{clearTimeout(timeout);clearInterval(keepAlive);activeTurns--;s.emit=null;s.readOnlyContinuation=false;s.revisionId=null;res.end();res.off('close',onClose);}
      });
    }
    const match=/^\/chat-api\/operations\/([a-f0-9-]{36})(?:\/(pay|sponsor|cancel))?$/.exec(path);
    const decisionMatch=/^\/chat-api\/drafts\/([a-f0-9-]{36})\/decision$/.exec(path);
    if(req.method==='POST'&&decisionMatch)return await sessions.exclusive(token,async s=>{
      if([...(s.draftBatches?.values()||[])].some(batch=>batch.preparationIncomplete&&batch.drafts.some(draft=>draft.id===decisionMatch[1])))throw new SessionError('Retry the remaining quotes for this approved batch before changing its drafts.',409);
      const data=await body(req);return send(200,decideDraft(s,decisionMatch[1],data.decision,data.feedback));
    });
    const draftMatch=/^\/chat-api\/draft-batches\/([a-f0-9-]{36})\/prepare$/.exec(path);
    if(req.method==='POST'&&draftMatch)return await sessions.exclusive(token,async s=>{
      const drafts=approvedDrafts(s,draftMatch[1]);
      const operationUpdates=[];
      return withBatchPreparation(s,draftMatch[1],async id=>{const op=await refresh(s,id);operationUpdates.push(op);return op;},async()=>{
      const boxes=await api(s,'/v1/inboxes');
      const prepared=await prepareEmailBatch(s,s.draftBatches.get(draftMatch[1]),drafts,boxes.inboxes,(input,key)=>api(s,'/v1/operations',{service:'email.send',input},'POST',key));
      return send(200,{...prepared,operationUpdates});
      });
    });
    if(match){
      const [_,id,action]=match;
      if(!session.operations.has(id))throw new SessionError('Operation not found.',404);
      if(req.method==='GET'&&!action)return send(200,await refresh(session,id));
      if(req.method==='POST'&&action==='cancel'){
        const options=parseCancellationRequest(await body(req));
        const cancel=async s=>{const result=await cancelSessionOperation(s,id,api,options);for(const operation of result.operationUpdates)s.emit?.({type:'operation',operation});return send(200,result);};
        return isResearchOperation(session.operations.get(id))?await cancel(session):await sessions.exclusive(token,cancel);
      }
      if(req.method==='POST'&&action==='sponsor')return await sessions.exclusive(token,async s=>{
        const data=await body(req);if(data.approved!==true)throw new SessionError('Approve this sponsored payment first.');
        assertPaymentGroupReady(s,id);
        let op=await refresh(s,id);if(op.status!=='awaiting_payment')return send(200,op);
        const payment=await sponsor.payment(s,op,data.currency);
        op=await api(s,`/v1/operations/${id}/pay`,{payment});
        return send(200,rememberOperation(s,op));
      });
    }
    if(req.method==='GET'&&path==='/chat-api/sponsorship')return send(200,{...sponsor.info(),account:session.sponsorAccount||null});
    if(match){
      const [_,id,action]=match;
      if(req.method==='POST'&&action==='pay')return await sessions.exclusive(token,async s=>{
        const data=await body(req),stored=s.operations.get(id);
        if(data.approved!==true)throw new SessionError('Review and approve this operation first.');
        assertPaymentGroupReady(s,id);
        if(stored.status!=='awaiting_payment')return send(200,await refresh(s,id));
        const q=stored.paymentRequired?.accepts?.find(q=>q.asset===data.payment?.accepted?.asset);
        if(!q||JSON.stringify(q)!==JSON.stringify(data.payment.accepted))throw new SessionError('The signed quote does not match this operation.');
        const op=await api(s,`/v1/operations/${id}/pay`,{payment:data.payment});return send(200,rememberOperation(s,op));
      });
    }
    if(req.method==='GET'){
      const inboxResponse=await readInboxRoute(session,req.url,api);
      if(inboxResponse)return send(200,inboxResponse.data);
    }
    throw new SessionError('Not found.',404);
  }catch(e){if(res.headersSent){res.end();return;}send(e instanceof SessionError?e.status:500,{error:e instanceof SessionError?e.message:'Request could not be completed.'});}
});
server.listen(Number(process.env.PORT||8081),'127.0.0.1',()=>console.log('Wikshi agent server listening on 127.0.0.1:8081'));
