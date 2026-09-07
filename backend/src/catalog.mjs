import {ASSETS,USDC,HBAR} from './payments/assets.mjs';
export class ApiError extends Error {constructor(code,status=400){super(code);this.code=code;this.status=status;}}
const string=(v,min,max)=>typeof v==='string' && v.length>=min && v.length<=max;
export const emailAddress=v=>string(v,3,254) && /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(v);
const domain=v=>string(v,3,253) && /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(v);
const searchServices=['discovery.search','discovery.people','discovery.companies'];
export const serviceInputs={
  'network.inspect':['account'],
  'discovery.search':['query','limit'], 'discovery.people':['query','limit'], 'discovery.companies':['query','limit'],
  'discovery.contents':['urls'],
  'contacts.enrich':['firstName','lastName','domain','linkedinUrl'],
  'contacts.phone':['firstName','lastName','domain','linkedinUrl'],
  'contacts.reverse':['email'], 'contacts.company':['domain','title','page'],
  'email.inbox':['displayName'], 'email.send':['inboxId','to','subject','text','consent'],
  'email.reply':['inboxId','messageId','text','consent'],
  'phone.call':['phone','mission','maxSeconds','consent'],
  'video.meeting':['mission','questions','maxSeconds','scheduledAt','consent'],
};
export function validate(service,input) {
  if (!input || typeof input!=='object' || Array.isArray(input)) throw new ApiError('invalid_input');
  const allowed=serviceInputs[service];
  if (!allowed || Object.keys(input).some(k=>!allowed.includes(k))) throw new ApiError('invalid_input');
  if (service==='network.inspect' && !/^0\.0\.[1-9]\d*$/.test(input.account||'')) throw new ApiError('invalid_account');
  if (searchServices.includes(service) && (!string(input.query,3,2000) || !Number.isInteger(input.limit) || input.limit<1 || input.limit>10)) throw new ApiError('invalid_search');
  if (service==='discovery.contents') {
    if(!Array.isArray(input.urls) || input.urls.length<1 || input.urls.length>5)throw new ApiError('invalid_urls');
    for(const value of input.urls){let u;try{u=new URL(value);}catch{throw new ApiError('invalid_url');}
      if(!string(value,8,2000) || u.protocol!=='https:' || u.username || u.password || u.port || !domain(u.hostname) || /\.(local|internal|localhost)$/i.test(u.hostname))throw new ApiError('invalid_url');}
  }
  if (['contacts.enrich','contacts.phone'].includes(service)) {
    const named=['firstName','lastName','domain'].some(k=>input[k]!==undefined);
    if(named && (!string(input.firstName,1,100) || !string(input.lastName,1,100) || !domain(input.domain)))throw new ApiError('invalid_contact');
    if(input.linkedinUrl!==undefined && (!string(input.linkedinUrl,20,500) || !/^https:\/\/(www\.)?linkedin\.com\/in\/[a-z0-9_%.-]+\/?$/i.test(input.linkedinUrl)))throw new ApiError('invalid_contact');
    if(!named && !input.linkedinUrl)throw new ApiError('invalid_contact');
  }
  if(service==='contacts.reverse' && !emailAddress(input.email))throw new ApiError('invalid_email');
  if(service==='contacts.company' && (!domain(input.domain) || (input.title!==undefined && !string(input.title,1,200)) || !Number.isInteger(input.page) || input.page<1 || input.page>50))throw new ApiError('invalid_company_search');
  if (service==='email.inbox' && !string(input.displayName,1,100)) throw new ApiError('invalid_name');
  if (service==='email.send' && (!string(input.inboxId,36,36) || !emailAddress(input.to) || !string(input.subject,1,200) || /[\r\n]/.test(input.subject) || !string(input.text,1,10000))) throw new ApiError('invalid_message');
  if(service==='email.reply' && (!string(input.inboxId,36,36) || !string(input.messageId,36,36) || !string(input.text,1,10000)))throw new ApiError('invalid_message');
  if (['phone.call','video.meeting','email.send','email.reply'].includes(service) && input.consent!==true) throw new ApiError('consent_required');
  if (['phone.call','video.meeting'].includes(service)) {
    const validDuration=service==='phone.call'?Number.isInteger(input.maxSeconds)&&input.maxSeconds>=60&&input.maxSeconds<=600:[60,120,180].includes(input.maxSeconds);
    if (!string(input.mission,10,6000) || !validDuration) throw new ApiError('invalid_mission');
    if (service==='phone.call' && !/^\+[1-9]\d{7,14}$/.test(input.phone||'')) throw new ApiError('invalid_phone');
    if (service==='video.meeting' && (!Array.isArray(input.questions) || input.questions.length<1 || input.questions.length>3 || input.questions.some(q=>!string(q,3,250)))) throw new ApiError('invalid_questions');
    if (service==='video.meeting' && input.scheduledAt!==undefined && (!Number.isFinite(Date.parse(input.scheduledAt)) || Date.parse(input.scheduledAt)<Date.now()-60000 || Date.parse(input.scheduledAt)>Date.now()+86400000*7)) throw new ApiError('invalid_schedule');
  }
  return JSON.parse(JSON.stringify(input));
}
export function catalog(env) {
  const price=name=>/^[1-9]\d{0,8}$/.test(env[name]||'') ? env[name] : null;
  const entries=[
    ['network.inspect','Inspect public testnet account funding','WIKSHI_PRICE_INSPECT',true,'request'],
    ['discovery.search','Search the web with source text','WIKSHI_PRICE_SEARCH',Boolean(env.EXA_API_KEY),'request'],
    ['discovery.people','Discover people and professional profiles','WIKSHI_PRICE_SEARCH',Boolean(env.EXA_API_KEY),'request'],
    ['discovery.companies','Discover companies','WIKSHI_PRICE_SEARCH',Boolean(env.EXA_API_KEY),'request'],
    ['discovery.contents','Retrieve source text from up to five URLs','WIKSHI_PRICE_CONTENTS',Boolean(env.EXA_API_KEY),'request'],
    ['contacts.enrich','Find a business email and available contact details','WIKSHI_PRICE_ENRICH',Boolean(env.QUICKENRICH_API_KEY),'request'],
    ['contacts.phone','Find an available business contact phone','WIKSHI_PRICE_CONTACT_PHONE',Boolean(env.QUICKENRICH_API_KEY),'request'],
    ['contacts.reverse','Look up a business profile by email','WIKSHI_PRICE_REVERSE',Boolean(env.QUICKENRICH_API_KEY),'request'],
    ['contacts.company','Find up to twenty company contacts per page','WIKSHI_PRICE_COMPANY_CONTACTS',Boolean(env.QUICKENRICH_API_KEY),'request'],
    ['email.inbox','Create your durable agent inbox','WIKSHI_PRICE_INBOX',Boolean(env.RESEND_API_KEY && env.RESEND_WEBHOOK_SECRET && env.WIKSHI_EMAIL_READY==='true' && domain(env.WIKSHI_EMAIL_DOMAIN)),'request'],
    ['email.send','Send an email from your agent inbox','WIKSHI_PRICE_EMAIL',Boolean(env.RESEND_API_KEY && env.WIKSHI_EMAIL_READY==='true'),'request'],
    ['email.reply','Reply to an owned inbox message','WIKSHI_PRICE_EMAIL',Boolean(env.RESEND_API_KEY && env.WIKSHI_EMAIL_READY==='true'),'request'],
    ['phone.call','Outbound voice call with a private transcript','WIKSHI_PRICE_PHONE_SECOND',Boolean(env.AGENTPHONE_API_KEY && env.AGENTPHONE_AGENT_ID && env.WIKSHI_PHONE_ENABLED==='true'),'second'],
    ['video.meeting','Hosted video conversation with a private transcript','WIKSHI_PRICE_VIDEO_SECOND',Boolean(env.BEY_API_KEY && env.BEY_AVATAR_ID && (env.WIKSHI_VIDEO_MODE==='hosted'||env.WIKSHI_VIDEO_API_READY==='true')),'second'],
  ];
  return entries.map(([id,name,rateKey,ready,unit])=>{
    const rate=(suffix='')=>price(id==='email.inbox' && !env[`${rateKey}${suffix}`]?`WIKSHI_PRICE_EMAIL${suffix}`:`${rateKey}${suffix}`);
    const prices=[{...ASSETS[USDC],rateAtomic:rate()},{...ASSETS[HBAR],rateAtomic:rate('_HBAR'),verification:'local_tests_only_live_verification_pending'}].filter(p=>p.rateAtomic);
    return {id,name,unit,prices,
    // Preserve legacy USDC fields. HBAR-only entries leave the legacy rate null.
    rateAtomic:rate(),currency:'USDC',decimals:6,maxSeconds:id==='phone.call'?600:unit==='second'?180:undefined,
    durationEnforcement:id==='phone.call'?'none_customer_billing_ceiling_only':undefined,
    admission:id==='video.meeting'&&env.WIKSHI_VIDEO_MODE==='hosted'?'provider_hosted_not_strictly_one_use':undefined,
    enabled:Boolean(ready && prices.length && env.WIKSHI_MERCHANT_ACCOUNT && env.WIKSHI_MERCHANT_KEY),
    acceptedInputFields:serviceInputs[id],
    availabilityReason:!ready?'configuration_required':!prices.length?'price_required':(!env.WIKSHI_MERCHANT_ACCOUNT || !env.WIKSHI_MERCHANT_KEY)?'payment_configuration_required':'configured',
    verification:id==='network.inspect'?'live_testnet_verified':'adapter_only_not_live_verified',
    rounding:unit==='second'?'ceil-second':'one-request'};});
}
