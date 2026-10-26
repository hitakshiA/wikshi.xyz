import {randomUUID} from 'node:crypto';
// Cline Core compaction and Agent use different transcript contracts.
export function toCore(messages){return messages.map(m=>({...m,role:m.role==='tool'?'user':m.role,ts:m.createdAt,content:m.content.map(p=>{
  if(p.type==='tool-call')return {type:'tool_use',id:p.toolCallId,name:p.toolName,input:p.input};
  if(p.type==='tool-result')return {type:'tool_result',tool_use_id:p.toolCallId,name:p.toolName,content:typeof p.output==='string'?p.output:JSON.stringify(p.output??null),is_error:p.isError};
  if(p.type==='reasoning')return {type:'thinking',thinking:p.text,signature:p.metadata?.signature};
  return p;
})}));}
export function fromCore(messages){return messages.flatMap(m=>{
  const parts=typeof m.content==='string'?[{type:'text',text:m.content}]:m.content;
  const groups=[];
  for(const p of parts){
    const role=p.type==='tool_result'?'tool':m.role;
    const part=p.type==='tool_use'?{type:'tool-call',toolCallId:p.id,toolName:p.name,input:p.input}:p.type==='tool_result'?{type:'tool-result',toolCallId:p.tool_use_id,toolName:p.name,output:p.content,isError:p.is_error}:p.type==='thinking'?{type:'reasoning',text:p.thinking,metadata:{signature:p.signature}}:p;
    if(groups.at(-1)?.role===role)groups.at(-1).content.push(part);
    else groups.push({id:groups.length?randomUUID():m.id||randomUUID(),createdAt:m.ts||Date.now(),role,content:[part]});
  }
  return groups;
});}
