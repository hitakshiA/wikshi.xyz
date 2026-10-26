'use client';

import {useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode} from 'react';
import {wikshiPrompt} from '@/lib/wikshi-prompt';
import './agent-deck.css';

type Agent = {name: string; icon: ReactNode};
const prompt = wikshiPrompt();

export function AgentDeck({agents}: {agents: Agent[]}) {
  const [selected, setSelected] = useState(0);
  const [copyState, setCopyState] = useState<'idle' | 'copying' | 'copied' | 'failed'>('idle');
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gesture = useRef<{id: number; x: number; y: number} | null>(null);
  const suppressClickUntil = useRef(0);
  const copyVersion = useRef(0);
  useEffect(() => () => {copyVersion.current++; if (timer.current) clearTimeout(timer.current);}, []);

  function choose(index: number, focus = false) {
    const next = (index + agents.length) % agents.length;
    setSelected(next);
    // Every supported agent receives the same portable mission prompt.
    if (focus) buttons.current[next]?.focus({preventScroll: true});
  }
  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = ['ArrowRight', 'ArrowDown'].includes(event.key) ? index + 1 : ['ArrowLeft', 'ArrowUp'].includes(event.key) ? index - 1 : event.key === 'Home' ? 0 : event.key === 'End' ? agents.length - 1 : null;
    if (next === null) return;
    event.preventDefault(); choose(next, true);
  }
  async function copy() {
    if (copyState === 'copying') return;
    const version = ++copyVersion.current;
    if (timer.current) clearTimeout(timer.current);
    setCopyState('copying');
    try {
      await navigator.clipboard.writeText(prompt);
      if (copyVersion.current === version) setCopyState('copied');
    } catch {
      if (copyVersion.current === version) setCopyState('failed');
    }
    if (copyVersion.current === version) timer.current = setTimeout(() => setCopyState('idle'), 2500);
  }

  return <div className="agent-picker" id="quickstart-panel">
    <p className="agent-picker-or">or</p>
    <p className="agent-picker-intro" id="agent-picker-label">Bring your own agent</p>
    <div className="agent-deck" role="radiogroup" aria-labelledby="agent-picker-label"
      onPointerDown={event => {
        if (!event.isPrimary || event.button !== 0) return;
        gesture.current = {id: event.pointerId, x: event.clientX, y: event.clientY};
        const target = (event.target as Element).closest('button') ?? event.currentTarget;
        target.setPointerCapture(event.pointerId);
      }}
      onPointerUp={event => {
        const start = gesture.current; gesture.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        if (!start || start.id !== event.pointerId) return;
        const dx = event.clientX - start.x, dy = event.clientY - start.y;
        if (Math.abs(dx) > 36 && Math.abs(dx) > Math.abs(dy) * 1.4) {
          suppressClickUntil.current = Date.now() + 300;
          choose(selected + (dx < 0 ? 1 : -1));
        }
      }}
      onPointerCancel={() => {gesture.current = null;}}
      onClickCapture={event => {if (Date.now() < suppressClickUntil.current) {event.preventDefault(); event.stopPropagation();}}}>
      {agents.map((agent, index) => {
        const slot = ((index - selected + agents.length + 3) % agents.length) - 3;
        const depth = Math.abs(slot);
        return <button key={agent.name} ref={element => {buttons.current[index] = element;}} type="button" role="radio"
          className="agent-card" data-depth={depth} aria-label={agent.name} aria-checked={selected === index} tabIndex={selected === index ? 0 : -1}
          style={{'--slot': slot, '--depth': depth, '--drop': `${depth * depth * 5}px`, '--angle': `${slot * 7}deg`, '--scale': 1 - depth * .055, zIndex: agents.length - depth} as CSSProperties}
          onClick={() => choose(index)} onKeyDown={event => navigate(event, index)}>
          <span className="agent-card-index" aria-hidden="true">{String(index + 1).padStart(2, '0')}<span>{selected === index ? '↗' : '·'}</span></span>
          <span className="agent-card-logo" aria-hidden="true">{agent.icon}</span>
          <span className="agent-card-name" aria-hidden="true">{agent.name}</span>
        </button>;
      })}
    </div>
    <button className="agent-copy" type="button" onClick={copy} disabled={copyState === 'copying'} aria-busy={copyState === 'copying'}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">{copyState === 'copied' ? <path d="m5 12 4 4L19 6"/> : <><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h4"/></>}</svg>
      <span aria-live="polite">{copyState === 'copied' ? 'Prompt copied' : copyState === 'copying' ? 'Copying…' : copyState === 'failed' ? 'Try copying again' : 'Copy prompt'}</span>
    </button>
  </div>;
}
