'use client';
import {useState} from 'react';
export function WorkflowBrief({brief,preview}:{brief:string;preview?:string}){
 const [status,setStatus]=useState('Copy mission');
 async function copy(){try{await navigator.clipboard.writeText('Read '+location.origin+'/wikshi/skills.md.\n\n'+brief+'\n\nUse Wikshi with x402 on Hedera. Ask for my total USDC budget and confirm the quoted network before paid requests. Never invent results, contact details, or successful actions. Confirm before contacting anyone.');setStatus('Copied');}catch{setStatus('Select the text to copy');}}
 return <div className="workflow-brief">{preview?<><p>{preview}</p><details><summary>Read the full mission</summary><p className="mission-prompt">{brief}</p></details></>:<p>{brief}</p>}<button onClick={copy}>{status} <span aria-hidden="true">↗</span></button><span className="sr-only" role="status">{status==='Copied'?'Mission copied to clipboard':''}</span></div>;
}
