import React from 'react';

export default function Hero({ isHidden, onSendChip }) {
  const chips = [
    { icon: '👥', text: 'How many students are enrolled?' },
    { icon: '🏆', text: 'Show me the top 10 counsellors by leads' },
    { icon: '📈', text: 'What is the lead conversion rate this month?' },
    { icon: '🔔', text: 'List students with pending follow-ups' },
    { icon: '📊', text: 'Compare intake trends over last 6 months' },
    { icon: '🎓', text: 'Which universities have the most applicants?' },
  ];

  return (
    <div className={`hero ${isHidden ? 'hidden' : ''}`} id="hero">
      <div className="hero-badge">◈ Text-to-SQL</div>
      <h1 className="hero-title">
        Data<span className="accent">Whisper</span>
      </h1>
      <p className="hero-sub">Ask · Whisper · Query</p>

      <div className="hero-chips">
        {chips.map(({ icon, text }) => (
          <div
            key={text}
            className="chip"
            onClick={() => onSendChip(text)}
          >
            <span className="chip-icon">{icon}</span>
            {text}
          </div>
        ))}
      </div>
    </div>
  );
}
