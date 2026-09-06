/* global LivekitClient */
const guestToken=location.hash.slice(1);history.replaceState(null,'',location.pathname);
const status=document.querySelector('#status'),join=document.querySelector('#join'),leave=document.querySelector('#leave');
let room,timer,admitted=false;
const roomState=document.querySelector('#room-state');
if(!/^[A-Za-z0-9_-]{43}$/.test(guestToken)){join.hidden=true;status.textContent='Open the private invitation your agent shared to join your conversation.';roomState.textContent='Invitation needed';}
join.addEventListener('click',async()=>{
  join.disabled=true;
  status.textContent='Allow microphone access to join your conversation.';
  try{
    if(!/^[A-Za-z0-9_-]{43}$/.test(guestToken))throw new Error();
    // Obtain microphone permission before consuming the single-use invitation.
    const stream=await navigator.mediaDevices.getUserMedia({audio:true});stream.getTracks().forEach(t=>t.stop());
    const response=await fetch('/v1/meetings/join',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({guestToken,consent:true})});
    if(!response.ok){const body=await response.json();throw Object.assign(new Error(),{code:body.error?.code});}
    const {connection,maxSeconds}=await response.json();
    admitted=true;roomState.textContent='Connecting';status.textContent='Connecting your conversation…';
    room=new LivekitClient.Room();
    room.on(LivekitClient.RoomEvent.TrackSubscribed,track=>{const el=track.attach();document.querySelector('#media').append(el);if(track.kind==='video')document.querySelector('#waiting').hidden=true;});
    room.on(LivekitClient.RoomEvent.Disconnected,()=>{clearTimeout(timer);leave.hidden=true;roomState.textContent='Conversation ended';status.textContent='This conversation has ended. Your agent can retrieve the transcript when it is ready.';});
    await room.connect(connection.url,connection.token);await room.localParticipant.setMicrophoneEnabled(true);
    await room.startAudio();join.hidden=true;leave.hidden=false;roomState.textContent='Connected';status.textContent='Connected to your AI representative.';
    timer=setTimeout(()=>room.disconnect(),maxSeconds*1000);
  }catch(error){
    await room?.disconnect();roomState.textContent='Not connected';
    const messages={meeting_connection_unavailable:'We couldn’t start this conversation. Your agent can check the session and payment status. You have not joined a call.',meeting_not_started:'Your scheduled conversation is not ready yet. Please return at the time your agent arranged.',meeting_unavailable:'This invitation is no longer available. Ask the agent that invited you to check its status.'};
    const permission=['NotAllowedError','NotFoundError','NotReadableError'].includes(error.name);
    status.textContent=permission?'Your microphone is unavailable. Check browser permissions and your microphone, then try again.':messages[error.code]||(admitted?'The room could not connect. Ask your agent to check this session before using another invitation.':'We couldn’t reach the meeting service. Check your connection and ask your agent to check the invitation before retrying.');
    if(permission || error.code==='meeting_not_started'){join.disabled=false;}else{join.hidden=true;}
  }
});
leave.addEventListener('click',()=>room?.disconnect());
