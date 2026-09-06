export class ApiError extends Error {constructor(code,status=400){super(code);this.code=code;this.status=status;}}
const string=(v,min,max)=>typeof v==='string' && v.length>=min && v.length<=max;
export function validate(service,input) {
  if (!input || typeof input!=='object' || Array.isArray(input)) throw new ApiError('invalid_input');
  const allowed={
    'network.inspect':['account'], 'discovery.search':['query','limit'], 'contacts.enrich':['firstName','lastName','domain'],
    'email.inbox':['displayName'], 'email.send':['inboxId','to','subject','text','consent'],
    'phone.call':['phone','mission','maxSeconds','consent'], 'video.meeting':['mission','questions','maxSeconds','scheduledAt','consent'],
  }[service];
  if (!allowed || Object.keys(input).some(k=>!allowed.includes(k))) throw new ApiError('invalid_input');
  if (service==='network.inspect' && !/^0\.0\.[1-9]\d*$/.test(input.account||'')) throw new ApiError('invalid_account');
  if (service==='discovery.search' && (!string(input.query,3,2000) || !Number.isInteger(input.limit) || input.limit<1 || input.limit>10)) throw new ApiError('invalid_search');
  if (service==='contacts.enrich' && (!string(input.firstName,1,100) || !string(input.lastName,1,100) || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(input.domain||''))) throw new ApiError('invalid_contact');
  if (service==='email.inbox' && !string(input.displayName,1,100)) throw new ApiError('invalid_name');
  if (service==='email.send' && (!string(input.inboxId,36,36) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.to||'') || !string(input.subject,1,200) || !string(input.text,1,10000))) throw new ApiError('invalid_message');
  if (['phone.call','video.meeting','email.send'].includes(service) && input.consent!==true) throw new ApiError('consent_required');
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
    ['discovery.search','Search people and companies','WIKSHI_PRICE_SEARCH',Boolean(env.EXA_API_KEY),'request'],
    ['contacts.enrich','Find business contact details','WIKSHI_PRICE_ENRICH',Boolean(env.HUNTER_API_KEY),'request'],
    ['email.inbox','Create a private agent inbox','WIKSHI_PRICE_INBOX',Boolean(env.AGENTMAIL_API_KEY && env.WIKSHI_EMAIL_DOMAIN),'request'],
    ['email.send','Send an approved email','WIKSHI_PRICE_EMAIL',Boolean(env.AGENTMAIL_API_KEY && env.WIKSHI_EMAIL_DOMAIN),'request'],
    ['phone.call','Make a bounded voice call','WIKSHI_PRICE_PHONE_SECOND',Boolean(env.BLAND_API_KEY),'second'],
    ['video.meeting','One-use video conversation','WIKSHI_PRICE_VIDEO_SECOND',Boolean(env.BEY_API_KEY && env.BEY_AVATAR_ID),'second'],
  ];
  return entries.map(([id,name,rateKey,ready,unit])=>({id,name,unit,rateAtomic:price(rateKey),currency:'USDC',decimals:6,maxSeconds:unit==='second'?180:undefined,
    enabled:Boolean(ready && price(rateKey) && env.WIKSHI_MERCHANT_ACCOUNT && env.WIKSHI_MERCHANT_KEY),
    rounding:unit==='second'?'ceil-second':'one-request'}));
}
