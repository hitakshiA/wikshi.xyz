import React from 'react';
import {ToolActivity} from './cards';
import {Presence} from './motion';

export type ToolRun={id:string;name:string;status:string;durationMs?:number;summary?:string};
const labels:Record<string,string>={list_services:'Check available services',service_instructions:'Read service instructions',prepare_operation:'Prepare a payment request',check_operation:'Retrieve results and receipt',cancel_operation:'Cancel unpaid request',read_inbox:'Check your inbox',read_messages:'Read incoming messages',show_email_drafts:'Prepare email drafts',revise_email_draft:'Revise your email'};
export function ToolTrail({runs}:{runs:ToolRun[]}) {
  if(!runs.length)return null;
  const active=runs.filter(t=>t.status==='running'),failed=runs.some(t=>['failed','interrupted'].includes(t.status));
  return <section className="tool-trail" aria-label="Agent tool activity">
    <details><summary><span className={`tool-dot ${active.length?'tool-running':''}`} aria-hidden="true">{active.length?'':failed?'!':'✓'}</span>{active.length?`${active.length} ${active.length===1?'step':'steps'} in progress`:`${runs.length} ${runs.length===1?'step':'steps'} ${failed?'reviewed':'completed'}`}<span className="tool-chevron" aria-hidden="true">⌄</span></summary>
    <ol>{runs.map(t=><li key={t.id} data-status={t.status}><div><strong>{labels[t.name]||t.name.replaceAll('_',' ')}</strong><span>{t.status==='running'?'Working':t.status==='finished'?'Done':t.status==='failed'?'Failed':'Interrupted'}{t.durationMs!==undefined?` · ${(t.durationMs/1000).toFixed(1)}s`:''}</span></div><p>{t.summary|| (t.status==='interrupted'?'Connection ended before this step was confirmed.':'')}</p></li>)}</ol></details>
    <Presence show={active.length>0}><ToolActivity name={active[0]?.name.replaceAll('_',' ')||''}/></Presence>
  </section>;
}
