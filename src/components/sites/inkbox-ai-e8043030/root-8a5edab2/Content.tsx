'use client';
import {useEffect, useState} from 'react';
import parse, {attributesToProps, domToReact, Element, type DOMNode, type HTMLReactParserOptions} from 'html-react-parser';
import markup from './wikshi-markup.json';
import {MeetingSection} from './MeetingSection';
import {MeteringSection} from './MeteringSection';
const ids = ['memory', 'collaboration', 'control'];
export function Content() {
  const [active, setActive] = useState('memory');
  useEffect(() => {
    const observer = new IntersectionObserver(entries => {
      const first = entries.filter(entry => entry.isIntersecting).sort((a,b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (first) setActive(first.target.id);
    }, {rootMargin: '-30% 0px -55% 0px'});
    ids.forEach(id => {const element = document.getElementById(id); if(element) observer.observe(element);});
    return () => observer.disconnect();
  }, []);
  const options: HTMLReactParserOptions = {replace(node) {
    if (node instanceof Element && node.attribs['data-wikshi-section'] === 'meetings') return <MeetingSection/>;
    if (node instanceof Element && node.attribs['data-wikshi-section'] === 'metering') return <MeteringSection/>;
    if (!(node instanceof Element) || node.name !== 'a' || !ids.includes(node.attribs.href?.slice(1))) return;
    const selected = node.attribs.href === `#${active}`;
    const props = attributesToProps(node.attribs);
    if (node.attribs.class.includes('rounded-full')) {
      const base = node.attribs.class.replace(/border-salmon|bg-salmon\/10|text-\[#8e585e\]|border-rule|bg-surface|text-muted/g, '');
      return <a {...props} className={`${base} ${selected ? 'border-salmon bg-salmon/10 text-[#8e585e]' : 'border-rule bg-surface text-muted'}`} aria-current={selected ? 'location' : undefined}>{domToReact(node.children as DOMNode[])}</a>;
    }
    return <a {...props} aria-current={selected ? 'location' : undefined}>{domToReact(node.children as DOMNode[], {replace(child) {
      if (!(child instanceof Element)) return;
      const indicator = child.attribs.class.includes('bg-salmon');
      return <span {...attributesToProps(child.attribs)} className={child.attribs.class.replace(/opacity-\d+/g, selected ? 'opacity-100' : indicator ? 'opacity-0' : 'opacity-50')}>{domToReact(child.children as DOMNode[])}</span>;
    }})}</a>;
  }};
  return <>{parse(markup.Content, options)}</>;
}
