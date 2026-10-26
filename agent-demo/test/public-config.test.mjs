import test from 'node:test';
import assert from 'node:assert/strict';
import {walletProjectId} from '../deploy/public-config.mjs';

const id='1234567890abcdef1234567890abcdef';
test('build config exposes only the public WalletConnect ID',()=>{
  assert.equal(walletProjectId(`CLINE_API_KEY=private\nVITE_WALLETCONNECT_PROJECT_ID=${id}\r\nWIKSHI_SPONSOR_KEY=private`),id);
  assert.equal(walletProjectId('CLINE_API_KEY=private'),'');
  assert.equal(walletProjectId(''),'');
});
test('build config rejects placeholders, executable values and duplicate IDs',()=>{
  for(const value of ['dummy','0'.repeat(32),'$(echo bad)',`${id}; echo bad`])assert.throws(()=>walletProjectId(`VITE_WALLETCONNECT_PROJECT_ID=${value}`));
  assert.throws(()=>walletProjectId(`VITE_WALLETCONNECT_PROJECT_ID=${id}\nVITE_WALLETCONNECT_PROJECT_ID=${id}`));
});
