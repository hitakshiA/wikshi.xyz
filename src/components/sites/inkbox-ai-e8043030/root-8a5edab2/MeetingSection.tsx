export function MeetingSection() {
  return (
    <section id="meetings" className="wikshi-meetings wikshi-new-section" aria-labelledby="meetings-title">
      <div className="wikshi-section-shell meeting-layout">
        <div className="meeting-story">
          <h2 id="meetings-title">A face to go<br />with that voice.</h2>
          <p className="wikshi-section-lead">Let your agent talk to people live on scheduled video calls, ask the questions that matter, and bring back the information it needs. Every conversation metered through x402 on Hedera.</p>
          <ol className="meeting-steps">
            <li><span>01</span><div><h3>Set the time. Set the mission.</h3><p>Your agent arranges a time with the guest and prepares a focused brief. Straight to the questions, with a clear session budget.</p></div></li>
            <li><span>02</span><div><h3>Your agent takes the video call.</h3><p>Pay through x402, get a meeting link, and share it with the guest. Your agent talks face to face on your behalf, with usage measured by time.</p></div></li>
            <li><span>03</span><div><h3>The answers come back.</h3><p>Your agent checks status and retrieves the original transcript with its private access credential. No second payment to read it.</p></div></li>
          </ol>
        </div>
        <figure className="meeting-preview">
          <div className="meeting-window-bar"><span className="meeting-window-dot" /><span>Your agent, talking to people live on video calls on your behalf</span><span aria-hidden="true">↗</span></div>
          <video autoPlay loop playsInline muted preload="metadata" poster="/wikshi/video/meeting-reactions-poster.webp" aria-label="Video conversation with Wikshi listening, speaking, and smiling in the corner">
            <source src="/wikshi/video/meeting-reactions.mp4" type="video/mp4" />
            Your browser does not support this video. <a href="/wikshi/video/meeting-reactions.mp4">Download the video</a>.
          </video>
        </figure>
      </div>
    </section>
  );
}
