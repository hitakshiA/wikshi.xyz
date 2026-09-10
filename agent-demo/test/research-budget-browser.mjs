// Browser fixtures only. Never signs or submits a payment.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)('playwright');
const base=process.env.WIKSHI_BROWSER_TEST_URL||'http://127.0.0.1:5186';
const browser=await chromium.launch();
try {
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  let budget=null,approved=0,revoked=0;
  await page.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());
  await page.route('**/chat-api/**',async r=>{
    const path=new URL(r.request().url()).pathname,method=r.request().method();
    let result={};
    if(path.endsWith('/sessions'))result={token:'t'.repeat(43)};
    if(path.endsWith('/inboxes'))result={inboxes:[]};
    if(path.endsWith('/budget')){
      if(method==='POST'){
        const body=r.request().postDataJSON();assert.equal(body.approved,true);assert.equal(body.amountAtomic,'1000');
        assert.deepEqual(body.services,['discovery.search','discovery.people','discovery.companies','discovery.contents']);
        budget={...body,remainingAtomic:'1000',revoked:false};approved++;
      }
      if(method==='DELETE'){budget.revoked=true;revoked++;}
      result={budget};
    }
    await r.fulfill({contentType:'application/json',body:JSON.stringify(result)});
  });
  await page.goto(base);
  await page.locator('.research-budget summary').click();
  await page.getByRole('button',{name:'Authorize research budget',exact:true}).click();
  await page.getByRole('button',{name:'Stop automatic payments',exact:true}).waitFor();
  assert.equal(approved,1);
  await page.getByRole('button',{name:'Stop automatic payments',exact:true}).click();
  await page.getByRole('button',{name:'Authorize research budget',exact:true}).waitFor();
  assert.equal(revoked,1);
  console.log('PASS research budget: explicit scope, atomic amount, authorization and revocation');
} finally {await browser.close();}
