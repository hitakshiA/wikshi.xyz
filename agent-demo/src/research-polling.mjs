import {shouldPoll} from './operation-flow.mjs';

export const RESEARCH_TIMEOUT_MS=120_000;
export function researchDeadline(op,startedAt=Date.now()){
  const supplied=Date.parse(op.researchDeadlineAt||'');
  return Math.min(startedAt+RESEARCH_TIMEOUT_MS,Number.isFinite(supplied)?supplied:Infinity);
}
export function researchTimeLeft(milliseconds){
  const seconds=Math.max(0,Math.ceil(milliseconds/1000));
  return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;
}

// One in-flight read, with a separate deadline timer that can abort a slow read.
// Cancellation retries reconcile the same operation, never another purchase.
export function startResearchPolling({operation,read,cancel,onUpdate,onState,now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout}){
  const startedAt=now();let latest=operation,deadline=researchDeadline(operation,startedAt);
  let phase='polling',reason=null,pollTimer,deadlineTimer,clockTimer,controller,epoch=0,disposed=false,inFlight=false,error='';
  const requestTimers=new Set();
  const state=()=>{if(!disposed)onState({phase,reason,remainingMs:Math.max(0,deadline-now()),error});};
  function clearWork(){clearTimer(pollTimer);clearTimer(deadlineTimer);clearTimer(clockTimer);controller?.abort();epoch++;}
  function stop(){phase='stopped';clearWork();state();}
  function publish(next){latest={...latest,...next};onUpdate(latest);}
  function observe(next){
    if(disposed)return;
    if(phase==='cancelling'&&next.status!=='cancelled')return;
    latest={...latest,...next};
    if(!shouldPoll(next)){stop();return;}
    const revised=researchDeadline(next,startedAt);
    if(revised<deadline){deadline=revised;scheduleDeadline();}
  }
  async function bounded(fn){
    const active=new AbortController();controller=active;
    let timeout;
    try{return await Promise.race([fn(active.signal),new Promise((_,reject)=>{timeout=setTimer(()=>{active.abort();reject(new Error('Request timed out'));},8000);requestTimers.add(timeout);})]);}
    finally{clearTimer(timeout);requestTimers.delete(timeout);if(controller===active)controller=undefined;}
  }
  function scheduleDeadline(){
    clearTimer(deadlineTimer);
    if(phase==='polling')deadlineTimer=setTimer(()=>requestCancellation('timeout'),Math.max(0,deadline-now()));
  }
  function clock(){if(disposed||phase!=='polling')return;state();clockTimer=setTimer(clock,1000);}
  async function poll(){
    if(disposed||phase!=='polling'||inFlight)return;
    if(now()>=deadline){requestCancellation('timeout');return;}
    const generation=epoch;inFlight=true;
    try{
      const next=await bounded(read);
      if(disposed||generation!==epoch||phase!=='polling')return;
      // A late HTTP reply must not extend the deadline or resurrect timed-out work.
      if(now()>=deadline){requestCancellation('timeout');return;}
      error='';publish(next);observe(next);state();
    }catch{if(!disposed&&generation===epoch&&phase==='polling'){error='Connection interrupted. Checking again automatically.';state();}}
    finally{inFlight=false;if(!disposed&&generation===epoch&&phase==='polling')pollTimer=setTimer(poll,2000);}
  }
  async function cancelAttempt(){
    if(disposed||phase!=='cancelling')return;
    const generation=epoch;
    try{
      const next=await bounded(signal=>cancel(reason,signal));
      if(disposed||generation!==epoch)return;
      // The server may report completion won the race. That is not a cancellation.
      if(!shouldPoll(next)){publish(next);error='';stop();return;}
      error=next.cancellationError||'Cancellation is pending. Reconnecting automatically.';
    }catch{if(disposed||generation!==epoch)return;error='Cancellation is pending. Reconnecting automatically.';}
    state();if(!disposed&&phase==='cancelling')pollTimer=setTimer(cancelAttempt,3000);
  }
  function requestCancellation(why='user'){
    if(disposed||phase!=='polling')return;
    reason=why;phase='cancelling';error='';clearWork();state();void cancelAttempt();
  }
  function wake(){
    if(disposed||phase!=='polling')return;
    if(now()>=deadline)requestCancellation('timeout');
    else if(!inFlight){clearTimer(pollTimer);void poll();}
  }
  state();scheduleDeadline();clockTimer=setTimer(clock,1000);
  pollTimer=setTimer(poll,0);
  return {cancel:requestCancellation,observe,wake,dispose(){disposed=true;clearWork();for(const timer of requestTimers)clearTimer(timer);requestTimers.clear();}};
}
