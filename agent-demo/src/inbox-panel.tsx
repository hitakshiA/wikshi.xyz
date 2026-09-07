import React,{useCallback,useEffect,useRef,useState} from 'react';
import {artUrl} from './cards';
import './inbox-panel.css';

type Inbox={id:string;email?:string;address?:string;emailAddress?:string};
type Mail={id:string;direction?:string;from?:string;to?:string[]|string;subject?:string;text?:string|null;html?:string|null;createdAt?:string;attachments?:{filename?:string}[]};
type Props={inboxes:Inbox[];initialInboxId?:string;request:(path:string,data?:unknown,method?:string)=>Promise<any>;onBack:()=>void};
type Folder='inbound'|'outbound'|'all';

function mailText(mail:Mail){
  if(typeof mail.text==='string'&&mail.text.trim())return mail.text;
  if(typeof mail.html!=='string')return '';
  // Email is untrusted. Extract text without constructing HTML nodes, loading
  // remote content, or allowing an email to add controls to this workspace.
  return mail.html.slice(0,1_000_000)
    .replace(/<!--[\s\S]*?-->/g,'').replace(/<(script|style|head)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'')
    .replace(/<br\s*\/?\s*>|<\/(p|div|li|tr|h[1-6])\s*>/gi,'\n').replace(/<[^>]*>/g,'')
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(_,entity:string)=>{
      const named:Record<string,string>={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '};
      if(entity[0]!=='#')return named[entity.toLowerCase()]||'';
      const code=entity[1].toLowerCase()==='x'?parseInt(entity.slice(2),16):Number(entity.slice(1));
      return code>0&&code<=0x10ffff&&!(code>=0xd800&&code<=0xdfff)?String.fromCodePoint(code):'';
    }).replace(/\n[ \t]+/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
}
function addressOf(inbox?:Inbox){return inbox?.email||inbox?.address||inbox?.emailAddress||'';}
function recipients(mail:Mail){return Array.isArray(mail.to)?mail.to.join(', '):mail.to||'';}
function correspondent(mail:Mail){return mail.direction==='outbound'?recipients(mail):mail.from||'Unknown sender';}
function shortName(value:string){return value.match(/^([^<]+)\s*</)?.[1].trim().replace(/^"|"$/g,'')||value;}
function dateOf(value?:string,full=false){
  const date=value?new Date(value):null;
  if(!date||Number.isNaN(date.getTime()))return '';
  return full?date.toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'}):date.toLocaleDateString(undefined,{month:'short',day:'numeric'});
}
function Icon({name}:{name:'back'|'search'|'refresh'|'mail'|'arrow'}){
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{name==='back'?<path d="m14 6-6 6 6 6M8 12h12"/>:name==='search'?<><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></>:name==='refresh'?<><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.1 6.1a8 8 0 0 1 13.3 3.1M4.6 14.8a8 8 0 0 0 13.3 3.1"/></>:name==='arrow'?<path d="m9 6 6 6-6 6"/>:<><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4 7 8 6 8-6"/></>}</svg>;
}

export function InboxPanel({inboxes,initialInboxId,request,onBack}:Props){
  const [inboxId,setInboxId]=useState(initialInboxId||inboxes[0]?.id||'');
  const [messages,setMessages]=useState<Mail[]>([]),[loadedInboxId,setLoadedInboxId]=useState(''),[nextCursor,setNextCursor]=useState<number|null>(null);
  const [folder,setFolder]=useState<Folder>('inbound'),[query,setQuery]=useState('');
  const [loading,setLoading]=useState(false),[loadingOlder,setLoadingOlder]=useState(false),[error,setError]=useState('');
  const [selected,setSelected]=useState<Mail|null>(null),[readInboxId,setReadInboxId]=useState(''),[reading,setReading]=useState(false),[readError,setReadError]=useState('');
  const fetcher=useRef(request),listSequence=useRef(0),readSequence=useRef(0),mounted=useRef(true);
  const panel=useRef<HTMLElement>(null),readerHeading=useRef<HTMLHeadingElement>(null),lastMessage=useRef<string|null>(null);
  fetcher.current=request;
  const ids=inboxes.map(box=>box.id).join('|');
  useEffect(()=>{if(!inboxes.some(box=>box.id===inboxId))setInboxId(inboxes[0]?.id||'');},[ids,inboxId]);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;listSequence.current++;readSequence.current++;};},[]);

  const loadMessages=useCallback(async(before?:number)=>{
    if(!inboxId){setLoading(false);setLoadingOlder(false);setError('');return;}
    const sequence=++listSequence.current;
    setError('');if(before===undefined)setLoading(true);else setLoadingOlder(true);
    try{
      const data=await fetcher.current(`/inboxes/${encodeURIComponent(inboxId)}/messages${before===undefined?'':`?before=${encodeURIComponent(before)}`}`);
      if(!mounted.current||sequence!==listSequence.current)return;
      const incoming:Mail[]=Array.isArray(data.messages)?data.messages.filter((mail:Mail)=>mail&&typeof mail.id==='string'):[];
      setMessages(previous=>before===undefined?incoming:[...previous,...incoming.filter(mail=>!previous.some(old=>old.id===mail.id))]);
      setLoadedInboxId(inboxId);
      setNextCursor(Number.isSafeInteger(data.nextCursor)&&data.nextCursor>0?data.nextCursor:null);
    }catch(e){if(mounted.current&&sequence===listSequence.current)setError(e instanceof Error?e.message:'Could not load your mail. Try again.');}
    finally{if(mounted.current&&sequence===listSequence.current){setLoading(false);setLoadingOlder(false);}}
  },[inboxId]);
  useEffect(()=>{
    setMessages([]);setNextCursor(null);setSelected(null);setReadError('');setQuery('');setFolder('inbound');setReading(false);setLoadingOlder(false);
    readSequence.current++;loadMessages();
    return()=>{listSequence.current++;readSequence.current++;};
  },[loadMessages]);

  async function openMessage(mail:Mail){
    const sequence=++readSequence.current;
    lastMessage.current=mail.id;setSelected(mail);setReadInboxId(inboxId);setReading(true);setReadError('');
    try{
      const data=await fetcher.current(`/inboxes/${encodeURIComponent(inboxId)}/messages/${encodeURIComponent(mail.id)}`);
      if(!mounted.current||sequence!==readSequence.current)return;
      if(!data.message||data.message.id!==mail.id)throw Error('Could not load this message. Try again.');
      setSelected(data.message);
    }catch(e){if(mounted.current&&sequence===readSequence.current)setReadError(e instanceof Error?e.message:'Could not load this message. Try again.');}
    finally{if(mounted.current&&sequence===readSequence.current)setReading(false);}
  }
  useEffect(()=>{if(selected)readerHeading.current?.focus();},[selected?.id]);
  function backToMessages(){readSequence.current++;setSelected(null);setReading(false);setReadError('');requestAnimationFrame(()=>{const buttons=panel.current?.querySelectorAll<HTMLButtonElement>('[data-mail-id]');Array.from(buttons||[]).find(button=>button.dataset.mailId===lastMessage.current)?.focus();});}
  const search=query.trim().toLocaleLowerCase();
  const visible=(loadedInboxId===inboxId?messages:[]).filter(mail=>(folder==='all'||mail.direction===folder)&&(!search||[mail.from,recipients(mail),mail.subject,mailText(mail)].join(' ').toLocaleLowerCase().includes(search)));
  const box=inboxes.find(inbox=>inbox.id===inboxId);
  return <section className="mail-workspace" aria-label="Agent email inbox" ref={panel}>
    <header className="mail-toolbar"><button className="mail-back" onClick={onBack}><Icon name="back"/>Back to workspace</button><span className="mail-private"><Icon name="mail"/></span></header>
    <div className="mail-account"><div className="mail-title-row"><h2>Inbox</h2><button className={`mail-icon-button ${loading?'mail-refreshing':''}`} disabled={!inboxId||loading||loadingOlder} onClick={()=>loadMessages()} aria-label="Refresh inbox"><Icon name="refresh"/></button></div>
      {inboxes.length>1?<><label className="sr-only" htmlFor="mail-account">Agent inbox</label><select id="mail-account" value={inboxId} onChange={event=>setInboxId(event.target.value)}>{inboxes.map(inbox=><option key={inbox.id} value={inbox.id}>{addressOf(inbox)}</option>)}</select></>:<p className="mail-address" title={addressOf(box)}>{addressOf(box)||'Your agent’s correspondence'}</p>}
    </div>
    {!selected||readInboxId!==inboxId?<>
      <div className="mail-filters"><label className="mail-search"><Icon name="search"/><input type="search" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Search loaded mail" aria-label="Search loaded mail"/></label><div className="mail-folders" role="group" aria-label="Mail folder">{([['inbound','Inbox'],['outbound','Sent'],['all','All']] as const).map(([value,label])=><button key={value} aria-pressed={folder===value} onClick={()=>setFolder(value)}>{label}</button>)}</div></div>
      <div className="mail-content" aria-busy={loading||loadingOlder}>
        {error&&<div className="mail-error" role="alert"><p>{error}</p><button onClick={()=>loadMessages()} disabled={loading}>Try again</button></div>}
        {loading&&!messages.length?<div className="mail-loading" role="status"><span className="mail-loading-envelope"><Icon name="mail"/></span>Opening your mail…</div>:visible.length?<ul className="mail-list">{visible.map(mail=><li key={mail.id}><button className="mail-row" data-mail-id={mail.id} onClick={()=>openMessage(mail)}><span className="mail-row-top"><strong>{mail.direction==='outbound'?'To: ':''}{shortName(correspondent(mail))||'Unknown recipient'}</strong><time dateTime={mail.createdAt}>{dateOf(mail.createdAt)}</time></span><span className="mail-subject">{mail.subject||'(No subject)'}</span><span className="mail-snippet">{mailText(mail).replace(/\s+/g,' ').trim()||'Open message to read'}</span><span className="mail-row-arrow"><Icon name="arrow"/></span></button></li>)}</ul>:!error&&<div className="mail-empty"><img src={artUrl('email-cutout.png')} alt=""/><h3>{search?'No matches in loaded mail':folder==='outbound'?'No sent messages yet':'No messages here yet'}</h3><p>{search?'Try a name, address, or subject.':folder==='outbound'?'Emails your agent sends will appear here.':'Replies to your agent will appear here.'}</p></div>}
        {nextCursor!==null&&<button className="mail-older" disabled={loading||loadingOlder} onClick={()=>loadMessages(nextCursor)}>{loadingOlder?'Loading older mail…':'Load older messages'}</button>}
      </div>
    </>:<div className="mail-reader mail-content" aria-busy={reading}><button className="mail-back mail-reader-back" onClick={backToMessages}><Icon name="back"/>Messages</button><h3 ref={readerHeading} tabIndex={-1}>{selected.subject||'(No subject)'}</h3><dl className="mail-metadata"><div><dt>From</dt><dd>{selected.from||'Unknown sender'}</dd></div><div><dt>To</dt><dd>{recipients(selected)||addressOf(box)}</dd></div>{selected.createdAt&&<div><dt>Date</dt><dd>{dateOf(selected.createdAt,true)}</dd></div>}</dl>
      {reading?<div className="mail-loading" role="status">Loading message…</div>:readError?<div className="mail-error" role="alert"><p>{readError}</p><button onClick={()=>openMessage(selected)}>Try again</button></div>:<><div className="mail-body">{mailText(selected)||'This email has no text content.'}</div>{!!selected.attachments?.length&&<div className="mail-attachments"><h4>Attachments</h4>{selected.attachments.map((item,index)=><p key={index}>{item.filename||'Attachment'}</p>)}</div>}</>}
    </div>}
  </section>;
}
