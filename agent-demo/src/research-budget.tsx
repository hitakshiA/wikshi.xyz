import React,{useEffect,useState} from 'react';
const services=['discovery.search','discovery.people','discovery.companies','discovery.contents','contacts.enrich','contacts.phone','contacts.reverse','contacts.company'];
const names=['Web search','People search','Company search','Read pages','Business email lookup','Business phone lookup','Reverse contact lookup','Company contacts'];
const format=(atomic:string,currency:string)=>Number(atomic)/10**(currency==='USDC'?6:8);
export function ResearchBudget({request,disabled}:{request:(path:string,body?:any,method?:string)=>Promise<any>;disabled:boolean}) {
  const [budget,setBudget]=useState<any>(null),[currency,setCurrency]=useState('USDC'),[amount,setAmount]=useState('0.001'),[selected,setSelected]=useState(services.slice(0,4)),[working,setWorking]=useState(false),[error,setError]=useState('');
  useEffect(()=>{if(disabled)return;let alive=true;const read=()=>request('/budget').then(r=>{if(alive)setBudget(r.budget);}).catch(()=>{});read();const timer=setInterval(read,15000);return()=>{alive=false;clearInterval(timer);};},[disabled]);
  const active=budget&&!budget.revoked&&Date.parse(budget.expiresAt)>Date.now();
  async function change(revoke=false){
    setWorking(true);setError('');
    try{
      let data;
      if(revoke)data=await request('/budget',undefined,'DELETE');
      else{
        const decimals=currency==='USDC'?6:8;
        if(!new RegExp(`^\\d+(\\.\\d{1,${decimals}})?$`).test(amount))throw Error('Enter a valid amount.');
        const [whole,fraction='']=amount.split('.');
        const amountAtomic=(BigInt(whole)*10n**BigInt(decimals)+BigInt(fraction.padEnd(decimals,'0'))).toString();
        data=await request('/budget',{approved:true,currency,amountAtomic,services:selected,expiresAt:new Date(Date.now()+30*60000).toISOString()});
      }
      setBudget(data.budget);
    }catch(e){setError(e instanceof Error?e.message:'Could not update the budget.');}finally{setWorking(false);}
  }
  return <details className="research-budget"><summary>Research budget{active?' · active':''}</summary>
    {active?<><p>{format(budget.remainingAtomic,budget.currency)} {budget.currency} remaining until {new Date(budget.expiresAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}.</p><button type="button" disabled={working} onClick={()=>change(true)}>{working?'Stopping…':'Stop automatic payments'}</button></>:<>
      <p>Let Wikshi buy selected research within a sponsored testnet budget. Up to 10 purchases over 30 minutes. Emails, calls and meetings still need separate approval.</p>
      <label>Currency <select value={currency} onChange={e=>setCurrency(e.target.value)}><option>USDC</option><option>HBAR</option></select></label>
      <label>Maximum spend <input inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)} aria-label="Maximum research spend"/></label>
      <fieldset><legend>Allowed services</legend>{services.map((s,i)=><label key={s}><input type="checkbox" checked={selected.includes(s)} onChange={e=>setSelected(old=>e.target.checked?[...old,s]:old.filter(x=>x!==s))}/>{names[i]}</label>)}</fieldset>
      <button type="button" disabled={disabled||working||!selected.length} onClick={()=>change()}>{working?'Authorizing…':'Authorize research budget'}</button>
    </>}{error&&<p role="alert">{error}</p>}
  </details>;
}
