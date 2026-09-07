// Browser-only interception. No real signatures, payments, or service requests.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)('playwright');

const browser=await chromium.launch();
const base=process.env.WIKSHI_BROWSER_TEST_URL||'http://127.0.0.1:5180';
const id='00000000-0000-0000-0000-000000000001';
const walletModule=`let connected=false; export async function walletOptions(){return {accounts:connected?['0.0.12345']:[],extensions:[{id:'test-hashpack',name:'HashPack'}]}}; export async function connectWallet(id){window.__extension=id;connected=true;return '0.0.12345'}; export function chooseWalletAccount(id){window.__account=id;}; export async function signPayment(id,quote){if(window.__reject)throw Error('Wallet request rejected.');window.__signature={id,quote};return {x402Version:2,accepted:quote,payload:{transaction:'browser-test-only'}}};`;
try{
  for(const width of [1280,390])for(const mode of ['wallet','sponsor'])for(const currency of ['USDC','HBAR']){
    const page=await browser.newPage({viewport:{width,height:960}});
    const requests=[],errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    const op={id,service:'network.inspect',status:'awaiting_payment',input:{account:'0.0.456'},expiresAt:new Date(Date.now()+600_000).toISOString(),paymentRequired:{accepts:['USDC','HBAR'].map(c=>({scheme:'exact',network:'hedera:testnet',asset:c==='HBAR'?'0.0.0':'0.0.429274',amount:c==='HBAR'?'1000':'1',payTo:'0.0.456',extra:{feePayer:'0.0.789'}}))}};
    await page.route('**/src/wallet.ts*',route=>route.fulfill({contentType:'text/javascript',body:walletModule}));
    await page.route('**/chat-api/**',async route=>{
      const url=new URL(route.request().url());let body={};
      if(url.pathname.endsWith('/sessions'))body={token:'t'.repeat(43)};
      else if(url.pathname.endsWith('/sponsorship'))body={available:true};
      else if(url.pathname.endsWith('/inboxes'))body={inboxes:[]};
      else if(url.pathname.endsWith('/message'))return route.fulfill({contentType:'application/x-ndjson',body:[{type:'operation',operation:op},{type:'done'}].map(x=>JSON.stringify(x)).join('\n')+'\n'});
      else if(/\/(pay|sponsor)$/.test(url.pathname)){
        requests.push({path:url.pathname,body:route.request().postDataJSON()});op.status='completed';op.result={account:'0.0.456'};body=op;
      }else if(url.pathname.includes('/operations/'))body=op;
      return route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
    });
    await page.goto(base);
    await page.locator('#mission').fill('Payment controls test');
    await page.getByRole('button',{name:'Send message',exact:true}).click();
    await page.getByRole('button',{name:currency,exact:true}).click();
    await page.locator('.wallet-choice > summary').click();
    await page.getByRole('button',{name:'Connect HashPack',exact:true}).click();
    await page.waitForFunction(()=>window.__extension==='test-hashpack');
    await page.getByLabel('Signing account').waitFor();
    assert.equal(await page.evaluate(()=>window.__extension),'test-hashpack');
    assert.equal(await page.getByLabel('Signing account').inputValue(),'0.0.12345');
    if(mode==='wallet'&&currency==='USDC')await page.screenshot({path:`/tmp/wikshi-wallet-choice-${width}.png`,fullPage:true});
    if(mode==='wallet'){
      // A rejected signature must not submit any API payment and must be retryable.
      await page.evaluate(()=>{window.__reject=true});
      await page.getByRole('button',{name:`Approve & sign ${currency}`}).click();
      await page.getByRole('alert').filter({hasText:'Wallet request rejected.'}).waitFor();
      assert.equal(requests.length,0);
      await page.evaluate(()=>{window.__reject=false});
      await page.getByRole('button',{name:`Approve & sign ${currency}`}).click();
    }else{
      await page.getByRole('button',{name:'Let Wikshi sponsor this',exact:true}).click();
      assert.equal(requests.length,0);
      await page.getByRole('button',{name:'Approve sponsored payment',exact:true}).click();
    }
    await page.waitForFunction(()=>document.querySelector('.state-label')?.textContent==='completed');
    assert.equal(requests.length,1);assert.equal(requests[0].body.approved,true);
    if(mode==='wallet'){
      assert(requests[0].path.endsWith('/pay'));
      assert.equal(requests[0].body.payment.accepted.asset,currency==='HBAR'?'0.0.0':'0.0.429274');
    }else{assert(requests[0].path.endsWith('/sponsor'));assert.equal(requests[0].body.currency,currency);}
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    assert.deepEqual(errors,[]);
    console.log(`PASS ${width}px ${mode} ${currency}: explicit approval, exact currency, extension selection, no duplicate payment`);
    await page.close();
  }
}finally{await browser.close();}
