import test from 'node:test';
import assert from 'node:assert/strict';
import {resultRows,resultColumns,displayValue,resultKind,exportCsv,exportJson} from '../src/research-data.mjs';

test('normalizes public discovery, contacts, nested wrappers and enriched singletons',()=>{
  const company={title:'A voice company',url:'https://example.com',text:'A sourced description',publishedAt:'2026-09-08'};
  for(const wrapper of [value=>value,value=>({results:value}),value=>({data:{result:{items:value}}}),value=>({companies:value})]) {
    assert.deepEqual(resultRows(wrapper([company])),[company]);
  }
  const contact={firstName:'Ada',lastName:'Lovelace',email:'ada@example.com',companyName:'Example',phone:null};
  assert.deepEqual(resultRows(contact),[contact]);
  assert.deepEqual(resultRows({data:contact,meta:{page:1}}),[contact]);
  assert.deepEqual(resultRows({contacts:[contact],found:true,page:1,contentTrust:'untrusted-source-content'}),[contact]);
  assert.deepEqual(resultRows({data:{first_name:'Ada',company_name:'Example',employee_count:42}}),[{first_name:'Ada',company_name:'Example',employee_count:42}]);
  assert.deepEqual(resultRows({name:'Company',contacts:[contact]}),[{name:'Company',contacts:[contact]}]);
  for(const empty of [null,undefined,42,'text',{},[],{results:[]},{data:{found:false}},{meta:{total:0}},[null,'text',7,[]]]) assert.deepEqual(resultRows(empty),[]);
});

test('keeps all 137 rows, long values and safe nested data while cells stay short',()=>{
  const text='Research details with a line break.\n'.repeat(1000);
  const rows=Array.from({length:137},(_,index)=>({name:`Company ${index}`,text,company:{name:'Parent',address:{city:'London',country:'UK'},industries:['Healthcare','Services']},...(index===136?{phone:'+44 20 7946 0000'}:{})}));
  const normalized=resultRows({results:rows});
  assert.equal(normalized.length,137);
  assert.equal(normalized[136].text,text);
  assert.deepEqual(normalized[0].company,rows[0].company);
  assert.ok(resultColumns(normalized).includes('phone'));
  assert.ok(displayValue(text).length<=160);
  assert.ok(displayValue(rows[0].company).length<=160);
  assert.ok(!displayValue(text).includes('\n'));
  assert.equal(displayValue(null),'');
  assert.equal(displayValue(false),'false');
  assert.equal(displayValue(0),'0');
  assert.deepEqual(JSON.parse(exportJson(normalized)),normalized);
  assert.equal(exportCsv(normalized,['name']).split('\r\n').length,138);
  assert.ok(exportCsv(normalized,['name']).includes(text));
  assert.ok(exportCsv(normalized,['name']).startsWith('"name","phone","text","company"'));
});

test('suppresses private envelopes and unknown fields recursively in UI data and exports',()=>{
  const input=JSON.parse('{"name":"Public company","credential":"do-not-show","accessToken":"do-not-show","private":{"name":"do-not-show"},"providerId":"do-not-show","metadata":{"name":"do-not-show"},"contentTrust":"do-not-show","customUnknown":"do-not-show","company":{"name":"Public parent","api_key":"do-not-show","connection":{"url":"do-not-show"},"__proto__":{"name":"do-not-show"}},"contacts":[{"email":"a@example.com","password":"do-not-show"}],"constructor":{"name":"do-not-show"}}');
  const expected={name:'Public company',company:{name:'Public parent'},contacts:[{email:'a@example.com'}]};
  assert.deepEqual(resultRows(input),[expected]);
  assert.equal({}.name,undefined);
  assert.ok(!exportJson([input]).includes('do-not-show'));
  assert.ok(!exportCsv([input],['credential','api_key','name']).includes('do-not-show'));
  assert.deepEqual(resultColumns([input]),['name','company','contacts']);
  assert.ok(!displayValue(input).includes('do-not-show'));
});

test('redacts credentials and internal or credential-bearing URLs even under a public field',()=>{
  const input={name:'Example',text:'Bearer hiddenToken_123 https://api.exa.ai/search?query=x https://example.com?q=ok&api_key=hidden sk_abcdefghijklmnopqrstuvwxyz1234',url:'https://api.agentphone.ai/v1/calls',description:'-----BEGIN PRIVATE KEY-----\nsecret bytes\n-----END PRIVATE KEY-----',profileUrl:'https://example.com/public-profile'};
  const rows=resultRows([input]);
  for(const output of [JSON.stringify(rows),exportJson(rows),exportCsv(rows)]) {
    for(const secret of ['hiddenToken','api.exa.ai','api.agentphone.ai','api_key=hidden','abcdefghijklmnopqrstuvwxyz','secret bytes']) assert.ok(!output.includes(secret),secret);
    assert.ok(output.includes('https://example.com/public-profile'));
  }
  for(const url of ['https://user:password@example.com/private','https://example.com/?%61ccess_token=hidden','https://user@api.exa.ai/search','wss://private.example/live','https://app.quickenrich.io/api/employees/search']) {
    const output=exportJson([{url}]);
    assert.ok(!output.includes(url));
    assert.ok(output.includes('link removed'));
  }
});

test('CSV escapes commas, quotes and newlines without truncation or formula execution',()=>{
  const attacks=['=SUM(A1:A2)','+123','-2+3','@SUM(1,2)','  =HYPERLINK("https://evil.example")','\t\r\n=1+1','\u0000=1+1','\uFEFF=1+1','\u200B=1+1','\u0085@A1'];
  for(const value of attacks) assert.equal(exportCsv([{name:value}]),`"name"\r\n"'${value.replace(/"/g,'""')}"`);
  assert.equal(exportCsv([{name:'Company, "One"\nNew line',email:'a@example.com'}]),'"name","email"\r\n"Company, ""One""\nNew line","a@example.com"');
  assert.equal(exportCsv([]),'');
  assert.equal(exportJson([]),'[]');
  assert.equal(exportCsv([{name:'Safe',phone:'+44 1234'}],['name','name','privateKey']),'"name","phone"\r\n"Safe","\'+44 1234"');
});

test('is robust to cycles, duplicate references, accessors and non-JSON objects',()=>{
  const address={city:'Paris'};
  const input={name:'Safe',company:{name:'Parent',address},address};
  input.company.company=input;
  let accessorRead=false;
  Object.defineProperty(input,'email',{enumerable:true,get(){accessorRead=true;throw new Error('no');}});
  const rows=resultRows(input);
  assert.deepEqual(rows,[{name:'Safe',company:{name:'Parent',address},address}]);
  assert.equal(accessorRead,false);
  const wrapper={};wrapper.data=wrapper;
  assert.deepEqual(resultRows(wrapper),[]);
  assert.deepEqual(resultRows([new Date(),new Map(),Infinity]),[]);
});

test('uses distinct research labels for companies, people, contacts and sources',()=>{
  assert.equal(resultKind('discovery.companies').noun,'companies');
  assert.equal(resultKind('discovery.people').noun,'people');
  assert.equal(resultKind('contacts.enrich').noun,'contacts');
  assert.equal(resultKind('contacts.phone').noun,'contacts');
  assert.equal(resultKind('discovery.contents').noun,'sources');
  assert.equal(resultKind('discovery.search').noun,'results');
});
