import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,verify,createPublicKey} from 'node:crypto';
import {Store,hash} from '../src/store.mjs';
import {AuditPublisher,receiptRecord,refundRecord,signedDirectory} from '../src/audit.mjs';

test('outbox persists exact transaction and reconciles uncertain submission without signing again',async()=>{
  const store=new Store(':memory:','11'.repeat(32));let prepared=0,submitted=0,confirmed=false;
  const transport={prepare:async()=>{prepared++;return {tx:'original',bytes:'signed'};},submit:async()=>{submitted++;throw Error('lost response');},confirm:async()=>confirmed?{topic:'0.0.1',sequence:1}:null};
  let audit=new AuditPublisher(store,transport);const record={type:'receipt',receiptHash:'abc'},id=audit.enqueue(record);
  assert.equal(audit.enqueue(record),id);await audit.tick();assert.equal(prepared,1);assert.equal(submitted,1);
  audit=new AuditPublisher(store,transport);confirmed=true;await audit.tick();assert.equal(prepared,1);assert.equal(submitted,1);assert.equal(audit.proof(id).sequence,1);store.close();
});
test('public audit fields exclude result, email, input and retrieval credentials',()=>{
  const op={id:'id',auth:'SECRET',data:{service:'email.send',input:{to:'private@example.com',text:'PRIVATE'},result:{text:'PRIVATE'},requirements:{asset:'0.0.0',payTo:'0.0.2'},payment:{payer:'0.0.1'},receipt:{signedPayload:Buffer.from('receipt').toString('base64'),asset:'0.0.0'},refund:{status:'pending'}}};
  const record=receiptRecord(op);assert.equal(record.receiptHash,hash('receipt'));assert.doesNotMatch(JSON.stringify(record),/SECRET|PRIVATE|private@example/);assert.equal(refundRecord(op),null);
});
test('directory signature commits exact manifest and changes when prices change',()=>{
  const {privateKey,publicKey}=generateKeyPairSync('ed25519');let rate='1';
  const engine={signingKey:privateKey,receiptKey:publicKey.export({format:'jwk'}),env:{WIKSHI_PUBLIC_ORIGIN:'https://api.wikshi.xyz'},services:()=>[{id:'discovery.search',rate}]};
  const d=signedDirectory(engine);assert.equal(verify(null,Buffer.from(d.signedPayload,'base64'),createPublicKey({key:d.manifest.receiptKey,format:'jwk'}),Buffer.from(d.signature,'base64')),true);
  rate='2';assert.notEqual(signedDirectory(engine).hash,d.hash);
});
