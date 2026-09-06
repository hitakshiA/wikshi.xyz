import test from 'node:test';
import assert from 'node:assert/strict';
import {Blocky, NETWORK, USDC} from '../src/payments/blocky.mjs';
import {createApi} from '../src/server.mjs';
const requirements = {scheme:'exact', network:NETWORK, asset:USDC, amount:'10000', payTo:'0.0.123', maxTimeoutSeconds:120, extra:{feePayer:'0.0.7162784'}};
const payload = {x402Version:2, accepted:requirements, payload:{transaction:'YWJj'}};
test('quotes discover real fee payer and use integer USDC units', async () => {
  const adapter = new Blocky(async url => {
    assert.equal(url, 'https://api.testnet.blocky402.com/supported');
    return Response.json({kinds:[{x402Version:2, scheme:'exact', network:NETWORK, extra:{feePayer:'0.0.7162784'}}]});
  });
  assert.deepEqual(await adapter.requirements({payTo:'0.0.123',amount:'10000'}), requirements);
  await assert.rejects(adapter.requirements({payTo:'0.0.123',amount:'0.01'}), /invalid_quote/);
});
test('mismatched quotes cannot reach facilitator', async () => {
  const adapter = new Blocky(() => {throw new Error('Must not call upstream');});
  for (const field of ['network','asset','amount','payTo']) {
    await assert.rejects(adapter.verify({...payload,accepted:{...requirements,[field]:'wrong'}},requirements), /payment_quote_mismatch/);
  }
});
test('invalid signatures do not leak upstream messages', async () => {
  const adapter = new Blocky(async () => Response.json({isValid:false,invalidMessage:'provider-secret'}));
  await assert.rejects(adapter.verify(payload, requirements), {message:'payment_rejected'});
});
test('settlement timeouts remain unknown and are never retried', async () => {
  let attempts=0;
  const adapter = new Blocky(async () => {attempts++; throw new Error('secret');});
  await assert.rejects(adapter.settle(payload,requirements), {message:'settlement_unknown'});
  assert.equal(attempts,1);
});
test('successful settlement requires network, transaction and payer', async () => {
  const adapter = new Blocky(async () => Response.json({success:true,network:NETWORK,transaction:'0.0.7162784@1780000000.123456789',payer:'0.0.7284970'}));
  assert.equal((await adapter.settle(payload,requirements)).payer,'0.0.7284970');
});
test('public API exposes no provider proxy or unconfigured paid services', async () => {
  const server=createApi();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const origin=`http://127.0.0.1:${server.address().port}`;
    assert.equal((await fetch(`${origin}/healthz`)).status,200);
    assert.deepEqual((await (await fetch(`${origin}/v1/services`)).json()).services,[]);
    const response=await fetch(`${origin}/settle`,{method:'POST'});
    assert.equal(response.status,404);
    assert.equal((await response.json()).error.code,'not_found');
  } finally {await new Promise(resolve=>server.close(resolve));}
});
