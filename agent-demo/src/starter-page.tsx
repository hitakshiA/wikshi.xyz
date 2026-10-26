import React from 'react';
import {artUrl} from './cards';
import './starter-page.css';

const tools=[
  ['Web research','Find people, companies, news, and niche information. Read the web to dig deeper.'],
  ['People & contacts','Find people and look up available email addresses, phone numbers, and business profiles.'],
  ['Email & inbox','Send emails, maintain an inbox, read replies, and continue conversations on your behalf.'],
  ['Live phone calls','Call someone for you, ask your questions, follow up, and bring back the answers.'],
  ['Async video calls','Share a 5-minute video link. Your AI hosts the conversation and gets answers without you joining.'],
];
export const starterPrompts=[
  {title:'Research a market',prompt:'Find four AI receptionist startups. Compare their products and customers, and explain what makes each different.'},
  {title:'Find people to talk to',prompt:'Find founders at voice AI startups, then help me draft an introduction to the people we pick.'},
  {title:'Arrange a conversation',prompt:'Help me arrange a short video meeting and email the guest link. Ask who it’s for and what we need to learn.'},
];

export function StarterPage({disabled,onSelect}:{disabled:boolean;onSelect:(prompt:string)=>void}){
  return <section className="starter-page" aria-labelledby="starter-heading">
    <header className="starter-intro"><div><h1 id="starter-heading">Research, reach out, and get answers.</h1><p>Tell Wikshi what to find out—and who to ask.</p></div><div className="bird"><img src={artUrl('starter-research-mail.png')} width={104} height={104} alt="" decoding="async"/></div></header>
    <section className="starter-tools" aria-labelledby="starter-tools-heading"><h2 id="starter-tools-heading">Tools your agent can use</h2><dl>{tools.map(([title,description])=><div key={title}><dt>{title}</dt><dd>{description}</dd></div>)}</dl></section>
    <section className="starter-prompt-box" aria-labelledby="starter-prompts-heading"><header><h2 id="starter-prompts-heading">Start with a prompt</h2><p>Pick one, then edit it before sending.</p></header><ol>{starterPrompts.map(({title,prompt})=><li key={title}><button type="button" disabled={disabled} onClick={()=>onSelect(prompt)} aria-label={`Use prompt: ${title}`}><span><strong>{title}</strong><span className="starter-prompt-text">{prompt}</span></span><span className="starter-prompt-use" aria-hidden="true">Use prompt ↗</span></button></li>)}</ol></section>
  </section>;
}
