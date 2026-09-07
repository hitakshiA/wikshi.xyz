// Browser-only fixtures. Every chat API request is intercepted; no live sessions or payments.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)('playwright');

const browser=await chromium.launch();
const base=process.env.WIKSHI_BROWSER_TEST_URL||'http://127.0.0.1:5180';
const longResponse=Array.from({length:30},(_,index)=>`### Research note ${index+1}\n\nThis company offers a focused product for businesses handling customer calls. The useful next step is to compare the product, the people behind it, and the available contact details.\n\n- Keep the company and contact matched.\n- Preserve the source for each finding.`).join('\n\n');
const near=(actual,expected,label)=>assert(Math.abs(actual-expected)<=1,`${label}: expected ${expected}, received ${actual}`);

async function checkLayout(page,width,state){
  const layout=await page.evaluate(()=>{
    const box=selector=>{const rect=document.querySelector(selector).getBoundingClientRect();return {x:rect.x,right:rect.right,width:rect.width,y:rect.y,bottom:rect.bottom};};
    const scroll=document.querySelector('.conversation-scroll');
    return {shell:box('.chat-shell'),header:box('.chat-header'),footer:box('.chat-footer'),conversation:box('.conversation'),scroll:box('.conversation-scroll'),composer:box('.composer'),workspace:box('.workspace'),messages:box('.messages'),overflow:document.documentElement.scrollWidth>innerWidth,scrollHeight:scroll.scrollHeight,scrollClientHeight:scroll.clientHeight,viewportHeight:innerHeight};
  });
  for(const name of ['shell','header','footer']){
    near(layout[name].x,0,`${width}px ${state} ${name} left`);
    near(layout[name].right,width,`${width}px ${state} ${name} right`);
  }
  near(layout.footer.bottom,layout.viewportHeight,`${width}px ${state} footer bottom`);
  assert.equal(layout.overflow,false,`${width}px ${state} must not overflow horizontally`);
  assert(layout.composer.width<=810.5,`${width}px ${state} composer remains readable`);
  assert(layout.messages.width<=810.5,`${width}px ${state} messages remain readable`);
  near(layout.composer.x+layout.composer.width/2,layout.conversation.x+layout.conversation.width/2,`${width}px ${state} centered composer`);
  assert(layout.composer.bottom<=layout.footer.y,`${width}px ${state} composer stays above footer`);
  assert(layout.scroll.bottom<=layout.composer.y,`${width}px ${state} scroll area does not cover composer`);
  if(width>=1000){
    near(layout.workspace.right,width,`${width}px ${state} workspace reaches the edge`);
    near(layout.conversation.right,layout.workspace.x,`${width}px ${state} conversation meets workspace`);
    near(layout.scroll.right,layout.workspace.x,`${width}px ${state} scrollbar meets workspace divider`);
    await page.getByRole('button',{name:'Your workspace'}).isHidden().then(hidden=>assert(hidden));
  }
  if(state==='conversation')assert(layout.scrollHeight>layout.scrollClientHeight,`${width}px long response scrolls within the chat`);
  return layout;
}

try{
  for(const width of [390,1280,1920,2560,3840]){
    const page=await browser.newPage({viewport:{width,height:1080}});
    const errors=[],apiRequests=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/chat-api/**',async route=>{
      const pathname=new URL(route.request().url()).pathname;
      apiRequests.push(pathname);
      if(pathname.endsWith('/message'))return route.fulfill({contentType:'application/x-ndjson',body:[{type:'text',text:longResponse},{type:'done'}].map(event=>JSON.stringify(event)).join('\n')+'\n'});
      const body=pathname.endsWith('/sessions')?{token:'t'.repeat(43)}:pathname.endsWith('/inboxes')?{inboxes:[]}:pathname.endsWith('/sponsorship')?{available:true}:{};
      return route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
    });
    await page.goto(base);
    await page.locator('.welcome h1').waitFor();
    await page.evaluate(()=>document.fonts.ready);
    await checkLayout(page,width,'welcome');
    if(width===390){
      const workspaceButton=page.getByRole('button',{name:'Your workspace'});
      await workspaceButton.click();
      await page.locator('.workspace-open').waitFor();
      assert.equal(await workspaceButton.getAttribute('aria-expanded'),'true');
      near((await page.locator('.workspace-open').boundingBox()).x+(await page.locator('.workspace-open').boundingBox()).width,width,'mobile workspace right edge');
      await page.getByRole('button',{name:'Close workspace'}).click();
      assert.equal(await workspaceButton.getAttribute('aria-expanded'),'false');
    }
    if(width===1920||width===2560)await page.screenshot({path:`/tmp/wikshi-wide-welcome-${width}.png`});
    await page.locator('#mission').fill('Compare the companies we found and explain what is worth checking next.');
    await page.getByRole('button',{name:'Send message',exact:true}).click();
    await page.locator('.message-markdown h3').last().waitFor();
    assert.equal(await page.locator('.message-markdown h3').count(),30);
    const layout=await checkLayout(page,width,'conversation');
    const composerBefore=await page.locator('.composer').boundingBox();
    await page.locator('.conversation-scroll').evaluate(element=>{element.scrollTop=0;});
    const composerAfter=await page.locator('.composer').boundingBox();
    near(composerBefore.y,composerAfter.y,`${width}px composer does not move when history scrolls`);
    if(width===390||width===2560)await page.screenshot({path:`/tmp/wikshi-wide-conversation-${width}.png`});
    assert.equal(apiRequests.filter(path=>path.endsWith('/message')).length,1);
    assert.deepEqual(errors,[]);
    console.log(`PASS ${width}px: edge-to-edge shell, readable ${Math.round(layout.composer.width)}px composer, aligned workspace divider, isolated long-chat scrolling${width===390?', mobile workspace opens and closes':''}`);
    await page.close();
  }
}finally{await browser.close();}
