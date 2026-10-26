import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Sessions} from '../server/sessions.mjs';
test('tabs have separate credentials and operation maps',()=>{const sessions=new Sessions();const a=sessions.create(),b=sessions.create();a.operations.set('private',{transcript:'secret'});assert.notEqual(a.credential,b.credential);assert.equal(b.operations.size,0);assert.throws(()=>sessions.get('other'));});
test('expiry aborts and discards the agent',()=>{let time=0,aborted=false;const sessions=new Sessions({now:()=>time,ttl:100});const s=sessions.create();s.agent={abort(){aborted=true;}};time=101;sessions.sweep();assert.equal(aborted,true);assert.equal(sessions.items.size,0);});
test('one turn per tab, independent tabs can run concurrently',async()=>{const sessions=new Sessions();const a=sessions.create(),b=sessions.create();let release;const first=sessions.exclusive(a.token,()=>new Promise(r=>release=r));await assert.rejects(sessions.exclusive(a.token,()=>{}),{status:409});await sessions.exclusive(b.token,async()=>{});release();await first;assert.equal(a.busy,false);});
test('close prevents reuse',()=>{const sessions=new Sessions();const s=sessions.create();sessions.close(s.token);assert.throws(()=>sessions.get(s.token),{status:401});});
