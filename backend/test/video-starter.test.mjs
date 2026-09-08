import test from 'node:test';
import assert from 'node:assert/strict';
import {validate,catalog} from '../src/catalog.mjs';
import {Providers} from '../src/providers.mjs';
import {receiveVideoEvent} from '../src/video-webhook.mjs';

const input={mission:'Discuss the project with the invited guest',questions:['What would you change?'],maxSeconds:300,consent:true};
test('Starter video quotes enforce exactly five minutes and offer no duration options',()=>{
  assert.equal(validate('video.meeting',input).maxSeconds,300);
  for(const maxSeconds of [undefined,60,120,180,299,301,600,'300'])assert.throws(()=>validate('video.meeting',{...input,maxSeconds}),/invalid_mission/);
  const service=catalog({BEY_API_KEY:'fixture',BEY_AVATAR_ID:'fixture',WIKSHI_VIDEO_MODE:'hosted',WIKSHI_PRICE_VIDEO_SECOND:'1'}).find(s=>s.id==='video.meeting');
  assert.equal(service.maxSeconds,300);
  assert.equal(service.durationOptionsSeconds,undefined);
  assert.equal(service.admission,'provider_hosted_not_strictly_one_use');
});
test('Starter provider creates a hosted agent with a five-minute hard limit without starting a direct call',async()=>{
  const provider=new Providers({BEY_API_KEY:'fixture',BEY_AVATAR_ID:'fixture',WIKSHI_VIDEO_MODE:'hosted'});
  const requests=[];
  provider.bey=async(path,method,body)=>{requests.push({path,method,body});return {id:'fixture-agent'};};
  await provider.execute({data:{service:'video.meeting',input}});
  assert.equal(requests.length,1);
  assert.equal(requests[0].path,'/agents');
  assert.equal(requests[0].body.max_session_length_minutes,5);
  assert.match(requests[0].body.system_prompt,/Once all meeting objectives have been covered/);
  assert.match(requests[0].body.system_prompt,/explicitly ask them to end the call/);
  assert.match(requests[0].body.system_prompt,/Do not invent extra questions/);
});
test('Video callbacks authenticate and reconcile; they never trust event transcripts or usage',async()=>{
  const token='a'.repeat(43);let ticks=0;
  const engine={env:{WIKSHI_VIDEO_WEBHOOK_TOKEN:token},tick:async()=>{ticks++;}};
  assert.throws(()=>receiveVideoEvent(engine,'b'.repeat(43),{event_type:'test'}),/not_found/);
  assert.deepEqual(receiveVideoEvent(engine,token,{event_type:'test'}),{ok:true});
  assert.equal(ticks,0);
  receiveVideoEvent(engine,token,{event_type:'call_ended',call_id:'fixture-call',transcript:'untrusted',duration:999999});
  assert.equal(ticks,1);
  assert.throws(()=>receiveVideoEvent(engine,token,{event_type:'call_ended'}),/invalid_video_event/);
});
