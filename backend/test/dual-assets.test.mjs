import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,createPublicKey,verify} from 'node:crypto';
import {PrivateKey,Transaction,TransferTransaction,TransactionId,AccountId,Client,Hbar} from '@hiero-ledger/sdk';
import {inspectHederaTransaction} from '@x402/hedera';
import {Blocky,NETWORK,USDC,HBAR} from '../src/payments/blocky.mjs';
import {signQuote,inspectPayment,confirmTransfer,RefundSigner} from '../src/payments/hedera.mjs';
import {Engine} from '../src/engine.mjs';
import {Store,hash} from '../src/store.mjs';
import {Providers} from '../src/providers.mjs';
import {catalog} from '../src/catalog.mjs';
import {createApi} from '../src/server.mjs';

const key=PrivateKey.generateECDSA().toStringRaw(), payer='0.0.999',merchant='0.0.123',sponsor='0.0.7162784';
const credential=randomBytes(32).toString('base64url');
function setup(){
  const env={WIKSHI_PUBLIC_ORIGIN:'https://api.wikshi.xyz',WIKSHI_MERCHANT_ACCOUNT:merchant,WIKSHI_MERCHANT_KEY:'fixture',WIKSHI_PRICE_INSPECT:'7',WIKSHI_PRICE_INSPECT_HBAR:'1000'};
  const calls=[], confirmations=[];
  const blocky=new Blocky(async(url,options)=>{
    const path=new URL(url).pathname;calls.push(path);
    if(path==='/supported')return Response.json({kinds:[{x402Version:2,scheme:'exact',network:NETWORK,extra:{feePayer:sponsor}}]});
    const body=JSON.parse(options.body),payment=inspectPayment(body.paymentPayload,body.paymentRequirements,Transaction.fromBytes(Buffer.from(body.paymentPayload.payload.transaction,'base64')).transactionMemo.slice(7));
    return Response.json(path==='/verify'?{isValid:true,payer:payment.payer}:{success:true,network:NETWORK,payer:payment.payer,transaction:payment.tx});
  });
  const store=new Store(':memory:','aa'.repeat(32));
  const engine=new Engine({env,store,blocky,providers:{execute:async()=>({done:true,result:{ok:true}})},confirm:async(tx,args)=>{confirmations.push({tx,...args});return true;}});
  return {engine,store,env,calls,confirmations};
}
const quote=(e,c=credential,idem=randomBytes(16).toString('hex'))=>e.quote('network.inspect',{account:payer},c,idem);
const pay=async(e,op,asset,c=credential)=>e.pay(op.id,c,await signQuote(payer,key,e.challenge(op).accepts.find(q=>q.asset===asset),op.id));

test('dual quote publishes exact independent asset prices, preserving legacy USDC fields',async()=>{
  const {engine,env}=setup();const op=await quote(engine);
  assert.deepEqual(engine.challenge(op).accepts.map(q=>[q.asset,q.amount]),[[USDC,'7'],[HBAR,'1000']]);
  const service=catalog(env)[0];assert.equal(service.rateAtomic,'7');assert.deepEqual(service.prices.map(p=>p.decimals),[6,8]);
  delete env.WIKSHI_PRICE_INSPECT;assert.equal(catalog(env)[0].enabled,true);assert.equal(catalog(env)[0].rateAtomic,null);
  assert.deepEqual(engine.challenge(await quote(engine)).accepts.map(q=>q.asset),[HBAR]);
});

for(const asset of [USDC,HBAR])test(`${asset}: signed payment, receipt and private retrieval keep chosen asset`,async()=>{
  const {engine,store,confirmations}=setup();const op=await quote(engine);
  await pay(engine,op,asset);await engine.tick();const saved=store.get(op.id),receipt=saved.data.receipt;
  assert.equal(saved.state,'completed');assert.equal(receipt.asset,asset);assert.equal(receipt.chargedAtomic,asset===HBAR?'1000':'7');
  assert.equal(receipt.decimals,asset===HBAR?8:6);
  assert.equal(confirmations[0].asset,asset);assert.equal(confirmations[0].memo,`wikshi:${op.id}`);
  assert.equal(verify(null,Buffer.from(receipt.signedPayload,'base64'),createPublicKey({key:engine.receiptKey,format:'jwk'}),Buffer.from(receipt.signature,'base64')),true);
  assert.throws(()=>engine.authorize(op.id,'different-private-credential'),/not_found/);
});

