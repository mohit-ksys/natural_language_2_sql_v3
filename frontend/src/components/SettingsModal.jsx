import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import { checkHealth } from '../services/api';

export default function SettingsModal({ isOpen, onClose, settings, setSettings, backendStatus = 'disconnected' }) {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await checkHealth();
      setTestResult(res.ok ? 'connected' : 'failed');
      setSettings(prev => ({ ...prev, datahubConnected: res.ok }));
    } catch {
      setTestResult('failed');
    } finally {
      setTesting(false);
    }
  };

  const handleToggle = (key) => {
    setSettings(prev => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="ChatWithDB Settings">
        <div className="modal-header">
          <h2>ChatWithDB Settings</h2>
          <button className="modal-close-btn" onClick={onClose} aria-label="Close settings">✕</button>
        </div>

        <div className="modal-body">
          <div className="settings-section">
            <h3>System Status</h3>
            <div className="connection-box">
              <div className="connection-status">
                <div className={`status-dot ${backendStatus === 'connected' ? 'connected' : ''}`}></div>
                <span>{backendStatus === 'connected' ? '✅ Backend Connected' : '❌ Backend Offline'}</span>
              </div>
              <button
                className={`test-btn ${testing ? 'testing' : ''} ${testResult === 'connected' ? 'connected' : testResult === 'failed' ? 'failed' : ''}`}
                onClick={handleTestConnection}
                disabled={testing}
              >
                {testing ? '⟳ Testing...' : testResult === 'connected' ? '✓ Connected' : testResult === 'failed' ? '✕ Failed' : 'Test Connection'}
              </button>
            </div>
          </div>

          <div className="settings-section">
            <h3>Database Connection</h3>
            <p className="settings-desc">Connected via DATABASE_URL in your .env file</p>
            <div className="connection-box">
              <div className="connection-status">
                <div className={`status-dot ${backendStatus === 'connected' ? 'connected' : 'disconnected'}`}></div>
                <span>{backendStatus === 'connected' ? 'Database: Active' : 'Database: Checking...'}</span>
              </div>
            </div>
          </div>

          <div className="settings-section">
            <h3>Automation</h3>
            <div className="toggle-row" onClick={() => handleToggle('autoRunQuery')}>
              <div className="toggle-info">
                <h4>Auto-run generated queries</h4>
                <p>Execute SQL immediately after AI generates it</p>
              </div>
              <div className={`switch-mod ${settings.autoRunQuery ? 'on' : ''}`} role="switch" aria-checked={settings.autoRunQuery}>
                <div className="knob-mod"></div>
              </div>
            </div>
          </div>

          <div className="settings-section">
            <h3>Interface</h3>
            <div className="toggle-row" onClick={() => handleToggle('hideQuery')}>
              <div className="toggle-info">
                <h4>Hide raw SQL query</h4>
                <p>Only show the English explanation & results</p>
              </div>
              <div className={`switch-mod ${settings.hideQuery ? 'on' : ''}`} role="switch" aria-checked={settings.hideQuery}>
                <div className="knob-mod"></div>
              </div>
            </div>
            <div className="toggle-row" onClick={() => handleToggle('mcqEnabled')}>
              <div className="toggle-info">
                <h4>MCQ clarification</h4>
                <p>Ask clarifying questions before generating SQL</p>
              </div>
              <div className={`switch-mod ${settings.mcqEnabled ? 'on' : ''}`} role="switch" aria-checked={settings.mcqEnabled}>
                <div className="knob-mod"></div>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

SettingsModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  settings: PropTypes.object.isRequired,
  setSettings: PropTypes.func.isRequired,
  backendStatus: PropTypes.string,
};
