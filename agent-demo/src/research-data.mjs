// Research files contain public source/contact data, never an operation's private envelope.
const fields = new Set([
  'name','firstname','lastname','fullname','displayname','title','jobtitle','role','headline',
  'company','companyname','companyurl','companydomain','companyphone','companysize','companydescription',
  'organization','organizationname','employer','domain','website','url','source','sources','sourceurl',
  'profile','profileurl','linkedin','linkedinurl','twitter','twitterurl','social','socials','socialprofiles',
  'email','emails','emailaddress','emailtype','emailverified','emailverifiedat','emailverificationdate',
  'phone','phones','phonenumber','phonetype','mobile','businessphone','contact','contacts',
  'industry','industries','sector','category','categories','tags','keywords','specialties',
  'description','summary','text','content','snippet','highlights','notes','reason','relevance','score',
  'location','locations','address','addresses','street','streetaddress','addressline1','addressline2',
  'city','state','province','region','regioncode','country','countrycode','postalcode','zipcode',
  'headquarters','latitude','longitude','timezone',
  'employeecount','employees','employeescount','founded','foundedat','foundedyear','founders','founder',
  'funding','fundingstage','fundingtotal','fundingamount','totalfunding','latestfunding','lastfundingdate',
  'investors','revenue','annualrevenue','valuation','currency','amount','year','date',
  'publishedat','publisheddate','updatedat','lastupdated','observedat','retrievedat','verifiedat',
  'products','product','features','services','customers','customersegments','markets','market',
  'usecases','pricing','price','plans','plan','team','education','experience','skills','languages',
  'type','label','value','verified','confidence','status','isprimary','seniority','department',
]);
const envelopes = ['results','people','companies','contacts','items','records','data','result'];
const priority = ['name','firstName','lastName','fullName','companyName','title','email','phone','url','companyUrl','profileUrl','industry','city','country','summary','text','publishedAt'];
const keyName = key => String(key).replace(/[^a-z0-9]/gi,'').toLowerCase();
const privateKey = key => /^(?:__|\$)/.test(key) || /(?:credential|password|secret|private|authorization|authhash|apikey|accesstoken|refreshtoken|sessiontoken|signature|provider|internal|rawresponse|requestheaders|responseheaders|contenttrust)/i.test(keyName(key)) || ['token','tokens','auth','metadata','meta','headers','payment','receipt','connection','session','constructor','prototype','proto'].includes(keyName(key));
const privateHosts = new Set(['api.exa.ai','api.agentphone.ai','api.resend.com','api.bey.dev']);

function cleanLink(value) {
  try {
    const url=new URL(value),hostname=url.hostname.toLowerCase().replace(/\.$/,'');
    if (privateHosts.has(hostname) || (hostname==='app.quickenrich.io' && /^\/api(?:\/|$)/i.test(url.pathname)) || /^wss?:$/.test(url.protocol)) return '[internal link removed]';
    if (url.username || url.password || [...url.searchParams.keys()].some(key => privateKey(key) || ['key','sig'].includes(keyName(key)))) return '[private link removed]';
  } catch { return '[invalid link removed]'; }
  return value;
}

