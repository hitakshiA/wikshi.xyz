import {sign} from 'node:crypto';
import {Client,PrivateKey,TopicMessageSubmitTransaction,Transaction,TransactionId,Hbar} from '@hiero-ledger/sdk';
import {hash} from './store.mjs';

// Hash the exact signed bytes, never a reserialized receipt or private result.
export function receiptRecord(op) {
  const r=op.data.receipt;if(!r)return null;
  return {version:1,type:'receipt',operationId:op.id,service:op.data.service,
    receiptHash:hash(Buffer.from(r.signedPayload,'base64')),paymentTransaction:r.paymentTransaction,
    payer:op.data.payment.payer,payTo:op.data.requirements.payTo,asset:r.asset,prepaidAtomic:r.prepaidAtomic,unit:r.unit,rateAtomic:r.rateAtomic,
    units:r.units,chargedAtomic:r.chargedAtomic,refundDueAtomic:r.refundDueAtomic};
}
export function refundRecord(op) {
  const r=op.data.refund;if(r?.status!=='confirmed')return null;
  return {version:1,type:'refund',operationId:op.id,asset:op.data.requirements.asset,
    payer:op.data.requirements.payTo,payTo:op.data.payment.payer,amountAtomic:r.amount,transaction:r.tx};
}
export function signedDirectory(engine) {
  const manifest={version:1,network:'hedera:testnet',origin:engine.env.WIKSHI_PUBLIC_ORIGIN,
    services:engine.services(),receiptKey:engine.receiptKey,
    skill:'https://wikshi.xyz/wikshi/skills.md',quotePath:'/v1/operations',
    operationPath:'/v1/operations/{id}',receiptKeyPath:'/v1/receipt-key'};
  const bytes=Buffer.from(JSON.stringify(manifest));
  return {manifest,hash:hash(bytes),signedPayload:bytes.toString('base64'),
    signature:sign(null,bytes,engine.signingKey).toString('base64')};
}

export class AuditPublisher {
  constructor(store,transport) {
    this.store=store;this.transport=transport;
    store.db.exec(`CREATE TABLE IF NOT EXISTS audit_outbox (
      id TEXT PRIMARY KEY, record TEXT NOT NULL, prepared TEXT, proof TEXT);
      CREATE TABLE IF NOT EXISTS audit_settings (name TEXT PRIMARY KEY,value TEXT NOT NULL);
    `);
    store.db.prepare('INSERT OR IGNORE INTO audit_settings VALUES(?,?)').run('startedAt',String(Date.now()));
    this.startedAt=Number(store.db.prepare('SELECT value FROM audit_settings WHERE name=?').get('startedAt').value);
  }
  enqueue(record) {
    const json=JSON.stringify(record),id=hash(json);
    this.store.db.prepare('INSERT OR IGNORE INTO audit_outbox(id,record) VALUES(?,?)').run(id,json);
    return id;
  }
  proof(id){const row=this.store.db.prepare('SELECT proof FROM audit_outbox WHERE id=?').get(id);return row?.proof?JSON.parse(row.proof):null;}
  async tick() {
    if(this.busy||!this.transport)return;this.busy=true;
    try {
      for(const row of this.store.db.prepare('SELECT * FROM audit_outbox WHERE proof IS NULL LIMIT 10').all()) {
        try {
          let prepared=row.prepared?this.store.open(row.prepared,row.id):null;
          if(!prepared) {
            prepared=await this.transport.prepare(row.record);
            this.store.db.prepare('UPDATE audit_outbox SET prepared=? WHERE id=?').run(this.store.seal(prepared,row.id),row.id);
          }
          // Reuse the saved transaction after an uncertain outcome. Never sign a
          // replacement automatically: expired/unknown submissions need review.
          let proof=await this.transport.confirm(prepared,row.record);
          if(!proof){await this.transport.submit(prepared);proof=await this.transport.confirm(prepared,row.record);}
          if(proof)this.store.db.prepare('UPDATE audit_outbox SET proof=? WHERE id=?').run(JSON.stringify(proof),row.id);
        }catch{/* Leave the durable entry pending; paid work is unaffected. */}
      }
    }finally{this.busy=false;}
  }
}

export class HcsTransport {
  constructor({topic,account,key}) {
    if(!/^0\.0\.\d+$/.test(topic))throw new Error('Invalid audit topic');
    Object.assign(this,{topic,account});this.key=PrivateKey.fromStringECDSA(key.replace(/^0x/,''));
  }
  async prepare(message) {
    if(Buffer.byteLength(message)>1024)throw new Error('Audit record exceeds one HCS message');
    const client=Client.forTestnet();
    try {
      const tx=new TopicMessageSubmitTransaction().setTopicId(this.topic).setMessage(message)
        .setMaxTransactionFee(new Hbar(1)).setTransactionId(TransactionId.generate(this.account)).freezeWith(client);
      await tx.sign(this.key);
      return {tx:tx.transactionId.toString(),topic:this.topic,bytes:Buffer.from(tx.toBytes()).toString('base64')};
    }finally{client.close();}
  }
  async submit(prepared) {
    const client=Client.forTestnet();
    try{await Transaction.fromBytes(Buffer.from(prepared.bytes,'base64')).execute(client);}finally{client.close();}
  }
  async confirm(prepared,message) {
    const id=prepared.tx.replace('@','-').replace(/\.(\d+)$/,'-$1');
    const response=await fetch(`https://testnet.mirrornode.hedera.com/api/v1/transactions/${id}`,{signal:AbortSignal.timeout(10000),redirect:'error'});
    if(!response.ok)return null;
    const data=await response.json();
    const tx=data.transactions?.find(t=>t.result==='SUCCESS'&&t.name==='CONSENSUSSUBMITMESSAGE'&&t.entity_id===prepared.topic&&t.nonce===0);
    if(!tx)return null;
    const msgResponse=await fetch(`https://testnet.mirrornode.hedera.com/api/v1/topics/${prepared.topic}/messages?timestamp=${tx.consensus_timestamp}`,{signal:AbortSignal.timeout(10000),redirect:'error'});
    if(!msgResponse.ok)return null;
    const msg=(await msgResponse.json()).messages?.find(m=>m.consensus_timestamp===tx.consensus_timestamp&&Buffer.from(m.message,'base64').toString()===message);
    return msg?{topic:prepared.topic,transaction:prepared.tx,sequence:msg.sequence_number,consensusTimestamp:msg.consensus_timestamp,recordHash:hash(message)}:null;
  }
}