test('unoffered assets and altered amounts never reach verification or settlement',async()=>{
  const {engine,calls}=setup();const op=await quote(engine),q=engine.challenge(op).accepts[1];
  await assert.rejects(engine.pay(op.id,credential,{accepted:{asset:'0.0.456858'}}),/payment_asset_not_offered/);
  const changed=await signQuote(payer,key,{...q,amount:'1'},op.id);
  await assert.rejects(engine.pay(op.id,credential,changed),/payment_quote_mismatch/);
  assert.equal(calls.includes('/verify'),false);assert.equal(calls.includes('/settle'),false);
});

test('concurrent currencies cannot pay twice or change the locked selection',async()=>{
  const {engine,store,calls}=setup();const op=await quote(engine);
  const [usdc,hbar]=await Promise.all(engine.challenge(op).accepts.map(q=>signQuote(payer,key,q,op.id)));
  await Promise.all([engine.pay(op.id,credential,hbar),engine.pay(op.id,credential,usdc)]);
  assert.equal(calls.filter(p=>p==='/settle').length,1);assert.equal(store.get(op.id).data.requirements.asset,HBAR);
  await engine.pay(op.id,credential,usdc);assert.equal(calls.filter(p=>p==='/settle').length,1);
});

test('quote retry retains original prices after configuration changes',async()=>{
  const {engine,env}=setup(),idem='persistent-dual-quote';const first=await quote(engine,credential,idem);
  env.WIKSHI_PRICE_INSPECT_HBAR='999999';delete env.WIKSHI_PRICE_INSPECT;
  const retry=await quote(engine,credential,idem);assert.equal(first.id,retry.id);
  assert.deepEqual(engine.challenge(retry).accepts.map(q=>q.amount),['7','1000']);
  const paid=await pay(engine,retry,HBAR);assert.equal(paid.data.price.rateAtomic,'1000');
});

test('restart during HBAR confirmation retains asset and never resubmits payment',async()=>{
  const {engine,store,calls}=setup();engine.confirm=async()=>false;
  const op=await pay(engine,await quote(engine),HBAR);
  assert.equal(op.state,'confirming_payment');engine.recover();
  engine.confirm=async(tx,args)=>{assert.equal(args.asset,HBAR);return true;};
  await engine.tick();await engine.tick();
  assert.equal(store.get(op.id).data.receipt.asset,HBAR);assert.equal(calls.filter(p=>p==='/settle').length,1);
});

test('historical single-asset USDC quotes remain payable and refundable',async()=>{
  const {engine,store}=setup();const op=await quote(engine);delete op.data.offers;store.save(op);
  assert.deepEqual(engine.challenge(op).accepts.map(q=>q.asset),[USDC]);
  await assert.rejects(engine.pay(op.id,credential,{accepted:{asset:HBAR}}),/payment_asset_not_offered/);
  const paid=await pay(engine,op,USDC);engine.fail(paid);
  assert.equal(engine.view(store.get(op.id)).refund.asset,USDC);
});

test('same payer owns one durable inbox across currencies and credentials',async()=>{
  const {engine,env,store}=setup();Object.assign(env,{WIKSHI_EMAIL_READY:'true',WIKSHI_EMAIL_DOMAIN:'wikshi.xyz',RESEND_API_KEY:'fixture',RESEND_WEBHOOK_SECRET:'fixture',WIKSHI_PRICE_INBOX:'1',WIKSHI_PRICE_INBOX_HBAR:'100'});
  engine.providers=new Providers(env);
  const created=await engine.quote('email.inbox',{displayName:'My agent'},credential,randomBytes(16).toString('hex'));
  await pay(engine,created,USDC);await engine.tick();const first=store.get(created.id);
  const other=randomBytes(32).toString('base64url');const second=await pay(engine,await quote(engine,other),HBAR,other);
  assert.equal(second.data.inbox,undefined);assert.deepEqual(store.inboxes(hash(other)),[]);
  const inboxQuote=await engine.quote('email.inbox',{displayName:'My agent'},other,randomBytes(16).toString('hex'));
  await pay(engine,inboxQuote,HBAR,other);await engine.tick();
  assert.equal(store.inboxes(hash(other))[0].id,first.data.inbox.id);
});

