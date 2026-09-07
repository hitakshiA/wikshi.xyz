import {Blocky, USDC} from '../src/payments/blocky.mjs';
const id = process.argv[2] || process.env.WIKSHI_TESTNET_PAYER;
if(!/^0\.0\.[1-9]\d*$/.test(id||''))throw new Error('Supply a public testnet account argument or WIKSHI_TESTNET_PAYER');
const mirror = 'https://testnet.mirrornode.hedera.com';
async function get(path) {
  const response = await fetch(`${mirror}${path}`, {signal: AbortSignal.timeout(15000), redirect: 'error'});
  if (!response.ok) throw new Error(`Mirror request failed (${response.status})`);
  return response.json();
}
const [wallet, associations, supported] = await Promise.all([
  get(`/api/v1/accounts/${id}`),
  get(`/api/v1/accounts/${id}/tokens?token.id=${USDC}`),
  new Blocky().supported(),
]);
const token = associations.tokens.find(token => token.token_id === USDC);
console.log(JSON.stringify({account: id, evmAddress: wallet.evm_address, hbarTinybars: String(wallet.balance.balance), usdcToken: USDC, associated: Boolean(token), usdcAtomicBalance: token ? String(token.balance) : null, decimals: token?.decimals, freezeStatus: token?.freeze_status, feePayer: supported.feePayer, usdcFunded: Boolean(token && token.balance > 0 && token.freeze_status !== 'FROZEN')}, null, 2));
