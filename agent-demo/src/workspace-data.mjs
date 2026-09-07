import {atomic,rowsOf,scanLink} from './card-data.mjs';

const names={
  'discovery.search':'Web search','discovery.companies':'Company search','discovery.people':'People search','discovery.contents':'Source pages',
  'contacts.enrich':'Contact details','contacts.phone':'Business phone','contacts.reverse':'Email lookup','contacts.company':'Company contacts',
  'phone.call':'Phone call','video.meeting':'Guest video meeting','email.send':'Send email','email.reply':'Email reply',
  'email.inbox':'Agent inbox','network.inspect':'Network check',
};
export const serviceName=service=>names[service]||String(service||'Service request').replaceAll('.',' / ');
export const serviceKind=service=>service==='phone.call'?'calls':service==='video.meeting'?'meetings':String(service).startsWith('email.')?'email':'research';
export function statusName(status){
  return ({awaiting_payment:'Awaiting payment',verifying_payment:'Verifying payment',settling_payment:'Settling payment',confirming_payment:'Confirming payment',
    payment_rejected:'Payment rejected',queued:'Queued',dispatching:'Starting',running:'In progress',awaiting_guest:'Invitation created',joining:'Connecting',
    completed:'Completed',failed:'Failed',cancelled:'Cancelled',expired:'Quote expired',execution_unknown:'Checking outcome'})[status]||'Checking status';
}
export function tokenAmount(value,metadata={}){
  const currency=metadata.currency||metadata.symbol||(metadata.asset==='0.0.0'?'HBAR':metadata.asset==='0.0.429274'?'USDC':undefined);
  if(!['HBAR','USDC'].includes(currency))return null;
  const formatted=atomic(value,metadata.decimals??(currency==='HBAR'?8:6));
  return formatted==='Not available'?null:`${formatted} ${currency}`;
}
export function activityAmount(op){
  if(op.receipt){const value=tokenAmount(op.receipt.chargedAtomic,op.receipt);if(value)return {label:'Charged',value};}
  if(op.payment?.confirmed){const value=tokenAmount(op.payment.amountAtomic,op.payment);if(value)return {label:'Prepaid',value};}
  if(op.status==='awaiting_payment'||op.status==='expired'){
    const quote=op.paymentRequired?.accepts?.[0],value=quote&&tokenAmount(quote.amount,quote);
    if(value)return {label:'Quoted',value};
  }
  return null;
}
export function explorerLinks(op){
  const links=[];
  // A quote, an unconfirmed transfer, and arbitrary provider URLs are not explorer evidence.
  if(op.receipt){
    const payment=scanLink('transaction',op.receipt.paymentTransaction),topic=scanLink('topic',op.receipt.topicId);
    if(payment)links.push({label:'Payment on HashScan',url:payment});
    if(topic)links.push({label:'Topic on HashScan',url:topic});
  }
  if(op.refund?.status==='confirmed'){
    const refund=scanLink('transaction',op.refund.transaction);
    if(refund)links.push({label:'Refund on HashScan',url:refund});
  }
  return links;
}
function readable(value){
  if(['string','number','boolean'].includes(typeof value))return String(value);
  if(Array.isArray(value)&&value.every(x=>['string','number','boolean'].includes(typeof x)))return value.map(String).join('\n');
  return null;
}
export function requestFields(input={}){
  const fields={to:'To',phone:'Phone',subject:'Subject',mission:'Agenda',questions:'Questions',query:'Search',limit:'Requested results',
    firstName:'First name',lastName:'Last name',domain:'Company domain',email:'Email',linkedinUrl:'Profile',title:'Role',
    url:'Source',urls:'Sources',page:'Results page',account:'Account',displayName:'Inbox name',text:'Message'};
  return Object.entries(fields).flatMap(([key,label])=>{
    const value=readable(input?.[key]);return value===null||value===''?[]:[{label,value}];
  });
}
export function resultSummary(op){
  const result=op.result;
  if(!result||typeof result!=='object')return null;
  const rows=rowsOf(result);
  if(rows.length)return `${rows.length} ${/people|contact|enrich/.test(op.service)?'contact':'source'} ${rows.length===1?'record':'records'} returned`;
  if(op.service?.startsWith('email.')&&result.status==='accepted')return 'Accepted for delivery';
  if(op.service==='video.meeting'&&op.status==='awaiting_guest')return 'Guest invitation is ready to share';
  return null;
}
export function transcriptRows(result){
  if(!Array.isArray(result?.transcript))return [];
  return result.transcript.flatMap(row=>{
    if(!row||typeof row!=='object')return [];
    const content=row.text??row.content??row.message;
    if(typeof content!=='string'||!content.trim())return [];
    const role=typeof row.role==='string'?row.role:typeof row.speaker==='string'?row.speaker:'Speaker';
    return [{role,text:content}];
  });
}
