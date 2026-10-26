import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {checkReceipt} from '../scripts/verify-receipt.mjs';
const {privateKey,publicKey}=generateKeyPairSync('ed25519');
const key=publicKey.export({format:'jwk'});
const bill={units:54,unit:'second',measuredSeconds:53.2,rateAtomic:'1000',prepaidAtomic:'300000',chargedAtomic:'54000',refundDueAtomic:'246000'};
function receipt(data){const bytes=Buffer.from(JSON.stringify(data));return {signedPayload:bytes.toString('base64'),signature:sign(null,bytes,privateKey).toString('base64')};}
test('verifier accepts exact signed metering and rejects altered bytes',()=>{
  const r=receipt(bill);assert.deepEqual(checkReceipt(r,key),bill);
  assert.throws(()=>checkReceipt({...r,signedPayload:Buffer.from(JSON.stringify({...bill,units:55})).toString('base64')},key),/signature/);
});
test('valid signatures do not hide incorrect billing arithmetic or duration',()=>{
  assert.throws(()=>checkReceipt(receipt({...bill,refundDueAtomic:'1'}),key),/arithmetic/);
  assert.throws(()=>checkReceipt(receipt({...bill,measuredSeconds:60}),key),/duration/);
});
