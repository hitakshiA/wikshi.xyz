// All chat responses are intercepted. This test never signs or pays.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)('playwright');
const browser=await chromium.launch();
const base=process.env.WIKSHI_BROWSER_TEST_URL||'http://127.0.0.1:5180';
const operation={id:'00000000-0000-0000-0000-000000000001',service:'discovery.search',status:'awaiting_payment',input:{query:'AI receptionist startups worldwide',limit:10},expiresAt:new Date(Date.now()+600_000).toISOString(),paymentRequired:{accepts:['USDC','HBAR'].map(currency=>({scheme:'exact',network:'hedera:testnet',asset:currency==='HBAR'?'0.0.0':'0.0.429274',amount:currency==='HBAR'?'1000':'1',payTo:'0.0.10397138'}))}};
try {
  for(const width of [1280,390]) {
    const page=await browser.newPage({viewport:{width,height:960}}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/chat-api/**',route=>{
      const path=new URL(route.request().url()).pathname;
      if(path.endsWith('/message'))return route.fulfill({contentType:'application/x-ndjson',body:[
        {type:'text',text:'I’ll start with a **web search** for AI receptionist startups.'},
        {type:'text_boundary'},
        {type:'text',text:'Then we can use the results to find the right contacts.'},
        {type:'operation',operation},{type:'done'},
      ].map(event=>JSON.stringify(event)).join('\n')+'\n'});
      return route.fulfill({json:path.endsWith('/sessions')?{token:'t'.repeat(43)}:path.endsWith('/sponsorship')?{available:true}:{inboxes:[]}});
    });
    await page.goto(base);
    await page.locator('#mission').fill('hey find some startups doing ai receptionists');
    await page.getByRole('button',{name:'Send message',exact:true}).click();
    await page.getByRole('button',{name:'Sponsor this',exact:true}).waitFor();
    await page.waitForFunction(()=>!document.querySelector('.tool-activity'));
    await page.evaluate(async()=>{await document.fonts.ready;await Promise.race([Promise.all([...document.images].map(img=>img.decode().catch(()=>{}))),new Promise(resolve=>setTimeout(resolve,3000))]);});
    await page.locator('.conversation-scroll').evaluate(el=>{el.scrollTop=el.scrollHeight;});
    assert.equal(await page.locator('.message-markdown strong').innerText(),'web search');
    assert.equal(await page.locator('.message-markdown > p').count(),2);
    assert.equal(await page.locator('.streaming-text').count(),0);
    assert.equal(await page.locator('.payment-wrap').count(),1);
    assert.equal(await page.locator('.approval-brief').getAttribute('open'),null);
    assert.equal(await page.locator('.wallet-choice').getAttribute('open'),null);
    const card=await page.locator('.payment-wrap').boundingBox(),face=await page.locator('.payment-card').boundingBox();
    assert(card.width<=521,`payment width ${card.width}`);
    assert(card.height<=430,`payment height ${card.height}`);
    assert(face.height<=205,`card face height ${face.height}`);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    if(width===1280) {
      const surface=await page.locator('.payment-surface').boundingBox();
      for(const [x,y] of [[.1,.1],[.9,.1],[.1,.9],[.9,.9]]) {
        await page.mouse.move(surface.x+surface.width*x,surface.y+surface.height*y);
        const rotation=await page.locator('.payment-surface').evaluate(el=>[parseFloat(el.style.getPropertyValue('--rx')),parseFloat(el.style.getPropertyValue('--ry'))]);
        assert.equal(Math.sign(rotation[0]),y<.5?1:-1);assert.equal(Math.sign(rotation[1]),x<.5?-1:1);
      }
      await page.mouse.move(0,0);
    }
    await page.screenshot({path:`/tmp/wikshi-compact-payment-${width}.png`,fullPage:true});
    // Verify renderer features and untrusted markup separately from the compact fixture.
    await page.evaluate(async()=>{
      const {default:React}=await import('/node_modules/.vite/deps/react.js');
      const {default:ReactDOM}=await import('/node_modules/.vite/deps/react-dom_client.js');
      const {MessageText}=await import('/src/message-text.tsx');
      const mount=document.createElement('div');mount.id='renderer-test';document.body.append(mount);
      ReactDOM.createRoot(mount).render(React.createElement(MessageText,{text:'1. **Bold**\n2. Second\n\n| Company | Location |\n| --- | --- |\n| Example | Global |\n\n[Source](https://example.com) [Unsafe](javascript:alert(1))\n\n`inline`\n\n<script>window.__injected=true</script>\n\n![tracking](https://example.com/tracker.png)'}));
    });
    await page.locator('#renderer-test strong').waitFor();
    assert.equal(await page.locator('#renderer-test ol li').count(),2);
    assert.equal(await page.locator('#renderer-test table tbody tr').count(),1);
    assert.equal(await page.locator('#renderer-test a').count(),1);
    assert.equal(await page.locator('#renderer-test code').innerText(),'inline');
    assert.equal(await page.locator('#renderer-test img, #renderer-test script').count(),0);
    assert.equal(await page.evaluate(()=>Boolean(window.__injected)),false);
    assert.deepEqual(errors,[]);
    console.log(`PASS ${width}px: ${Math.round(card.width)}×${Math.round(card.height)} payment, ${Math.round(face.height)}px face, Markdown, no cursor, safe links${width===1280?', four-quadrant tilt':''}`);
    await page.close();
  }
}finally{await browser.close();}
