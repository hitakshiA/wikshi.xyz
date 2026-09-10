import {createPublicKey,verify} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {hash} from '../src/store.mjs';
import {confirmTransfer} from '../src/payments/hedera.mjs';

export function checkReceipt(receipt,key) {
  const bytes=Buffer.from(receipt.signedPayload,'base64');
  if(!verify(null,bytes,createPublicKey({key,format:'jwk'}),Buffer.from(receipt.signature,'base64')))throw Error('Receipt signature mismatch');
  const r=JSON.parse(bytes);
  if(!Number.isSafeInteger(r.units)||r.units<0)throw Error('Invalid units');
  const prepaid=BigInt(r.prepaidAtomic),charged=BigInt(r.chargedAtomic),refund=BigInt(r.refundDueAtomic);
  if(prepaid<0n||charged<0n||refund<0n||charged+refund!==prepaid||BigInt(r.rateAtomic)*BigInt(r.units)!==charged)throw Error('Receipt arithmetic mismatch');
  if(r.unit==='second'&&r.measuredSeconds!==undefined&&(!Number.isFinite(r.measuredSeconds)||r.measuredSeconds<0||r.units!==Math.min(Math.ceil(r.measuredSeconds),Number(prepaid/BigInt(r.rateAtomic)))))throw Error('Measured duration mismatch');
  return r;
}
async function json(url,headers={}){const r=await fetch(url,{headers,redirect:'error',signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error(`Verification read failed (${r.status})`);return r.json();}
export async function verifyAnchor(record,anchor) {
  if(!anchor||!/^0\.0\.\d+$/.test(anchor.topic)||!Number.isSafeInteger(anchor.sequence))throw Error('HCS anchor is not confirmed');
  const message=await json(`https://testnet.mirrornode.hedera.com/api/v1/topics/${anchor.topic}/messages/${anchor.sequence}`);
  const text=Buffer.from(message.message,'base64').toString();
  if(hash(text)!==hash(JSON.stringify(record))||message.consensus_timestamp!==anchor.consensusTimestamp)throw Error('HCS record mismatch');
  return true;
}
export async function verifyOperation(op,key) {
  const r=checkReceipt(op.receipt,key);
  const purchase=op.audit?.find(a=>a.record.type==='receipt');if(!purchase)throw Error('Receipt anchor missing');
  const record=purchase.record;
  if(record.operationId!==r.operationId||record.receiptHash!==hash(Buffer.from(op.receipt.signedPayload,'base64')))throw Error('Receipt hash mismatch');
  for(const field of ['asset','paymentTransaction','prepaidAtomic','unit','rateAtomic','units','chargedAtomic','refundDueAtomic'])if(record[field]!==r[field])throw Error(`Anchored ${field} mismatch`);
  await verifyAnchor(record,purchase.anchor);
  if(!await confirmTransfer(r.paymentTransaction,{payer:record.payer,payTo:record.payTo,amount:r.prepaidAtomic,asset:r.asset,memo:`wikshi:${r.operationId}`}))throw Error('Payment transfer mismatch');
  let refundVerified=false;
  if(BigInt(r.refundDueAtomic)>0n){
    const refund=op.audit.find(a=>a.record.type==='refund');if(!refund)throw Error('Refund anchor is not confirmed');
    if(refund.record.amountAtomic!==r.refundDueAtomic||refund.record.payer!==record.payTo||refund.record.payTo!==record.payer||refund.record.asset!==r.asset||refund.record.operationId!==r.operationId)throw Error('Refund accounting mismatch');
    await verifyAnchor(refund.record,refund.anchor);
    if(!await confirmTransfer(refund.record.transaction,{payer:record.payTo,payTo:record.payer,amount:r.refundDueAtomic,asset:r.asset,memo:`refund:${r.operationId}`}))throw Error('Refund transfer mismatch');
    refundVerified=true;
  }
  return {operationId:r.operationId,signatureVerified:true,hcsVerified:true,paymentVerified:true,refundVerified,units:r.units,chargedAtomic:r.chargedAtomic,refundAtomic:r.refundDueAtomic,asset:r.asset};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    const id=process.argv[2],credential=process.env.WIKSHI_RETRIEVAL_CREDENTIAL;
    if(!/^[a-f0-9-]{36}$/.test(id||'')||!credential)throw Error('Usage: WIKSHI_RETRIEVAL_CREDENTIAL=<private credential> node scripts/verify-receipt.mjs <operation-id>');
    const origin='https://api.wikshi.xyz';
    const key=await json(`${origin}/v1/receipt-key`);
    if(process.env.WIKSHI_RECEIPT_KEY_X&&process.env.WIKSHI_RECEIPT_KEY_X!==key.x)throw Error('Pinned receipt key mismatch');
    const op=await json(`${origin}/v1/operations/${id}`,{Authorization:`Bearer ${credential}`});
    console.log(JSON.stringify(await verifyOperation(op,key),null,2));
  }catch(error){console.error(error.message);process.exitCode=1;}
}
