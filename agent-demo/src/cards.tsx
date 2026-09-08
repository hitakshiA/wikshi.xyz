import React,{useEffect,useRef,useState} from 'react';
import {atomic,safeUrl,scanLink,terminal} from './card-data.mjs';
import './cards.css';
import {Swap} from './motion';
import {WalletChoice} from './wallet-choice';
import {ResearchAttachment} from './research-panel';
import {isResearch,shouldPoll} from './operation-flow.mjs';
import {startResearchPolling,researchTimeLeft,type ResearchPollingState} from './research-polling.mjs';
import artManifest from '../../asset-cdn/manifest.json';

export type Operation={id:string;service:string;status:string;input?:Record<string,any>;paymentRequired?:{accepts:any[]};expiresAt?:string;result?:any;receipt?:any;refund?:any;payment?:any;error?:any;researchStartedAt?:string;researchDeadlineAt?:string;cancellation?:any;clientCancelling?:boolean};
export type DraftBatch={id:string;cancelled?:boolean;preparationIncomplete?:boolean;preparationError?:string;drafts:{id:string;to:string;subject:string;text:string;inboxId?:string;operationId?:string;decision?:'pending'|'approved'|'denied'|'changes_requested';feedback?:string}[]};
const art='/wikshi/art/';
export const artUrl=(file:string)=>`https://wikshi-assets.vercel.app${(artManifest as Record<string,string>)[art+file]}`;
export function Bird({state='welcome'}:{state?:string}) {
  const file=state==='search'?'chat-searching.png':state==='thinking'?'chat-thinking.png':state==='email'?'chat-delivering.png':state==='call'?'meeting-cutout.png':state==='payment'?'metering-cutout.png':'bird-wave-cutout.png';
  return <div className={`bird bird-${state}`} aria-hidden="true"><img src={artUrl(file)} alt=""/>{['search','thinking'].includes(state)&&<span className="thought-dots"><i/><i/><i/></span>}</div>;
}
export function ToolActivity({name}:{name:string}) {
  const state=/search|discover|compan|people|contact|list services/.test(name)?'search':/email|draft|inbox/.test(name)?'email':/call|phone/.test(name)?'call':/pay|prepare operation/.test(name)?'payment':'thinking';
  return <div className={`tool-activity activity-${state}`} role="status"><Bird state={state}/><div><strong>{state==='search'?'Following the leads':state==='email'?'Preparing your correspondence':state==='call'?'Checking the conversation':state==='payment'?'Preparing your payment card':'Working on your mission'}</strong><span>{name||'Connecting the next steps'}<i className="stream-dot">●</i></span></div></div>;
}
export function DataDetails({value}:{value:any}) {
  if(value==null)return null;
  if(typeof value!=='object')return <span className="data-value">{String(value)}</span>;
  return <dl className="data-details">{Object.entries(value).filter(([k])=>!['signedPayload','signature'].includes(k)).map(([k,v])=><div key={k}><dt>{k.replace(/_/g,' ')}</dt><dd>{safeUrl(v)?<a href={safeUrl(v)!} target="_blank" rel="noreferrer">Open link ↗</a>:typeof v==='object'&&v!==null?<details><summary>View details</summary><DataDetails value={v}/></details>:String(v??'Not available')}</dd></div>)}</dl>;
}
function Receipt({op,onRefresh}:{op:Operation;onRefresh?:()=>Promise<void>}) {
  const [refreshError,setRefreshError]=useState('');
  const r=op.receipt;if(!r)return null;
  const currency=r.currency||r.symbol||(r.asset==='0.0.0'?'HBAR':'USDC'),decimals=r.decimals??(currency==='HBAR'?8:6);
  const links=[['Payment',scanLink('transaction',r.paymentTransaction)],['Refund',scanLink('transaction',op.refund?.transaction)],['Topic',scanLink('topic',r.topicId)]];
  return <details className="receipt-disclosure" onToggle={event=>{if(event.target===event.currentTarget&&event.currentTarget.open&&onRefresh){setRefreshError('');void onRefresh().catch(()=>setRefreshError('Could not refresh the receipt. Close and reopen to retry.'));}}}><summary><span aria-hidden="true">▤</span> View receipt</summary><section className="paper-receipt" aria-label="Payment receipt"><div className="receipt-brand">Wikshi <span>x402 / TESTNET</span></div><h3>A record of this request.</h3>{refreshError&&<p role="alert">{refreshError}</p>}<p>{op.service}</p><dl><div><dt>Prepaid</dt><dd>{atomic(r.prepaidAtomic,decimals)} {currency}</dd></div><div className="receipt-total"><dt>Charged</dt><dd>{atomic(r.chargedAtomic,decimals)} {currency}</dd></div><div><dt>Refund due</dt><dd>{atomic(r.refundDueAtomic,decimals)} {currency}</dd></div><div><dt>Units</dt><dd>{r.units} {r.unit}</dd></div><div><dt>Issued</dt><dd>{r.issuedAt}</dd></div></dl><nav aria-label="Receipt explorer links">{links.filter(([,url])=>url).map(([label,url])=><a key={label} href={url!} target="_blank" rel="noreferrer">{label} on HashScan ↗</a>)}</nav><details><summary>Full receipt & identifiers</summary><DataDetails value={r}/>{op.refund&&<DataDetails value={{refund:op.refund}}/>}<p className="receipt-signature">Signature: {r.signature}</p></details></section></details>;
}
export function EmailDrafts({batch,onPrepare,onDecision,busy}:{batch:DraftBatch;onPrepare:(id:string)=>void;onDecision:(id:string,decision:string,feedback?:string)=>void;busy:boolean}) {
  const [editing,setEditing]=useState<string|null>(null),[feedback,setFeedback]=useState('');
  const approved=batch.drafts.filter(d=>d.decision==='approved'),ready=batch.drafts.every(d=>['approved','denied'].includes(d.decision||'')),prepared=batch.drafts.some(d=>d.operationId);
  if(batch.cancelled)return <section className="cancelled-request" role="status"><strong>Email review closed</strong><span>Unpaid requests were cancelled. Any emails already sent remain in your workspace.</span></section>;
  return <section className="draft-batch"><header><span>OUTBOX / DRAFTS</span><h3>A personal note for each person.</h3><p>Approve, pass, or ask for a rewrite. Payment comes after your review.</p></header><div className="draft-grid">{batch.drafts.map((d,i)=><article className={`draft-letter draft-${d.decision||'pending'}`} key={d.id}><div className="letter-top"><span>NOTE {String(i+1).padStart(2,'0')} · {(d.decision||'pending').replaceAll('_',' ')}</span><span className="postage" aria-hidden="true">✉</span></div><p className="letter-recipient">To {d.to}</p><h4>{d.subject}</h4><p className="letter-body">{d.text}</p><div className="draft-actions"><button className="draft-approve" aria-pressed={d.decision==='approved'} disabled={busy||prepared||d.decision==='changes_requested'} onClick={()=>onDecision(d.id,'approved')}>✓ {d.decision==='approved'?'Approved':'Approve'}</button><button className="draft-deny" aria-pressed={d.decision==='denied'} disabled={busy||prepared} onClick={()=>onDecision(d.id,'denied')}>{d.decision==='denied'?'Denied':'Deny'}</button><button className="draft-rewrite" disabled={busy||prepared} onClick={()=>{setEditing(editing===d.id?null:d.id);setFeedback('')}}>Ask for changes</button></div>{editing===d.id&&<form className="draft-feedback" onSubmit={e=>{e.preventDefault();if(feedback.trim()){onDecision(d.id,'changes_requested',feedback.trim());setEditing(null)}}}><label htmlFor={`feedback-${d.id}`}>What should change?</label><textarea id={`feedback-${d.id}`} autoFocus value={feedback} onChange={e=>setFeedback(e.target.value)} maxLength={1500} placeholder="Make it shorter, mention our launch…"/><button className="primary" disabled={busy||!feedback.trim()}>Request rewrite ↗</button></form>}</article>)}</div>
    {batch.preparationIncomplete&&<p className="batch-preparation-notice" role="status">{batch.preparationError||'The payment group is not ready yet. Your approved drafts are saved; retry to finish preparing it.'}</p>}
    <div className="batch-review-footer"><span>{approved.length} approved · {batch.drafts.filter(d=>d.decision==='denied').length} denied</span>{batch.preparationIncomplete?<button className="primary" disabled={busy||!ready||!approved.length} onClick={()=>onPrepare(batch.id)}>{busy?'Preparing…':'Retry payment preparation ↗'}</button>:prepared?<strong>Approved emails moved to payment</strong>:<button className="primary" disabled={busy||!ready||!approved.length} onClick={()=>onPrepare(batch.id)}>Continue with {approved.length} approved {approved.length===1?'email':'emails'} ↗</button>}</div>
  </section>;
}
export function Payment({op,request,onUpdate,onPaid,onRefresh,batchOps,disabled=false}:{op:Operation;request:Function;onUpdate:Function;onPaid:Function;onRefresh?:()=>void|Promise<void>;batchOps?:Operation[];disabled?:boolean}) {
  const quotes=op.paymentRequired?.accepts||[];
  const [sponsorEnabled,setSponsorEnabled]=useState(false),[sponsoring,setSponsoring]=useState(false);
  useEffect(()=>{let alive=true;request('/sponsorship').then((v:any)=>{if(alive)setSponsorEnabled(v.available===true)}).catch(()=>{});return()=>{alive=false}},[]);
  const [currency,setCurrency]=useState(quotes.some(q=>q.asset!=='0.0.0')?'USDC':'HBAR'),[busy,setBusy]=useState(false),[refreshing,setRefreshing]=useState(false),[error,setError]=useState(''),[now,setNow]=useState(Date.now);
  const dialog=useRef<HTMLDialogElement>(null),skip=useRef<HTMLButtonElement>(null);
  const quote=quotes.find(q=>(q.asset==='0.0.0'?'HBAR':'USDC')===currency);
  const payable=(batchOps||[op]).filter(o=>o.status==='awaiting_payment'||o.status==='expired');
  const expired=payable.some(o=>o.status==='expired'||!!o.expiresAt&&Date.parse(o.expiresAt)<=now);
  const total=payable.reduce((sum,o)=>sum+BigInt(o.paymentRequired?.accepts.find(q=>(q.asset==='0.0.0'?'HBAR':'USDC')===currency)?.amount||0),0n).toString();
  const surface=useRef<HTMLDivElement>(null);
  const resetPressure=()=>{const el=surface.current;if(el){el.style.setProperty('--rx','0deg');el.style.setProperty('--ry','0deg');el.style.setProperty('--press','1');el.dataset.pressed='false';}};
  const pressure=(e:React.PointerEvent<HTMLDivElement>)=>{if(e.pointerType==='touch'||matchMedia('(prefers-reduced-motion: reduce)').matches)return;const r=e.currentTarget.getBoundingClientRect(),x=(e.clientX-r.left)/r.width-.5,y=(e.clientY-r.top)/r.height-.5;const force=e.buttons?12:8;e.currentTarget.style.setProperty('--rx',`${-y*force}deg`);e.currentTarget.style.setProperty('--ry',`${x*force}deg`);e.currentTarget.style.setProperty('--press',e.buttons?'.982':'1');e.currentTarget.dataset.pressed=String(!!e.buttons);};
  useEffect(()=>{const t=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(t)},[]);
  const locked=busy||disabled||refreshing;
  const serviceLabel=batchOps?`${payable.length} approved ${payable.length===1?'email':'emails'}`:({
    'discovery.search':'Web search','discovery.companies':'Company search','discovery.people':'People search','discovery.contents':'Read source pages',
    'contacts.enrich':'Find contact details','contacts.phone':'Find a business phone','contacts.reverse':'Look up an email','contacts.company':'Company contacts',
    'phone.call':'Phone call','video.meeting':'Guest video meeting','email.send':'Send email','email.reply':'Reply to email',
    'email.inbox':'Agent inbox','email.inboxes':'Agent inbox','network.inspect':'Network check',
  } as Record<string,string>)[op.service]||op.service.replaceAll('.',' / ');
  const brief=batchOps?payable.map(o=>String(o.input?.to||'Approved recipient')).join(', '):String(op.input?.to||op.input?.phone||op.input?.query||op.input?.mission||op.input?.url||op.input?.email||op.input?.domain||op.input?.linkedinUrl||op.input?.urls?.join(', ')||op.input?.displayName||op.input?.account||'');
  async function refreshQuote(){if(locked||!onRefresh)return;setRefreshing(true);setError('');dialog.current?.close();try{await onRefresh();}catch(e:any){setError(e.message||'Could not refresh this quote. Try again.');}finally{setRefreshing(false);}}
  async function cancelRequest(){if(locked)return;setBusy(true);setError('');try{const item=payable[0];if(!item)return;const next=await request(`/operations/${item.id}/cancel`,{});onUpdate(next);for(const other of next.operationUpdates||[])onUpdate(other);if(next.cancellationError)throw Error(next.cancellationError);dialog.current?.close();}catch(e:any){setError(e.message||'Could not cancel this request. Please try again.');for(const item of payable){try{onUpdate(await request(`/operations/${item.id}`));}catch{}}}finally{setBusy(false);}}
  async function pay(sponsor=false){if(locked)return;setSponsoring(sponsor);setBusy(true);setError('');const updatedResults:Operation[]=[];try{if(!quote||expired)throw Error('Request a fresh quote before paying.');for(const item of payable){const accepted=item.paymentRequired?.accepts.find(q=>(q.asset==='0.0.0'?'HBAR':'USDC')===currency);if(!accepted||Date.parse(item.expiresAt||'')<Date.now())throw Error('A quote expired. Request fresh quotes for the remaining emails.');let updated;if(sponsor)updated=await request(`/operations/${item.id}/sponsor`,{currency,approved:true});else{const {signPayment}=await import('./wallet');updated=await request(`/operations/${item.id}/pay`,{payment:await signPayment(item.id,accepted),approved:true})}onUpdate(updated);updatedResults.push(updated);}dialog.current?.close();}catch(e:any){setError(e.message||'Payment was not completed.')}finally{setBusy(false);if(updatedResults.length)onPaid(op.id,updatedResults)}}
  return <div className="payment-wrap" aria-label={`${serviceLabel} payment`}>
    <div className="payment-surface" ref={surface} onPointerMove={pressure} onPointerDown={pressure} onPointerUp={resetPressure} onPointerLeave={resetPressure} onPointerCancel={resetPressure}>
      <div className="payment-card">
        <div className="payment-top"><img className="x402-mark" src="/wikshi/protocols/x402.svg" alt="x402"/><span>Wikshi</span><span>HEDERA TESTNET</span></div>
        <Bird state="payment"/>
        <p className="card-caption">{serviceLabel}</p>
        <h3>{quote?atomic(total,currency==='HBAR'?8:6):'Unavailable'} <span>{currency}</span></h3>
        <div className="payment-card-controls">
          <div className="currency-switch" role="group" aria-label="Payment currency">{['USDC','HBAR'].map(c=><button key={c} aria-pressed={currency===c} disabled={locked||!quotes.some(q=>(q.asset==='0.0.0'?'HBAR':'USDC')===c)} onClick={()=>setCurrency(c)}><img src={c==='USDC'?'/wikshi/protocols/USDC Token.svg':'/wikshi/protocols/hbar-mark.svg'} alt=""/>{c}</button>)}</div>
          <span className="payment-recipient">{expired?'Quote expired':`To ${quote?.payTo||'Unavailable'}`}</span>
        </div>
      </div>
    </div>
    {brief&&<p className={`payment-brief-summary ${op.input?.to||op.input?.phone||batchOps?'has-recipient':''}`} title={brief}>{brief}</p>}
    <details className="approval-brief"><summary>Request details{batchOps?` · ${payable.length} ${payable.length===1?'signature':'signatures'}`:''}</summary><DataDetails value={batchOps?{emails:payable.map(o=>({to:o.input?.to,subject:o.input?.subject})),signatures:payable.length}:op.input}/><p>{batchOps?`Each approved email is a separate exact x402 payment. Your wallet will ask for ${payable.length} ${payable.length===1?'signature':'signatures'}.`:'You approve this request and the amount shown. Nothing else.'}</p></details>
    {import.meta.env.VITE_WALLETCONNECT_PROJECT_ID&&<WalletChoice disabled={locked}/>}
    <div className="payment-actions">
      <button className="primary" disabled={locked||(expired?!onRefresh:!quote||!import.meta.env.VITE_WALLETCONNECT_PROJECT_ID)} title={!expired&&!import.meta.env.VITE_WALLETCONNECT_PROJECT_ID?'Wallet connection is not configured yet':undefined} onClick={()=>expired?refreshQuote():pay()}>{refreshing?'Refreshing quote…':expired?'Refresh quote ↻':busy?(sponsoring?'Sponsoring…':'Waiting for signature…'):batchOps?`Sign ${payable.length} ${payable.length===1?'payment':'payments'} ↗`:'Pay with wallet ↗'}</button>
      <button ref={skip} className="sponsor-button" disabled={locked||expired||!quote||!sponsorEnabled} onClick={()=>dialog.current?.showModal()}>Sponsor this</button>
    </div>
    <p className="faucet-links">Need test tokens? <a href="https://faucet.circle.com/" target="_blank" rel="noreferrer">USDC ↗</a><a href="https://portal.hedera.com/" target="_blank" rel="noreferrer">HBAR ↗</a></p>
    <button className="payment-cancel" disabled={locked} onClick={cancelRequest}>Cancel request</button>
    {error&&<p role="alert" className="error">{error}</p>}
    <dialog ref={dialog} className="sponsor-dialog" onClose={()=>skip.current?.focus()}><Bird state="payment"/><h2>We’ll pick this one up.</h2><p>Approve {serviceLabel.toLowerCase()} using sponsored testnet {currency}.</p>{error&&<p role="alert">{error}</p>}<button autoFocus className="primary" disabled={locked||expired} onClick={()=>pay(true)}>Approve sponsored payment</button><button className="text-button" disabled={busy} onClick={()=>dialog.current?.close()}>Back</button></dialog>
  </div>;
}
function MeetingInvite({url,onEmail,busy}:{url:string;onEmail:()=>void;busy:boolean}) {
  const [copied,setCopied]=useState(false),[error,setError]=useState('');
  return <div className="meeting-invite"><p>Share this link with your guest, or ask Wikshi to email the invitation. Your guest will speak with your agent about the agenda above.</p><button className="primary" onClick={async()=>{try{await navigator.clipboard.writeText(url);setCopied(true);setError('')}catch{setError('Could not copy the link. Select and copy it below.')}}}>{copied?'Guest link copied ✓':'Copy guest link'}</button><button className="text-button" disabled={busy} onClick={onEmail}>Ask agent to email invitation ↗</button><span role="status" className="sr-only">{copied?'Guest link copied to clipboard':''}</span>{error&&<p role="alert">{error}<input aria-label="Guest invitation link" readOnly value={url} onFocus={e=>e.currentTarget.select()}/></p>}</div>;
}
export function OperationCard({op,request,onUpdate,onCheck,onPaid,onEmail,onRefresh,onOpenResearch,busy}:{op:Operation;request:Function;onUpdate:Function;onCheck:Function;onPaid?:(id:string,operations:Operation[])=>void;onEmail:(id:string)=>void;onRefresh?:(id:string)=>void|Promise<void>;onOpenResearch?:(id:string)=>void;busy:boolean}) {
  const calling=op.service==='phone.call',meeting=op.service==='video.meeting',email=op.service.startsWith('email.'),research=isResearch(op.service),waiting=op.status==='awaiting_payment',active=!waiting&&!terminal.has(op.status);
  const [pollError,setPollError]=useState(''),[checking,setChecking]=useState(false);
  const [researchState,setResearchState]=useState<ResearchPollingState>({phase:'polling',reason:null,remainingMs:120000,error:''});
  const researchPoll=useRef<ReturnType<typeof startResearchPolling>|null>(null),currentOp=useRef(op);currentOp.current=op;
  const pollable=shouldPoll(op),fetcher=useRef(request),updater=useRef(onUpdate);fetcher.current=request;updater.current=onUpdate;
  useEffect(()=>{if(!pollable||research)return;let stopped=false,timer:ReturnType<typeof setTimeout>;const poll=async()=>{try{const next=await fetcher.current(`/operations/${op.id}`);if(!stopped){updater.current(next);setPollError('');if(!shouldPoll(next))return;}}catch{if(!stopped)setPollError('Connection interrupted. Checking again shortly.');}if(!stopped)timer=setTimeout(poll,calling?5000:2000);};timer=setTimeout(poll,1000);return()=>{stopped=true;clearTimeout(timer);};},[op.id,pollable,calling,research]);
  useEffect(()=>{
    if(!research||!pollable)return;
    let marked=false;
    const controller=startResearchPolling({operation:currentOp.current,
      read:signal=>fetcher.current(`/operations/${op.id}`,undefined,'GET',signal),
      cancel:async(reason,signal)=>{try{return await fetcher.current(`/operations/${op.id}/cancel`,{reason},'POST',signal);}catch(error:any){if(error.status===409)return fetcher.current(`/operations/${op.id}`,undefined,'GET',signal);throw error;}},
      onUpdate:next=>updater.current({...next,clientCancelling:false}),
      onState:state=>{setResearchState(state);if(state.phase==='cancelling'&&!marked){marked=true;updater.current({...currentOp.current,clientCancelling:true});}},
    });researchPoll.current=controller;
    const wake=()=>controller.wake();window.addEventListener('online',wake);document.addEventListener('visibilitychange',wake);
    return()=>{controller.dispose();researchPoll.current=null;window.removeEventListener('online',wake);document.removeEventListener('visibilitychange',wake);};
  },[op.id,research,pollable]);
  useEffect(()=>{researchPoll.current?.observe(op);},[op]);
  async function checkStatus(){if(checking)return;setChecking(true);try{await onCheck(op.id);setPollError('');}catch{setPollError('Could not check this request. Retrying automatically.');}finally{setChecking(false);}}
  const title=calling?'A conversation in motion':meeting?'An invitation for your guest':email?'A note from your agent':/people|contact|enrich/.test(op.service)?'People & contacts':'Company research';
  if(op.status==='expired')return <div className="expired-request" data-operation={op.id}><span>This {calling?'call':meeting?'meeting':email?'email':'research'} quote expired.</span>{onRefresh&&<button className="text-button" disabled={busy} onClick={()=>onRefresh(op.id)}>Refresh quote ↻</button>}</div>;
  if(op.status==='cancelled')return <article className="operation research-operation cancelled-operation" data-operation={op.id}><div className="cancelled-request"><strong>{research?(op.cancellation?.reason==='timeout'?'Research timed out':'Research cancelled'):'Request cancelled'}</strong><span>{op.refund?.status==='confirmed'?'Payment refunded.':op.refund?'Refund pending.':op.cancellation?.paymentStatus==='confirmation_pending'?'Payment is being reconciled. Any confirmed payment will be refunded.':op.payment?.confirmed?'Payment details are in your workspace.':'No payment was made.'}</span></div><Receipt op={op} onRefresh={async()=>{updater.current(await fetcher.current(`/operations/${op.id}`));}}/></article>;
  if(research&&!waiting)return <article className="operation research-operation" data-operation={op.id}>
    {op.status==='completed'?<ResearchAttachment op={op} onOpen={()=>onOpenResearch?.(op.id)}/>:<div className="research-progress" role="status" aria-label={active?'Research in progress':'Research outcome'}><Bird state={active?'search':'thinking'}/><div className="research-loading-content"><strong>{active?(researchState.phase==='cancelling'?'Cancelling research…':title):op.status==='failed'?'Research could not finish':'Research update'}</strong><span>{active?(researchState.phase==='cancelling'?'Stopping this request.':/payment/.test(op.status)?'Confirming your payment.':'Searching. Results will appear automatically.'):(op.error?.code||op.status.replaceAll('_',' '))}</span>{active&&<><div className="research-loading-track" aria-hidden="true"><i/></div><div className="research-loading-actions"><span className="research-countdown">{researchState.phase==='cancelling'?'Cancellation pending':`${researchTimeLeft(researchState.remainingMs)} left`}</span><button type="button" disabled={researchState.phase==='cancelling'} onClick={()=>researchPoll.current?.cancel('user')}>Cancel research</button></div></>}{researchState.error&&active&&<small>{researchState.error}</small>}</div></div>}
    <Receipt op={op}/>
  </article>;
  return <article className={`operation tactile-card ${waiting?'op-payment':''} ${calling?'op-call':meeting?'op-meeting':email?'op-email':'op-research'}`} data-operation={op.id}>
    {!waiting&&<><header className="card-header"><span>{calling?'PHONE':meeting?'MEETING':email?'EMAIL':'RESEARCH'}</span>{!(meeting&&op.status==='awaiting_guest')&&<span className={`state-label ${active?'is-active':''}`}>{op.status.replaceAll('_',' ')}</span>}</header><h2 className="card-title">{title}</h2></>}
    <Swap identity={waiting?'payment':'result'}>{waiting?<Payment op={op} request={request} onUpdate={onUpdate} onPaid={onPaid||onCheck} onRefresh={onRefresh?()=>onRefresh(op.id):undefined} disabled={busy}/>:<div className="operation-body">{(calling||meeting)&&<div className={`call-scene ${active?'is-active':''}`}><Bird state="call"/><div><h3>{calling?(active?'Call assigned':op.status==='completed'?'Conversation complete':'Call update'):(op.status==='awaiting_guest'?'Your agent is ready to speak with your guest':'Guest conversation update')}</h3><p>{op.input?.mission}</p>{calling&&<span>{op.input?.phone}</span>}{calling&&active&&<div className="call-wave" aria-label="Awaiting call result">{Array.from({length:9},(_,i)=><i key={i} style={{'--bar':i} as React.CSSProperties}/>)}</div>}</div></div>}{email&&<div className="sent-letter"><Bird state="email"/><div><span>To {op.input?.to||'your contact'}</span><h3>{op.input?.subject||'Email request'}</h3><details><summary>Read the message</summary><p>{op.input?.text}</p></details></div></div>}{meeting&&safeUrl(op.result?.meetingUrl)&&<MeetingInvite url={safeUrl(op.result.meetingUrl)!} onEmail={()=>onEmail(op.id)} busy={busy}/>}<DataDetails value={meeting?Object.fromEntries(Object.entries(op.result||{}).filter(([key])=>!['meetingUrl','scheduledAt'].includes(key))):op.result}/><Receipt op={op}/>{op.error&&<p role="alert">{op.error.code||'This request could not be completed.'}</p>}{pollError&&<p role="status">{pollError}</p>}{pollable&&pollError&&<button className={calling?"call-refresh":"check-button"} disabled={checking} onClick={checkStatus}>{checking?'Checking…':'↻ Check now'}</button>}</div>}</Swap>
  </article>;
}