function cleanText(value) {
  return value
    .replace(/-----BEGIN (?:[A-Z ]*PRIVATE KEY)-----[\s\S]*?-----END (?:[A-Z ]*PRIVATE KEY)-----/g,'[private value removed]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi,'[credential removed]')
    .replace(/\bsk[-_][A-Za-z0-9_-]{20,}\b/g,'[credential removed]')
    .replace(/\b(?:https?|wss?):\/\/[^\s<>"']+/gi,cleanLink);
}

function clean(value, seen = new WeakSet()) {
  if (typeof value === 'string') return cleanText(value);
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (!value || typeof value !== 'object' || seen.has(value)) return undefined;
  if (!Array.isArray(value) && ![Object.prototype,null].includes(Object.getPrototypeOf(value))) return undefined;
  seen.add(value);
  let output;
  if (Array.isArray(value)) {
    output = value.map(item => clean(item,seen)).filter(item => item !== undefined);
  } else {
    output = {};
    for (const key of Object.keys(value)) {
      if (privateKey(key) || !fields.has(keyName(key))) continue;
      const descriptor = Object.getOwnPropertyDescriptor(value,key);
      if (!descriptor || !('value' in descriptor)) continue;
      const safe = clean(descriptor.value,seen);
      if (safe !== undefined) output[key] = safe;
    }
  }
  seen.delete(value);
  return output;
}

function cleanRow(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = clean(value);
  return row && Object.keys(row).length ? row : null;
}

/** Normalize service envelopes or one enriched contact without truncating records. */
export function resultRows(value) {
  const visited = new WeakSet();
  function unwrap(candidate) {
    if (!candidate || typeof candidate !== 'object' || visited.has(candidate)) return [];
    visited.add(candidate);
    if (Array.isArray(candidate)) return candidate.map(cleanRow).filter(Boolean);
    // Public rows may themselves have a contacts field. Only unwrap collections on
    // envelopes, not inside an already identifiable company or person record.
    const identifiable = Object.keys(candidate).some(key => ['name','firstname','lastname','fullname','companyname','title','email','url','profileurl'].includes(keyName(key)));
    if (!identifiable) {
      for (const key of envelopes) {
        if (!Object.hasOwn(candidate,key)) continue;
        const descriptor = Object.getOwnPropertyDescriptor(candidate,key);
        if (!descriptor || !('value' in descriptor)) continue;
        if (descriptor.value && typeof descriptor.value === 'object') return unwrap(descriptor.value);
      }
    }
    const row = cleanRow(candidate);
    return row ? [row] : [];
  }
  return unwrap(value);
}

/** All public fields across all rows, not only fields present on the first page. */
export function resultColumns(rows) {
  const keys = new Set();
  for (const row of resultRows(rows)) for (const key of Object.keys(row)) keys.add(key);
  const rank = key => {const index=priority.findIndex(value => keyName(value)===keyName(key));return index<0?priority.length:index;};
  return [...keys].sort((a,b) => rank(a)-rank(b));
}

/** A sheet cell is always one short preview; the original stays in its record. */
export function displayValue(value) {
  const safe=clean(value);
  let text='';
  if (safe === undefined || safe === null) return '';
  if (typeof safe === 'object') text=JSON.stringify(safe);
  else text=String(safe);
  text=text.replace(/\s+/g,' ').trim();
  return text.length>160 ? `${text.slice(0,159)}…` : text;
}

export function resultKind(service) {
  if (/people/.test(service)) return {label:'People research',title:'People worth knowing',noun:'people'};
  if (/contact|enrich/.test(service)) return {label:'Contact details',title:'Contacts for your next step',noun:'contacts'};
  if (/compan/.test(service)) return {label:'Company research',title:'Companies worth a closer look',noun:'companies'};
  if (/contents/.test(service)) return {label:'Source research',title:'Your source library',noun:'sources'};
  return {label:'Web research',title:'Research worth a closer look',noun:'results'};
}

function csvCell(value) {
  let text=value===null || value===undefined ? '' : typeof value==='object' ? JSON.stringify(value) : String(value);
  // Spreadsheet apps skip leading whitespace/control characters before evaluating
  // formulas. Prefix the original cell so even a disguised formula remains text.
  if (/^[\s\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]*[=+\-@]/u.test(text)) text=`'${text}`;
  return `"${text.replace(/"/g,'""')}"`;
}

/** Full safe data is exported, independent of the sheet's search or current page. */
export function exportCsv(rows, columns) {
  const safe=resultRows(rows),all=resultColumns(safe);
  const preferred=Array.isArray(columns)?columns.filter(key => all.includes(key)):[];
  const keys=[...new Set([...preferred,...all])];
  if (!keys.length) return '';
  return [keys.map(csvCell).join(','),...safe.map(row => keys.map(key => csvCell(row[key])).join(','))].join('\r\n');
}

export function exportJson(rows) {
  return JSON.stringify(resultRows(rows),null,2);
}
