import type {ReactNode} from 'react';
import {wikshiArt} from '@/lib/wikshi-art';
import {Navigation} from '@/components/sites/inkbox-ai-e8043030/root-8a5edab2/Navigation';
import {Footer} from '@/components/sites/inkbox-ai-e8043030/root-8a5edab2/Footer';

export function SitePage({eyebrow,title,accent,lead,art,children}:{eyebrow:string;title:string;accent:string;lead:string;art?:string;children:ReactNode}) {
  return <div id="top"><a className="css-l3s3py" href="#page-content">Skip to content</a><Navigation/><main id="page-content" className="wikshi-page">
    <header className={`page-hero ${art?'page-hero-art':''}`}><div><p className="wikshi-eyebrow">Wikshi / {eyebrow}</p><h1>{title}<br/><span>{accent}</span></h1><p className="page-lead">{lead}</p><a className="page-button" href="/chat/">Try now for free <span aria-hidden="true">↗</span></a></div>{art&&<img src={wikshiArt(art)} alt="" className="page-art" width="800" height="600"/>}</header>
    <div className="page-body">{children}</div>
    <aside className="page-next"><p className="wikshi-eyebrow">Keep the agent you love</p><h2>Give it a way to reach people.</h2><a href="/docs" className="page-button">Start building with Wikshi ↗</a></aside>
  </main><Footer/></div>;
}

export function PageSection({id,label,title,children}:{id:string;label:string;title:string;children:ReactNode}){return <section id={id} className="page-section"><div><p className="wikshi-eyebrow">{label}</p><h2>{title}</h2></div><div className="page-section-content">{children}</div></section>}
