import {Client, PrivateKey, Transaction, TransferTransaction, TransactionId, AccountId, Hbar} from '@hiero-ledger/sdk';
import {inspectHederaTransaction} from '@x402/hedera';
import {NETWORK, USDC, PaymentError} from './blocky.mjs';
import {HBAR,supportedAsset} from './assets.mjs';

function transfer(asset,payer,payTo,amount) {
  if(!supportedAsset(asset) || !/^[1-9]\d{0,17}$/.test(amount) || payer===payTo)throw new PaymentError('invalid_transfer');
  const value=BigInt(amount), tx=new TransferTransaction();
  return asset===HBAR
    ? tx.addHbarTransfer(payer,Hbar.fromTinybars((-value).toString())).addHbarTransfer(payTo,Hbar.fromTinybars(value.toString()))
    : tx.addTokenTransfer(asset,payer,-value).addTokenTransfer(asset,payTo,value);
}

export function inspectPayment(payload, quote, operationId) {
  try {
    const bytes=payload.payload.transaction;
    const inspected=inspectHederaTransaction(bytes);
    const transaction=Transaction.fromBytes(Buffer.from(bytes,'base64'));
    if(!supportedAsset(quote.asset) || quote.network!==NETWORK || quote.scheme!=='exact')throw new Error();
    const native=quote.asset===HBAR;
    const entries=native?inspected.hbarTransfers:inspected.tokenTransfers[quote.asset] || [];
    const outgoing=entries.filter(x=>BigInt(x.amount)<0n), incoming=entries.filter(x=>BigInt(x.amount)>0n);
    const mixed=native?Object.keys(inspected.tokenTransfers).length!==0:inspected.hbarTransfers.length!==0 || Object.keys(inspected.tokenTransfers).length!==1;
    if (inspected.hasNonTransferOperations || mixed || [...transaction.nftTransfers].length ||
        outgoing.length!==1 || incoming.length!==1 || entries.length!==2 || incoming[0].accountId!==quote.payTo ||
        BigInt(incoming[0].amount)!==BigInt(quote.amount) || BigInt(outgoing[0].amount)!==-BigInt(quote.amount) ||
        inspected.transactionIdAccountId!==quote.extra.feePayer || transaction.transactionMemo!==`wikshi:${operationId}`) throw new Error();
    return {tx:inspected.transactionId,payer:outgoing[0].accountId};
  } catch {throw new PaymentError('invalid_payment');}
}

export async function confirmTransfer(tx, {payer,payTo,amount,asset=USDC,memo}, fetchImpl=fetch) {
  if (!supportedAsset(asset) || !/^[1-9]\d{0,17}$/.test(amount) || !/^0\.0\.\d+@\d+\.\d+$/.test(tx)) return false;
  const id=tx.replace('@','-').replace(/\.(\d+)$/,'-$1');
  const response=await fetchImpl(`https://testnet.mirrornode.hedera.com/api/v1/transactions/${id}`, {signal:AbortSignal.timeout(15000),redirect:'error'});
  if (!response.ok) return false;
  const data=await response.json();
  return data.transactions?.some(t=>t.result==='SUCCESS' && t.name==='CRYPTOTRANSFER' && t.nonce===0 && (()=>{
    try {
      if(memo!==undefined && Buffer.from(t.memo_base64||'','base64').toString()!==memo)return false;
      // Reject imprecise JSON numbers rather than rounding payment evidence.
      const atomic=value=>{if(typeof value==='number'&&!Number.isSafeInteger(value))throw new Error();if(!/^-?\d+$/.test(String(value)))throw new Error();return BigInt(value);};
      const native=asset===HBAR;
      if(native && (t.token_transfers?.length || t.nft_transfers?.length))return false;
      if(!native && ((t.token_transfers||[]).some(e=>e.token_id!==asset) || t.nft_transfers?.length))return false;
      const entries=native?(t.transfers||[]):(t.token_transfers||[]).filter(e=>e.token_id===asset);
      const sum=who=>entries.filter(e=>e.account===who).reduce((a,e)=>a+atomic(e.amount),0n);
      // Mirror HBAR balances include network fees. The tx-ID account pays them:
      // the facilitator for purchases, and our merchant for refunds.
      const fee=native?atomic(t.charged_tx_fee):0n, feePayer=tx.split('@')[0];
      if(fee<0n)return false;
      return payer!==payTo && sum(payer)===-BigInt(amount)-(feePayer===payer?fee:0n) && sum(payTo)===BigInt(amount)-(feePayer===payTo?fee:0n);
    } catch {return false;}
  })()) || false;
}

export class RefundSigner {
  constructor(account, key) {this.account=account;this.key=PrivateKey.fromStringECDSA(key.replace(/^0x/,''));}
  async prepare(payer, amount, operationId, asset=USDC) {
    const client=Client.forTestnet();
    try {
      const tx=transfer(asset,this.account,payer,amount)
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
  if (quote.network!==NETWORK || !supportedAsset(quote.asset) || quote.scheme!=='exact') throw new Error('Refusing unsupported testnet payment');
  const client=Client.forTestnet();
  try {
    const tx=transfer(quote.asset,account,quote.payTo,quote.amount)
      .setTransactionId(TransactionId.generate(AccountId.fromString(quote.extra.feePayer))).setTransactionMemo(`wikshi:${id}`).freezeWith(client);
    await tx.sign(PrivateKey.fromStringECDSA(key.replace(/^0x/,'')));
    return {x402Version:2,accepted:quote,payload:{transaction:Buffer.from(tx.toBytes()).toString('base64')}};
  } finally {client.close();}
}
