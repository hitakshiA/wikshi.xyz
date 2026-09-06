'use client';
import {useEffect, useRef, useState, type CSSProperties} from 'react';
import parse, {attributesToProps, domToReact, Element, type DOMNode, type HTMLReactParserOptions} from 'html-react-parser';
import {createPortal} from 'react-dom';
import markup from './wikshi-markup.json';

export function Navigation() {
  const [progress, setProgress] = useState(0);
  const [width, setWidth] = useState(1440);
  const [open, setOpen] = useState(false);
  const [drag, setDrag] = useState(0);
  const dragStart = useRef<number | null>(null);
  const dragTime = useRef(0);
  const menu = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    let frame = 0, current = 0, velocity = 0, last = 0;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const target = () => Math.min(1,Math.max(0,window.scrollY/180));
    function tick(time: number) {
      const dt = Math.min((time-last)/1000 || 1/60, 1/30); last = time;
      const aim = target();
      velocity += ((140*(aim-current)-32*velocity)/.7)*dt;
      current += velocity*dt;
      if (reduced.matches || (Math.abs(aim-current)<.001 && Math.abs(velocity)<.001)) {current=aim; velocity=0;}
      setProgress(current);
      if(current!==aim || velocity) frame=requestAnimationFrame(tick); else frame=0;
    }
    const update = () => {if(!frame) {last=performance.now(); frame=requestAnimationFrame(tick);}};
    const resize = () => setWidth(window.innerWidth);
    resize(); update();
    window.addEventListener('scroll',update,{passive:true});window.addEventListener('resize',resize);
    return () => {cancelAnimationFrame(frame);window.removeEventListener('scroll',update);window.removeEventListener('resize',resize);};
  }, []);
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow='hidden';
    menu.current?.querySelector<HTMLButtonElement>('[aria-label="Close"]')?.focus();
    const key = (event: KeyboardEvent) => {
      if(event.key==='Escape') setOpen(false);
      if(event.key==='Tab') {
        const items=Array.from(menu.current?.querySelectorAll<HTMLElement>('a,button') ?? []);
        const first=items[0],last=items.at(-1);
        if(event.shiftKey && document.activeElement===first){event.preventDefault();last?.focus();}
        else if(!event.shiftKey && document.activeElement===last){event.preventDefault();first?.focus();}
      }
    };
    document.addEventListener('keydown',key);
    return () => {document.body.style.overflow=previous;document.removeEventListener('keydown',key);opener.current?.focus();};
  }, [open]);
  useEffect(() => {if(width>=1024) setOpen(false);},[width]);
  const expanded=width>=1280?1080:width>=1024?900:Math.max(width-32,280);
  const collapsed=width>=1280?1024:width>=1024?868:expanded;
  const shellStyle:CSSProperties={borderRadius:16+983*progress,borderColor:`rgba(247,244,235,${.15*progress})`,backgroundColor:`rgba(86,112,90,${1-.15*progress})`,boxShadow:`0 12px 40px rgba(35,62,49,${.2*progress})`,backdropFilter:`blur(${12*progress}px)`,WebkitBackdropFilter:`blur(${12*progress}px)`};
  const options:HTMLReactParserOptions={replace(node){
    if(!(node instanceof Element)) return;
    const props=attributesToProps(node.attribs);
    const children=()=>domToReact(node.children as DOMNode[],options);
    if(node.name==='header') return <header {...props} style={{top:11.5+4.5*progress,paddingInline:12*progress}}>{children()}</header>;
    if(node.parent instanceof Element && node.parent.name==='header') return <div {...props} style={{maxWidth:expanded+(collapsed-expanded)*progress,willChange:progress>.02?'max-width':'auto'}}>{children()}</div>;
    if(node.attribs.class?.includes('home-nav-shell')) return <div {...props} style={shellStyle}>{children()}</div>;
    if(node.attribs['aria-label']==='Open menu') return <button {...props} ref={opener} aria-expanded={open} aria-controls="mobile-navigation" onClick={()=>{setDrag(0);setOpen(true);}}>{children()}</button>;
    if(node.name==='a' && node.attribs.href==='/#quickstart-panel') return <a {...props} style={{paddingInline:12-4*progress}}>{children()}</a>;
  }};
  const menuOptions:HTMLReactParserOptions={replace(node){
    if(!(node instanceof Element)) return;
    const props=attributesToProps(node.attribs);
    const children=()=>domToReact(node.children as DOMNode[],menuOptions);
    if(node.attribs.class==='css-vyl1rw') return <div {...props} onClick={()=>setOpen(false)}/>;
    if(node.attribs.style?.includes('max-height: 80vh')) return <div {...props} role="dialog" aria-modal="true" aria-label="Navigation" style={{...props.style as CSSProperties,transform:`translateY(${drag}px)`}}>{children()}</div>;
    if(node.attribs.class==='css-7ltpiz' || node.attribs.class==='css-oflea8') return <div {...props}
      onPointerDown={e=>{if((e.target as HTMLElement).closest('button,a'))return;dragStart.current=e.clientY;dragTime.current=performance.now();e.currentTarget.setPointerCapture(e.pointerId);}}
      onPointerMove={e=>{if(dragStart.current!==null)setDrag(.7*Math.max(0,e.clientY-dragStart.current));}}
      onPointerUp={e=>{const distance=dragStart.current===null?0:e.clientY-dragStart.current;const velocity=distance/Math.max((performance.now()-dragTime.current)/1000,.001);if(distance>120||velocity>600)setOpen(false);setDrag(0);dragStart.current=null;}}
      onPointerCancel={()=>{setDrag(0);dragStart.current=null;}}>{children()}</div>;
    if(node.name==='a') return <a {...props} onClick={()=>setOpen(false)}>{children()}</a>;
    if(node.name==='button') {
      const label=node.attribs['aria-label'] || node.children.map(n=>n.type==='text'?n.data:'').join('');
      return <button {...props} onClick={()=>{
        if(label==='Close'){setOpen(false);return;}
        const href=label==='Workflow skill'?'/wikshi/skills.md':label==='Overview'?'/docs':'/#quickstart-panel';
        setOpen(false);window.location.assign(href);
      }}>{label === 'Workflow skill' ? <>Workflow skill <span aria-hidden="true">↗</span></> : children()}</button>;
    }
  }};
  return <>{parse(markup.Navigation,options)}{open&&createPortal(<div id="mobile-navigation" ref={menu}>{parse(markup.MobileMenu,menuOptions)}</div>,document.body)}</>;
}
