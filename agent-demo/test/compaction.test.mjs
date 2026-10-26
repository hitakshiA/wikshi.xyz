import test from 'node:test';
import assert from 'node:assert/strict';
import {toCore,fromCore} from '../server/compaction.mjs';
test('tool calls and results cross the Core compaction boundary with their IDs and roles intact',()=>{
  const messages=[{id:'a',createdAt:1,role:'assistant',content:[{type:'tool-call',toolCallId:'call1',toolName:'list_services',input:{}}]},{id:'b',createdAt:2,role:'tool',content:[{type:'tool-result',toolCallId:'call1',toolName:'list_services',output:{services:['email.send']}}]}];
  const core=toCore(messages);assert.equal(core[1].role,'user');assert.equal(core[1].content[0].type,'tool_result');
  const restored=fromCore(core);assert.equal(restored[1].role,'tool');assert.equal(restored[1].content[0].toolCallId,'call1');assert.deepEqual(JSON.parse(restored[1].content[0].output),{services:['email.send']});assert.deepEqual(restored[0],messages[0]);
});
