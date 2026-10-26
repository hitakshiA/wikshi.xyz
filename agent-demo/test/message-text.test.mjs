import test from 'node:test';
import assert from 'node:assert/strict';
import {appendAssistantText} from '../src/stream.mjs';

test('separate assistant text segments remain separate paragraphs',()=>{
  let text='';
  for(const event of [{type:'text',text:'Checking '},{type:'text',text:'the sources.'},{type:'text_boundary'},{type:'text_boundary'},{type:'text',text:'Here is **one** request.'}])text=appendAssistantText(text,event);
  assert.equal(text,'Checking the sources.\n\nHere is **one** request.');
});
test('token boundaries do not add spaces inside words, code or markdown',()=>{
  let text='';for(const part of ['**Com','pany**','\n\n','`email','@example.com`'])text=appendAssistantText(text,{type:'text',text:part});
  assert.equal(text,'**Company**\n\n`email@example.com`');
  assert.equal(appendAssistantText('',{type:'text_boundary'}),'');
});
