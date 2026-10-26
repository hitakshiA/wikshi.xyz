import {randomUUID} from 'node:crypto';
import {SessionError} from './sessions.mjs';

const research=/^(discovery\.(search|people|companies|contents)|contacts\.(enrich|phone|reverse|company))$/;
const assets={USDC:'0.0.429274',HBAR:'0.0.0'};
export function authorizeBudget(session,input,now=Date.now()) {
  if(input?.approved!==true||!assets[input.currency]||!Array.isArray(input.services)||!input.services.length||input.services.length>8||input.services.some(s=>!research.test(s)))throw new SessionError('Approve a research budget with explicit services and currency.');
  const ceiling=input.currency==='USDC'?50000n:100000000n;
  if(!/^[1-9]\d{0,17}$/.test(input.amountAtomic||'')||BigInt(input.amountAtomic)>ceiling)throw new SessionError('Budget exceeds the hosted testnet limit.');
  const expiry=Date.parse(input.expiresAt);
  if(!Number.isFinite(expiry)||expiry<=now||expiry>now+3600000)throw new SessionError('Budget expiry must be within one hour.');
  if(session.budget&&!session.budget.revoked&&Date.parse(session.budget.expiresAt)>now)throw new SessionError('Revoke the existing budget before replacing it.',409);
  session.budget={id:randomUUID(),currency:input.currency,asset:assets[input.currency],amountAtomic:input.amountAtomic,
    services:[...new Set(input.services)],expiresAt:input.expiresAt,reservations:{},revoked:false};
  return budgetView(session);
}
export function budgetView(session) {
  const b=session.budget;if(!b)return null;
  const reserved=Object.values(b.reservations).reduce((sum,r)=>sum+BigInt(r.amount),0n);
  return {id:b.id,currency:b.currency,amountAtomic:b.amountAtomic,reservedAtomic:reserved.toString(),
    remainingAtomic:(BigInt(b.amountAtomic)-reserved).toString(),services:b.services,expiresAt:b.expiresAt,revoked:b.revoked};
}
export function reserveBudget(session,op,now=Date.now()) {
  const b=session.budget;
  if(!b||b.revoked||Date.parse(b.expiresAt)<=now||!research.test(op.service)||!b.services.includes(op.service))return null;
  if(b.reservations[op.id])return b.reservations[op.id];
  const quote=op.paymentRequired?.accepts?.find(q=>q.asset===b.asset);
  if(!quote||quote.scheme!=='exact'||quote.network!=='hedera:testnet'||!/^\d{1,18}$/.test(quote.amount)||BigInt(quote.amount)<=0n)return null;
  if(Object.keys(b.reservations).length>=10||BigInt(quote.amount)>BigInt(budgetView(session).remainingAtomic))return null;
  // Reserve before any await. Uncertain payments remain charged to the budget;
  // refunds do not silently renew spending authority.
  const reservation={amount:quote.amount,currency:b.currency};b.reservations[op.id]=reservation;return reservation;
}
export async function payWithinBudget(session,op,{sponsor,api,refresh,emit}) {
  if(session.turnAborted)return null;
  const reservation=reserveBudget(session,op);if(!reservation)return null;
  const payment=await sponsor.payment(session,op,reservation.currency);
  // Revocation during wallet setup must stop submission too.
  if(session.turnAborted||session.budget.revoked||Date.parse(session.budget.expiresAt)<=Date.now())throw new SessionError('Budget is no longer active.',409);
  let result=await api(session,`/v1/operations/${op.id}/pay`,{payment});
  session.operations.set(op.id,{...op,...result});emit({type:'operation',operation:session.operations.get(op.id)});
  const deadline=Date.now()+60000;
  while(['queued','running','confirming_payment','verifying_payment'].includes(result.status)&&Date.now()<deadline&&!session.budget.revoked&&!session.turnAborted){
    await new Promise(resolve=>setTimeout(resolve,1500));result=await refresh(session,op.id);emit({type:'operation',operation:result});
  }
  return result;
}
