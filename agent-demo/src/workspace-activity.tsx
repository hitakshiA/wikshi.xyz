import React,{useState} from 'react';
import type {Operation} from './cards';
import {safeUrl} from './card-data.mjs';
import {activityAmount,explorerLinks,requestFields,resultSummary,serviceKind,serviceName,statusName,tokenAmount,transcriptRows} from './workspace-data.mjs';
import './workspace-activity.css';

function ActivityIcon({kind}:{kind:string}){
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind==='calls'?<path d="M7.4 3.5H4.6c-.7 0-1.2.6-1.1 1.3C4.3 13 11 19.7 19.2 20.5c.7.1 1.3-.4 1.3-1.1v-2.8l-4.2-1.9-1.8 2a15.4 15.4 0 0 1-7.2-7.2l2-1.8-1.9-4.2Z"/>:kind==='meetings'?<><rect x="3" y="5.5" width="12" height="13" rx="2.5"/><path d="m15 10 6-3v10l-6-3"/></>:kind==='email'?<><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m4 7 8 6 8-6"/></>:<><path d="M6 3.5h12v17l-3-1.5-3 1.5-3-1.5-3 1.5v-17Z"/><path d="M9 8h6M9 12h6M9 16h3"/></>}
  </svg>;
}
function Fields({fields}:{fields:{label:string;value:string}[]}){
  return <dl className="workspace-receipt-fields">{fields.map(({label,value})=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}
function dateLabel(value:unknown){
  if(typeof value!=='string'||!Number.isFinite(Date.parse(value)))return null;
  return new Date(value).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
}
function GuestLink({value}:{value:unknown}){
  const url=safeUrl(value),[copied,setCopied]=useState(false),[error,setError]=useState(false);
  if(!url)return null;
  // Only our guest doorway and the explicit hosted-video exception belong in this UI.
  if(!['bey.chat','api.wikshi.xyz','wikshi.xyz'].includes(new URL(url).hostname))return null;
  return <div className="workspace-guest-link"><p>Share the invitation with your guest. They’ll talk with your agent about this agenda.</p><button type="button" onClick={async()=>{try{await navigator.clipboard.writeText(url);setCopied(true);setError(false)}catch{setError(true)}}}>{copied?'Copied ✓':'Copy guest invitation'}<span aria-hidden="true">↗</span></button>{copied&&<span className="sr-only" role="status">Guest invitation copied.</span>}{error&&<label>Copy this guest link<input aria-label="Guest invitation link" readOnly value={url} onFocus={e=>e.currentTarget.select()}/></label>}</div>;
}
function ActivityRecord({op}:{op:Operation}){
  const receipt=op.receipt,amount=activityAmount(op),kind=serviceKind(op.service),summary=resultSummary(op),fields=requestFields(op.input),links=explorerLinks(op);
  const transcript=transcriptRows(op.result),[transcriptLimit,setTranscriptLimit]=useState(12);
  const receiptFields=receipt?[
    {label:'Prepaid',value:tokenAmount(receipt.prepaidAtomic,receipt)},
    {label:'Charged',value:tokenAmount(receipt.chargedAtomic,receipt)},
    {label:op.refund?.status==='confirmed'?'Refunded':'Refund due',value:tokenAmount(receipt.refundDueAtomic,receipt)},
    {label:'Billed usage',value:Number.isFinite(receipt.units)?`${receipt.units} ${receipt.unit==='second'?(receipt.units===1?'second':'seconds'):receipt.unit==='request'?(receipt.units===1?'request':'requests'):(receipt.units===1?'unit':'units')}`:null},
    {label:'Duration',value:Number.isFinite(receipt.measuredSeconds)?`${receipt.measuredSeconds} ${receipt.measuredSeconds===1?'second':'seconds'}`:null},
    {label:receipt.unit==='second'?'Per second':receipt.unit==='request'?'Per request':'Rate',value:tokenAmount(receipt.rateAtomic,receipt)},
    {label:'Issued',value:dateLabel(receipt.issuedAt)},
  ].filter((row):row is {label:string;value:string}=>typeof row.value==='string'):[];
  const confirmedRefund=op.refund?.status==='confirmed';
  const refundAmount=op.refund&&tokenAmount(op.refund.amountAtomic,op.refund);
  const identifiers=[{label:'Request',value:op.id},...receipt?[
    {label:'Network',value:receipt.network},
    {label:'Token',value:receipt.asset},
    {label:'Payment transaction',value:receipt.paymentTransaction},
    {label:'Topic',value:receipt.topicId},
    {label:'Result hash',value:receipt.resultHash},
    {label:'Receipt signature',value:receipt.signature},
  ]:[],...confirmedRefund?[{label:'Refund transaction',value:op.refund.transaction}]:[]].filter((row):row is {label:string;value:string}=>typeof row.value==='string'&&row.value.length>0);
  return <details className={`workspace-activity-record activity-${kind}`}>
    <summary><span className="workspace-activity-icon"><ActivityIcon kind={kind}/></span><span className="workspace-activity-label"><strong>{serviceName(op.service)}</strong><small>{statusName(op.status)}</small>{refundAmount&&<small>{confirmedRefund?'Refund confirmed':op.refund?.status==='failed'?'Refund needs attention':'Refund pending'} · {refundAmount}</small>}</span><span className="workspace-activity-amount">{amount&&<><small>{amount.label}</small><span>{amount.value}</span></>}<span className="workspace-activity-chevron" aria-hidden="true">⌄</span></span></summary>
    <div className="workspace-activity-expanded">
      {summary&&<p className="workspace-result-summary">{summary}</p>}
      {fields.length>0&&<details className="workspace-request-details"><summary>{kind==='calls'||kind==='meetings'?'Conversation details':'Request details'}</summary><Fields fields={fields}/></details>}
      {kind==='meetings'&&<GuestLink value={op.result?.meetingUrl}/>}
      {transcript.length>0&&<details className="workspace-transcript"><summary>Read transcript <span>{transcript.length} {transcript.length===1?'message':'messages'}</span></summary><ol>{transcript.slice(0,transcriptLimit).map((row,i)=><li key={i}><strong>{row.role}</strong><p>{row.text}</p></li>)}</ol>{transcriptLimit<transcript.length&&<button type="button" className="workspace-more" onClick={()=>setTranscriptLimit(n=>n+20)}>Show more messages <span>+</span></button>}</details>}
      {receipt?<section className="workspace-paper-receipt" aria-label={`${serviceName(op.service)} receipt`}><div className="workspace-receipt-masthead"><strong>Wikshi</strong><span>x402 RECEIPT</span></div><Fields fields={receiptFields}/>{refundAmount&&<p className="workspace-refund-state">{confirmedRefund?'Refund confirmed':op.refund?.status==='pending'?'Refund pending':'Checking refund'} · {refundAmount}</p>}
      </section>:<p className="workspace-payment-state">{op.payment?.confirmed?`Payment confirmed${amount?` · ${amount.value}`:''}. ${['failed','cancelled'].includes(op.status)?'No completed service receipt.':'Receipt follows the result.'}`:['awaiting_payment','expired','payment_rejected'].includes(op.status)?'No confirmed payment recorded.':['failed','cancelled'].includes(op.status)?'No completed service receipt.':'The request is still in progress.'}{refundAmount&&<span>{confirmedRefund?'Refund confirmed':'Refund pending'} · {refundAmount}</span>}</p>}
      {links.length>0&&<nav className="workspace-explorer-links" aria-label="Receipt HashScan links">{links.map(link=><a href={link.url} key={link.label} target="_blank" rel="noopener noreferrer">{link.label}<span aria-hidden="true">↗</span></a>)}</nav>}
      <details className="workspace-request-identifiers"><summary>{receipt?'Receipt & request identifiers':'Request identifier'}</summary><Fields fields={identifiers}/></details>
    </div>
  </details>;
}
export function WorkspaceActivity({operations}:{operations:Operation[]}){
  const [filter,setFilter]=useState('all'),[limit,setLimit]=useState(8);
  if(!operations.length)return null;
  const records=[...operations].reverse().filter(op=>filter==='all'||serviceKind(op.service)===filter);
  const receiptCount=operations.filter(op=>!!op.receipt).length;
  return <section className="workspace-activity" aria-label="Requests and receipts"><header><h3>Requests & receipts</h3><span>{receiptCount} {receiptCount===1?'receipt':'receipts'}</span></header>
    <div className="workspace-activity-filters" role="group" aria-label="Filter workspace requests">{[['all','All'],['calls','Calls'],['meetings','Meetings']].map(([value,label])=><button type="button" key={value} aria-pressed={filter===value} onClick={()=>{setFilter(value);setLimit(8)}}>{label}</button>)}</div>
    <div className="workspace-activity-list">{records.slice(0,limit).map(op=><ActivityRecord key={op.id} op={op}/>)}{!records.length&&<p className="workspace-activity-empty">Your {filter==='calls'?'phone calls':'guest meetings'} will appear here.</p>}</div>
    {limit<records.length&&<button type="button" className="workspace-more" onClick={()=>setLimit(n=>n+8)}>Show more requests <span>{records.length-limit} more</span></button>}
  </section>;
}
