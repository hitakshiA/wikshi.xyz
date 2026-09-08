import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startResearchPolling,researchDeadline,researchTimeLeft} from '../src/research-polling.mjs';
import {mergeOperation} from '../src/operation-flow.mjs';
const base={id:'research',service:'discovery.search',status:'queued',payment:{confirmed:true}};
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function clock(){
  let time=1_000_000,id=0;const jobs=new Map();
  return {now:()=>time,setTimer:(fn,delay)=>{jobs.set(++id,{fn,at:time+delay});return id;},clearTimer:id=>jobs.delete(id),async advance(ms){
    const end=time+ms;let steps=0;
    while(true){await flush();const next=[...jobs].filter(([,job])=>job.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;assert(++steps<2000);jobs.delete(next[0]);time=next[1].at;next[1].fn();}
    time=end;await flush();
  }};
}
function setup(options={}){
  const timer=clock(),updates=[],states=[],cancellations=[];
  const controller=startResearchPolling({operation:base,read:async()=>base,cancel:async reason=>{cancellations.push(reason);return {...base,status:'cancelled'};},onUpdate:op=>updates.push(op),onState:state=>states.push(state),...timer,...options});
  return {timer,updates,states,cancellations,controller};
}
test('research automatically polls without overlapping and stops on actual completion',async()=>{
  let reads=0;const x=setup({read:async()=>({...base,status:++reads===2?'completed':'running'})});
  await x.timer.advance(0);assert.equal(reads,1);
  await x.timer.advance(2000);assert.equal(reads,2);assert.equal(x.updates.at(-1).status,'completed');
  await x.timer.advance(120000);assert.equal(reads,2);assert.deepEqual(x.cancellations,[]);x.controller.dispose();
});
test('deadline cancels paid work even when a status request never resolves',async()=>{
  const x=setup({read:()=>new Promise(()=>{})});
  await x.timer.advance(119999);assert.deepEqual(x.cancellations,[]);
  await x.timer.advance(1);assert.deepEqual(x.cancellations,['timeout']);assert.equal(x.updates.at(-1).status,'cancelled');x.controller.dispose();
});
test('manual cancellation aborts the read and ignores a late completed result',async()=>{
  let resolve,signal;const x=setup({read:input=>{signal=input;return new Promise(done=>resolve=done);}});
  await x.timer.advance(0);x.controller.cancel();await flush();
  assert(signal.aborted);assert.equal(x.updates.at(-1).status,'cancelled');
  resolve({...base,status:'completed'});await flush();assert.deepEqual(x.updates.map(op=>op.status),['cancelled']);
  await x.timer.advance(120000);assert.deepEqual(x.cancellations,['user']);x.controller.dispose();
});
test('lost cancellation responses retry the same cancellation without restarting research',async()=>{
  let attempts=0,reads=0;const x=setup({read:async()=>{reads++;return base;},cancel:async()=>{if(++attempts===1)throw Error('offline');return {...base,status:'cancelled'};}});
  await x.timer.advance(0);x.controller.cancel();await flush();
  assert.equal(x.states.at(-1).phase,'cancelling');assert.match(x.states.at(-1).error,/pending/);
  await x.timer.advance(3000);assert.equal(attempts,2);assert.equal(reads,1);assert.equal(x.updates.at(-1).status,'cancelled');x.controller.dispose();
});
test('completed result winning a cancellation race is preserved, never called refunded',async()=>{
  const x=setup({cancel:async()=>({...base,status:'completed',result:{results:[]}})});
  x.controller.cancel();await flush();assert.equal(x.updates.at(-1).status,'completed');assert.equal(x.updates.at(-1).refund,undefined);x.controller.dispose();
});
test('server deadline survives remount and is never extended by a later status response',async()=>{
  const x=setup({operation:{...base,researchDeadlineAt:new Date(1_005_000).toISOString()}});
  await x.timer.advance(4999);assert.equal(x.cancellations.length,0);
  x.controller.observe({...base,researchDeadlineAt:new Date(1_200_000).toISOString()});
  await x.timer.advance(1);assert.deepEqual(x.cancellations,['timeout']);x.controller.dispose();
  assert.equal(researchDeadline({},1000),121000);assert.equal(researchTimeLeft(119001),'2:00');assert.equal(researchTimeLeft(-1),'0:00');
});
test('unmounted poller never publishes a late response',async()=>{
  let resolve;const x=setup({read:()=>new Promise(done=>resolve=done)});await x.timer.advance(0);x.controller.dispose();resolve({...base,status:'completed'});await flush();assert.equal(x.updates.length,0);
});
test('out-of-order updates cannot revive cancelled work or roll back a confirmed refund',()=>{
  const cancelled={...base,status:'cancelled',refund:{status:'confirmed'}};
  assert.equal(mergeOperation(cancelled,{...base,status:'completed'}),cancelled);
  assert.equal(mergeOperation(cancelled,{...cancelled,refund:{status:'pending'}}).refund.status,'confirmed');
  const pending={...base,clientCancelling:true};assert.equal(mergeOperation(pending,{...base,status:'completed'}),pending);
  assert.equal(mergeOperation(pending,{...base,status:'completed',clientCancelling:false}).status,'completed');
});
