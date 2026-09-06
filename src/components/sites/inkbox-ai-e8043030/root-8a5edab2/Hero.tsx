'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { attributesToProps, domToReact, Element, htmlToDOM, type DOMNode, type HTMLReactParserOptions } from 'html-react-parser';
import markup from './wikshi-markup.json';
import {CourierSky} from './CourierSky';

const source = htmlToDOM(markup.Hero);

function elements(nodes: DOMNode[]): Element[] {
  return nodes.flatMap((node) => node instanceof Element
    ? [node, ...elements(node.children as DOMNode[])]
    : []);
}

const allElements = elements(source);
const tabs = allElements.filter((node) => node.attribs.role === 'tab');
const paragraphs = allElements.filter((node) => node.name === 'p' && 'aria-hidden' in node.attribs);
const commandParagraphs = paragraphs.slice(tabs.length);
const copyButtons = allElements.filter((node) => node.name === 'button' && node.attribs.role !== 'tab');

function textContent(node: DOMNode): string {
  if (node.type === 'text') return node.data;
  if (node instanceof Element) return (node.children as DOMNode[]).map(textContent).join('');
  return '';
}

const commands = commandParagraphs.map((node) => textContent(node).replace(/^\$\s*/, ''));

export function Hero() {
  const [activeTab, setActiveTab] = useState(0);
  const [copyState, setCopyState] = useState<'Copy' | 'Copied' | 'Retry'>('Copy');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  function selectTab(index: number, focus = false) {
    setActiveTab(index);
    setCopyState('Copy');
    if (timer.current) clearTimeout(timer.current);
    if (focus) {
      tabRefs.current[index]?.focus();
      tabRefs.current[index]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }

  function navigateTabs(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number;
    switch (event.key) {
      case 'ArrowRight': next = (index + 1) % tabs.length; break;
      case 'ArrowLeft': next = (index - 1 + tabs.length) % tabs.length; break;
      case 'Home': next = 0; break;
      case 'End': next = tabs.length - 1; break;
      default: return;
    }
    event.preventDefault();
    selectTab(next, true);
  }

  async function copyCommand() {
    try {
      await navigator.clipboard.writeText(commands[activeTab].replace('/wikshi/skills.md',new URL('/wikshi/skills.md',window.location.origin).href));
      setCopyState('Copied');
    } catch {
      setCopyState('Retry');
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopyState('Copy'), 2000);
  }

  const options: HTMLReactParserOptions = {
    replace(node) {
      if (!(node instanceof Element)) return;
      if (node.attribs['data-wikshi-sky']) return <CourierSky/>;
      if (node.name === 'script') return <></>;
      const props = attributesToProps(node.attribs);
      const children = () => domToReact(node.children as DOMNode[], options);
      if (node.attribs.role === 'tablist') {
        return <div {...props} className={`${node.attribs.class} quickstart-marquee`}>
          <div className="quickstart-marquee-track" role="presentation">
            <div className="quickstart-marquee-group" role="presentation">{children()}</div>
            <div className="quickstart-marquee-group quickstart-marquee-copy" aria-hidden="true">
              {tabs.map((tab, index) => <button key={index} type="button" tabIndex={-1}
                className={tabs[activeTab === index ? 0 : 1].attribs.class}
                onPointerDown={event => event.preventDefault()}
                onClick={() => selectTab(index)}>
                {domToReact(tab.children as DOMNode[], options)}
              </button>)}
            </div>
          </div>
        </div>;
      }
      const tabIndex = tabs.indexOf(node);
      if (tabIndex !== -1) {
        return <button {...props}
          ref={(element) => { tabRefs.current[tabIndex] = element; }}
          className={tabs[activeTab === tabIndex ? 0 : 1].attribs.class}
          aria-selected={activeTab === tabIndex}
          tabIndex={activeTab === tabIndex ? 0 : -1}
          onClick={() => selectTab(tabIndex)}
          onKeyDown={(event) => navigateTabs(event, tabIndex)}
        >{children()}</button>;
      }
      if (node.attribs.role === 'tabpanel') {
        return <div {...props} aria-labelledby={`quickstart-tab-${activeTab}`}>{children()}</div>;
      }
      const paragraphIndex = paragraphs.indexOf(node);
      if (paragraphIndex !== -1) {
        const selected = paragraphIndex % tabs.length === activeTab;
        return <p {...props} aria-hidden={!selected}
          className={node.attribs.class.replace(/\b(?:invisible|visible)\b/g, selected ? 'visible' : 'invisible')}
        >{children()}</p>;
      }
      if (copyButtons.includes(node)) {
        return <button {...props} onClick={copyCommand}
          aria-label={copyState === 'Copied' ? 'Copied to clipboard' : copyState === 'Retry' ? 'Copy failed, try again' : node === copyButtons[1] ? 'Copy' : 'Copy prompt'}
        >{children()}</button>;
      }
      if (node.name === 'span' && node.parent === copyButtons[1]) {
        return <span {...props} aria-live="polite">{copyState}</span>;
      }
    },
  };

  return <>{domToReact(source, options)}</>;
}
