// Parse streamed JSON across arbitrary byte boundaries, including a final line
// without a newline. The transport is already incremental, not a buffered reply.
export async function readEvents(body, onEvent) {
  if (!body) throw new Error('The response stream is unavailable. Please try again.');
  const reader=body.getReader(),decoder=new TextDecoder();
  let buffer='';
  const line=value=>{if(value.trim())onEvent(JSON.parse(value));};
  try {
    while(true){
      const {done,value}=await reader.read();
      if(done){buffer+=decoder.decode();line(buffer);break;}
      buffer+=decoder.decode(value,{stream:true});
      let end;
      while((end=buffer.indexOf('\n'))!==-1){line(buffer.slice(0,end));buffer=buffer.slice(end+1);}
    }
  } finally {reader.releaseLock();}
}

export function updateToolRun(runs,event) {
  const id=event.id||[...runs].reverse().find(t=>t.name===event.name&&t.status==='running')?.id||crypto.randomUUID();
  const old=runs.find(t=>t.id===id);
  const next={...old,id,name:event.name,status:event.status,durationMs:event.durationMs,summary:event.summary};
  return old?runs.map(t=>t.id===id?next:t):[...runs,next];
}

export function appendAssistantText(text,event) {
  if(event.type==='text_boundary')return text.trim()?text.trimEnd()+'\n\n':text;
  return event.type==='text'?text+event.text:text;
}
