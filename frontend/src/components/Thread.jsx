import React, { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import AiMessage from './AiMessage';
import MCQMessage from './MCQMessage';

const SQL_HINTS = [
  'SELECT ...', 'JOIN tables ...', 'GROUP BY ...', 'WHERE ...', 'WITH cte AS (...)', 'ORDER BY ...', 'HAVING COUNT(...)',
];

export default function Thread({ messages, addToast, onFix, onRegen, onSubmitMCQAnswers, onSkipMCQ, settings, currentUser }) {
  const endRef = useRef(null);
  const convRef = useRef(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [hintIdx, setHintIdx] = useState(0);

  const lastMsg = messages.length > 0 ? messages[messages.length - 1] : null;
  // Show loading when last message is a user message (AI hasn't responded yet)
  // or when user messages exist but last non-user message is still being processed
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
  }, [messages]);

  // Detect manual scroll — show button whenever not at bottom
  const handleScroll = (e) => {
    const el = e.currentTarget;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (atBottom) {
      setAutoScroll(true);
      setShowScrollBtn(false);
    } else {
      setAutoScroll(false);
      setShowScrollBtn(true);
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
          if (m.type === 'mcq') {
            return (
              <MCQMessage
                key={m.id || i}
                msg={m}
                onSubmitAnswers={onSubmitMCQAnswers}
                onSkip={onSkipMCQ}
              />
            );
          }
          if (m.type === 'ai-error') {
            return (
              <div key={m.id || i} className="message msg-ai">
                <div className="msg-ai-header">
                  <div className="ai-avatar">⚠</div>
                  <span className="ai-name">ChatWithDB</span>
                  <span className="msg-ai-error-label">Error</span>
                </div>
                <div className="msg-ai-error-body">{m.error}</div>
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
                currentUser={currentUser}
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
              <span className="ai-name">ChatWithDB</span>
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

Thread.propTypes = {
  messages: PropTypes.array.isRequired,
  addToast: PropTypes.func.isRequired,
  onFix: PropTypes.func.isRequired,
  onRegen: PropTypes.func.isRequired,
  onSubmitMCQAnswers: PropTypes.func.isRequired,
  onSkipMCQ: PropTypes.func.isRequired,
  settings: PropTypes.object,
  currentUser: PropTypes.object,
};
