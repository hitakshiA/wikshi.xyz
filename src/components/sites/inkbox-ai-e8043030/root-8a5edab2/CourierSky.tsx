'use client';
import {useEffect,useRef,useState,type CSSProperties} from 'react';

// Original Wikshi vector scene. No imagery, paths or motion copied from the reference.
const routes=[
 'M -80 430 C 180 170 350 615 720 490 S 1180 175 1510 340',
 'M -60 560 C 290 350 370 540 710 565 S 1160 295 1530 495',
 'M 100 180 C 400 460 390 110 690 285 S 1100 580 1350 120',
];
function Envelope(){return <g><rect x="-21" y="-15" width="42" height="30" rx="5" fill="#efc19e" stroke="#f7e8d2" strokeWidth="1.3"/><path d="m-19-12 19 15 19-15M-19 12l12-11m26 11L7 1" fill="none" stroke="#8d6949" strokeWidth="1.5"/></g>}
export function CourierSky(){
 const [visible,setVisible]=useState(true),[reduced,setReduced]=useState(false);
 const scene=useRef<HTMLDivElement>(null);
 useEffect(()=>{const media=matchMedia('(prefers-reduced-motion: reduce)');const update=()=>setReduced(media.matches);update();media.addEventListener('change',update);const observer=new IntersectionObserver(([entry])=>setVisible(entry.isIntersecting));if(scene.current)observer.observe(scene.current);return()=>{media.removeEventListener('change',update);observer.disconnect();};},[]);
 return <div ref={scene} className="courier-sky" data-paused={!visible||reduced} aria-hidden="true"><svg viewBox="0 0 1440 600" fill="none" className="courier-scene" preserveAspectRatio="xMidYMax slice">
 <defs><linearGradient id="wikshi-horizon" x1="720" y1="360" x2="720" y2="660" gradientUnits="userSpaceOnUse"><stop stopColor="#91aa7b" stopOpacity=".04"/><stop offset="1" stopColor="#91aa7b" stopOpacity=".3"/></linearGradient><clipPath id="wikshi-globe-clip"><ellipse cx="720" cy="718" rx="540" ry="335"/></clipPath></defs>
 <ellipse cx="720" cy="718" rx="540" ry="335" fill="url(#wikshi-horizon)" stroke="#b7cba2" strokeOpacity=".25"/>
 <g clipPath="url(#wikshi-globe-clip)" stroke="#c9d7b4" strokeOpacity=".12"><ellipse cx="720" cy="718" rx="350" ry="335"/><ellipse cx="720" cy="718" rx="145" ry="335"/><ellipse cx="720" cy="620" rx="540" ry="155"/><ellipse cx="720" cy="530" rx="510" ry="88"/><path d="M720 380v335M175 710h1090"/></g>
 <g stroke="#d3dfbe" strokeWidth="1" strokeOpacity=".2">{routes.map(path=><path key={path} d={path} strokeDasharray="3 9"/>)}</g>
 <g stroke="#e9c3a0" strokeOpacity=".15"><path d="M-100 490C250 110 1130 640 1530 210"/><path d="M-50 310C460 620 960 125 1500 540"/></g>
 {routes.map((path,i)=><g key={path} className={`courier-packet packet-${i}`} style={{offsetPath:`path('${path}')`,'--journey':`${22+i*8}s`,'--delay':`${-i*11-5}s`} as CSSProperties}><Envelope/></g>)}
 <g className="courier-orbit" style={{transformOrigin:'225px 365px'}}><g transform="translate(225 365) rotate(-12)"><rect x="-53" y="-53" width="106" height="106" rx="23" fill="#577359" stroke="#adc59a" strokeOpacity=".4"/><Envelope/><circle cx="38" cy="-39" r="10" fill="#efb38b"/><path d="m34-39 3 3 5-6" stroke="#37543b" strokeWidth="2"/></g></g>
 <g className="courier-orbit orbit-late" style={{transformOrigin:'1220px 335px'}}><g transform="translate(1220 335) rotate(14)"><rect x="-50" y="-50" width="100" height="100" rx="25" fill="#668060" stroke="#bfd0aa" strokeOpacity=".4"/><path d="M-14-24c-7 0-14 8-12 18 4 19 15 30 34 34 10 2 18-5 18-12l-13-8-8 9C-6 12-12 6-16-5l9-7-7-12Z" fill="#edc09c"/><path className="call-signal" d="M9-20c8 2 12 6 14 14m-12-26c14 3 21 10 24 24" stroke="#f3d4b5" strokeWidth="2" strokeLinecap="round"/></g></g>
 <g transform="translate(110 530) rotate(-14)" className="courier-stamp"><rect x="-39" y="-25" width="78" height="50" rx="7" stroke="#d5dfbc" strokeOpacity=".35"/><circle cx="-16" cy="-2" r="10" stroke="#d5dfbc" strokeOpacity=".5"/><path d="M3-10h24M3-1h17M3 8h21" stroke="#d5dfbc" strokeOpacity=".5" strokeLinecap="round"/></g>
 <g transform="translate(1330 525) rotate(10)" opacity=".6"><path d="m-34 10 68-25-19 48-15-22-34-1Z" fill="#b2c5a0"/><path d="M0 11 34-15" stroke="#536c50" strokeWidth="2"/></g>
 {[[100,300],[385,460],[1050,405],[1360,260],[840,520],[520,365]].map(([x,y],i)=><g key={x} className="courier-spark" style={{animationDelay:`${-i*1.7}s`}} stroke="#d3ddbf" strokeOpacity=".45"><path d={`M${x-4} ${y}h8M${x} ${y-4}v8`}/></g>)}
 </svg></div>;
}
