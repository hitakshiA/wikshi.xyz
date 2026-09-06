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
    if (!string(input.mission,10,6000) || ![60,120,180].includes(input.maxSeconds)) throw new ApiError('invalid_mission');
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
    ['email.inbox','Durable inbox included with verified payment','WIKSHI_PRICE_INBOX',false,'request'],
    ['email.send','Send an approved email','WIKSHI_PRICE_EMAIL',Boolean(env.RESEND_API_KEY && env.WIKSHI_EMAIL_READY==='true'),'request'],
    ['email.reply','Reply to an owned inbox message','WIKSHI_PRICE_EMAIL',Boolean(env.RESEND_API_KEY && env.WIKSHI_EMAIL_READY==='true'),'request'],
    // No documented provider-enforced duration cap. Never sell bounded calls on a prompt alone.
    ['phone.call','Make a bounded voice call','WIKSHI_PRICE_PHONE_SECOND',false,'second'],
    ['video.meeting','One-use video conversation','WIKSHI_PRICE_VIDEO_SECOND',Boolean(env.BEY_API_KEY && env.BEY_AVATAR_ID && env.WIKSHI_VIDEO_API_READY==='true'),'second'],
  ];
  return entries.map(([id,name,rateKey,ready,unit])=>({id,name,unit,rateAtomic:price(rateKey),currency:'USDC',decimals:6,maxSeconds:unit==='second'?180:undefined,
    enabled:Boolean(ready && price(rateKey) && env.WIKSHI_MERCHANT_ACCOUNT && env.WIKSHI_MERCHANT_KEY),
    acceptedInputFields:serviceInputs[id],
    availabilityReason:id==='email.inbox'?'included_with_verified_payment_use_get_inboxes':id==='phone.call'?'duration_enforcement_unverified':!ready?'configuration_required':!price(rateKey)?'price_required':(!env.WIKSHI_MERCHANT_ACCOUNT || !env.WIKSHI_MERCHANT_KEY)?'payment_configuration_required':'configured',
    verification:id==='network.inspect'?'live_testnet_verified':'adapter_only_not_live_verified',
    rounding:unit==='second'?'ceil-second':'one-request'}));
}
