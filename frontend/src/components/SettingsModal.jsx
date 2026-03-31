import React, { useState } from 'react';

export default function SettingsModal({ isOpen, onClose, settings, setSettings, backendStatus = 'disconnected' }) {
  if (!isOpen) return null;

  const [testing, setTesting] = useState(false);

  const handleTestConnection = () => {
    setTesting(true);
    setTimeout(() => {
      setTesting(false);
      setSettings(prev => ({ ...prev, datahubConnected: true }));
    }, 1500);
  };

  const handleToggle = (key) => {
    setSettings(prev => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>DataWhisper Settings</h2>
          <button className="modal-close-btn" onClick={onClose}>✕</button>
        </div>
        
        <div className="modal-body">
          <div className="settings-section">
            <h3>System Status</h3>
            <div className="connection-box">
              <div className="connection-status">
                <div className={`status-dot ${backendStatus === 'connected' ? 'connected' : ''}`}></div>
                <span>{backendStatus === 'connected' ? '✅ Backend Connected' : '❌ Backend Offline'}</span>
              </div>
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
              <div className={`switch-mod ${settings.autoRunQuery ? 'on' : ''}`}>
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
              <div className={`switch-mod ${settings.hideQuery ? 'on' : ''}`}>
                <div className="knob-mod"></div>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
