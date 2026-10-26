import test from 'node:test';
import assert from 'node:assert/strict';
import {meetingTasks,meetingStatusPrompt} from '../src/meeting-task-data.mjs';
test('meeting tasks exclude unpaid requests and preserve multiple created meetings',()=>{
 const meeting={id:'one',service:'video.meeting',status:'awaiting_guest',input:{mission:'Discuss Linda AI'},result:{meetingUrl:'https://api.wikshi.xyz/guest/example'}};
 const tasks=meetingTasks([meeting,{...meeting,id:'unpaid',status:'awaiting_payment',result:undefined},{...meeting,id:'two',status:'completed',result:{transcript:[{role:'guest',text:'Hello'}]}},{id:'call',service:'phone.call',status:'completed'}]);
 assert.deepEqual(tasks.map(x=>x.id),['two','one']);
 assert.equal(tasks[0].status,'Transcript available');
 assert.equal(tasks[1].status,'Invitation created');
 const prompt=meetingStatusPrompt(tasks[1]);
 assert.match(prompt,/Discuss Linda AI/);assert.match(prompt,/request one/);assert.match(prompt,/Do not create another meeting or payment/);
});
