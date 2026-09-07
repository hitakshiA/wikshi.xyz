import {DAppConnector} from '@hashgraph/hedera-wallet-connect';
import {LedgerId,TransferTransaction,TransactionId,AccountId,Hbar} from '@hiero-ledger/sdk';

let connector:DAppConnector|undefined;
export async function signPayment(id:string,quote:any){
  const projectId=import.meta.env.VITE_WALLETCONNECT_PROJECT_ID;
  if(!projectId)throw Error('Wallet connection is not available yet. Please try again later.');
  if(quote.network!=='hedera:testnet'||quote.scheme!=='exact'||!['0.0.0','0.0.429274'].includes(quote.asset)||!/^\d+$/.test(quote.amount))throw Error('Unsupported payment request.');
  if(!connector){connector=new DAppConnector({name:'Wikshi',description:'Approve a Wikshi service payment on Hedera testnet',url:location.origin,icons:[location.origin+'/wikshi/art/messenger-cutout.png']},LedgerId.TESTNET,projectId,['hedera_signTransaction'],[],['hedera:testnet']);await connector.init({logger:'error'});}
  if(!connector.signers.length)await connector.openModal(undefined,true);
  const signer=connector.signers[0];if(!signer||signer.getLedgerId().toString()!==LedgerId.TESTNET.toString())throw Error('Connect a Hedera testnet wallet.');
  const payer=signer.getAccountId().toString(),amount=BigInt(quote.amount);
  if(payer===quote.payTo||amount<=0n)throw Error('Invalid payment account or amount.');
  const tx=new TransferTransaction().setTransactionId(TransactionId.generate(AccountId.fromString(quote.extra.feePayer))).setTransactionMemo(`wikshi:${id}`).setNodeAccountIds([AccountId.fromString('0.0.3')]);
  if(quote.asset==='0.0.0')tx.addHbarTransfer(payer,Hbar.fromTinybars((-amount).toString())).addHbarTransfer(quote.payTo,Hbar.fromTinybars(amount.toString()));
  else tx.addTokenTransfer(quote.asset,payer,-amount).addTokenTransfer(quote.asset,quote.payTo,amount);
  tx.freeze();const signed=await signer.signTransaction(tx);
  // Sign only. Blocky receives this payload and settles the exact x402 operation.
  const bytes=signed.toBytes();let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);
  return {x402Version:2,accepted:quote,payload:{transaction:btoa(binary)}};
}