for(const asset of [USDC,HBAR])test(`${asset}: metered and full refunds retain asset across retry/recovery`,async()=>{
  const {engine,store,confirmations}=setup();let prepares=0,submits=0,preparedAsset;
  engine.refundSigner={prepare:async(p,amount,id,a)=>{prepares++;preparedAsset=a;return {tx:`${merchant}@100.100`,bytes:'fixture'};},submit:async()=>{submits++;throw Error('uncertain');}};
  const op=await pay(engine,await quote(engine),asset);op.data.price={...op.data.price,unit:'second',rateAtomic:'1000'};op.data.requirements.amount='60000';op.data.input.maxSeconds=60;
  engine.finish(op,{transcript:[]},20.1);const saved=store.get(op.id);
  assert.equal(saved.data.receipt.chargedAtomic,'21000');assert.equal(saved.data.refund.amount,'39000');
  engine.confirm=async(tx,args)=>{confirmations.push({tx,...args});return false;};
  await engine.refund(saved);engine.recover();await engine.refund(store.get(op.id));
  assert.equal(prepares,1);assert.equal(submits,1);assert.equal(preparedAsset,asset);
  assert.equal(confirmations.at(-1).asset,asset);assert.equal(confirmations.at(-1).memo,`refund:${op.id}`);
  assert.equal(engine.view(store.get(op.id)).refund.currency,asset===HBAR?'HBAR':'USDC');
  engine.confirm=async()=>true;await engine.refund(store.get(op.id));assert.equal(store.get(op.id).data.refund.status,'confirmed');
  const failed=await pay(engine,await quote(engine),asset);engine.fail(failed);
  assert.equal(store.get(failed.id).data.refund.amount,asset===HBAR?'1000':'7');
});

test('native transfer inspection rejects mixed assets, wrong memo and wrong recipient',async()=>{
  const {engine}=setup();const op=await quote(engine),q=engine.challenge(op).accepts[1];
  const signed=await signQuote(payer,key,q,op.id);assert.equal(inspectPayment(signed,q,op.id).payer,payer);
  assert.throws(()=>inspectPayment(signed,{...q,payTo:'0.0.888'},op.id),/invalid_payment/);
  assert.throws(()=>inspectPayment(signed,q,'wrong-operation'),/invalid_payment/);
  assert.throws(()=>inspectPayment(signed,{...q,asset:USDC},op.id),/invalid_payment/);
  const client=Client.forTestnet();try{
    const tx=new TransferTransaction().addHbarTransfer(payer,Hbar.fromTinybars(-1000)).addHbarTransfer(merchant,Hbar.fromTinybars(1000))
      .addTokenTransfer(USDC,payer,-1).addTokenTransfer(USDC,merchant,1)
      .setTransactionId(TransactionId.generate(AccountId.fromString(sponsor))).setTransactionMemo(`wikshi:${op.id}`).freezeWith(client);
    await tx.sign(PrivateKey.fromStringECDSA(key));
    assert.throws(()=>inspectPayment({payload:{transaction:Buffer.from(tx.toBytes()).toString('base64')}},q,op.id),/invalid_payment/);
  }finally{client.close();}
});

