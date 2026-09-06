import {Client, PrivateKey, Transaction, TransferTransaction, TransactionId, AccountId} from '@hiero-ledger/sdk';
import {inspectHederaTransaction} from '@x402/hedera';
import {NETWORK, USDC, PaymentError} from './blocky.mjs';

export function inspectPayment(payload, quote, operationId) {
  try {
    const bytes=payload.payload.transaction;
    const inspected=inspectHederaTransaction(bytes);
    const transaction=Transaction.fromBytes(Buffer.from(bytes,'base64'));
    const entries=inspected.tokenTransfers[USDC] || [];
    const outgoing=entries.filter(x=>BigInt(x.amount)<0n), incoming=entries.filter(x=>BigInt(x.amount)>0n);
    if (inspected.hasNonTransferOperations || inspected.hbarTransfers.length || Object.keys(inspected.tokenTransfers).length!==1 ||
        outgoing.length!==1 || incoming.length!==1 || entries.length!==2 || incoming[0].accountId!==quote.payTo ||
        BigInt(incoming[0].amount)!==BigInt(quote.amount) || BigInt(outgoing[0].amount)!==-BigInt(quote.amount) ||
        inspected.transactionIdAccountId!==quote.extra.feePayer || transaction.transactionMemo!==`wikshi:${operationId}`) throw new Error();
    return {tx:inspected.transactionId,payer:outgoing[0].accountId};
  } catch {throw new PaymentError('invalid_payment');}
}

export async function confirmTransfer(tx, {payer,payTo,amount}, fetchImpl=fetch) {
  if (!/^0\.0\.\d+@\d+\.\d+$/.test(tx)) return false;
  const id=tx.replace('@','-').replace(/\.(\d+)$/,'-$1');
  const response=await fetchImpl(`https://testnet.mirrornode.hedera.com/api/v1/transactions/${id}`, {signal:AbortSignal.timeout(15000),redirect:'error'});
  if (!response.ok) return false;
  const data=await response.json();
  return data.transactions?.some(t=>t.result==='SUCCESS' && t.name==='CRYPTOTRANSFER' && t.nonce===0 && (()=>{
    const entries=(t.token_transfers||[]).filter(e=>e.token_id===USDC);
    const sum=who=>entries.filter(e=>e.account===who).reduce((a,e)=>a+BigInt(e.amount),0n);
    return payer!==payTo && sum(payer)===-BigInt(amount) && sum(payTo)===BigInt(amount);
  })()) || false;
}

export class RefundSigner {
  constructor(account, key) {this.account=account;this.key=PrivateKey.fromStringECDSA(key.replace(/^0x/,''));}
  async prepare(payer, amount, operationId) {
    const client=Client.forTestnet();
    try {
      const tx=new TransferTransaction().addTokenTransfer(USDC,this.account,-BigInt(amount)).addTokenTransfer(USDC,payer,BigInt(amount))
        .setTransactionId(TransactionId.generate(AccountId.fromString(this.account))).setTransactionMemo(`refund:${operationId}`).freezeWith(client);
      await tx.sign(this.key);
      return {tx:tx.transactionId.toString(),bytes:Buffer.from(tx.toBytes()).toString('base64')};
    } finally {client.close();}
  }
  async submit(prepared) {
    const client=Client.forTestnet();
    try {await Transaction.fromBytes(Buffer.from(prepared.bytes,'base64')).execute(client);}
    finally {client.close();}
  }
}

export async function signQuote(account, key, quote, id) {
  if (quote.network!==NETWORK || quote.asset!==USDC || quote.scheme!=='exact') throw new Error('Refusing non-testnet-USDC payment');
  const client=Client.forTestnet();
  try {
    const tx=new TransferTransaction().addTokenTransfer(USDC,account,-BigInt(quote.amount)).addTokenTransfer(USDC,quote.payTo,BigInt(quote.amount))
      .setTransactionId(TransactionId.generate(AccountId.fromString(quote.extra.feePayer))).setTransactionMemo(`wikshi:${id}`).freezeWith(client);
    await tx.sign(PrivateKey.fromStringECDSA(key.replace(/^0x/,'')));
    return {x402Version:2,accepted:quote,payload:{transaction:Buffer.from(tx.toBytes()).toString('base64')}};
  } finally {client.close();}
}
