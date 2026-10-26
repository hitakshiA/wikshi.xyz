import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)('playwright');
const browser=await chromium.launch();
try{for(const [width,height] of [[1920,1000],[1440,900],[1366,768],[1024,768],[390,844]]){
  const page=await browser.newPage({viewport:{width,height},reducedMotion:'reduce'});
  let messages=0;const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/chat-api/**',route=>{if(route.request().url().endsWith('/message'))messages++;return route.fulfill({contentType:'application/json',body:JSON.stringify({token:'t'.repeat(43),ok:true})});});
  await page.goto(process.env.WIKSHI_BROWSER_TEST_URL||'http://127.0.0.1:5182');
  await page.getByRole('heading',{name:'Tools your agent can use'}).waitFor();
  assert.equal(await page.locator('.starter-tools dt').count(),5);
  assert.equal(await page.getByText('Payments & records',{exact:true}).count(),0);
  const prompts=page.locator('.starter-prompt-box button');assert.equal(await prompts.count(),3);
  assert.equal(await page.locator('.starter-page').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
  assert.equal(await page.locator('.conversation-scroll').evaluate(el=>el.scrollTop),0,'Start at the explanation, not the bottom of the prompt box');
  await page.evaluate(()=>document.fonts.ready);
  await page.waitForFunction(()=>{const image=document.querySelector('.starter-intro img');return image?.complete&&image.naturalWidth>0;});
  await page.waitForTimeout(800);
  if(width>=1000){
    const fit=await page.locator('.conversation-scroll').evaluate(el=>({content:el.scrollHeight,available:el.clientHeight}));
    assert.ok(fit.content<=fit.available+1,`${width}×${height}: starter overflows ${JSON.stringify(fit)}`);
    assert.ok(await page.locator('.workspace').evaluate(el=>el.scrollHeight<=el.clientHeight+1),'New-chat workspace fits too');
    for(const prompt of await prompts.all())assert.ok(await prompt.isVisible());
  }
  await page.screenshot({path:`/tmp/wikshi-starter-${width}.png`});
  for(let i=0;i<3;i++){
    const button=prompts.nth(i),expected=await button.locator('.starter-prompt-text').innerText();
    await button.click();
    assert.equal(await page.locator('#mission').inputValue(),expected);
    await page.waitForFunction(()=>document.activeElement===document.querySelector('#mission'));
  }
  assert.equal(messages,0,'Selecting a starter must not send or execute it');
  assert.deepEqual(errors,[]);
  console.log(`${width}px: capabilities, full prompt box, editable selection, focus and no auto-send passed`);
  await page.close();
}}finally{await browser.close();}
