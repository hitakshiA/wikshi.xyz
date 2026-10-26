import test from 'node:test';
import assert from 'node:assert/strict';
import {activityAmount,explorerLinks,requestFields,serviceName,tokenAmount,transcriptRows} from '../src/workspace-data.mjs';
import {ASSETS} from '../../backend/src/payments/assets.mjs';

test('workspace distinguishes quoted, prepaid and charged money',()=>{
  const quote={asset:'0.0.0',amount:'100000000'};
  assert.deepEqual(activityAmount({status:'awaiting_payment',paymentRequired:{accepts:[quote]}}),{label:'Quoted',value:'1 HBAR'});
  assert.deepEqual(activityAmount({status:'running',payment:{confirmed:true,asset:'0.0.0',amountAtomic:'100000000'}}),{label:'Prepaid',value:'1 HBAR'});
  assert.deepEqual(activityAmount({receipt:{currency:'USDC',chargedAtomic:'1'}}),{label:'Charged',value:'0.000001 USDC'});
  assert.equal(activityAmount({status:'running',payment:{confirmed:false,asset:'0.0.0',amountAtomic:'100000000'}}),null);
  assert.equal(tokenAmount('-1',{currency:'USDC'}),null);
  assert.equal(tokenAmount('10',{currency:'UNKNOWN'}),null);
});
test('workspace only links actual shaped receipt IDs and confirmed refunds',()=>{
  const transaction='0.0.123@1720000000.123456789';
  assert.deepEqual(explorerLinks({paymentRequired:{transaction},payment:{transaction},refund:{status:'pending',transaction}}),[]);
  assert.deepEqual(explorerLinks({receipt:{paymentTransaction:transaction,topicId:'0.0.456'},refund:{status:'confirmed',transaction}}).map(x=>x.label),['Payment on HashScan','Topic on HashScan','Refund on HashScan']);
  assert.deepEqual(explorerLinks({receipt:{paymentTransaction:'https://provider.example/secret',topicId:'javascript:alert(1)'},refund:{status:'confirmed',transaction:'not-a-transaction'}}),[]);
});
test('workspace projects request data instead of exposing private credentials or raw objects',()=>{
  const fields=requestFields({mission:'Ask about availability',phone:'+10000000000',questions:['When?','How many?'],credential:'secret',apiKey:'secret',provider:{url:'https://provider.example'},text:{password:'secret'}});
  assert.deepEqual(fields,[{label:'Phone',value:'+10000000000'},{label:'Agenda',value:'Ask about availability'},{label:'Questions',value:'When?\nHow many?'}]);
  assert(!JSON.stringify(fields).includes('secret'));
});
test('workspace transcript renders only speaker and text, not provider metadata',()=>{
  assert.deepEqual(transcriptRows({transcript:[{role:'guest',text:'Thursday works.',credential:'secret'},{speaker:'agent',content:'Thank you.',provider:'secret'},{text:{raw:'secret'}},null]}),[{role:'guest',text:'Thursday works.'},{role:'agent',text:'Thank you.'}]);
});
test('workspace supports both backend asset records and confirmed refund metadata',()=>{
  for(const [asset,metadata] of Object.entries(ASSETS)){
    const op={status:'completed',payment:{...metadata,amountAtomic:'100',confirmed:true},receipt:{...metadata,prepaidAtomic:'100',chargedAtomic:'60',refundDueAtomic:'40'},refund:{...metadata,status:'confirmed',amountAtomic:'40',transaction:'0.0.123@1720000000.123456789'}};
    assert.deepEqual(activityAmount(op),{label:'Charged',value:asset==='0.0.0'?'0.0000006 HBAR':'0.00006 USDC'});
    assert.equal(tokenAmount(op.refund.amountAtomic,op.refund),asset==='0.0.0'?'0.0000004 HBAR':'0.00004 USDC');
    assert.deepEqual(explorerLinks(op).map(x=>x.label),['Refund on HashScan']);
  }
  assert.equal(serviceName('email.send'),'Send email');
});
