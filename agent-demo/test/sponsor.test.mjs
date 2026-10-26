import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Sponsor,selectSponsoredQuote} from '../server/sponsor.mjs';
const merchant='0.0.123',q={scheme:'exact',network:'hedera:testnet',asset:'0.0.429274',amount:'1',payTo:merchant,extra:{feePayer:'0.0.456'}};
const op={expiresAt:new Date(Date.now()+60000).toISOString(),paymentRequired:{accepts:[q]}};
test('sponsor accepts only current exact testnet quotes payable to treasury',()=>{
 assert.equal(selectSponsoredQuote(op,'USDC',merchant),q);
 for(const quote of [{...q,network:'hedera:mainnet'},{...q,payTo:'0.0.999'},{...q,amount:'-1'},{...q,scheme:'upto'}])assert.throws(()=>selectSponsoredQuote({...op,paymentRequired:{accepts:[quote]}},'USDC',merchant));
 assert.throws(()=>selectSponsoredQuote({...op,expiresAt:'bad'},'USDC',merchant));
 assert.throws(()=>selectSponsoredQuote(op,'USD',merchant));
});
test('wallet journal encrypts keys, isolates sessions and survives reload',()=>{
 const dir=mkdtempSync(join(tmpdir(),'wikshi-sponsor-test-')),id='00000000-0000-0000-0000-000000000001';
 try{const env={WIKSHI_SPONSOR_DIR:dir,WIKSHI_SPONSOR_DATA_KEY:'ab'.repeat(32)},s=new Sponsor(env);s.save(id,{key:'secret-key',payments:{a:'same-signed-payload'}});assert.equal(readFileSync(s.file(id)).includes('secret-key'),false);assert.deepEqual(new Sponsor(env).load(id),{key:'secret-key',payments:{a:'same-signed-payload'}});assert.equal(s.load('00000000-0000-0000-0000-000000000002'),null);assert.throws(()=>s.file('../../bad'));}finally{rmSync(dir,{recursive:true});}
});
test('funding operations serialize and release after failure',async()=>{
 const s=new Sponsor(),order=[];await Promise.all([s.exclusive(async()=>{order.push(1);await new Promise(r=>setTimeout(r,5));order.push(2)}),s.exclusive(async()=>order.push(3))]);assert.deepEqual(order,[1,2,3]);await assert.rejects(s.exclusive(async()=>{throw Error('test')}));assert.equal(await s.exclusive(async()=>4),4);
});
