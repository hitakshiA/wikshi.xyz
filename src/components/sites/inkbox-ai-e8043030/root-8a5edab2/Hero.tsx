'use client';

import { attributesToProps, domToReact, Element, htmlToDOM, type DOMNode, type HTMLReactParserOptions } from 'html-react-parser';
import markup from './wikshi-markup.json';
import {CourierSky} from './CourierSky';
import {AgentDeck} from './AgentDeck';

const source = htmlToDOM(markup.Hero);
function elements(nodes: DOMNode[]): Element[] {
  return nodes.flatMap(node => node instanceof Element ? [node, ...elements(node.children as DOMNode[])] : []);
}
function textContent(node: DOMNode): string {
  return node.type === 'text' ? node.data : node instanceof Element ? (node.children as DOMNode[]).map(textContent).join('') : '';
}
const agents = elements(source).filter(node => node.attribs.role === 'tab').map(node => ({
  name: textContent(node),
  icon: domToReact(node.children.slice(0, 1) as DOMNode[]),
}));

export function Hero() {
  const options: HTMLReactParserOptions = {
    replace(node) {
      if (!(node instanceof Element)) return;
      if (node.attribs['data-wikshi-sky']) return <CourierSky/>;
      if (node.name === 'script' || node.attribs.role === 'tabpanel') return <></>;
      if (node.attribs.role === 'tablist') return <AgentDeck agents={agents}/>;
      if (node.name === 'section') return <section {...attributesToProps(node.attribs)} className={`${node.attribs.class} wikshi-hero`}>{domToReact(node.children as DOMNode[], options)}</section>;
      if (node.children.some(child => child instanceof Element && child.name === 'h1')) return <div {...attributesToProps(node.attribs)} className={`${node.attribs.class} wikshi-hero-content`}>{domToReact(node.children as DOMNode[], options)}</div>;
      if (node.name === 'a' && node.attribs.href === '/#quickstart-panel') {
        return <a {...attributesToProps(node.attribs)} href="/chat/">{domToReact(node.children as DOMNode[], options)}</a>;
      }
    },
  };
  return <>{domToReact(source, options)}</>;
}
