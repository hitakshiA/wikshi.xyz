import {DAppConnector} from '@hashgraph/hedera-wallet-connect';
import {LedgerId,TransferTransaction,TransactionId,AccountId,Hbar} from '@hiero-ledger/sdk';

let connector:DAppConnector|undefined;
let initializing:Promise<DAppConnector>|undefined;
let selectedAccount:string|undefined;
let interacting=false;

function projectId(){
  const value=import.meta.env.VITE_WALLETCONNECT_PROJECT_ID;
  if(!/^[a-f0-9]{32}$/i.test(value||'')||/^0+$/.test(value))throw Error('Wallet connection is not available yet. Please try again later.');
  return value as string;
}

async function connect(projectId:string) {
  if(connector?.walletConnectClient)return connector;
  initializing??=(async()=>{
    const next=new DAppConnector({name:'Wikshi',description:'Approve a Wikshi service payment on Hedera testnet',url:location.origin,icons:[location.origin+'/wikshi/art/messenger-cutout.png']},LedgerId.TESTNET,projectId,['hedera_signTransaction'],[],['hedera:testnet']);
    await next.init({logger:'error'});
    if(!next.walletConnectClient)throw Error('Could not connect to the wallet service. Please try again.');
    connector=next;return next;
  })();
  try{return await initializing;}finally{initializing=undefined;}
}

function testnetSigners(active:DAppConnector){
  return active.signers.filter(s=>s.getLedgerId().toString()===LedgerId.TESTNET.toString());
}

async function exclusive<T>(run:()=>Promise<T>){
  if(interacting)throw Error('Finish or cancel the current wallet request before starting another.');
  interacting=true;
  try{return await run();}finally{interacting=false;}
}

export async function walletOptions(){
  const active=await connect(projectId());
  return {
    accounts:[...new Set(testnetSigners(active).map(s=>s.getAccountId().toString()))],
    extensions:[...new Map(active.extensions.filter(e=>e.available&&e.id).map(e=>[e.id,{id:e.id,name:e.name||'Hedera wallet'}])).values()]
  };
}

async function pair(active:DAppConnector,extensionId?:string){
  if(extensionId&&!active.extensions.some(e=>e.id===extensionId&&e.available))throw Error('That wallet extension is unavailable. Refresh the wallet list or connect using WalletConnect.');
  const session=extensionId?await active.connectExtension(extensionId):await active.openModal(undefined,true);
  const signer=testnetSigners(active).find(s=>s.topic===session.topic);
  if(!signer)throw Error('Connect a wallet that supports native Hedera testnet transactions.');
  selectedAccount=signer.getAccountId().toString();
  return selectedAccount;
}

export async function connectWallet(extensionId?:string){
  return exclusive(async()=>pair(await connect(projectId()),extensionId));
}

export function chooseWalletAccount(account:string){
  if(interacting)throw Error('Finish or cancel the current wallet request before changing accounts.');
  if(!connector||!testnetSigners(connector).some(s=>s.getAccountId().toString()===account))throw Error('That Hedera testnet account is no longer connected. Connect it again.');
  selectedAccount=account;
  return account;
}

function validateQuote(id:string,quote:any){
  const account=(value:unknown)=>typeof value==='string'&&/^0\.0\.[1-9]\d{0,18}$/.test(value)&&BigInt(value.slice(4))<=9223372036854775807n;
  if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)||!quote||quote.network!=='hedera:testnet'||quote.scheme!=='exact'||!['0.0.0','0.0.429274'].includes(quote.asset)||typeof quote.amount!=='string'||!/^\d{1,18}$/.test(quote.amount)||BigInt(quote.amount)<=0n||!account(quote.payTo)||!account(quote.extra?.feePayer))throw Error('Unsupported payment request. Request a fresh Hedera testnet quote.');
}

export async function signPayment(id:string,quote:any){
  validateQuote(id,quote);
  return exclusive(async()=>{
    const active=await connect(projectId());
    if(selectedAccount&&!testnetSigners(active).some(s=>s.getAccountId().toString()===selectedAccount))throw Error('Your selected account disconnected. Choose a connected Hedera testnet account before signing.');
    if(!testnetSigners(active).length)await pair(active);
    if(!selectedAccount){
      const available=testnetSigners(active);
      if(available.length!==1)throw Error('Choose the Hedera testnet account you want to pay from before signing.');
      selectedAccount=available[0].getAccountId().toString();
    }
    const signer=testnetSigners(active).find(s=>s.getAccountId().toString()===selectedAccount);
    if(!signer)throw Error('Connect a Hedera testnet wallet.');
    const payer=signer.getAccountId().toString(),amount=BigInt(quote.amount);
    if(payer===quote.payTo)throw Error('Choose a payment account different from the service recipient.');
    const tx=new TransferTransaction().setTransactionId(TransactionId.generate(AccountId.fromString(quote.extra.feePayer))).setTransactionMemo(`wikshi:${id}`).setNodeAccountIds([AccountId.fromString('0.0.3')]);
    if(quote.asset==='0.0.0')tx.addHbarTransfer(payer,Hbar.fromTinybars((-amount).toString())).addHbarTransfer(quote.payTo,Hbar.fromTinybars(amount.toString()));
    else tx.addTokenTransfer(quote.asset,payer,-amount).addTokenTransfer(quote.asset,quote.payTo,amount);
    tx.freeze();const signed=await signer.signTransaction(tx);
    // Sign only. Blocky receives this payload and settles the exact x402 operation.
    const bytes=signed.toBytes();let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);
    return {x402Version:2,accepted:quote,payload:{transaction:btoa(binary)}};
  });
}
