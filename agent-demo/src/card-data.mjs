export const terminal = new Set(['completed','failed','cancelled','expired','payment_rejected']);
export function rowsOf(value) {
  if (Array.isArray(value)) return value.filter(x=>x && typeof x==='object' && !Array.isArray(x));
  if (value && typeof value==='object') for (const key of ['results','people','companies','contacts','data','items']) {
    const rows=rowsOf(value[key]); if(rows.length) return rows;
  }
  return [];
}
export function safeUrl(value) {
  try {const u=new URL(String(value)); return u.protocol==='https:' ? u.href : null;} catch {return null;}
}
export function atomic(value, decimals=6) {
  if(!/^\d+$/.test(String(value)) || !Number.isInteger(decimals) || decimals<0 || decimals>18) return 'Not available';
  const n=BigInt(value),scale=10n**BigInt(decimals);
  const tail=(n%scale).toString().padStart(decimals,'0').replace(/0+$/,'');
  return `${n/scale}${tail?'.'+tail:''}`;
}
export function scanLink(kind, value) {
  if(kind==='topic' && /^\d+\.\d+\.\d+$/.test(String(value))) return `https://hashscan.io/testnet/topic/${value}`;
  if(kind==='transaction' && /^(\d+\.\d+\.\d+[@-]\d+[.-]\d+|0x[\da-f]{64,96})$/i.test(String(value)))
    return `https://hashscan.io/testnet/transaction/${String(value).replace('@','-').replace(/(\d+-\d+)\.(\d+)$/, '$1-$2')}`;
  return null;
}