test('HBAR Mirror confirmation accounts for sponsor fees and merchant refund fees',async()=>{
  const args={payer,payTo:merchant,amount:'1000',asset:HBAR,memo:'wikshi:fixture'};
  const row={result:'SUCCESS',name:'CRYPTOTRANSFER',nonce:0,charged_tx_fee:250,memo_base64:Buffer.from(args.memo).toString('base64'),transfers:[{account:payer,amount:-1000},{account:merchant,amount:1000},{account:sponsor,amount:-250},{account:'0.0.98',amount:250}],token_transfers:[]};
  const get=async()=>Response.json({transactions:[row]});
  assert.equal(await confirmTransfer(`${sponsor}@100.100`,args,get),true);
  row.transfers[1].amount=999;assert.equal(await confirmTransfer(`${sponsor}@100.100`,args,get),false);row.transfers[1].amount=1000;
  assert.equal(await confirmTransfer(`${sponsor}@100.100`,{...args,asset:USDC},get),false);
  assert.equal(await confirmTransfer(`${sponsor}@100.100`,{...args,memo:'different'},get),false);
  row.transfers=[{account:merchant,amount:-1250},{account:payer,amount:1000},{account:'0.0.98',amount:250}];
  assert.equal(await confirmTransfer(`${merchant}@100.100`,{...args,payer:merchant,payTo:payer},get),true);
  row.transfers[0].amount=-1000;assert.equal(await confirmTransfer(`${merchant}@100.100`,{...args,payer:merchant,payTo:payer},get),false);
  row.charged_tx_fee=undefined;assert.equal(await confirmTransfer(`${merchant}@100.100`,{...args,payer:merchant,payTo:payer},get),false);
});

test('native payment cannot smuggle an NFT transfer alongside the HBAR amount',async()=>{
  const {engine}=setup();const op=await quote(engine),q=engine.challenge(op).accepts[1];
  const client=Client.forTestnet();try{
    const tx=new TransferTransaction().addHbarTransfer(payer,Hbar.fromTinybars(-1000)).addHbarTransfer(merchant,Hbar.fromTinybars(1000))
      .addNftTransfer('0.0.555',1,payer,merchant)
      .setTransactionId(TransactionId.generate(AccountId.fromString(sponsor))).setTransactionMemo(`wikshi:${op.id}`).freezeWith(client);
    await tx.sign(PrivateKey.fromStringECDSA(key));
    assert.throws(()=>inspectPayment({payload:{transaction:Buffer.from(tx.toBytes()).toString('base64')}},q,op.id),/invalid_payment/);
  }finally{client.close();}
});

test('refund signer creates native HBAR bytes, not an HTS 0.0.0 transfer',async()=>{
  const signer=new RefundSigner(merchant,key);const prepared=await signer.prepare(payer,'39000','fixture',HBAR);
  const tx=inspectHederaTransaction(prepared.bytes);
  assert.equal(tx.transactionIdAccountId,merchant);assert.deepEqual(tx.tokenTransfers,{});
  assert.deepEqual(tx.hbarTransfers.map(e=>e.amount).sort(),['-39000','39000']);
  assert.equal(Transaction.fromBytes(Buffer.from(prepared.bytes,'base64')).transactionMemo,'refund:fixture');
});

test('HTTP 402 advertises both currencies and accepts the selected HBAR payload',async()=>{
  const {engine}=setup();const server=createApi(engine);await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try{
    const base=`http://127.0.0.1:${server.address().port}`,headers={Authorization:`Bearer ${credential}`,'Content-Type':'application/json','Idempotency-Key':'dual-http-request-001'};
    const response=await fetch(`${base}/v1/operations`,{method:'POST',headers,body:JSON.stringify({service:'network.inspect',input:{account:payer}})});
    assert.equal(response.status,402);const body=await response.json(),challenge=JSON.parse(Buffer.from(response.headers.get('payment-required'),'base64'));
    assert.deepEqual(challenge.accepts.map(q=>q.asset),[USDC,HBAR]);assert.equal(body.paymentOptions[1].currency,'HBAR');
    const payment=await signQuote(payer,key,challenge.accepts[1],body.id);
    const paid=await fetch(`${base}/v1/operations/${body.id}/pay`,{method:'POST',headers,body:JSON.stringify({payment})});
    assert.equal(paid.status,202);assert.equal((await paid.json()).payment.asset,HBAR);
  }finally{await new Promise(r=>server.close(r));}
});
