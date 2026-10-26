import React from 'react';
import type {Suggestion} from './suggestions.mjs';
import './suggestion-buttons.css';

export function SuggestionButtons({items,disabled,onChoose}:{items:Suggestion[];disabled:boolean;onChoose:(prompt:string)=>void}){
  if(!items.length)return null;
  return <nav className="suggestion-buttons" aria-label="Suggested next steps">{items.map(item=><button key={item.prompt} type="button" title={item.prompt} disabled={disabled} onClick={()=>onChoose(item.prompt)}>{item.label}<span aria-hidden="true"> ↗</span></button>)}</nav>;
}
