import {Client,PrivateKey,TopicCreateTransaction,TransactionReceiptQuery,Hbar} from '@hiero-ledger/sdk';
import {readFileSync,writeFileSync,mkdirSync,existsSync,renameSync} from 'node:fs';
import {dirname} from 'node:path';

// Explicit operator command. Run with the protected backend environment loaded.
// Journal before submission so a timeout cannot create a second topic on retry.
if(process.env.WIKSHI_CREATE_AUDIT_TOPIC!=='true')throw Error('Set WIKSHI_CREATE_AUDIT_TOPIC=true explicitly');
const file=process.env.WIKSHI_HCS_SETUP_FILE||'.runtime/audit-topic.json';
mkdirSync(dirname(file),{recursive:true,mode:0o700});
const save=value=>{writeFileSync(file+'.tmp',JSON.stringify(value),{mode:0o600});renameSync(file+'.tmp',file);};
const key=PrivateKey.fromStringECDSA(process.env.WIKSHI_MERCHANT_KEY.replace(/^0x/,''));
const client=Client.forTestnet().setOperator(process.env.WIKSHI_MERCHANT_ACCOUNT,key);
try{
  let journal=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):null;
  if(!journal){
    const tx=new TopicCreateTransaction().setTopicMemo('Wikshi signed directory and payment receipt hashes v1').setSubmitKey(key.publicKey).setMaxTransactionFee(new Hbar(2)).freezeWith(client);
    await tx.signWithOperator(client);journal={transaction:tx.transactionId.toString()};save(journal);
    const response=await tx.execute(client);const receipt=await response.getReceipt(client);
    journal.topic=receipt.topicId.toString();save(journal);
  }else if(!journal.topic){
    const receipt=await new TransactionReceiptQuery().setTransactionId(journal.transaction).execute(client);
    if(receipt.status.toString()!=='SUCCESS'||!receipt.topicId)throw Error('Topic creation needs operator reconciliation');
    journal.topic=receipt.topicId.toString();save(journal);
  }
  const envFile=process.env.WIKSHI_HCS_ENV_FILE;
  if(envFile){
    const env=readFileSync(envFile,'utf8');
    const old=/^WIKSHI_HCS_TOPIC=(.*)$/m.exec(env);
    if(old&&old[1]!==journal.topic)throw Error('Existing topic differs; refusing replacement');
    if(!old)writeFileSync(envFile,env.trimEnd()+`\nWIKSHI_HCS_TOPIC=${journal.topic}\n`,{mode:0o600});
  }
  console.log(JSON.stringify(journal));
}finally{client.close();}
