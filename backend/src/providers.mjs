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
  mail(path,method='GET',body,idempotencyKey) {return this.request(`https://api.resend.com${path}`,{method,body,headers:{Authorization:`Bearer ${this.env.RESEND_API_KEY}`,...(idempotencyKey?{'Idempotency-Key':idempotencyKey}:{})}});}
  phone(path,method='GET',body) {return this.request(`https://api.agentphone.ai/v1${path}`,{method,body,headers:{Authorization:`Bearer ${this.env.AGENTPHONE_API_KEY}`}});}
  provisionInbox(payer,auth,store,displayName='Wikshi agent') {
    let existing=store.payerInbox(payer);
    if(existing){
      if(/^agent-[a-f0-9]{32}@/.test(existing.address)){
        const address=`hello-${existing.id.slice(0,8)}@${existing.address.split('@')[1]}`;
        if(!store.inboxForAddress(address))existing=store.renameInbox(payer,address);
      }
      return store.createPayerInbox(payer,auth,existing);
    }
    const domain=this.env.WIKSHI_EMAIL_DOMAIN;
    if(this.env.WIKSHI_EMAIL_READY!=='true' || !this.env.RESEND_API_KEY || !this.env.RESEND_WEBHOOK_SECRET || !/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i.test(domain||''))return null;
    let id,address;
    do{id=randomUUID();address=`hello-${id.slice(0,8)}@${domain.toLowerCase()}`;}while(store.inboxForAddress(address));
    return store.createPayerInbox(payer,auth,{id,kind:'inbox',displayName,address,createdAt:new Date().toISOString()});
  }
  async execute(op,store) {
    const {service,input}=op.data;
    if(service==='network.inspect') {
      const base='https://testnet.mirrornode.hedera.com/api/v1';
      const [account,tokens]=await Promise.all([this.request(`${base}/accounts/${input.account}`),this.request(`${base}/accounts/${input.account}/tokens?token.id=${USDC}`)]);
      const token=tokens.tokens.find(t=>t.token_id===USDC);
      return {done:true,result:{account:input.account,network:'hedera:testnet',hbarTinybars:String(account.balance.balance),usdcAtomicBalance:String(token?.balance??0),usdcAssociated:Boolean(token),usdcFrozen:token?.freeze_status==='FROZEN',observedAt:new Date().toISOString()}};
    }
    if(service.startsWith('discovery.')) {
      const contents=service==='discovery.contents';
      const category={'discovery.people':'people','discovery.companies':'company'}[service];
      const body=contents?{ids:input.urls,text:{maxCharacters:10000}}:{query:input.query,numResults:input.limit,type:'auto',...(category?{category}:{}),contents:{text:{maxCharacters:3000}}};
      const data=await this.request(`https://api.exa.ai/${contents?'contents':'search'}`,{method:'POST',headers:{'x-api-key':this.env.EXA_API_KEY},body});
      if(!Array.isArray(data.results))throw new ProviderError(true);
      return {done:true,result:{results:data.results.map(r=>({title:r.title,url:r.url,text:r.text,publishedAt:r.publishedDate})),contentTrust:'untrusted-source-content'}};
    }
    if(service.startsWith('contacts.')) {
      const paths={'contacts.enrich':'search','contacts.phone':'phone-search','contacts.reverse':'email-search','contacts.company':'dataset-search'};
      const params={first_name:input.firstName,last_name:input.lastName,company_url:input.domain,linkedin_url:input.linkedinUrl,email:input.email,title:input.title,page:input.page};
      const query=new URLSearchParams(Object.entries(params).filter(([,v])=>v!==undefined));
      const data=await this.request(`https://app.quickenrich.io/api/employees/${paths[service]}?${query}`,{headers:{Authorization:`Bearer ${this.env.QUICKENRICH_API_KEY}`}});
      if(data.success!==true || !data.data || typeof data.data!=='object')throw new ProviderError();
      const fields={first_name:'firstName',last_name:'lastName',title:'title',email:'email',employee_phone:'phone',employee_phone_type:'phoneType',employee_linkedin:'profileUrl',email_verification_date:'emailVerifiedAt',company_url:'companyUrl',company_name:'companyName',company_phone:'companyPhone',industry:'industry',employee_count:'employeeCount',city:'city',region_code:'region',country_code:'country'};
      const rows=(Array.isArray(data.data)?data.data:[data.data]).slice(0,20).map(r=>Object.fromEntries(Object.entries(fields).map(([key,label])=>[label,r[key]==='N/A'?null:r[key]??null])));
      return {done:true,result:{contacts:rows,found:rows.length>0,page:input.page,hasMore:Number(data.meta?.last_page)>Number(input.page),contentTrust:'untrusted-source-content'}};
    }
    if(service==='email.inbox') {
      const inbox=this.provisionInbox(op.data.payment.payer,op.auth,store,input.displayName);
      if(!inbox)throw new ProviderError();
      return {done:true,result:{inboxId:inbox.id,address:inbox.address}};
    }
    if(['email.send','email.reply'].includes(service)) {
      const inbox=store.resource(input.inboxId,op.auth);
      if(!inbox)throw new ProviderError();
      if(inbox.kind!=='inbox')throw new ProviderError();
      const message=service==='email.reply'?store.message(input.inboxId,input.messageId):null;
      if(service==='email.reply' && (!message || message.direction!=='inbound'))throw new ProviderError();
      const to=message?.replyTo||message?.from||input.to;
      const subject=message?`Re: ${message.subject}`.slice(0,200):input.subject;
      const headers=message?.rfcMessageId?{'In-Reply-To':message.rfcMessageId,References:message.rfcMessageId}:undefined;
      const data=await this.mail('/emails','POST',{from:`Wikshi agent <${inbox.address}>`,to:[to],subject,text:input.text,reply_to:inbox.address,...(headers?{headers}:{})},op.id);
      if(!data.id)throw new ProviderError(true);
      const messageId=store.putMessage(inbox.id,`outbound:${op.id}`,{direction:'outbound',from:inbox.address,to:[to],subject,text:input.text,status:'accepted',createdAt:new Date().toISOString()});
      return {done:true,result:{messageId,status:'accepted'}};
    }
    if(service==='phone.call') {
      const agent=await this.phone(`/agents/${encodeURIComponent(this.env.AGENTPHONE_AGENT_ID)}`);
      if(agent.enableMessaging!==false)throw new ProviderError();
      const data=await this.phone('/calls','POST',{agentId:this.env.AGENTPHONE_AGENT_ID,toNumber:input.phone,disableRecording:true,
        initialGreeting:"I'm Wikshi, an AI representative for the person or team who arranged this call. They'll receive a transcript. May we continue?",
        systemPrompt:`Ask related questions together, be concise, identify as AI, respect refusals. Do not send messages, transfer calls, make purchases or commitments. Mission: ${input.mission}`});
      if(!data.id)throw new ProviderError(true);
      return {done:false,private:{callId:data.id}};
    }
    if(service==='video.meeting') {
      const agent=await this.bey('/agents','POST',{name:'Wikshi',avatar_id:this.env.BEY_AVATAR_ID,language:'en',max_session_length_minutes:input.maxSeconds/60,
        greeting:`I'm Wikshi, an AI representative for the person or team who invited you. They'll receive a transcript. May we continue? ${input.questions[0]}`,
        system_prompt:`Conduct a focused conversation comfortably within ${input.maxSeconds} seconds. Identify as AI and obtain consent. No big introduction or rigid questionnaire. Ask related questions together, adapt to answers, respect refusals, and summarize only confirmed facts. Never promise external actions or commitments. Mission: ${input.mission}\nEssential questions: ${input.questions.join(' / ')}`});
      if(!agent.id)throw new ProviderError(true);
      return {done:false,waiting:true,private:{agentId:agent.id,hosted:this.env.WIKSHI_VIDEO_MODE==='hosted'}};
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
    const id=encodeURIComponent(op.data.private.callId);
    const data=await this.phone(`/calls/${id}`);
    if(!['completed','failed'].includes(data.status)){
      return null;
    }
    const seconds=data.durationSeconds;
    if(typeof seconds!=='number' || !Number.isFinite(seconds) || seconds<0 || !Array.isArray(data.transcripts))throw new ProviderError();
    return {seconds,transcript:data.transcripts};
  }
  async cleanup(op) {if(op.data.service==='video.meeting' && op.data.private?.agentId)await this.bey(`/agents/${encodeURIComponent(op.data.private.agentId)}`,'DELETE');}
  async findHostedCall(op){
    const calls=[];let cursor;
    do{
      const page=await this.bey(`/calls?limit=50${cursor?`&cursor=${encodeURIComponent(cursor)}`:''}`);
      if(!Array.isArray(page.data)||(page.has_more&&!page.next_cursor))throw new ProviderError();
      calls.push(...page.data);cursor=page.next_cursor;if(calls.length>1000)throw new ProviderError();
    }while(cursor);
    const own=calls.filter(c=>c.agent_id===op.data.private.agentId && ['ongoing','completed'].includes(c.status?.type));
    own.sort((a,b)=>Date.parse(a.status.started_at)-Date.parse(b.status.started_at));
    return own[0]?.id;
  }
}
