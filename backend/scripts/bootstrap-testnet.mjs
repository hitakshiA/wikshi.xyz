// Explicit operator-only setup. Reads the payer key from stdin without persisting it.
import {AccountCreateTransaction,TokenAssociateTransaction,Client,PrivateKey,Hbar} from '@hiero-ledger/sdk';
import {mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {createInterface} from 'node:readline';
import {USDC} from '../src/payments/blocky.mjs';
import {payer} from './testnet-payer.mjs';
const path=new URL('../.runtime/',import.meta.url);
if(existsSync(new URL('server.env',path)))throw new Error('Runtime already exists. Refusing to create another account.');
process.stdout.write('Supply testnet payer key on stdin (not echoed).\n');
const lines=createInterface({input:process.stdin,terminal:false});
let client;
try {
  const [line]=await (async()=>{for await(const value of lines)return [value];})();lines.close();
  const key=PrivateKey.fromStringECDSA(line.trim().replace(/^0x/,''));
  const response=await fetch(`https://testnet.mirrornode.hedera.com/api/v1/accounts/${payer}`);
  const account=await response.json();
  if(account.key?.key.toLowerCase()!==key.publicKey.toStringRaw().toLowerCase())throw new Error('Key does not match requested public account');
  mkdirSync(path,{recursive:true,mode:0o700});
  const merchantKey=PrivateKey.generateECDSA();
  // Persist generated key BEFORE network submission so an uncertain response cannot orphan it.
  writeFileSync(new URL('merchant-recovery.key',path),merchantKey.toStringRaw(),{mode:0o600,flag:'wx'});
  client=Client.forTestnet().setOperator(payer,key);
  const create=new AccountCreateTransaction().setKeyWithoutAlias(merchantKey.publicKey).setInitialBalance(new Hbar(2));
  const submitted=await create.execute(client);
  writeFileSync(new URL('merchant-create.tx',path),submitted.transactionId.toString(),{mode:0o600,flag:'wx'});
  const receipt=await submitted.getReceipt(client), merchant=receipt.accountId.toString();
  const assoc=await new TokenAssociateTransaction().setAccountId(merchant).setTokenIds([USDC]).freezeWith(client).sign(merchantKey);
  await (await assoc.execute(client)).getReceipt(client);
  writeFileSync(new URL('server.env',path),[
    `WIKSHI_MERCHANT_ACCOUNT=${merchant}`,`WIKSHI_MERCHANT_KEY=${merchantKey.toStringRaw()}`,
    `WIKSHI_DATA_KEY=${randomBytes(32).toString('hex')}`,'WIKSHI_DB=.runtime/wikshi.sqlite','WIKSHI_PUBLIC_ORIGIN=http://127.0.0.1:8080',
    'WIKSHI_PRICE_INSPECT=1','PORT=8080','',
  ].join('\n'),{mode:0o600,flag:'wx'});
  console.log(JSON.stringify({merchantAccount:merchant,usdcAssociated:true,payer,keyPersisted:false,merchantConfigSaved:true}));
} catch(error){console.error(error.message?.startsWith('Key does')?error.message:'Setup did not finish. Inspect public transaction state before retrying.');process.exitCode=1;}
finally{client?.close();lines.close();}
