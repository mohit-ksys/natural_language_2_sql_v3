import React, { useState } from 'react';

const MCQMessage = React.memo(({ id, msg, onUpdate, onSubmitAnswers, onSkip, settings }) => {
  console.log('[MCQ] Rendering message:', id, msg);
  const { query_id, questions, original_query, model, timestamp } = msg;
  const totalQ = questions?.length || 0;

  // answers[i] = { type: 'option', value: optIdx } | { type: 'text', value: string } | null (skipped)
  const [answers, setAnswers] = useState(Array(totalQ).fill(null));
  const [freeTexts, setFreeTexts] = useState(Array(totalQ).fill(''));
  const [currentIdx, setCurrentIdx] = useState(0);
  const [submitted, setSubmitted] = useState(false);
  const [skippingAll, setSkippingAll] = useState(false);

  const q = questions?.[currentIdx];
  const isLast = currentIdx === totalQ - 1;
  const currentAnswer = answers[currentIdx];
  const currentFree = freeTexts[currentIdx];
  const hasAnswerForCurrent = currentAnswer !== null || currentFree.trim() !== '';

  const handleSelectOption = (optIdx) => {
    if (submitted) return;
    setAnswers(prev => {
      const next = [...prev];
      next[currentIdx] = { type: 'option', value: optIdx };
      return next;
    });
    setFreeTexts(prev => { const next = [...prev]; next[currentIdx] = ''; return next; });
  };

  const handleFreeText = (val) => {
    if (submitted) return;
    setFreeTexts(prev => { const next = [...prev]; next[currentIdx] = val; return next; });
    if (val.trim()) {
      setAnswers(prev => { const next = [...prev]; next[currentIdx] = { type: 'text', value: val }; return next; });
    } else {
      setAnswers(prev => { const next = [...prev]; next[currentIdx] = null; return next; });
    }
  };

  const handleSkipThis = () => {
    if (submitted) return;
    // Mark as explicitly skipped (keep null) and advance
    if (isLast) handleGenerate();
    else setCurrentIdx(i => i + 1);
  };

  const handleNext = () => {
    if (submitted) return;
    if (isLast) handleGenerate();
    else setCurrentIdx(i => i + 1);
  };

  const handlePrev = () => {
    if (currentIdx > 0) setCurrentIdx(i => i - 1);
  };

  const handleGenerate = () => {
    if (submitted || msg.loading) return;
    setSubmitted(true);
    // Build final answers — null stays null for skipped questions
    const finalAnswers = answers.map((a, i) => {
      if (a === null) return ''; // skipped — send empty string, backend accepts str
      if (a.type === 'option') return a.value; // integer index
      return freeTexts[i].trim() || ''; // free text
    });
    onSubmitAnswers(query_id, finalAnswers);
  };

  const handleSkipAll = () => {
    if (submitted || msg.loading) return;
    setSkippingAll(true);
    onSkip(query_id, original_query);
  };

  const shortTime = (isoStr) => {
    if (!isoStr) return '';
    try { return new Date(isoStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
    catch { return ''; }
  };

  const questionNumbers = ['\u2776', '\u2777', '\u2778', '\u2779', '\u277a'];

  const answeredCount = answers.filter((a, i) => a !== null || freeTexts[i].trim() !== '').length;

  const showLoading = submitted || msg.loading;

  return (
    <div className="message msg-ai mcq-message" data-id={id}>
      <div className="msg-ai-header">
        <div className="ai-avatar">◈</div>
        <span className="ai-name">GrepSQL AI</span>
        {model && <span className="ai-model-tag">{model}</span>}
        <span className="mcq-badge">MCQ</span>
        {timestamp && <span className="msg-timestamp">{shortTime(timestamp)}</span>}
      </div>

      <div className="mcq-intro">
        To give you the best SQL, I have a few quick questions. Answer what you can — skip anything that doesn't apply.
      </div>

      {/* Progress dots */}
      {!showLoading && (
        <div className="mcq-progress">
          {(questions || []).map((_, i) => {
            const hasAns = answers[i] !== null || freeTexts[i].trim() !== '';
            return (
              <button
                key={i}
                className={`mcq-dot ${i === currentIdx ? 'active' : ''} ${hasAns ? 'answered' : ''}`}
                onClick={() => !showLoading && setCurrentIdx(i)}
                title={`Question ${i + 1}`}
              />
            );
          })}
          <span className="mcq-progress-label">
            {answeredCount}/{totalQ} answered
          </span>
        </div>
      )}

      {/* Single question card */}
      {!showLoading && q && (
        <div className="mcq-card">
          <div className="mcq-question-header">
            <span className="mcq-number">{questionNumbers[currentIdx] || `${currentIdx + 1}.`}</span>
            <span className="mcq-question-text">{q.question_text}</span>
          </div>
          <div className="mcq-options">
            {(q.options || []).map((opt, optIdx) => {
              const isSelected = answers[currentIdx]?.type === 'option' && answers[currentIdx]?.value === optIdx;
              return (
                <button
                  key={opt.label}
                  className={`mcq-option ${isSelected ? 'selected' : ''}`}
                  onClick={() => handleSelectOption(optIdx)}
                >
                  <span className={`mcq-radio ${isSelected ? 'checked' : ''}`}>{isSelected ? '●' : '○'}</span>
                  <span className="mcq-option-label">{opt.label}.</span>
                  <span className="mcq-option-text">{opt.text}</span>
                </button>
              );
            })}

            {/* Other / free text */}
            <div className={`mcq-option mcq-option-text-wrap ${currentFree.trim() ? 'selected' : ''}`}>
              <span className={`mcq-radio ${currentFree.trim() ? 'checked' : ''}`}>{currentFree.trim() ? '●' : '○'}</span>
              <span className="mcq-option-label">D.</span>
              <input
                className="mcq-free-text-inline"
                type="text"
                placeholder="Other — type your own answer"
                value={currentFree}
                onChange={e => handleFreeText(e.target.value)}
              />
            </div>
          </div>

          <div className="mcq-card-actions">
            <button
              className="mcq-prev-btn"
              onClick={handlePrev}
              disabled={currentIdx === 0}
            >
              ← Back
            </button>
            <button className="mcq-skip-this-btn" onClick={handleSkipThis}>
              {isLast ? 'Skip & Generate →' : 'Skip this →'}
            </button>
            <button
              className={`mcq-next-btn ${hasAnswerForCurrent ? 'ready' : ''}`}
              onClick={handleNext}
            >
              {isLast ? 'Generate SQL →' : 'Next →'}
            </button>
          </div>
        </div>
      )}

      {showLoading && (
        <div className="mcq-submitted-state">
          <span className="mcq-spinner">⟳</span> Generating SQL with your answers...
        </div>
      )}

      {/* Bottom actions */}
      {!showLoading && (
        <div className="mcq-actions">
          <button
            className="mcq-skip-btn"
            onClick={handleSkipAll}
            disabled={skippingAll}
          >
            {skippingAll ? '⟳ Generating...' : 'Skip all MCQs'}
          </button>
          <button
            className="mcq-submit-btn ready"
            onClick={handleGenerate}
          >
            Generate SQL now ({answeredCount}/{totalQ} answered)
          </button>
        </div>
      )}
    </div>
  );
});

export default MCQMessage;
