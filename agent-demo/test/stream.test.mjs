import test from 'node:test';
import assert from 'node:assert/strict';
import {readEvents,updateToolRun} from '../src/stream.mjs';
import {publicToolEvent} from '../server/tool-events.mjs';

test('stream accepts split unicode, multiple events, heartbeats and final unterminated line',async()=>{
 const expected=[{type:'text',text:'Hello 🐦'},{type:'heartbeat'},{type:'done'}];
 const bytes=new TextEncoder().encode(expected.map(e=>JSON.stringify(e)).join('\n'));
 const body=new ReadableStream({start(c){for(const byte of bytes)c.enqueue(Uint8Array.of(byte));c.close();}}),seen=[];
 await readEvents(body,e=>seen.push(e));assert.deepEqual(seen,expected);
});
test('parallel calls to the same tool retain separate states',()=>{
 let runs=[];for(const e of [{id:'a',name:'check_operation',status:'running'},{id:'b',name:'check_operation',status:'running'},{id:'a',name:'check_operation',status:'finished'}])runs=updateToolRun(runs,e);
 assert.equal(runs.length,2);assert.equal(runs[1].status,'running');assert.equal(runs[0].status,'finished');
});
test('tool stream projects IDs and actual failures without raw private data',()=>{
 const started=new Map(),toolCall={toolCallId:'a',toolName:'prepare_operation',input:{credential:'secret'}};
 assert.equal(publicToolEvent({type:'tool-started',toolCall},started,100).status,'running');
 const result=publicToolEvent({type:'tool-finished',toolCall,message:{content:[{type:'tool-result',isError:true,output:{credential:'secret'}}]}},started,350);
 assert.equal(result.status,'failed');assert.equal(result.durationMs,250);assert.equal(JSON.stringify(result).includes('secret'),false);assert.equal(started.size,0);
 assert.equal(publicToolEvent({type:'assistant-reasoning-delta',text:'private'},started),null);
});
