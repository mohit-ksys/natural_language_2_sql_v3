import React, { useState } from 'react';
import { login } from '../services/api';

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);
  const [showPw, setShowPw]   = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    const res = await login(username.trim(), password);
    setLoading(false);
    if (res.ok) {
      onLogin(res.user);
    } else {
      setError(res.error || 'Invalid credentials');
    }
  };

  return (
    <div style={s.root}>
      {/* ── Left branding panel ── */}
      <div style={s.left}>
        <div style={s.leftInner}>
          {/* Logo mark */}
          <div style={s.logoWrap}>
            <svg width="44" height="44" viewBox="0 0 44 44" fill="none">
              <rect width="44" height="44" rx="12" fill="rgba(0,255,178,0.08)" stroke="rgba(0,255,178,0.3)" strokeWidth="1.2"/>
              <path d="M10 22 Q18 10 22 22 Q26 34 34 22" stroke="#00FFB2" strokeWidth="2.2" strokeLinecap="round" fill="none"/>
              <circle cx="22" cy="22" r="3" fill="#00FFB2" opacity="0.9"/>
              <circle cx="10" cy="22" r="2" fill="#00FFB2" opacity="0.5"/>
              <circle cx="34" cy="22" r="2" fill="#00FFB2" opacity="0.5"/>
            </svg>
          </div>

          <h1 style={s.brand}>GrepSQL AI</h1>
          <p style={s.tagline}>Ask your data<br/>anything — in plain English.</p>

          <div style={s.pills}>
            {[
              ['⌁', 'Natural Language → SQL'],
              ['⟳', 'Session Memory'],
              ['◈', 'Role-based Access'],
              ['⊞', 'Multi-DB Routing'],
            ].map(([icon, label]) => (
              <div key={label} style={s.pill}>
                <span style={s.pillIcon}>{icon}</span>
                <span>{label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom version tag */}
        <span style={s.version}>v2.0 · database-migration</span>
      </div>

      {/* ── Right form panel ── */}
      <div style={s.right}>
        <div style={s.formCard}>
          <div style={s.formHeader}>
            <p style={s.formEyebrow}>Welcome back</p>
            <h2 style={s.formTitle}>Sign in to continue</h2>
          </div>

          <form onSubmit={handleSubmit} style={s.form}>
            <div style={s.field}>
              <label style={s.label}>Username</label>
              <input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                style={s.input}
                placeholder="your.email@domain.com"
                autoComplete="username"
                autoFocus
                required
              />
            </div>

            <div style={s.field}>
              <label style={s.label}>Password</label>
              <div style={s.pwWrap}>
                <input
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  style={{ ...s.input, paddingRight: '42px' }}
                  placeholder="••••••••••••"
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  style={s.eyeBtn}
                  onClick={() => setShowPw(v => !v)}
                  tabIndex={-1}
                >
                  {showPw ? '🙈' : '👁'}
                </button>
              </div>
            </div>

            {error && (
              <div style={s.errorBox}>
                <span style={s.errorDot}>●</span>
                {error}
              </div>
            )}

            <button type="submit" style={s.btn} disabled={loading}>
              {loading ? (
                <span style={s.spinnerWrap}>
                  <span style={s.spinner} />
                  Signing in…
                </span>
              ) : 'Sign In'}
            </button>
          </form>
        </div>
      </div>

      {/* Spinner keyframe via style tag */}
      <style>{`
        @keyframes dw-spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

/* ── Styles ──────────────────────────────────────────────────────────────── */
const s = {
  root: {
    display: 'flex',
    height: '100vh',
    width: '100vw',
    background: '#050505',
    fontFamily: "'Inter', sans-serif",
    overflow: 'hidden',
    position: 'relative',
  },

  /* Left */
  left: {
    width: '52%',
    background: 'linear-gradient(145deg, #060a08 0%, #050505 60%)',
    borderRight: '1px solid rgba(0,255,178,0.1)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    justifyContent: 'center',
    padding: '60px 64px',
    position: 'relative',
    overflow: 'hidden',
  },
  leftInner: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0',
  },
  logoWrap: {
    marginBottom: '20px',
  },
  brand: {
    fontSize: '48px',
    fontWeight: 800,
    letterSpacing: '-0.04em',
    lineHeight: 1,
    background: 'linear-gradient(135deg, #fff 0%, #a0b4a8 100%)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    backgroundClip: 'text',
    marginBottom: '16px',
  },
  tagline: {
    fontSize: '22px',
    color: 'rgba(255,255,255,0.45)',
    lineHeight: 1.45,
    fontWeight: 300,
    letterSpacing: '-0.01em',
    marginBottom: '44px',
  },
  pills: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  pill: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '10px',
    padding: '8px 16px',
    borderRadius: '8px',
    border: '1px solid rgba(0,255,178,0.12)',
    background: 'rgba(0,255,178,0.04)',
    color: 'rgba(255,255,255,0.55)',
    fontSize: '13px',
    width: 'fit-content',
  },
  pillIcon: {
    color: '#00FFB2',
    fontSize: '14px',
    opacity: 0.8,
  },
  version: {
    position: 'absolute',
    bottom: '28px',
    left: '64px',
    fontSize: '11px',
    color: 'rgba(255,255,255,0.18)',
    fontFamily: "'JetBrains Mono', monospace",
    letterSpacing: '0.06em',
  },

  /* Right */
  right: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '40px',
    background: '#050505',
  },
  formCard: {
    width: '100%',
    maxWidth: '380px',
    display: 'flex',
    flexDirection: 'column',
    gap: '32px',
  },
  formHeader: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  formEyebrow: {
    fontSize: '12px',
    fontWeight: 600,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: '#00FFB2',
    opacity: 0.8,
    margin: 0,
  },
  formTitle: {
    fontSize: '26px',
    fontWeight: 700,
    color: '#f8fafc',
    letterSpacing: '-0.02em',
    margin: 0,
  },

  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '18px',
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: '7px',
  },
  label: {
    fontSize: '12px',
    fontWeight: 500,
    color: 'rgba(255,255,255,0.4)',
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
  },
  input: {
    padding: '12px 14px',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '10px',
    color: '#f8fafc',
    fontSize: '14px',
    outline: 'none',
    width: '100%',
    transition: 'border-color 0.2s',
    fontFamily: "'Inter', sans-serif",
  },
  pwWrap: {
    position: 'relative',
  },
  eyeBtn: {
    position: 'absolute',
    right: '12px',
    top: '50%',
    transform: 'translateY(-50%)',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: '14px',
    padding: '2px',
    opacity: 0.5,
    lineHeight: 1,
  },

  errorBox: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '10px 14px',
    background: 'rgba(255,79,79,0.08)',
    border: '1px solid rgba(255,79,79,0.2)',
    borderRadius: '8px',
    color: '#ff6b6b',
    fontSize: '13px',
  },
  errorDot: {
    fontSize: '6px',
    color: '#ff4f4f',
    flexShrink: 0,
  },

  btn: {
    padding: '13px',
    background: 'rgba(0,255,178,0.12)',
    border: '1px solid rgba(0,255,178,0.4)',
    borderRadius: '10px',
    color: '#00FFB2',
    fontSize: '14px',
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 0.2s',
    fontFamily: "'Inter', sans-serif",
    marginTop: '4px',
    letterSpacing: '0.02em',
  },
  spinnerWrap: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
  },
  spinner: {
    display: 'inline-block',
    width: '14px',
    height: '14px',
    border: '2px solid rgba(0,255,178,0.3)',
    borderTopColor: '#00FFB2',
    borderRadius: '50%',
    animation: 'dw-spin 0.7s linear infinite',
  },
};
