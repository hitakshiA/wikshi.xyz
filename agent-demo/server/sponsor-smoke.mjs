// Explicit operator test. Only the inexpensive network.inspect service is used.
import {randomBytes,randomUUID,verify,createPublicKey} from 'node:crypto';
import {Sponsor} from './sponsor.mjs';
import {api,refresh} from './runtime.mjs';
const sponsor=new Sponsor(),session={id:randomUUID(),credential:randomBytes(32).toString('base64url'),operations:new Map()};
if(!sponsor.enabled)throw Error('Sponsor is not configured');
for(const currency of ['USDC','HBAR']){
 const op=await api(session,'/v1/operations',{service:'network.inspect',input:{account:process.env.WIKSHI_SPONSOR_ACCOUNT}});
 session.operations.set(op.id,op);
 const quote=op.paymentRequired.accepts.find(q=>q.asset===(currency==='USDC'?'0.0.429274':'0.0.0'));
 if(!quote||BigInt(quote.amount)>(currency==='USDC'?10000n:10000000n))throw Error('Smoke quote exceeds authorized small verification amount');
 const payment=await sponsor.payment(session,op,currency);
 const retry=await sponsor.payment(session,op,currency);
 if(payment.payload.transaction!==retry.payload.transaction)throw Error('Retry changed payment');
 await api(session,`/v1/operations/${op.id}/pay`,{payment});
 let result;
 for(let i=0;i<30;i++){
  result=await refresh(session,op.id);if(result.status==='completed')break;
  if(['failed','payment_rejected','execution_unknown'].includes(result.status))throw Error(`Smoke operation ${op.id}: ${result.status}`);
  await new Promise(r=>setTimeout(r,2000));
 }
 if(result.status!=='completed')throw Error(`Payment pending for ${op.id}. Do not create a replacement.`);
 const key=await(await fetch('https://api.wikshi.xyz/v1/receipt-key')).json();
 if(!verify(null,Buffer.from(result.receipt.signedPayload,'base64'),createPublicKey({key,format:'jwk'}),Buffer.from(result.receipt.signature,'base64')))throw Error('Receipt signature invalid');
 const tx=result.receipt.paymentTransaction,mirror=await(await fetch('https://testnet.mirrornode.hedera.com/api/v1/transactions/'+tx.replace('@','-').replace(/\.(\d+)$/,'-$1'))).json();
 if(!mirror.transactions?.some(t=>t.result==='SUCCESS'))throw Error('Mirror settlement missing');
 console.log(JSON.stringify({currency,payer:session.sponsorAccount,operation:op.id,transaction:tx,chargedAtomic:result.receipt.chargedAtomic,receiptVerified:true,mirrorConfirmed:true,samePayloadOnRetry:true}));
}
