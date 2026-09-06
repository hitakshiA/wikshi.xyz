import {randomUUID} from 'node:crypto';
import {ApiError} from './catalog.mjs';
import {USDC} from './payments/blocky.mjs';
export class ProviderError extends Error {constructor(uncertain=false){super('service_execution_failed');this.uncertain=uncertain;}}
export class Providers {
  constructor(env,fetchImpl=fetch) {this.env=env;this.fetch=fetchImpl;}
  async request(url, {method='GET',headers={},body}={}) {
    try {
      const response=await this.fetch(url,{method,headers:{'Content-Type':'application/json',...headers},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000),redirect:'error'});
      if (method==='DELETE' && response.status===404)return {};
      if (!response.ok) throw new ProviderError(method!=='GET' && response.status>=500);
      if (response.status===204) return {};
      const reader=response.body.getReader();let size=0;const chunks=[];
      while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2_000_000){await reader.cancel();throw new ProviderError(method!=='GET');}chunks.push(Buffer.from(value));}
      return JSON.parse(Buffer.concat(chunks).toString());
    } catch(error) {if(error instanceof ProviderError)throw error;throw new ProviderError(method!=='GET');}
  }
  bey(path, method='GET', body) {return this.request(`https://api.bey.dev/v1${path}`,{method,body,headers:{'x-api-key':this.env.BEY_API_KEY}});}
  mail(path,method='GET',body) {return this.request(`https://api.agentmail.to/v0${path}`,{method,body,headers:{Authorization:`Bearer ${this.env.AGENTMAIL_API_KEY}`}});}
  async execute(op,store) {
    const {service,input}=op.data;
    if(service==='network.inspect') {
      const base='https://testnet.mirrornode.hedera.com/api/v1';
      const [account,tokens]=await Promise.all([this.request(`${base}/accounts/${input.account}`),this.request(`${base}/accounts/${input.account}/tokens?token.id=${USDC}`)]);
      const token=tokens.tokens.find(t=>t.token_id===USDC);
      return {done:true,result:{account:input.account,network:'hedera:testnet',hbarTinybars:String(account.balance.balance),usdcAtomicBalance:String(token?.balance??0),usdcAssociated:Boolean(token),usdcFrozen:token?.freeze_status==='FROZEN',observedAt:new Date().toISOString()}};
    }
    if(service==='discovery.search') {
      const data=await this.request('https://api.exa.ai/search',{method:'POST',headers:{'x-api-key':this.env.EXA_API_KEY},body:{query:input.query,numResults:input.limit,type:'auto',contents:{text:{maxCharacters:3000}}}});
      if(!Array.isArray(data.results))throw new ProviderError(true);
      return {done:true,result:{results:data.results.map(r=>({title:r.title,url:r.url,text:r.text,publishedAt:r.publishedDate})),contentTrust:'untrusted-source-content'}};
    }
    if(service==='contacts.enrich') {
      // Key remains in an Authorization header, never a URL or client response.
      const query=new URLSearchParams({domain:input.domain,first_name:input.firstName,last_name:input.lastName});
      const data=await this.request(`https://api.hunter.io/v2/email-finder?${query}`,{headers:{Authorization:`Bearer ${this.env.HUNTER_API_KEY}`}});
      return {done:true,result:{email:data.data?.email??null,confidence:data.data?.score??null,sources:(data.data?.sources||[]).map(s=>({url:s.uri}))}};
    }
    if(service==='email.inbox') {
      const data=await this.mail('/inboxes','POST',{display_name:input.displayName,domain:this.env.WIKSHI_EMAIL_DOMAIN,client_id:op.id});
      if(!data.inbox_id || !data.email || !data.email.endsWith(`@${this.env.WIKSHI_EMAIL_DOMAIN}`))throw new ProviderError(true);
      return {done:true,resource:{id:randomUUID(),providerId:data.inbox_id,address:data.email},result:{address:data.email}};
    }
    if(service==='email.send') {
      const inbox=store.resource(input.inboxId,op.auth);
      if(!inbox)throw new ProviderError();
      const data=await this.mail(`/inboxes/${encodeURIComponent(inbox.providerId)}/messages/send`,'POST',{to:[input.to],subject:input.subject,text:input.text});
      if(!data.message_id)throw new ProviderError(true);
      return {done:true,result:{messageId:op.id,status:'sent'}};
    }
    if(service==='phone.call') {
      const data=await this.request('https://api.bland.ai/v1/calls',{method:'POST',headers:{Authorization:this.env.BLAND_API_KEY},body:{phone_number:input.phone,task:`You are an AI assistant calling on the user's behalf. Briefly identify yourself as AI, ask permission to continue, respect refusals, and get directly to the task. Do not make purchases or commitments. Mission: ${input.mission}`,max_duration:input.maxSeconds/60,record:false,voicemail_action:'hangup',metadata:{wikshi_operation:op.id}}});
      if(!data.call_id)throw new ProviderError(true);
      return {done:false,private:{callId:data.call_id}};
    }
    if(service==='video.meeting') {
      const agent=await this.bey('/agents','POST',{name:'Wikshi',avatar_id:this.env.BEY_AVATAR_ID,language:'en',max_session_length_minutes:input.maxSeconds/60,
        greeting:`I'm Wikshi, an AI assistant. This conversation is transcribed for your agent. May we continue? ${input.questions[0]}`,
        system_prompt:`Conduct a focused conversation comfortably within ${input.maxSeconds} seconds. Identify as AI and obtain consent. No big introduction or rigid questionnaire. Ask related questions together, adapt to answers, respect refusals, and summarize only confirmed facts. Never promise external actions or commitments. Mission: ${input.mission}\nEssential questions: ${input.questions.join(' / ')}`});
      if(!agent.id)throw new ProviderError(true);
      return {done:false,waiting:true,private:{agentId:agent.id}};
    }
    throw new ProviderError();
  }
  async join(op) {
    const call=await this.bey('/calls','POST',{agent_id:op.data.private.agentId,tags:{wikshi_operation:op.id}});
    if(!call.id || !call.livekit_token || !/^wss:\/\//.test(call.livekit_url||''))throw new ProviderError(true);
    return {callId:call.id,connection:{url:call.livekit_url,token:call.livekit_token}};
  }
  async poll(op) {
    if(op.data.service==='video.meeting') {
      const id=encodeURIComponent(op.data.private.callId);
      const call=await this.bey(`/calls/${id}`);
      if(call.status?.type!=='completed')return null;
      const transcript=await this.bey(`/calls/${id}/messages`);
      if(!Array.isArray(transcript))throw new ProviderError();
      const seconds=(Date.parse(call.status.ended_at)-Date.parse(call.status.started_at))/1000;
      if(!Number.isFinite(seconds) || seconds<0)throw new ProviderError();
      return {seconds,transcript};
    }
    const data=await this.request(`https://api.bland.ai/v1/calls/${encodeURIComponent(op.data.private.callId)}`,{headers:{Authorization:this.env.BLAND_API_KEY}});
    if(data.completed!==true)return null;
    const seconds=Number(data.corrected_duration);
    if(data.corrected_duration==null || !Number.isFinite(seconds) || seconds<0 || !Array.isArray(data.transcripts))throw new ProviderError();
    return {seconds,transcript:data.transcripts};
  }
  async cleanup(op) {if(op.data.service==='video.meeting' && op.data.private?.agentId)await this.bey(`/agents/${encodeURIComponent(op.data.private.agentId)}`,'DELETE');}
  async inboxMessages(resource) {
    const data=await this.mail(`/inboxes/${encodeURIComponent(resource.providerId)}/messages?limit=20`);
    if(!Array.isArray(data.messages))throw new ProviderError();
    return {messages:data.messages.map(m=>({from:m.from,to:m.to,subject:m.subject,text:m.text,receivedAt:m.timestamp})),contentTrust:'untrusted-message-content'};
  }
}
