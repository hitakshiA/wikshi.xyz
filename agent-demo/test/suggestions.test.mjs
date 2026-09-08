import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSuggestions} from '../src/suggestions.mjs';
test('suggestions retain natural prompts, discard malformed entries, deduplicate, and cap at three',()=>{
  assert.deepEqual(normalizeSuggestions(null),[]);
  const items=normalizeSuggestions([{label:' Draft invitation ',prompt:' Draft the meeting invitation for Alex. '},{label:'Duplicate',prompt:'draft the meeting invitation for Alex.'},{label:'bad',prompt:1},{label:'x'.repeat(61),prompt:'test'},{label:'Bad',prompt:'x'.repeat(601)},...['Check replies','Summarize meeting','Research more'].map(label=>({label,prompt:label}))]);
  assert.deepEqual(items,[{label:'Draft invitation',prompt:'Draft the meeting invitation for Alex.'},{label:'Check replies',prompt:'Check replies'},{label:'Summarize meeting',prompt:'Summarize meeting'}]);
});
