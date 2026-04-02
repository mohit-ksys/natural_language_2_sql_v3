import React, { useState } from 'react';

export default function MCQMessage({ msg, onSubmitAnswers, onSkip }) {
  const { id, query_id, questions, original_query, model, timestamp } = msg;
  const [selectedAnswers, setSelectedAnswers] = useState(
    Array(questions?.length || 3).fill(null)
  );
  const [freeTexts, setFreeTexts] = useState(
    Array(questions?.length || 3).fill('')
  );
  const [submitted, setSubmitted] = useState(false);
  const [skipping, setSkipping] = useState(false);

  const allAnswered = selectedAnswers.every((a, i) =>
    a !== null || freeTexts[i].trim() !== ''
  );

  const handleSelect = (qIdx, optIdx) => {
    if (submitted) return;
    setSelectedAnswers(prev => {
      const next = [...prev];
      next[qIdx] = optIdx;
      return next;
    });
    // Clear free text if a radio option is picked
    setFreeTexts(prev => {
      const next = [...prev];
      next[qIdx] = '';
      return next;
    });
  };

  const handleFreeTextChange = (qIdx, val) => {
    // Deselect radio when user types
    setSelectedAnswers(prev => {
      const next = [...prev];
      next[qIdx] = null;
      return next;
    });
    setFreeTexts(prev => {
      const next = [...prev];
      next[qIdx] = val;
      return next;
    });
  };

  const handleSubmit = () => {
    if (!allAnswered || submitted) return;
    setSubmitted(true);
    const finalAnswers = selectedAnswers.map((a, i) =>
      a === null ? freeTexts[i].trim() : a
    );
    onSubmitAnswers(query_id, finalAnswers);
  };

  const handleSkip = () => {
    if (submitted) return;
    setSkipping(true);
    onSkip(query_id, original_query);
  };

  const shortTime = (isoStr) => {
    if (!isoStr) return '';
    try {
      return new Date(isoStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch { return ''; }
  };

  const questionNumbers = ['\u2776', '\u2777', '\u2778']; // ❶ ❷ ❸

  return (
    <div className="message msg-ai mcq-message" data-id={id}>
      <div className="msg-ai-header">
        <div className="ai-avatar">◈</div>
        <span className="ai-name">ChatWithDB</span>
        {model && <span className="ai-model-tag">{model}</span>}
        <span className="mcq-badge">MCQ</span>
        {timestamp && <span className="msg-timestamp">{shortTime(timestamp)}</span>}
      </div>

      <div className="mcq-intro">
        I have a few questions to make sure I get this right:
      </div>

      <div className="mcq-questions">
        {(questions || []).map((q, qIdx) => (
          <div key={q.question_id} className={`mcq-question ${submitted ? 'locked' : ''}`}>
            <div className="mcq-question-header">
              <span className="mcq-number">{questionNumbers[qIdx] || `${qIdx + 1}.`}</span>
              <span className="mcq-question-text">{q.question_text}</span>
            </div>
            <div className="mcq-options">
              {(q.options || []).map((opt, optIdx) => {
                const isSelected = selectedAnswers[qIdx] === optIdx;
                return (
                  <button
                    key={opt.label}
                    className={`mcq-option ${isSelected ? 'selected' : ''} ${submitted ? 'disabled' : ''}`}
                    onClick={() => handleSelect(qIdx, optIdx)}
                    disabled={submitted}
                  >
                    <span className={`mcq-radio ${isSelected ? 'checked' : ''}`}>
                      {isSelected ? '●' : '○'}
                    </span>
                    <span className="mcq-option-label">{opt.label}.</span>
                    <span className="mcq-option-text">{opt.text}</span>
                  </button>
                );
              })}
              {/* Free text as 4th option */}
              <div className={`mcq-option mcq-option-text-wrap ${freeTexts[qIdx] ? 'selected' : ''} ${submitted ? 'disabled' : ''}`}>
                <span className={`mcq-radio ${freeTexts[qIdx] ? 'checked' : ''}`}>
                  {freeTexts[qIdx] ? '●' : '○'}
                </span>
                <span className="mcq-option-label">D.</span>
                <input
                  className="mcq-free-text-inline"
                  type="text"
                  placeholder="Other — type your own answer"
                  value={freeTexts[qIdx]}
                  onChange={e => handleFreeTextChange(qIdx, e.target.value)}
                  disabled={submitted}
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mcq-actions">
        <button
          className="mcq-skip-btn"
          onClick={handleSkip}
          disabled={submitted || skipping}
        >
          {skipping ? '⟳ Generating...' : 'Skip MCQs'}
        </button>
        <button
          className={`mcq-submit-btn ${allAnswered && !submitted ? 'ready' : ''}`}
          onClick={handleSubmit}
          disabled={!allAnswered || submitted}
        >
          {submitted ? '⟳ Generating SQL...' : 'Generate SQL with answers →'}
        </button>
      </div>
    </div>
  );
}
