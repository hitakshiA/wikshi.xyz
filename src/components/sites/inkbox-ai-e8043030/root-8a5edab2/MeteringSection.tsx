'use client';
import {useState} from 'react';
export function MeteringSection() {
  const [seconds, setSeconds] = useState(90);
  return (
    <section id="metering" className="wikshi-metering wikshi-new-section" aria-labelledby="metering-title">
      <div className="wikshi-section-shell metering-layout">
        <div className="metering-story">
          <h2 id="metering-title">Only the time it takes.<br /><span>The rest comes back.</span></h2>
          <p className="wikshi-section-lead">Give your agent a spending limit, not an open tab. Calls and meetings are designed around measured time, with unused prepaid balance returned after the session.</p>
          <img className="metering-art wikshi-cutout" src="/wikshi/art/metering-cutout.png" width="1254" height="894" alt="Wikshi returning a coin to a purse beside a stopwatch and receipt" loading="lazy" />
        </div>
        <div className="metering-example">
          <div className="receipt-topline"><span>WIKSHI / USAGE CALCULATOR</span><span className="usdc-badge"><img src="/wikshi/protocols/USDC Token.svg" width="32" height="32" alt="" />Paid in USDC</span></div>
          <h3>A short conversation.<br />A smaller bill.</h3>
          <div className="duration-control">
            <label htmlFor="session-duration">Try a session length <output htmlFor="session-duration">{Math.floor(seconds / 60)}m {String(seconds % 60).padStart(2, '0')}s</output></label>
            <input id="session-duration" type="range" min="0" max="180" step="15" value={seconds} onChange={event => setSeconds(Number(event.target.value))} aria-valuetext={`${seconds} seconds`} />
            <div className="duration-endpoints"><span>0 seconds</span><span>3-minute ceiling</span></div>
          </div>
          <dl className="receipt-lines">
            <div><dt>Prepaid ceiling</dt><dd>1.80 <small>USDC</small></dd></div>
            <div><dt>Used <small>{seconds}s × 0.01 USDC</small></dt><dd>{(seconds / 100).toFixed(2)} <small>USDC</small></dd></div>
            <div className="receipt-return"><dt>Returned to your wallet</dt><dd>{((180 - seconds) / 100).toFixed(2)} <small>USDC</small></dd></div>
          </dl>
          <p className="receipt-disclaimer">Calculation rate: 0.01 USDC per second. Adjust the duration to see the usage cost and unused balance. Your service quote sets the rate before payment.</p>
          <div className="receipt-perforation" aria-hidden="true" />
          <p className="receipt-footnote">x402 on Hedera <span>One session. An itemized receipt.</span></p>
        </div>
      </div>
      <div className="wikshi-section-shell metering-details">
        <p><strong>Know the ceiling.</strong> Review the rate and maximum charge before authorizing payment.</p>
        <p><strong>Keep the evidence.</strong> Match the session’s measured usage to its payment and refund receipts.</p>
        <p><strong>Get the result.</strong> Use your private credential for status and transcripts, not a public transaction link.</p>
      </div>
    </section>
  );
}
