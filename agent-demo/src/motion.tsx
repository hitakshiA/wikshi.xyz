import React,{useEffect,useRef,useState} from 'react';

// Keep the outgoing surface visible long enough to fade, but immediately make
// its actions inert. Repeated updates cancel the old transition cleanly.
export function Presence({show,children}:{show:boolean;children:React.ReactNode}) {
  const [mounted,setMounted]=useState(show),last=useRef(children);
  if(show)last.current=children;
  useEffect(()=>{
    if(show){setMounted(true);return;}
    const timer=setTimeout(()=>setMounted(false),matchMedia('(prefers-reduced-motion: reduce)').matches?0:160);
    return()=>clearTimeout(timer);
  },[show]);
  if(!show&&!mounted)return null;
  return <div className="presence" data-leaving={!show||undefined} inert={!show} aria-hidden={!show||undefined}>{show?children:last.current}</div>;
}

export function Swap({identity,children}:{identity:string;children:React.ReactNode}) {
  const [shown,setShown]=useState(identity),previous=useRef(children);
  const leaving=shown!==identity;
  if(!leaving)previous.current=children;
  useEffect(()=>{
    if(shown===identity)return;
    const timer=setTimeout(()=>setShown(identity),matchMedia('(prefers-reduced-motion: reduce)').matches?0:160);
    return()=>clearTimeout(timer);
  },[identity,shown]);
  return <div key={shown} className="presence" data-leaving={leaving||undefined} inert={leaving} aria-hidden={leaving||undefined}>{leaving?previous.current:children}</div>;
}
