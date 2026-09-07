// Require an explicit test payer; never reuse a previous operator wallet by default.
export const payer=process.env.WIKSHI_TESTNET_PAYER;
if(!/^0\.0\.[1-9]\d*$/.test(payer||''))throw new Error('Set WIKSHI_TESTNET_PAYER to the authorized testnet payer account');
