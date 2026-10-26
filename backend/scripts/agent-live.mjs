// Public deployment check. Uses only the customer's key, never merchant credentials.
import {createInterface} from 'node:readline';
import {randomBytes,verify,createPublicKey} from 'node:crypto';
import {signQuote} from '../src/payments/hedera.mjs';
import {payer} from './testnet-payer.mjs';
const origin='https://api.wikshi.xyz';
console.log('Supply testnet payer key on stdin (not echoed).');
const lines=createInterface({input:process.stdin,terminal:false});const key=await(async()=>{for await(const line of lines)return line.trim();})();lines.close();
const credential=randomBytes(32).toString('base64url');
const headers={Authorization:`Bearer ${credential}`,'Content-Type':'application/json'};
try {
  const response=await fetch(`${origin}/v1/operations`,{method:'POST',headers:{...headers,'Idempotency-Key':randomBytes(16).toString('hex')},body:JSON.stringify({service:'network.inspect',input:{account:payer}})});
  const op=await response.json();if(response.status!==402)throw new Error('Expected real x402 challenge');
  const requirements=op.paymentRequired.accepts[0];if(requirements.amount!=='1')throw new Error('Refusing more than 1 atomic testnet USDC');
  const payment=await signQuote(payer,key,requirements,op.id);
  const paid=await fetch(`${origin}/v1/operations/${op.id}/pay`,{method:'POST',headers:{...headers,'PAYMENT-SIGNATURE':Buffer.from(JSON.stringify(payment)).toString('base64')},body:'{}'});
  const initial=await paid.json();console.log(JSON.stringify({phase:'submitted',operation:op.id,status:initial.status}));
  let done;
  for(let i=0;i<24;i++) {
    const result=await fetch(`${origin}/v1/operations/${op.id}`,{headers});done=await result.json();
    if(done.status==='completed')break;
    if(['failed','payment_rejected','execution_unknown'].includes(done.status))throw new Error(`Operation ${op.id}: ${done.status}`);
    await new Promise(r=>setTimeout(r,5000));
  }
  if(done.status!=='completed')throw new Error(`Operation ${op.id} remains pending; do not repay`);
  const publicKey=await(await fetch(`${origin}/v1/receipt-key`)).json();
  const verified=verify(null,Buffer.from(done.receipt.signedPayload,'base64'),createPublicKey({key:publicKey,format:'jwk'}),Buffer.from(done.receipt.signature,'base64'));
  if(!verified)throw new Error('Receipt verification failed');
  const denied=await fetch(`${origin}/v1/operations/${op.id}`,{headers:{Authorization:`Bearer ${randomBytes(32).toString('base64url')}`}});
  if(denied.status!==404)throw new Error('Ownership check failed');
  console.log(JSON.stringify({origin,operation:op.id,status:done.status,transaction:done.receipt.paymentTransaction,chargedAtomic:done.receipt.chargedAtomic,receiptVerified:verified,otherAgentDenied:true,result:done.result}));
}catch(error){console.error(error.message);process.exitCode=1;}
