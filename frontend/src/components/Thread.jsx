import React, { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import AiMessage from './AiMessage';
import MCQMessage from './MCQMessage';

const SQL_HINTS = [
  'SELECT ...', 'JOIN tables ...', 'GROUP BY ...', 'WHERE ...', 'WITH cte AS (...)', 'ORDER BY ...', 'HAVING COUNT(...)',
];

export default function Thread({ messages, addToast, onFix, onRegen, onUpdate, onSubmitMCQAnswers, onSkipMCQ, settings, currentUser, onLoadMore, hasMore, isFetchingMore, isMessagesLoading, lmsId }) {
  const endRef = useRef(null);
  const convRef = useRef(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [hintIdx, setHintIdx] = useState(0);

  const lastMsg = messages.length > 0 ? messages[messages.length - 1] : null;
  const isLoading = lastMsg && lastMsg.type === 'user';

  useEffect(() => {
    if (!isLoading) return;
    const interval = setInterval(() => {
      setHintIdx(i => (i + 1) % SQL_HINTS.length);
    }, 1200);
    return () => clearInterval(interval);
  }, [isLoading]);
  useEffect(() => {
    if (autoScroll && endRef.current) {
      setTimeout(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), 60);
    }
  }, [messages]);

  const handleScroll = (e) => {
    const el = e.currentTarget;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    const atTop = el.scrollTop === 0;

    if (atBottom) {
      setAutoScroll(true);
      setShowScrollBtn(false);
    } else {
      setAutoScroll(false);
      setShowScrollBtn(true);
    }

    if (atTop && hasMore && !isFetchingMore && messages.length > 0) {
      const prevScrollHeight = el.scrollHeight;
      onLoadMore().then(() => {
        setTimeout(() => {
          el.scrollTop = el.scrollHeight - prevScrollHeight;
        }, 50);
      });
    }
  };

  const scrollToBottom = () => {
    setAutoScroll(true);
    setShowScrollBtn(false);
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  };
  console.log('Rendering all message',messages)
  return (
    <div className="conversation" id="conversation" ref={convRef} onScroll={handleScroll}>
      <div className="thread" id="thread">
        {isMessagesLoading && (
          <div className="initial-loading">
            <div className="spinner-large" />
            <p>Loading conversation...</p>
          </div>
        )}

       
        {isFetchingMore && (
          <div className="fetching-more">
            <div className="spinner-small" />
            Loading previous messages...
          </div>
        )}

        {!isMessagesLoading && messages.map((m, i) => {
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
                  <span className="ai-name">GrepSQL AI</span>
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
                onUpdate={onUpdate}
                settings={settings}
                currentUser={currentUser}
                lmsId={lmsId}
              />
            );
          }
          return null;
        })}

        {/* AI IS THINKING (NEW QUERY) */}
        {!isMessagesLoading && isLoading && (
          <div className="message msg-ai">
            <div className="msg-ai-header">
              <div className="ai-avatar loading-avatar">◈</div>
              <span className="ai-name">GrepSQL AI</span>
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
