import React,{useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import './style.css';
import {Payment,artUrl,Bird,OperationCard,EmailDrafts,ToolActivity,type Operation,type DraftBatch} from './cards';
import {Presence,Swap} from './motion';
import {ToolTrail,type ToolRun} from './tool-trail';
import {readEvents,updateToolRun,appendAssistantText} from './stream.mjs';
import {MessageText} from './message-text';
import {InboxPanel} from './inbox-panel';
import {WorkspaceActivity} from './workspace-activity';
import {terminal} from './card-data.mjs';
import {ResearchPanel} from './research-panel';
import {readyToSummarize,hasStarted,continuationPrompt,deferResearchResult,isResearch,mergeOperation} from './operation-flow.mjs';

type Message={id:string;role:'user'|'assistant';text:string;tools?:ToolRun[]};
type Continuation={messageId:string;ids:string[];retryNeeded?:boolean};
const continuationKey=(group:Continuation)=>`${group.messageId}:${group.ids.join(',')}`;
const missions=[
  {title:'Find the next wave of voice AI, worldwide.',detail:'Map startups → find founders → draft introductions',prompt:'Find 8 emerging voice AI startups worldwide, across at least 3 regions. Ask which use case I care about and my testnet budget first. Build a sourced table with product, location, evidence of recent activity, founder or partnerships lead, and available business contact details. Rank the 3 strongest fits and draft a specific introduction for each. Ask me to approve recipients, drafts, and payment before sending from your inbox. Keep replies together so we can choose who to invite to a video conversation.'},
  {title:'Turn a venue shortlist into real answers.',detail:'Compare spaces → call about availability → report back',prompt:'Help me find a venue for an event. Ask for the city, dates, guest count, venue budget, and testnet service budget. Research 5 suitable spaces and show sources, capacity, and business contact details. Recommend the best 2, then ask me to approve the recipients, call brief, and payment before calling to check availability, pricing, and restrictions. When I ask you to check up, retrieve the actual call results and compare the answers. Do not claim a booking has been made.'},
  {title:'Meet the people who could shape my product.',detail:'Find experts → send invitations → arrange video interviews',prompt:'Help me recruit 5 relevant experts for customer discovery. Ask about my product, target customer, learning goals, and testnet budget. Find people with evidence of relevant experience and available business contact details. Prepare personal email invitations from your inbox and ask me to approve recipients, content, and payment before sending. Use their replies to propose interview times. With my approval, arrange video meetings with a focused question brief, then email the guest links as separate approved paid requests. Retrieve the transcripts when I ask and summarize what we learned without inventing answers.'}
];
function App(){
  const [researchId,setResearchId]=useState<string|null>(null),[continuations,setContinuations]=useState<Continuation[]>([]);
  const continuing=useRef(new Set<string>());
  const [workspaceView,setWorkspaceView]=useState<'workspace'|'inbox'>('workspace'),[activeInboxId,setActiveInboxId]=useState<string|undefined>();
  const [batches,setBatches]=useState<DraftBatch[]>([]),[paymentGroups,setPaymentGroups]=useState<Record<string,string[]>>({});
  const retiredBatchOperations=useRef(new Set<string>());
  const owners=useRef(new Map<string,string>()),batchOwners=useRef(new Map<string,string>());
  const [token,setToken]=useState(''),[messages,setMessages]=useState<Message[]>([]),[operations,setOperations]=useState<Operation[]>([]),[inboxes,setInboxes]=useState<any[]>([]),[input,setInput]=useState(''),[busy,setBusy]=useState(false),[streamingId,setStreamingId]=useState(''),[error,setError]=useState(''),[sidebar,setSidebar]=useState(false);
  const scrollArea=useRef<HTMLDivElement>(null),stickToBottom=useRef(true);
  const [revisingId,setRevisingId]=useState('');
  async function reviseInCard(id:string,feedback:string){
    pending.current=true;setBusy(true);setRevisingId(id);setError('');
    let revised:DraftBatch|undefined,done=false,failed=false;
    try{
      const response=await fetch('/chat-api/message',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${sessionToken.current}`},body:JSON.stringify({message:'Revise the requested email.',revisionId:id})});
      if(!response.ok)throw Error((await response.json()).error||'Could not revise the email.');
      await readEvents(response.body,(event:any)=>{
        if(event.type==='draft_batch'&&event.batch.drafts.some((draft:any)=>draft.id===id))revised=event.batch;
        if(event.type==='done')done=true;
        if(event.type==='error'){failed=true;setError(event.message);}
      });
      if(!done||failed||!revised)throw Error('The rewrite did not finish. Ask for changes again to retry.');
    }catch(error:any){setError(error.message);}
    finally{
      // A confirmed tool update remains real even if the trailing model text
      // disconnects. Publish it when streaming stops, never lose the revision.
      if(revised){const updated=revised;setBatches(all=>all.map(batch=>batch.id===updated.id?updated:batch));}
      setRevisingId('');setBusy(false);pending.current=false;
    }
  }
  const inboxHeading=useRef<HTMLButtonElement>(null);
  const bottom=useRef<HTMLDivElement>(null),composerInput=useRef<HTMLTextAreaElement>(null),pending=useRef(false),sessionToken=useRef('');
  useEffect(()=>{const resize=()=>{const el=composerInput.current;if(!el)return;el.style.height='auto';el.style.height=`${Math.min(el.scrollHeight,window.innerHeight*.4)}px`;};resize();window.addEventListener('resize',resize);return()=>window.removeEventListener('resize',resize);},[input]);
  async function request(path:string,data?:unknown,method=data?'POST':'GET',signal?:AbortSignal){
    const r=await fetch('/chat-api'+path,{method,headers:{'Content-Type':'application/json',Authorization:`Bearer ${sessionToken.current}`},body:data?JSON.stringify(data):undefined,signal});const value=await r.json();if(!r.ok)throw Object.assign(Error(value.error||'Request failed.'),{status:r.status});return value;
  }
  useEffect(()=>{let cancelled=false;fetch('/chat-api/sessions',{method:'POST'}).then(async r=>{if(!r.ok)throw Error('Could not start a chat. Please reload.');return r.json();}).then(s=>{if(cancelled){fetch('/chat-api/session',{method:'DELETE',headers:{Authorization:`Bearer ${s.token}`}});return;}sessionToken.current=s.token;setToken(s.token);}).catch(e=>setError(e.message));
    const heart=setInterval(()=>{if(sessionToken.current)request('/heartbeat',{}).catch(e=>setError(e.message));},20_000);
    const close=()=>{if(sessionToken.current)fetch('/chat-api/session',{method:'DELETE',headers:{Authorization:`Bearer ${sessionToken.current}`},keepalive:true}).catch(()=>{});};
    window.addEventListener('pagehide',close);return()=>{cancelled=true;clearInterval(heart);window.removeEventListener('pagehide',close);close();};
  },[]);
  useEffect(()=>{if(stickToBottom.current&&scrollArea.current)scrollArea.current.scrollTop=scrollArea.current.scrollHeight;},[messages,busy,operations,batches]);
  const update=(incoming:Operation&{batch?:DraftBatch;operationUpdates?:Operation[];cancellationError?:string})=>{const {batch,operationUpdates,cancellationError,...op}=incoming;if(cancellationError)setError(cancellationError);if(batch)setBatches(all=>all.map(item=>item.id===batch.id?batch:item));setOperations(all=>all.some(x=>x.id===op.id)?all.map(x=>x.id===op.id?mergeOperation(x,op):x):[...all,op]);};
  async function send(message=input,automatic=false,targetId?:string,completionIds?:string[]):Promise<boolean>{if(!message.trim()||pending.current||!token)return false;const previous=targetId?messages.find(m=>m.id===targetId):undefined;let streamedText='',finished=false,streamFailed=false,success=false;pending.current=true;setBusy(true);setError('');if(!automatic)setInput('');const assistantId=targetId||crypto.randomUUID();if(!automatic)stickToBottom.current=true;setStreamingId(assistantId);setMessages(all=>targetId&&all.some(m=>m.id===targetId)?all.map(m=>m.id===targetId?{...m,text:'',tools:[]}:m):[...all,...(automatic?[]:[{id:crypto.randomUUID(),role:'user' as const,text:message}]),{id:assistantId,role:'assistant',text:''}]);
    try{const r=await fetch('/chat-api/message',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({message,...(completionIds?{completionIds}:{})})});if(!r.ok){const data=await r.json();throw Error(data.error||'Could not send message.');}
      const event=(e:any)=>{if(e.type==='text'||e.type==='text_boundary'){streamedText=appendAssistantText(streamedText,e);setMessages(all=>all.map(m=>m.id===assistantId?{...m,text:appendAssistantText(m.text,e)}:m));}if(e.type==='operation'){if(!owners.current.has(e.operation.id))owners.current.set(e.operation.id,assistantId);update(e.operation);}if(e.type==='draft_batch'){if(!batchOwners.current.has(e.batch.id))batchOwners.current.set(e.batch.id,assistantId);setBatches(all=>all.some(b=>b.id===e.batch.id)?all.map(b=>b.id===e.batch.id?e.batch:b):[...all,e.batch]);}if(e.type==='inboxes')setInboxes(e.inboxes||[]);if(e.type==='tool')setMessages(all=>all.map(m=>m.id===assistantId?{...m,tools:updateToolRun(m.tools||[],e)}:m));if(e.type==='done')finished=true;if(e.type==='error'){streamFailed=true;setError(e.message||'The agent could not finish this response.');}};
      await readEvents(r.body,event);
      success=finished&&!streamFailed&&(!completionIds||!!streamedText.trim());
      if(!success&&!streamFailed)setError(completionIds?'The summary did not finish. You can retry using the existing result.':'The response stopped before it finished. Please try again.');
      try{const boxes=await request('/inboxes');setInboxes(boxes.inboxes||[]);}catch{/* An inbox refresh failure must not retry a completed model response. */}
    }catch(e:any){setError(e.message);}finally{pending.current=false;setBusy(false);setStreamingId('');setMessages(all=>all.map(m=>m.id===assistantId?completionIds&&!success&&!streamedText.trim()&&previous?{...m,text:previous.text,tools:previous.tools}:{...m,tools:m.tools?.map(t=>t.status==='running'?{...t,status:'interrupted'}:t)}:m));}
    return success;
  }
  const check=async(id:string)=>{const op=await request(`/operations/${id}`);update(op);};
  function paid(_id:string,updated:Operation[]){
    const started=updated.filter(hasStarted);
    const groups=new Map<string,string[]>();
    for(const op of started){const owner=owners.current.get(op.id);if(owner)groups.set(owner,[...(groups.get(owner)||[]),op.id]);}
    setContinuations(all=>{const result=[...all];for(const [messageId,ids] of groups){const index=result.findIndex(item=>item.messageId===messageId);if(index>=0)result[index]={...result[index],ids:[...new Set([...result[index].ids,...ids])]};else result.push({messageId,ids});}return result;});
  }
  useEffect(()=>{
    if(busy||pending.current)return;
    const ready=continuations.find(group=>!group.retryNeeded&&!continuing.current.has(continuationKey(group))&&group.ids.every(id=>{const op=operations.find(op=>op.id===id);return !op?.clientCancelling&&readyToSummarize(op);}));
    if(!ready)return;const key=continuationKey(ready);
    if(continuing.current.has(key))return;continuing.current.add(key);
    if(ready.ids.every(id=>{const op=operations.find(op=>op.id===id);return op&&isResearch(op.service)&&op.status==='cancelled';})){setContinuations(all=>all.filter(group=>continuationKey(group)!==key));return;}
    void send(continuationPrompt(ready.ids),true,ready.messageId,ready.ids).then(success=>setContinuations(all=>success?all.filter(group=>continuationKey(group)!==key):all.map(group=>continuationKey(group)===key?{...group,retryNeeded:true}:group)));
  },[continuations,operations,busy]);
  function retrySummary(messageId:string){if(busy||pending.current)return;const group=continuations.find(item=>item.messageId===messageId&&item.retryNeeded);if(!group)return;continuing.current.delete(continuationKey(group));setContinuations(all=>all.map(item=>item===group?{...item,retryNeeded:false}:item));}
  const activeCalls=operations.filter(op=>op.service==='phone.call'&&op.status!=='awaiting_payment'&&!terminal.has(op.status));
  async function prepareDraft(id:string){if(pending.current)return;setBusy(true);pending.current=true;try{const result=await request(`/draft-batches/${id}/prepare`,{});const currentIds=new Set(result.operations.map((op:Operation)=>op.id));for(const previousId of paymentGroups[id]||[])if(!currentIds.has(previousId))retiredBatchOperations.current.add(previousId);for(const op of result.operationUpdates||[])update(op);for(const op of result.operations){owners.current.set(op.id,batchOwners.current.get(id)!);update(op)}setBatches(all=>all.map(b=>b.id===id?result.batch:b));setPaymentGroups(all=>({...all,[id]:result.operations.map((o:Operation)=>o.id)}));}catch(e:any){setError(e.message)}finally{setBusy(false);pending.current=false}}
  async function decide(id:string,decision:string,feedback=''){if(pending.current)return;pending.current=true;setBusy(true);let changed=false;try{const batch=await request(`/drafts/${id}/decision`,{decision,feedback});setBatches(all=>all.map(b=>b.id===batch.id?batch:b));changed=true;}catch(e:any){setError(e.message)}finally{pending.current=false;setBusy(false)}if(changed&&decision==='changes_requested')void reviseInCard(id,feedback);}
  const emailMeeting=(id:string)=>send(`The visitor selected Email this invitation on meeting operation ${id}. Ask for the recipient email address if missing, then show an email draft card with the real meeting link and context. Do not send or pay until approved.`,true);
  const researchOperation=operations.find(op=>op.id===researchId);
  return <div className={`chat-shell ${researchOperation?'research-is-open':''}`}><header className="chat-header"><a href="https://wikshi.xyz" className="wordmark"><img src={artUrl('messenger-cutout.png')} alt=""/>Wikshi</a><button className="session-button" onClick={()=>setSidebar(!sidebar)} aria-expanded={sidebar}>Your workspace <span aria-hidden="true">↗</span></button></header>
    <main className="chat-main"><section className="conversation" aria-label="Agent conversation">
      <div className="conversation-scroll" ref={scrollArea} onScroll={e=>{const el=e.currentTarget;stickToBottom.current=el.scrollHeight-el.scrollTop-el.clientHeight<100;}} tabIndex={0} aria-label="Conversation history">
      {!messages.length&&<div className="welcome"><h1>Big mission?<br/><em>Send a little bird.</em></h1><p>Research companies. Reach decision-makers. Send emails, make calls, and arrange video conversations. All from one brief.</p><Bird/><div className="starters">{missions.map(s=><button key={s.title} disabled={!token||busy} onClick={()=>setInput(s.prompt)}><span className="mission-copy"><strong>{s.title}</strong><small>{s.detail}</small></span><span aria-hidden="true">↗</span></button>)}</div></div>}
      <div className="messages" role="log" aria-label="Chat messages">{messages.map(m=><div key={m.id} className={`message message-${m.role}`}><span className="message-author">{m.role==='user'?'YOU':'WIKSHI'}</span>{m.tools&&<ToolTrail runs={m.tools}/>}{m.text&&(m.role==='assistant'?<MessageText text={m.text}/>:<p>{m.text}</p>)}<Presence show={streamingId===m.id}><ToolActivity name={m.tools?.find(t=>t.status==='running')?.name.replaceAll('_',' ')||''}/></Presence>{batches.filter(b=>batchOwners.current.get(b.id)===m.id).map(b=><Presence key={b.id} show={streamingId!==m.id}><EmailDrafts batch={b} onPrepare={prepareDraft} onDecision={decide} busy={busy} revisingId={revisingId}/><Presence show={!!paymentGroups[b.id]&&!b.preparationIncomplete&&operations.some(o=>paymentGroups[b.id].includes(o.id)&&['awaiting_payment','expired'].includes(o.status))}>{paymentGroups[b.id]&&!b.preparationIncomplete&&operations.some(o=>paymentGroups[b.id].includes(o.id)&&['awaiting_payment','expired'].includes(o.status))&&<article className="operation email-batch-payment"><Payment disabled={busy} onRefresh={()=>prepareDraft(b.id)} op={operations.find(o=>paymentGroups[b.id].includes(o.id)&&['awaiting_payment','expired'].includes(o.status))!} batchOps={operations.filter(o=>paymentGroups[b.id].includes(o.id))} request={request} onUpdate={update} onPaid={paid}/></article>}</Presence></Presence>)}{operations.filter(op=>owners.current.get(op.id)===m.id&&!retiredBatchOperations.current.has(op.id)&&!(['awaiting_payment','expired'].includes(op.status)&&Object.values(paymentGroups).some(ids=>ids.includes(op.id)))).map(op=><Presence key={op.id} show={streamingId!==m.id&&!(readyToSummarize(op)&&op.status!=='cancelled'&&continuations.some(group=>group.messageId===m.id&&group.ids.includes(op.id))) }><OperationCard key={op.id} op={op} request={request} onUpdate={update} onCheck={check} onPaid={paid} onOpenResearch={id=>{setSidebar(false);setResearchId(id);}} onRefresh={async id=>{await send(`The quote for operation ${id} expired. Prepare one fresh quote with the same service and exact input. Do not pay or add any other operation.`,true,owners.current.get(id));}} onEmail={emailMeeting} busy={busy}/></Presence>)}{continuations.some(group=>group.messageId===m.id&&group.retryNeeded)&&<button type="button" className="text-button summary-retry" style={{minHeight:44}} disabled={busy||!token} onClick={()=>retrySummary(m.id)} title="Use the existing result again. No new payment.">Retry summary</button>}</div>)}</div>

      <Presence show={!!activeCalls.length}><div className="response-watching" role="status">Watching {activeCalls.length===1?'your call':`${activeCalls.length} calls`}. The result will appear here when the conversation ends.</div></Presence>
      <Presence show={!!error}><div className="error" role="alert">{error}</div></Presence><div ref={bottom}/>
      </div>
      <form className="composer" onSubmit={e=>{e.preventDefault();send();}}><label className="sr-only" htmlFor="mission">Your message</label><textarea ref={composerInput} id="mission" disabled={!!revisingId} value={input} maxLength={8000} placeholder="Give me a mission…" rows={2} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();send();}}}/><div>{busy&&<span>Wikshi is working</span>}<button className="send" disabled={!token||busy||!input.trim()} aria-label="Send message">↑</button></div></form>
    </section>
    <aside className={`workspace ${sidebar?'workspace-open':''} ${workspaceView==='inbox'?'workspace-mail':''} ${operations.length?'workspace-active':''}`} aria-label="This chat’s workspace">
      <button className="workspace-close" onClick={()=>setSidebar(false)}>Close workspace ×</button>
      {workspaceView==='inbox'?<InboxPanel inboxes={inboxes} initialInboxId={activeInboxId} request={request} onBack={()=>{setWorkspaceView('workspace');requestAnimationFrame(()=>inboxHeading.current?.focus());}}/>:<>
        <p className="eyebrow">YOUR WORKSPACE</p><h2>From first contact<br/>to next steps.</h2>
        <div className={`inbox-scene ${inboxes.length?'inbox-created':''}`}><div className="paper-envelope" aria-hidden="true">✉</div><img src={artUrl('email-cutout.png')} alt="Wikshi carrying your correspondence"/></div>
        <section className="inbox-panel">
          <h3><button ref={inboxHeading} className="inbox-heading-button" onClick={()=>{setActiveInboxId(inboxes[0]?.id);setWorkspaceView('inbox');}}>Your agent’s inbox <span aria-hidden="true">↗</span></button></h3>
          {inboxes.length?inboxes.map((box,i)=><button className="inbox-account-button" key={box.id||i} onClick={()=>{setActiveInboxId(box.id);setWorkspaceView('inbox');}}><strong>{box.email||box.address||box.emailAddress}</strong><span>Open inbox ↗</span></button>):<p>Your agent’s address will appear here when you create an inbox.</p>}
        </section>
        <WorkspaceActivity operations={operations.filter(op=>!retiredBatchOperations.current.has(op.id))}/>
        <section className="workspace-wallet"><h3>Pay your way.</h3><p>Sign each request in your wallet, or ask Wikshi to sponsor it.</p><div className="token-marks"><img src="/wikshi/protocols/USDC Token.svg" alt=""/>USDC<img className="hbar-mark" src="/wikshi/protocols/hbar-mark.svg" alt=""/>HBAR</div></section>
        <p className="workspace-foot">Chat stays in this tab. Keep any meeting links or receipts you need before closing it.</p>
      </>}
    </aside>
    </main>{researchOperation&&<ResearchPanel op={researchOperation} onClose={()=>setResearchId(null)}/>}<footer className="chat-footer"><span>Powered by Wikshi</span><span>x402 · Hedera testnet</span></footer></div>;
}
createRoot(document.getElementById('root')!).render(<App/>);
