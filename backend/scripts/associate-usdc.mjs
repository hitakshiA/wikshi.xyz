// Explicit operator setup: key arrives on stdin, never written or printed.
import {createInterface} from 'node:readline';
import {mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {Client,PrivateKey,TokenAssociateTransaction} from '@hiero-ledger/sdk';
import {USDC} from '../src/payments/assets.mjs';
const account=process.argv[2];
if(!/^0\.0\.[1-9]\d*$/.test(account||''))throw Error('Provide the testnet account');
const base='https://testnet.mirrornode.hedera.com/api/v1';
const get=async path=>{const r=await fetch(base+path);if(!r.ok)throw Error('Public account lookup failed');return r.json();};
let client,lines;
try{
  if((await get(`/accounts/${account}/tokens?token.id=${USDC}`)).tokens?.some(t=>t.token_id===USDC)){
    console.log(JSON.stringify({account,usdcAssociated:true,submitted:false}));
  }else{
    const saved=new URL(`../.runtime/association-${account.split('.').at(-1)}.json`,import.meta.url);
    if(existsSync(saved))throw Error('A submission is already recorded; reconcile before retrying');
    console.log('Ready for private key on stdin; input is not echoed or saved.');
    lines=createInterface({input:process.stdin,terminal:false});
    const raw=await(async()=>{for await(const line of lines)return line.trim();})();lines.close();process.stdin.pause();
    const key=PrivateKey.fromStringECDSA(raw.replace(/^0x/,''));
    const target=await get(`/accounts/${account}`);
    if(target.deleted||target.key?.key.toLowerCase()!==key.publicKey.toStringRaw().toLowerCase())throw Error('Key mismatch');
    client=Client.forTestnet().setOperator(account,key);
    const tx=await new TokenAssociateTransaction().setAccountId(account).setTokenIds([USDC]).setTransactionMemo('USDC testnet association').freezeWith(client).sign(key);
    mkdirSync(new URL('../.runtime/',import.meta.url),{recursive:true,mode:0o700});
    writeFileSync(saved,JSON.stringify({account,token:USDC,transaction:tx.transactionId.toString(),bytes:Buffer.from(tx.toBytes()).toString('base64')}),{mode:0o600,flag:'wx'});
    const receipt=await(await tx.execute(client)).getReceipt(client);
    console.log(JSON.stringify({account,token:USDC,status:receipt.status.toString(),transaction:tx.transactionId.toString(),privateKeySaved:false}));
  }
}catch{console.error('Association not confirmed. Check saved transaction state before retrying. No private details logged.');process.exitCode=1;}
finally{lines?.close();client?.close();}
