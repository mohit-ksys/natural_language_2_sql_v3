import React, { useEffect, useRef, useState } from 'react';
import AiMessage from './AiMessage';

const SQL_HINTS = [
  'SELECT ...', 'JOIN tables ...', 'GROUP BY ...', 'WHERE ...', 'WITH cte AS (...)', 'ORDER BY ...', 'HAVING COUNT(...)',
];

export default function Thread({ messages, addToast, onFix, onRegen, settings }) {
  const endRef = useRef(null);
  const convRef = useRef(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [hintIdx, setHintIdx] = useState(0);

  const lastMsg = messages.length > 0 ? messages[messages.length - 1] : null;
  const isLoading = lastMsg && lastMsg.type === 'user';

  // Rotate SQL hints while loading
  useEffect(() => {
    if (!isLoading) return;
    const interval = setInterval(() => {
      setHintIdx(i => (i + 1) % SQL_HINTS.length);
    }, 1200);
    return () => clearInterval(interval);
  }, [isLoading]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (autoScroll && endRef.current) {
      setTimeout(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), 60);
    }
    // When new AI message arrives, show scroll button if user has scrolled away
    if (lastMsg?.type === 'ai' && !autoScroll) {
      setShowScrollBtn(true);
    }
  }, [messages]);

  // Detect manual scroll up
  const handleScroll = (e) => {
    const el = e.currentTarget;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (atBottom) {
      setAutoScroll(true);
      setShowScrollBtn(false);
    } else {
      setAutoScroll(false);
    }
  };

  const scrollToBottom = () => {
    setAutoScroll(true);
    setShowScrollBtn(false);
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="conversation" id="conversation" ref={convRef} onScroll={handleScroll}>
      <div className="thread" id="thread">
        {/* EMPTY STATE */}
        {messages.length === 0 && (
          <div className="thread-empty">
            <span className="thread-empty-icon">◈</span>
            <span className="thread-empty-title">Ask your database anything</span>
            <span className="thread-empty-sub">Try one of the suggestions above ↑</span>
          </div>
        )}

        {messages.map((m, i) => {
          if (m.type === 'user') {
            return (
              <div key={m.id || i} className="message msg-user">
                {m.isFix ? (
                  <div className="msg-user-bubble fix-bubble">
                    <span className="fix-bubble-tag">✎ Fix requested</span>
                    {m.text}
                  </div>
                ) : (
                  <div className="msg-user-bubble">{m.text}</div>
                )}
                {m.timestamp && (
                  <div className="msg-user-time">
                    {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                )}
              </div>
            );
          }
          if (m.type === 'ai-error') {
            return (
              <div key={m.id || i} className="message msg-ai">
                <div className="msg-ai-header">
                  <div className="ai-avatar">⚠</div>
                  <span className="ai-name">DataWhisper</span>
                  <span style={{ color: '#ff6b6b' }}>Error</span>
                </div>
                <div style={{ padding: '16px', color: '#ff6b6b', fontSize: '13px', lineHeight: '1.5' }}>
                  {m.error}
                </div>
              </div>
            );
          }
          if (m.type === 'ai') {
            return (
              <AiMessage
                key={m.id || i}
                msg={m}
                addToast={addToast}
                onFix={onFix}
                onRegen={onRegen}
                settings={settings}
              />
            );
          }
          return null;
        })}

        {/* LOADING STATE */}
        {isLoading && (
          <div className="message msg-ai">
            <div className="msg-ai-header">
              <div className="ai-avatar loading-avatar">◈</div>
              <span className="ai-name">DataWhisper</span>
              <div className="think-pulse" style={{ marginLeft: '6px' }}>
                <span></span><span></span><span></span>
              </div>
              <span className="sql-hint" key={hintIdx}>{SQL_HINTS[hintIdx]}</span>
            </div>
            <div style={{ padding: '14px 0', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div className="skeleton-line" style={{ width: '72%', height: '11px' }} />
              <div className="skeleton-line" style={{ width: '55%', height: '11px' }} />
              <div className="skeleton-line" style={{ width: '88%', height: '11px' }} />
              <div className="skeleton-line" style={{ width: '40%', height: '11px' }} />
            </div>
          </div>
        )}

        <div ref={endRef} />
      </div>

      {/* SCROLL TO BOTTOM PILL */}
      {showScrollBtn && (
        <button className="scroll-to-bottom" onClick={scrollToBottom}>
          ↓ Jump to bottom
        </button>
      )}
    </div>
  );
}
