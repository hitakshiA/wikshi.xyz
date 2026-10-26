// All API requests are fixtures. No payment or provider request is made.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)('playwright');
const base=process.env.WIKSHI_BROWSER_TEST_URL||'http://127.0.0.1:5186';
const browser=await chromium.launch();
try {
  for(const width of [390,1280]) {
    const page=await browser.newPage({viewport:{width,height:844}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    let release,payments=0;
    const op={id:'00000000-0000-0000-0000-000000000001',service:'phone.call',status:'awaiting_payment',input:{mission:'Ask about a fictional booking.',phone:'+12025550123'},expiresAt:new Date(Date.now()+600000).toISOString(),paymentRequired:{accepts:[{scheme:'exact',network:'hedera:testnet',asset:'0.0.429274',amount:'120',payTo:'0.0.456',extra:{feePayer:'0.0.789'}}]}};
    await page.route('**/*',route=>new URL(route.request().url()).origin===new URL(base).origin?route.continue():route.abort());
    await page.route('**/chat-api/**',async route=>{
      const path=new URL(route.request().url()).pathname;
      const json=(value,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(value)});
      if(path.endsWith('/sessions'))return json({token:'t'.repeat(43)});
      if(path.endsWith('/sponsorship'))return json({available:true});
      if(path.endsWith('/inboxes'))return json({inboxes:[]});
      if(path.endsWith('/message'))return route.fulfill({contentType:'application/x-ndjson',body:[{type:'text',text:'Your call is ready for approval.\n\n'+('A readable conversation paragraph.\n\n'.repeat(16))},{type:'operation',operation:op},{type:'done'}].map(e=>JSON.stringify(e)).join('\n')+'\n'});
      if(path.endsWith('/sponsor')){payments++;await new Promise(resolve=>release=resolve);return json({error:'Payment could not be confirmed. Check the request before retrying.'},503);}
      if(path.includes('/operations/'))return json(op);
      return json({});
    });
    await page.goto(base);
    await page.locator('#mission').fill('Prepare a demo call');
    await page.getByRole('button',{name:'Send message',exact:true}).click();
    await page.getByRole('button',{name:'Sponsor this',exact:true}).click();
    await page.getByRole('button',{name:'Approve sponsored payment',exact:true}).click();
    const processing=page.getByRole('button',{name:'Processing payment…',exact:true});
    await processing.waitFor();
    assert.equal(await processing.isDisabled(),true);
    assert.equal(await processing.getAttribute('aria-busy'),'true');
    assert.equal(await page.locator('.payment-spinner').evaluate(el=>getComputedStyle(el).animationName),'payment-spin');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('dialog').evaluate(el=>el.open),true);
    await page.emulateMedia({reducedMotion:'reduce'});
    assert.equal(await page.locator('.payment-spinner').evaluate(el=>getComputedStyle(el).animationName),'none');
    assert.equal(payments,1);
    release();
    await page.locator('dialog [role=alert]').waitFor();
    assert.equal(await page.getByRole('button',{name:'Approve sponsored payment',exact:true}).isEnabled(),true);
    assert.equal(await page.locator('.payment-spinner').count(),0);
    await page.getByRole('button',{name:'Back',exact:true}).click();
    {
      const layout=await page.evaluate(()=>{const scroll=document.querySelector('.conversation-scroll'),form=document.querySelector('.composer');scroll.scrollTop=scroll.scrollHeight;const s=scroll.getBoundingClientRect(),f=form.getBoundingClientRect();return {scrollBottom:s.bottom,formBottom:f.bottom,position:getComputedStyle(form).position,padding:parseFloat(getComputedStyle(scroll).paddingBottom),height:f.height,overflow:document.documentElement.scrollWidth>innerWidth};});
      assert.equal(layout.position,'absolute');
      assert.ok(layout.scrollBottom>layout.formBottom,'History must extend behind the floating composer');
      assert.ok(layout.padding>layout.height,'Last message needs room above composer');
      assert.equal(layout.overflow,false);
      await page.locator('#mission').fill('A longer message\n'.repeat(10));
      await page.waitForTimeout(100);
      assert.ok(await page.evaluate(()=>parseFloat(getComputedStyle(document.querySelector('.conversation-scroll')).paddingBottom)>document.querySelector('.composer').getBoundingClientRect().height));
      await page.screenshot({path:`/tmp/wikshi-composer-${width}.png`});
    }
    assert.deepEqual(errors,[]);
    console.log(`PASS ${width}: sponsored loading, reduced motion, error recovery, composer layout`);
    await page.close();
  }
} finally {await browser.close();}
