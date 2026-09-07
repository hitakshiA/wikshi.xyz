// Live, opt-in test: 2 atomic USDC paid, 1 refunded. Never contacts people.
import {randomBytes,createPublicKey,verify} from 'node:crypto';
import {createInterface} from 'node:readline';
import {writeFileSync} from 'node:fs';
import {Store} from '../src/store.mjs';
import {Engine} from '../src/engine.mjs';
import {Providers} from '../src/providers.mjs';
import {createApi} from '../src/server.mjs';
import {signQuote,RefundSigner} from '../src/payments/hedera.mjs';
import {payer} from './testnet-payer.mjs';
process.loadEnvFile(new URL('../.runtime/server.env',import.meta.url));
console.log('Supply testnet payer key on stdin (not echoed).');
const lines=createInterface({input:process.stdin,terminal:false});
const key=await(async()=>{for await(const line of lines)return line.trim();})();lines.close();
const env=process.env,store=new Store(new URL('../.runtime/wikshi.sqlite',import.meta.url).pathname,env.WIKSHI_DATA_KEY);
const engine=new Engine({store,env,providers:new Providers(env),refundSigner:new RefundSigner(env.WIKSHI_MERCHANT_ACCOUNT,env.WIKSHI_MERCHANT_KEY)});
const server=createApi(engine);await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`,credential=randomBytes(32).toString('base64url');
const headers={Authorization:`Bearer ${credential}`,'Content-Type':'application/json'};
async function purchase(){
  const response=await fetch(`${origin}/v1/operations`,{method:'POST',headers:{...headers,'Idempotency-Key':randomBytes(16).toString('hex')},body:JSON.stringify({service:'network.inspect',input:{account:payer}})});
  const quoted=await response.json();if(response.status!==402)throw new Error('Quote failed');
  const requirements=quoted.paymentRequired.accepts[0];if(requirements.amount!=='1')throw new Error('Refusing a test payment larger than 1 atomic USDC');
  const payment=await signQuote(payer,key,requirements,quoted.id);
  const paid=await fetch(`${origin}/v1/operations/${quoted.id}/pay`,{method:'POST',headers:{...headers,'PAYMENT-SIGNATURE':Buffer.from(JSON.stringify(payment)).toString('base64')},body:'{}'});
  const result=await paid.json();console.log(JSON.stringify({phase:'submitted',operation:quoted.id,status:result.status,transaction:store.get(quoted.id).data.payment?.tx}));
  for(let i=0;i<18;i++){const op=store.get(quoted.id);if(op.state==='queued')return quoted.id;if(op.state==='payment_rejected')throw new Error('Blocky rejected payment');await new Promise(r=>setTimeout(r,5000));await engine.reconcilePayment(op);}
  throw new Error('Payment outcome pending Mirror reconciliation. Do not retry with a new transaction.');
}
try{
  const id=await purchase();await engine.tick();const done=engine.view(engine.authorize(id,credential));
  if(done.status!=='completed' || !done.receipt)throw new Error('Service did not complete');
  const receipt=done.receipt;
  if(!verify(null,Buffer.from(receipt.signedPayload,'base64'),createPublicKey({key:engine.receiptKey,format:'jwk'}),Buffer.from(receipt.signature,'base64')))throw new Error('Receipt signature invalid');
  const unauthorized=await fetch(`${origin}/v1/operations/${id}`);if(unauthorized.status!==401)throw new Error('Private access failed');
  console.log(JSON.stringify({phase:'completed',...done}));
  const cancelled=await purchase();await engine.cancel(cancelled,credential);
  for(let i=0;i<18;i++){await engine.tick();const op=store.get(cancelled);if(op.data.refund?.status==='confirmed')break;await new Promise(r=>setTimeout(r,5000));}
  const refund=engine.view(engine.authorize(cancelled,credential));
  const report={checkedAt:new Date().toISOString(),payer,merchant:env.WIKSHI_MERCHANT_ACCOUNT,completed:done,refunded:refund,privateAccessTest:true,receiptSignatureTest:true};
  writeFileSync(new URL('../.runtime/live-smoke.json',import.meta.url),JSON.stringify(report,null,2),{mode:0o600});
  console.log(JSON.stringify({phase:'refund',status:refund.refund?.status,transaction:refund.refund?.transaction,amountAtomic:refund.refund?.amountAtomic}));
  if(refund.refund?.status!=='confirmed')throw new Error('Refund awaiting reconciliation');
}catch(e){console.error(e.message);process.exitCode=1;}
finally{await new Promise(r=>server.close(r));store.close();}
