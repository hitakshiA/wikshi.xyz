import React from 'react';
import {Bird} from './cards';
import './starter-page.css';

const tools=[
  ['Web & company research','Search the web, read source pages, and compare companies with links to the evidence.'],
  ['People & business contacts','Find founders, teams, and available business emails or phone numbers.'],
  ['Email & inbox','Create an agent inbox, draft and send approved emails, and read replies.'],
  ['Phone calls','Call someone with your brief and bring back the conversation transcript.'],
  ['Video meetings','Create a guest link for an AI-led conversation of up to 5 minutes, then retrieve the transcript.'],
  ['Payments & records','Check testnet account funding and track requests, receipts, and refund status.'],
];
export const starterPrompts=[
  {title:'Research a market',prompt:'Find some interesting startups making AI receptionists for clinics or service businesses. Compare what they do and pick a few that seem genuinely different.'},
  {title:'Find people to talk to',prompt:'Help me find founders or partnership leads at small voice AI companies. Start with a shortlist, then help me write a useful introduction to the people we pick.'},
  {title:'Arrange a conversation',prompt:'I want to ask someone about their plans for a project. Help me put together a short video meeting and an email with the guest link. Ask me who it’s for and what we need to learn.'},
];

export function StarterPage({disabled,onSelect}:{disabled:boolean;onSelect:(prompt:string)=>void}){
  return <section className="starter-page" aria-labelledby="starter-heading">
    <header className="starter-intro"><div><h1 id="starter-heading">Research, reach out,<br/>and get answers.</h1><p>Tell Wikshi what you’re trying to do. It can gather information, find the right people, and follow up through email or a conversation.</p></div><Bird/></header>
    <section className="starter-tools" aria-labelledby="starter-tools-heading"><h2 id="starter-tools-heading">Tools your agent can use</h2><dl>{tools.map(([title,description])=><div key={title}><dt>{title}</dt><dd>{description}</dd></div>)}</dl></section>
    <p className="starter-approval">You stay in control: review each paid request before it runs, and review emails before sending. Pay with testnet USDC or HBAR, or use sponsorship when available. Emails and calls reach real people.</p>
    <section className="starter-prompt-box" aria-labelledby="starter-prompts-heading"><header><h2 id="starter-prompts-heading">Start with a prompt</h2><p>Choose one to put it in the message box. Edit it to make it yours.</p></header><ol>{starterPrompts.map(({title,prompt})=><li key={title}><button type="button" disabled={disabled} onClick={()=>onSelect(prompt)} aria-label={`Use prompt: ${title}`}><span><strong>{title}</strong><span className="starter-prompt-text">{prompt}</span></span><span className="starter-prompt-use" aria-hidden="true">Use prompt ↗</span></button></li>)}</ol></section>
  </section>;
}
