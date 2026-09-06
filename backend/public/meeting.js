/* global LivekitClient */
const guestToken=location.hash.slice(1);history.replaceState(null,'',location.pathname);
const status=document.querySelector('#status'),join=document.querySelector('#join'),leave=document.querySelector('#leave');
let room,timer;
join.addEventListener('click',async()=>{
  join.disabled=true;
  try{
    if(!/^[A-Za-z0-9_-]{43}$/.test(guestToken))throw new Error();
    // Obtain microphone permission before consuming the single-use invitation.
    const stream=await navigator.mediaDevices.getUserMedia({audio:true});stream.getTracks().forEach(t=>t.stop());
    const response=await fetch('/v1/meetings/join',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({guestToken,consent:true})});
    if(!response.ok)throw new Error();
    const {connection,maxSeconds}=await response.json();
    room=new LivekitClient.Room();
    room.on(LivekitClient.RoomEvent.TrackSubscribed,track=>{const el=track.attach();document.querySelector('#media').append(el);});
    room.on(LivekitClient.RoomEvent.Disconnected,()=>{clearTimeout(timer);leave.hidden=true;status.textContent='This conversation has ended. Your agent can retrieve the transcript when it is ready.';});
    await room.connect(connection.url,connection.token);await room.localParticipant.setMicrophoneEnabled(true);
    await room.startAudio();join.hidden=true;leave.hidden=false;status.textContent='Connected to your AI representative.';
    timer=setTimeout(()=>room.disconnect(),maxSeconds*1000);
  }catch{await room?.disconnect();status.textContent='Unable to join. This invitation may be used, expired, or not ready yet. Contact the agent that arranged your meeting.';}
});
leave.addEventListener('click',()=>room?.disconnect());
