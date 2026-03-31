import React, { useState, useEffect, useRef } from 'react';

export default function InputDock({ onSendMessage, model, setModel, thinkOn, setThinkOn, chatStarted }) {
  const [inputVal, setInputVal] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const textareaRef = useRef(null);
  const dockRef = useRef(null);

  const models = [
    { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro', sub: 'Most capable', color: '#4285f4', bg: 'rgba(66,133,244,.1)' },
    { id: 'gemini-3.1-flash-lite-preview', name: 'Gemini 3.1 Flash Lite', sub: 'Fast & efficient', color: '#34a853', bg: 'rgba(52,168,83,.1)' },
    { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash', sub: 'Legacy', color: '#ea8224', bg: 'rgba(234,130,36,.1)' }
  ];

  useEffect(() => {
    function handleClickOutside(event) {
      if (dockRef.current && !dockRef.current.contains(event.target)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [dockRef]);

  const handleInput = (e) => {
    setInputVal(e.target.value);
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 160) + 'px';
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSend = () => {
    const v = inputVal.trim();
    if (!v) return;
    onSendMessage(v);
    setInputVal('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  return (
    <div className={`input-dock ${chatStarted ? 'dock-compact' : ''}`}>
      <div className="input-container">
        <div className={`input-console ${isFocused ? 'focused' : ''} ${chatStarted ? 'compact' : ''}`}>
          <div className="input-row">
            <div className="textarea-wrap">
              <textarea 
                className="input-textarea"
                ref={textareaRef}
                value={inputVal}
                placeholder="Ask your database anything..."
                rows={1}
                onChange={handleInput}
                onKeyDown={handleKeyDown}
                onFocus={() => setIsFocused(true)}
                onBlur={() => setIsFocused(false)}
              />
            </div>
            <div className="input-actions">
              <div className="model-pill" ref={dockRef}>
                <button
                  className={`model-pill-btn ${dropdownOpen ? 'open' : ''}`}
                  onClick={() => setDropdownOpen(!dropdownOpen)}
                >
                  <span className="model-dot" style={{ background: models.find(m => m.id === model)?.color || 'var(--green)', boxShadow: `0 0 5px ${models.find(m => m.id === model)?.color || 'var(--green)'}` }}></span>
                  <span>{models.find(m => m.id === model)?.name || model}</span>
                  <span className="model-chevron">▾</span>
                </button>
                
                {dropdownOpen && (
                  <div className="model-dropdown">
                    <div className="dd-label">Model</div>
                    {models.map(m => (
                      <div 
                        key={m.id} 
                        className={`model-opt ${model === m.id ? 'selected' : ''}`}
                        onClick={() => { setModel(m.id); setDropdownOpen(false); }}
                      >
                        <div className="model-ico" style={{ background: m.bg, color: m.color }}>●</div>
                        <div>
                          <div className="model-opt-name">{m.name}</div>
                          <div className="model-opt-sub">{m.sub}</div>
                        </div>
                        {model === m.id && <span className="model-chk">✓</span>}
                      </div>
                    ))}
                    
                    <div className="dd-divider"></div>
                    
                    <div className="think-toggle" onClick={() => setThinkOn(!thinkOn)}>
                      <div className="toggle-info">
                        <div className="toggle-name">Extended Thinking</div>
                        <div className="toggle-sub">Show reasoning steps</div>
                      </div>
                      <div className={`toggle-sw ${thinkOn ? 'on' : ''}`}>
                        <div className="toggle-knob"></div>
                      </div>
                    </div>
                  </div>
                )}

              </div>
              <button className="send-btn" onClick={handleSend}>
                <span className="send-icon">↑</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
