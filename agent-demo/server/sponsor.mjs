import {AccountCreateTransaction,TokenAssociateTransaction,TransferTransaction,TransactionId,AccountId,TransactionReceiptQuery,Client,PrivateKey,Hbar} from '@hiero-ledger/sdk';
import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync,renameSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {SessionError} from './sessions.mjs';

const USDC='0.0.429274',HBAR='0.0.0';
const uuid=/^[a-f0-9-]{36}$/;
export function selectSponsoredQuote(op,currency,merchant,now=Date.now()) {
  if(!['USDC','HBAR'].includes(currency))throw new SessionError('Choose USDC or HBAR.');
  if(Date.parse(op.expiresAt)<=now||!Number.isFinite(Date.parse(op.expiresAt)))throw new SessionError('Request a fresh quote before paying.',410);
  const q=op.paymentRequired?.accepts?.find(q=>q.asset===(currency==='USDC'?USDC:HBAR));
  if(!q||q.network!=='hedera:testnet'||q.scheme!=='exact'||q.payTo!==merchant||!/^0\.0\.[1-9]\d*$/.test(q.extra?.feePayer||'')||!/^\d{1,18}$/.test(q.amount)||BigInt(q.amount)<=0n)throw new SessionError('This quote cannot be sponsored.');
  return q;
}
export class Sponsor {
  constructor(env=process.env){this.env=env;this.queue=Promise.resolve();}
  get enabled(){return this.env.WIKSHI_FAUCET_ENABLED==='true'&&/^0\.0\.[1-9]\d*$/.test(this.env.WIKSHI_SPONSOR_ACCOUNT||'')&&!!this.env.WIKSHI_SPONSOR_KEY&&/^[a-f0-9]{64}$/.test(this.env.WIKSHI_SPONSOR_DATA_KEY||'');}
  info(){return {available:this.enabled,hbar:10,usdc:0.5,network:'hedera:testnet'};}
  file(id){if(!uuid.test(id))throw new Error('Invalid wallet ID');const dir=this.env.WIKSHI_SPONSOR_DIR||'/var/lib/wikshi-chat/sponsor';mkdirSync(dir,{recursive:true,mode:0o700});return join(dir,id+'.enc');}
  save(id,data){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',Buffer.from(this.env.WIKSHI_SPONSOR_DATA_KEY,'hex'),iv);cipher.setAAD(Buffer.from(id));const ciphertext=Buffer.concat([cipher.update(JSON.stringify(data)),cipher.final()]);const file=this.file(id);writeFileSync(file+'.tmp',Buffer.concat([iv,cipher.getAuthTag(),ciphertext]),{mode:0o600});renameSync(file+'.tmp',file);}
  load(id){const file=this.file(id);if(!existsSync(file))return null;const bytes=readFileSync(file),cipher=createDecipheriv('aes-256-gcm',Buffer.from(this.env.WIKSHI_SPONSOR_DATA_KEY,'hex'),bytes.subarray(0,12));cipher.setAAD(Buffer.from(id));cipher.setAuthTag(bytes.subarray(12,28));return JSON.parse(Buffer.concat([cipher.update(bytes.subarray(28)),cipher.final()]).toString());}
  async exclusive(fn){const previous=this.queue;let release;this.queue=new Promise(r=>release=r);await previous;try{return await fn();}finally{release();}}
  async step(session,wallet,name,transaction,client,keys=[]) {
    const prior=wallet.steps[name];if(prior?.done)return prior;
    let receipt;
    if(prior){
      // An uncertain submission is reconciled using its ORIGINAL transaction ID.
      // Never mint another transaction or fund twice when a response is lost.
      try{receipt=await new TransactionReceiptQuery().setTransactionId(TransactionId.fromString(prior.tx)).execute(client);}catch{throw new SessionError('Funding confirmation is pending. Please try again shortly.',503);}
    }else{
      transaction.freezeWith(client);for(const key of keys)await transaction.sign(key);await transaction.signWithOperator(client);
      wallet.steps[name]={tx:transaction.transactionId.toString(),bytes:Buffer.from(transaction.toBytes()).toString('base64')};this.save(session.id,wallet);
      try{receipt=await(await transaction.execute(client)).getReceipt(client);}catch{throw new SessionError('Funding confirmation is pending. Please try again shortly.',503);}
    }
    if(receipt.status.toString()!=='SUCCESS')throw new SessionError('The testnet funding transaction did not complete.',503);
    const done={...wallet.steps[name],done:true,account:receipt.accountId?.toString()};wallet.steps[name]=done;this.save(session.id,wallet);return done;
  }
  async payment(session,op,currency) {
    if(!this.enabled)throw new SessionError('Testnet sponsorship is unavailable.',503);
    const quote=selectSponsoredQuote(op,currency,this.env.WIKSHI_SPONSOR_ACCOUNT);
    return this.exclusive(async()=>{
      const treasury=PrivateKey.fromStringECDSA(this.env.WIKSHI_SPONSOR_KEY.replace(/^0x/,''));
      const client=Client.forTestnet().setOperator(this.env.WIKSHI_SPONSOR_ACCOUNT,treasury);
      try{
        let wallet=this.load(session.id);
        if(!wallet){wallet={key:PrivateKey.generateECDSA().toStringRaw(),steps:{},payments:{}};this.save(session.id,wallet);}
        if(wallet.payments[op.id]){session.sponsorAccount=wallet.account;if(wallet.payments[op.id].accepted.asset!==quote.asset)throw new SessionError('This request already has a sponsored payment. Check its status before changing currency.',409);return wallet.payments[op.id];}
        const key=PrivateKey.fromStringECDSA(wallet.key);
        const created=await this.step(session,wallet,'create',new AccountCreateTransaction().setECDSAKeyWithAlias(key.publicKey).setInitialBalance(new Hbar(10)),client);
        wallet.account=created.account;this.save(session.id,wallet);
        await this.step(session,wallet,'associate',new TokenAssociateTransaction().setAccountId(wallet.account).setTokenIds([USDC]),client,[key]);
        await this.step(session,wallet,'initial-usdc',new TransferTransaction().addTokenTransfer(USDC,this.env.WIKSHI_SPONSOR_ACCOUNT,-500000).addTokenTransfer(USDC,wallet.account,500000),client);
        // Reserve every signed payment locally, including uncertain outcomes.
        // Mirror balances can lag, so they must not be used to spend the same
        // initial allocation twice. Confirmed top-ups add to the ledger.
        const reserved=Object.values(wallet.payments).filter(p=>p.accepted.asset===quote.asset).reduce((sum,p)=>sum+BigInt(p.accepted.amount),0n);
        const added=Object.values(wallet.steps).filter(s=>s.done&&s.asset===quote.asset).reduce((sum,s)=>sum+BigInt(s.amount||0),0n);
        const current=(quote.asset===HBAR?1000000000n:500000n)+added-reserved;
        const amount=BigInt(quote.amount),shortfall=amount-current;
        if(shortfall>0n){
          const refill=new TransferTransaction();
          if(quote.asset===HBAR)refill.addHbarTransfer(this.env.WIKSHI_SPONSOR_ACCOUNT,Hbar.fromTinybars((-shortfall).toString())).addHbarTransfer(wallet.account,Hbar.fromTinybars(shortfall.toString()));
          else refill.addTokenTransfer(USDC,this.env.WIKSHI_SPONSOR_ACCOUNT,-shortfall).addTokenTransfer(USDC,wallet.account,shortfall);
          const topped=await this.step(session,wallet,`topup-${op.id}`,refill,client);
          Object.assign(topped,{asset:quote.asset,amount:shortfall.toString()});wallet.steps[`topup-${op.id}`]=topped;this.save(session.id,wallet);
        }
        // Sign, never submit here. The Wikshi backend verifies and settles via Blocky.
        selectSponsoredQuote(op,currency,this.env.WIKSHI_SPONSOR_ACCOUNT);
        const tx=new TransferTransaction().setTransactionId(TransactionId.generate(AccountId.fromString(quote.extra.feePayer))).setNodeAccountIds([AccountId.fromString('0.0.3')]).setTransactionMemo(`wikshi:${op.id}`);
        if(quote.asset===HBAR)tx.addHbarTransfer(wallet.account,Hbar.fromTinybars((-amount).toString())).addHbarTransfer(quote.payTo,Hbar.fromTinybars(amount.toString()));
        else tx.addTokenTransfer(USDC,wallet.account,-amount).addTokenTransfer(USDC,quote.payTo,amount);
        tx.freeze();await tx.sign(key);
        const payment={x402Version:2,accepted:quote,payload:{transaction:Buffer.from(tx.toBytes()).toString('base64')}};
        wallet.payments[op.id]=payment;this.save(session.id,wallet);session.sponsorAccount=wallet.account;return payment;
      }finally{client.close();}
    });
  }
}
