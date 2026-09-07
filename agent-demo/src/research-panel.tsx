import {useEffect,useId,useMemo,useRef,useState} from 'react';
import type {KeyboardEvent} from 'react';
import type {Operation} from './cards';
import {safeUrl} from './card-data.mjs';
import {displayValue,exportCsv,exportJson,resultColumns,resultKind,resultRows} from './research-data.mjs';
import './research-panel.css';

const PAGE_SIZE=25;
const fieldLabel=(value:string)=>value.replace(/([a-z\d])([A-Z])/g,'$1 $2').replace(/[_-]/g,' ').replace(/^./,c=>c.toUpperCase());
const fullValue=(value:unknown)=>value==null?'Not available':typeof value==='string'?value:typeof value==='object'?JSON.stringify(value,null,2):String(value);

function SheetMark(){
  return <svg className="research-file-mark" viewBox="0 0 40 48" fill="none" aria-hidden="true"><path d="M7 2h20l9 9v34H7z" fill="var(--cream)" stroke="currentColor"/><path d="M27 2v9h9" fill="var(--apricot)" stroke="currentColor"/><path d="M13 20h17M13 27h17M13 34h17M19 17v20" stroke="currentColor"/><path d="M3 8v39h27" stroke="currentColor" opacity=".4"/></svg>;
}

export function ResearchAttachment({op,onOpen}:{op:Operation;onOpen:()=>void}){
  const count=useMemo(()=>resultRows(op.result).length,[op.result]);
  const kind=resultKind(op.service);
  return <button type="button" className="research-attachment" data-operation={op.id} onClick={onOpen} aria-label={`Browse ${kind.label.toLowerCase()}, ${count} records`}>
    <SheetMark/>
    <span className="research-attachment-copy"><strong>{kind.label}</strong><span>{count} {count===1?'record':'records'}<span aria-hidden="true"> · </span>Browse & download</span></span>
    <span className="research-attachment-arrow" aria-hidden="true">↗</span>
  </button>;
}

type Selection={row:number;column:string|null;full:boolean};

