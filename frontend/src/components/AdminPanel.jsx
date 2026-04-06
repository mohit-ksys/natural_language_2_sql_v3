import React, { useState, useEffect } from 'react';
import { fetchUsers, createUser, resetPassword, deactivateUser, reactivateUser } from '../services/api';

export default function AdminPanel({ onClose }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ username: '', full_name: '', role: 'admin', lms_type: 'online' });
  const [creating, setCreating] = useState(false);
  const [reveal, setReveal] = useState(null); // { username, password }
  const [search, setSearch] = useState('');

  const loadUsers = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetchUsers();
      if (res.ok) setUsers(res.data.users || []);
      else setError(res.error || 'Failed to load users');
    } catch (e) {
      setError(e.message || 'Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    setCreating(true);
    setError('');
    try {
      const payload = {
        username: form.username.trim(),
        full_name: form.full_name.trim(),
        role: form.role,
        lms_type: form.role === 'super_admin' ? null : form.lms_type,
      };
      const res = await createUser(payload);
      if (res.ok) {
        setReveal({ username: res.data.username, password: res.data.password });
        setShowCreate(false);
        setForm({ username: '', full_name: '', role: 'admin', lms_type: 'online' });
        loadUsers();
      } else {
        setError(res.error || 'Failed to create user');
      }
    } catch (e) {
      setError(e.message || 'Failed to create user');
    } finally {
      setCreating(false);
    }
  };

  const handleReset = async (username) => {
    if (!confirm(`Reset password for ${username}?`)) return;
    try {
      const res = await resetPassword(username);
      if (res.ok) setReveal({ username: res.data.username, password: res.data.new_password });
      else setError(res.error || 'Reset failed');
    } catch (e) {
      setError(e.message || 'Reset failed');
    }
  };

  const handleDeactivate = async (username) => {
    if (!confirm(`Deactivate ${username}? All active sessions will be revoked.`)) return;
    try {
      const res = await deactivateUser(username);
      if (res.ok) loadUsers();
      else setError(res.error || 'Deactivate failed');
    } catch (e) {
      setError(e.message || 'Deactivate failed');
    }
  };

  const handleReactivate = async (username) => {
    try {
      const res = await reactivateUser(username);
      if (res.ok) loadUsers();
      else setError(res.error || 'Reactivate failed');
    } catch (e) {
      setError(e.message || 'Reactivate failed');
    }
  };

  const filtered = users.filter(u =>
    u.username.toLowerCase().includes(search.toLowerCase()) ||
    u.full_name.toLowerCase().includes(search.toLowerCase())
  );

  const roleMeta = {
    super_admin: { label: 'Super Admin', color: '#a78bfa', bg: 'rgba(167,139,250,0.12)', border: 'rgba(167,139,250,0.25)' },
    admin:       { label: 'Admin',       color: '#60a5fa', bg: 'rgba(96,165,250,0.12)',  border: 'rgba(96,165,250,0.25)' },
    analyser:    { label: 'Analyser',    color: '#34d399', bg: 'rgba(52,211,153,0.12)',  border: 'rgba(52,211,153,0.25)' },
  };

  return (
    <div className="ap-overlay" onClick={onClose}>
      <div className="ap-panel" onClick={e => e.stopPropagation()}>

        {/* ── Header ── */}
        <div className="ap-header">
          <div className="ap-header-left">
            <div className="ap-header-icon">⬡</div>
            <div>
              <h2 className="ap-title">User Management</h2>
              <p className="ap-subtitle">{users.length} user{users.length !== 1 ? 's' : ''} · superadmin access</p>
            </div>
          </div>
          <div className="ap-header-right">
            <button className="ap-btn-primary" onClick={() => { setShowCreate(true); setError(''); }}>
              + Create User
            </button>
            <button className="ap-btn-close" onClick={onClose}>✕</button>
          </div>
        </div>

        {/* ── Error banner ── */}
        {error && (
          <div className="ap-error-banner">
            <span>⚠ {error}</span>
            <button onClick={() => setError('')}>✕</button>
          </div>
        )}

        {/* ── Search ── */}
        <div className="ap-search-row">
          <div className="ap-search-wrap">
            <span className="ap-search-icon">⌕</span>
            <input
              className="ap-search"
              placeholder="Search by name or email…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {search && <button className="ap-search-clear" onClick={() => setSearch('')}>✕</button>}
          </div>
          <button className="ap-btn-ghost" onClick={loadUsers} title="Refresh">⟳ Refresh</button>
        </div>

        {/* ── Table ── */}
        <div className="ap-table-wrap">
          {loading ? (
            <div className="ap-empty">
              <div className="mcq-spinner" style={{ fontSize: '22px', marginBottom: '10px', opacity: 0.5 }}>⟳</div>
              Loading users…
            </div>
          ) : error && users.length === 0 ? (
            <div className="ap-empty" style={{ color: 'var(--red)' }}>
              <div style={{ fontSize: '22px', marginBottom: '10px' }}>⚠</div>
              {error}
              <br />
              <button className="ap-btn-ghost" style={{ marginTop: '12px' }} onClick={loadUsers}>Retry</button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="ap-empty">{search ? 'No users match your search.' : 'No users found.'}</div>
          ) : (
            <table className="ap-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Role</th>
                  <th>LMS</th>
                  <th>Status</th>
                  <th>Last Login</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(u => {
                  const rm = roleMeta[u.role] || roleMeta.analyser;
                  const lastLogin = u.last_login_at_ist
                    ? new Date(u.last_login_at_ist).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                    : null;
                  return (
                    <tr key={u.id} className={u.is_active ? '' : 'ap-row-inactive'}>
                      <td className="ap-td-user">
                        <div className="ap-avatar">{u.full_name.charAt(0).toUpperCase()}</div>
                        <div className="ap-user-info">
                          <span className="ap-user-name">{u.full_name}</span>
                          <span className="ap-user-email">{u.username}</span>
                        </div>
                      </td>
                      <td>
                        <span className="ap-role-badge" style={{ color: rm.color, background: rm.bg, borderColor: rm.border }}>
                          {rm.label}
                        </span>
                      </td>
                      <td>
                        {u.lms_type ? (
                          <span className="ap-lms-badge">{u.lms_type}</span>
                        ) : (
                          <span className="ap-dash">—</span>
                        )}
                      </td>
                      <td>
                        <span className={`ap-status ${u.is_active ? 'active' : 'inactive'}`}>
                          <span className="ap-status-dot" />
                          {u.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="ap-td-login">
                        {lastLogin ? <span className="ap-login-time">{lastLogin}</span> : <span className="ap-dash">Never</span>}
                      </td>
                      <td>
                        <div className="ap-actions">
                          <button className="ap-action-btn" onClick={() => handleReset(u.username)} title="Reset password">
                            🔑 Reset PW
                          </button>
                          {u.is_active ? (
                            <button className="ap-action-btn danger" onClick={() => handleDeactivate(u.username)} title="Deactivate user">
                              ✕ Deactivate
                            </button>
                          ) : (
                            <button className="ap-action-btn success" onClick={() => handleReactivate(u.username)} title="Reactivate user">
                              ✓ Reactivate
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* ── Footer count ── */}
        {!loading && filtered.length > 0 && (
          <div className="ap-footer">
            {search ? `${filtered.length} of ${users.length} users` : `${users.length} total users`}
            &nbsp;·&nbsp;
            {users.filter(u => u.is_active).length} active
            &nbsp;·&nbsp;
            {users.filter(u => !u.is_active).length} inactive
          </div>
        )}
      </div>

      {/* ── Create User Modal ── */}
      {showCreate && (
        <div className="ap-modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="ap-modal" onClick={e => e.stopPropagation()}>
            <div className="ap-modal-header">
              <h3>Create New User</h3>
              <button className="ap-btn-close" onClick={() => setShowCreate(false)}>✕</button>
            </div>
            <form onSubmit={handleCreate} className="ap-modal-form">
              <label className="ap-label">
                Email address
                <input
                  className="ap-input"
                  type="email"
                  placeholder="user@company.com"
                  value={form.username}
                  onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                  required
                  autoFocus
                />
              </label>
              <label className="ap-label">
                Full name
                <input
                  className="ap-input"
                  type="text"
                  placeholder="Jane Smith"
                  value={form.full_name}
                  onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))}
                  required
                />
              </label>
              <div className="ap-form-row">
                <label className="ap-label">
                  Role
                  <select className="ap-input" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
                    <option value="admin">Admin</option>
                    <option value="analyser">Analyser</option>
                    <option value="super_admin">Super Admin</option>
                  </select>
                </label>
                {form.role !== 'super_admin' && (
                  <label className="ap-label">
                    LMS Type
                    <select className="ap-input" value={form.lms_type} onChange={e => setForm(f => ({ ...f, lms_type: e.target.value }))}>
                      <option value="online">Online</option>
                      <option value="regular">Regular</option>
                    </select>
                  </label>
                )}
              </div>
              <p className="ap-hint">A secure random password will be generated and shown once after creation.</p>
              <div className="ap-modal-actions">
                <button type="button" className="ap-btn-ghost" onClick={() => setShowCreate(false)}>Cancel</button>
                <button type="submit" className="ap-btn-primary" disabled={creating}>
                  {creating ? '⟳ Creating…' : 'Create User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Password Reveal Modal ── */}
      {reveal && (
        <div className="ap-modal-overlay" onClick={() => setReveal(null)}>
          <div className="ap-modal" onClick={e => e.stopPropagation()}>
            <div className="ap-modal-header">
              <h3>Password Generated</h3>
            </div>
            <div className="ap-pw-body">
              <div className="ap-pw-user">
                <div className="ap-avatar large">{reveal.username.charAt(0).toUpperCase()}</div>
                <span className="ap-user-email">{reveal.username}</span>
              </div>
              <p className="ap-hint" style={{ marginBottom: '12px' }}>
                ⚠ Copy this password now — it will not be shown again after you close this dialog.
              </p>
              <div className="ap-pw-box">
                <code className="ap-pw-code">{reveal.password}</code>
                <button
                  className="ap-btn-copy"
                  onClick={() => navigator.clipboard.writeText(reveal.password)}
                  title="Copy to clipboard"
                >
                  ⎘ Copy
                </button>
              </div>
            </div>
            <div className="ap-modal-actions" style={{ borderTop: '1px solid var(--border)' }}>
              <button className="ap-btn-primary" style={{ width: '100%' }} onClick={() => setReveal(null)}>
                Done — I've copied the password
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
