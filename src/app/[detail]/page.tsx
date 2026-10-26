import {notFound} from 'next/navigation';
import {SitePage,PageSection} from '@/components/wikshi-pages/SitePage';
import {detailPages} from '@/components/wikshi-pages/detail-pages';
export const dynamicParams=false;
export function generateStaticParams(){return Object.keys(detailPages).map(detail=>({detail}))}
export async function generateMetadata({params}:{params:Promise<{detail:string}>}){const {detail}=await params;return {title:`${detailPages[detail]?.label??'Page not found'} | Wikshi`}}
export default async function DetailPage({params}:{params:Promise<{detail:string}>}){const {detail}=await params;const page=detailPages[detail];if(!page)notFound();return <SitePage eyebrow={page.label} title={page.title} accent={page.accent} lead={page.lead} art={`/wikshi/art/${page.art}`}>{page.download&&<div className="page-index"><a href="/wikshi/skills.md" download>Download workflow guidance ↗</a><a href="/use-cases">Explore specific missions ↗</a></div>}{page.sections.map((section,i)=><PageSection key={section.title} id={`step-${i+1}`} label={`0${i+1} / ${page.label}`} title={section.title}><p className="section-intro">{section.body}</p>{section.items&&<ul className="page-steps">{section.items.map(item=><li key={item}>{item}</li>)}</ul>}</PageSection>)}</SitePage>}