export function ResearchPanel({op,onClose}:{op:Operation;onClose:()=>void}){
  const rows=useMemo(()=>resultRows(op.result),[op.result]);
  const columns=useMemo(()=>resultColumns(rows),[rows]);
  const kind=resultKind(op.service),headingId=useId(),hintId=useId();
  const [filter,setFilter]=useState(''),[page,setPage]=useState(0),[selection,setSelection]=useState<Selection|null>(null);
  const [downloadError,setDownloadError]=useState(''),[mobile,setMobile]=useState(()=>window.matchMedia('(max-width:999px)').matches);
  const panelRef=useRef<HTMLElement>(null),closeRef=useRef<HTMLButtonElement>(null),sheetRef=useRef<HTMLDivElement>(null),inspectorRef=useRef<HTMLElement>(null);
  const lastCell=useRef<HTMLElement|null>(null),closeCallback=useRef(onClose);
  closeCallback.current=onClose;
  const indexed=useMemo(()=>rows.map((row,index)=>({row,index,search:JSON.stringify(row).toLocaleLowerCase()})),[rows]);
  const query=filter.trim().toLocaleLowerCase();
  const filtered=useMemo(()=>query?indexed.filter(item=>item.search.includes(query)):indexed,[indexed,query]);
  const pageCount=Math.max(1,Math.ceil(filtered.length/PAGE_SIZE)),safePage=Math.min(page,pageCount-1);
  const shown=filtered.slice(safePage*PAGE_SIZE,(safePage+1)*PAGE_SIZE);
  const activeRow=selection?rows[selection.row]:undefined;
  const columnWidth=(column:string)=>/text|description|summary|content/i.test(column)?260:/name|title|company/i.test(column)?210:170;

  useEffect(()=>{
    const opener=document.activeElement instanceof HTMLElement?document.activeElement:null;
    const frame=requestAnimationFrame(()=>closeRef.current?.focus());
    return()=>{cancelAnimationFrame(frame);if(opener?.isConnected)opener.focus({preventScroll:true});};
  },[]);
  useEffect(()=>{
    const media=window.matchMedia('(max-width:999px)');
    const change=()=>setMobile(media.matches);
    media.addEventListener('change',change);return()=>media.removeEventListener('change',change);
  },[]);
  useEffect(()=>{setFilter('');setPage(0);setSelection(null);setDownloadError('');},[op.id]);
  useEffect(()=>{if(selection)inspectorRef.current?.focus({preventScroll:true});},[selection]);

  function closeDetails(){
    setSelection(null);
    requestAnimationFrame(()=>{
      if(lastCell.current?.isConnected)lastCell.current.focus({preventScroll:true});
      else sheetRef.current?.focus({preventScroll:true});
    });
  }
  function onKeyDown(event:KeyboardEvent<HTMLElement>){
    if(event.key==='Escape'){
      event.preventDefault();event.stopPropagation();
      if(selection)closeDetails();else closeCallback.current();
    }
    if(event.key==='Tab'&&mobile){
      const focusable=Array.from(panelRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input,a[href],[tabindex="0"]')||[]).filter(el=>el.getClientRects().length>0);
      const first=focusable[0],last=focusable.at(-1);
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
    }
  }
  function openCell(row:number,column:string|null,target:HTMLElement){
    lastCell.current=target;
    setSelection({row,column,full:column===null});
  }
  function changePage(next:number){
    setPage(next);setSelection(null);sheetRef.current?.scrollTo({top:0});
  }
  function download(format:'csv'|'json'){
    setDownloadError('');
    try{
      const data=format==='csv'?exportCsv(rows,columns):exportJson(rows);
      const blob=new Blob([data],{type:format==='csv'?'text/csv;charset=utf-8':'application/json;charset=utf-8'});
      const url=URL.createObjectURL(blob),link=document.createElement('a');
      link.href=url;link.download=`wikshi-${op.service.replace(/[^a-z0-9]+/gi,'-')}-${op.id.slice(0,8)}.${format}`;
      document.body.appendChild(link);link.click();link.remove();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
    }catch{setDownloadError('Could not prepare the download. Please try again.');}
  }

  return <section ref={panelRef} className={`research-panel ${selection?'research-panel-inspecting':''}`} role="dialog" aria-modal={mobile||undefined} aria-labelledby={headingId} onKeyDown={onKeyDown}>
    <header className="research-panel-header">
      <div><h2 id={headingId}>{kind.label}</h2><p>{rows.length} {rows.length===1?'record':'records'} from this request</p></div>
      <button ref={closeRef} className="research-close" type="button" aria-label="Close records" onClick={onClose}>×</button>
    </header>
    <div className="research-toolbar">
      <label className="research-search"><svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="5.5" stroke="currentColor"/><path d="m12 12 5 5" stroke="currentColor"/></svg><input aria-label="Search records" value={filter} onChange={event=>{setFilter(event.target.value);setPage(0);setSelection(null);}} placeholder="Find in these records" type="search"/></label>
      <div className="research-downloads" role="group" aria-label="Download all records"><button type="button" aria-label="Download CSV" onClick={()=>download('csv')} disabled={!rows.length}>CSV <span aria-hidden="true">↓</span></button><button type="button" aria-label="Download JSON" onClick={()=>download('json')} disabled={!rows.length}>JSON <span aria-hidden="true">↓</span></button></div>
    </div>
    <p id={hintId} className="research-sheet-hint">Click a cell for its full value, or a row number for the whole record.</p>
    {downloadError&&<p className="research-download-error" role="alert">{downloadError}</p>}
    <div ref={sheetRef} className="research-sheet-scroll" tabIndex={0} aria-label="Scrollable records" aria-describedby={hintId}>
      {shown.length?<table className="research-sheet" style={{width:`${48+columns.reduce((sum,column)=>sum+columnWidth(column),0)}px`}}>
        <caption className="sr-only">{kind.label}, page {safePage+1} of {pageCount}</caption>
        <colgroup><col style={{width:48}}/>{columns.map(column=><col key={column} style={{width:columnWidth(column)}}/>)}</colgroup>
        <thead><tr><th scope="col" className="research-row-heading">#</th>{columns.map(column=><th scope="col" key={column}><span>{fieldLabel(column)}</span></th>)}</tr></thead>
        <tbody>{shown.map(({row,index})=><tr key={index} className={selection?.row===index?'research-row-selected':''}>
          <th scope="row"><button type="button" className="research-row-open" aria-label={`Open record ${index+1}`} aria-pressed={selection?.row===index&&selection.full} onClick={event=>openCell(index,null,event.currentTarget)}>{String(index+1).padStart(2,'0')}</button></th>
          {columns.map(column=><td key={column}><button type="button" className={`research-cell ${selection?.row===index&&selection.column===column?'research-cell-selected':''}`} data-column={column} onClick={event=>openCell(index,column,event.currentTarget)} aria-label={`${fieldLabel(column)}, record ${index+1}: ${displayValue(row[column])}`}><span>{displayValue(row[column])||'Not available'}</span></button></td>)}
        </tr>)}</tbody>
      </table>:<div className="research-empty"><SheetMark/><h3>{rows.length?'No matching records':'No records returned'}</h3><p>{rows.length?'Try a different name, company, or keyword.':'This request did not return any records to browse.'}</p>{filter&&<button type="button" onClick={()=>{setFilter('');setPage(0);}}>Clear search</button>}</div>}
    </div>
    <nav className="research-pager" aria-label="Records pagination"><span>{filtered.length?`${safePage*PAGE_SIZE+1}–${Math.min((safePage+1)*PAGE_SIZE,filtered.length)} of ${filtered.length}`:'0 records'}{query&&filtered.length!==rows.length?` · ${rows.length} total`:''}</span><div><button type="button" aria-label="Previous page" disabled={safePage===0} onClick={()=>changePage(safePage-1)}>←</button><span>{safePage+1} / {pageCount}</span><button type="button" aria-label="Next page" disabled={safePage+1>=pageCount} onClick={()=>changePage(safePage+1)}>→</button></div></nav>
    {selection&&activeRow&&<section ref={inspectorRef} className="research-inspector" aria-label={`Record ${selection.row+1} details`} tabIndex={-1}>
      <header><div><span>Record {String(selection.row+1).padStart(2,'0')}</span><h3>{selection.full?'Full record':fieldLabel(selection.column!)}</h3></div><button type="button" aria-label="Close record details" onClick={closeDetails}>×</button></header>
      <div className="research-inspector-body">{selection.full?<dl>{Object.entries(activeRow).map(([column,value])=><div key={column}><dt>{fieldLabel(column)}</dt><dd><pre>{fullValue(value)}</pre>{safeUrl(value)&&<a href={safeUrl(value)!} target="_blank" rel="noreferrer">Open source ↗</a>}</dd></div>)}</dl>:<><pre className="research-field-value">{fullValue(activeRow[selection.column!])}</pre>{safeUrl(activeRow[selection.column!])&&<a href={safeUrl(activeRow[selection.column!])!} target="_blank" rel="noreferrer">Open source ↗</a>}</>}</div>
      <footer>{selection.full?selection.column&&<button type="button" onClick={()=>setSelection({...selection,full:false})}>← Back to cell</button>:<button type="button" onClick={()=>setSelection({...selection,full:true})}>View full record ↗</button>}</footer>
    </section>}
  </section>;
}
