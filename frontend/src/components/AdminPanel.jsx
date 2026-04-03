import React, { useState, useEffect } from 'react';
import { fetchUsers, createUser, resetPassword, deactivateUser, reactivateUser } from '../services/api';

export default function AdminPanel({ onClose }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Create user form
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ username: '', full_name: '', role: 'admin', lms_type: 'online' });
  const [creating, setCreating] = useState(false);

  // Password reveal modal
  const [reveal, setReveal] = useState(null); // { username, password }

  const loadUsers = async () => {
    setLoading(true);
    const res = await fetchUsers();
    setLoading(false);
    if (res.ok) setUsers(res.data.users);
    else setError(res.error);
  };

  useEffect(() => { loadUsers(); }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    setCreating(true);
    const payload = {
      username: form.username.trim(),
      full_name: form.full_name.trim(),
      role: form.role,
      lms_type: form.role === 'super_admin' ? null : form.lms_type,
    };
    const res = await createUser(payload);
    setCreating(false);
    if (res.ok) {
      setReveal({ username: res.data.username, password: res.data.password });
      setShowCreate(false);
      setForm({ username: '', full_name: '', role: 'admin', lms_type: 'online' });
      loadUsers();
    } else {
      alert(`Error: ${res.error}`);
    }
  };

  const handleReset = async (username) => {
    if (!confirm(`Reset password for ${username}?`)) return;
    const res = await resetPassword(username);
    if (res.ok) setReveal({ username: res.data.username, password: res.data.new_password });
    else alert(`Error: ${res.error}`);
  };

  const handleDeactivate = async (username) => {
    if (!confirm(`Deactivate ${username}? All their sessions will be revoked.`)) return;
    const res = await deactivateUser(username);
    if (res.ok) loadUsers();
    else alert(`Error: ${res.error}`);
  };

  const handleReactivate = async (username) => {
    const res = await reactivateUser(username);
    if (res.ok) loadUsers();
    else alert(`Error: ${res.error}`);
  };

  return (
    <div style={styles.overlay}>
      <div style={styles.panel}>
        <div style={styles.header}>
          <span style={styles.headerTitle}>User Management</span>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button style={styles.btnCreate} onClick={() => setShowCreate(true)}>+ Create User</button>
            <button style={styles.btnClose} onClick={onClose}>×</button>
          </div>
        </div>

        {loading && <p style={styles.info}>Loading users...</p>}
        {error && <p style={styles.errorText}>{error}</p>}

        {!loading && (
          <table style={styles.table}>
            <thead>
              <tr>
                {['Username', 'Full Name', 'Role', 'LMS', 'Status', 'Last Login', 'Actions'].map(h => (
                  <th key={h} style={styles.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id} style={{ borderBottom: '1px solid #2a2d3a' }}>
                  <td style={styles.td}>{u.username}</td>
                  <td style={styles.td}>{u.full_name}</td>
                  <td style={styles.td}><span style={roleStyle(u.role)}>{u.role}</span></td>
                  <td style={styles.td}>{u.lms_type || '—'}</td>
                  <td style={styles.td}>
                    <span style={{ color: u.is_active ? '#4ade80' : '#f87171', fontSize: '12px' }}>
                      {u.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td style={styles.td}>{u.last_login_at_ist ? new Date(u.last_login_at_ist).toLocaleString('en-IN') : '—'}</td>
                  <td style={styles.td}>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button style={styles.btnSm} onClick={() => handleReset(u.username)}>Reset PW</button>
                      {u.is_active
                        ? <button style={{ ...styles.btnSm, background: '#7f1d1d' }} onClick={() => handleDeactivate(u.username)}>Deactivate</button>
                        : <button style={{ ...styles.btnSm, background: '#14532d' }} onClick={() => handleReactivate(u.username)}>Reactivate</button>
                      }
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Create user form modal */}
      {showCreate && (
        <div style={styles.modal}>
          <div style={styles.modalBox}>
            <h3 style={styles.modalTitle}>Create User</h3>
            <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <input style={styles.input} placeholder="Username (email)" value={form.username}
                onChange={e => setForm(f => ({ ...f, username: e.target.value }))} required />
              <input style={styles.input} placeholder="Full Name" value={form.full_name}
                onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} required />
              <select style={styles.input} value={form.role}
                onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
                <option value="admin">admin</option>
                <option value="analyser">analyser</option>
                <option value="super_admin">super_admin</option>
              </select>
              {form.role !== 'super_admin' && (
                <select style={styles.input} value={form.lms_type}
                  onChange={e => setForm(f => ({ ...f, lms_type: e.target.value }))}>
                  <option value="online">online</option>
                  <option value="regular">regular</option>
                </select>
              )}
              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                <button type="button" style={styles.btnCancel} onClick={() => setShowCreate(false)}>Cancel</button>
                <button type="submit" style={styles.btnPrimary} disabled={creating}>{creating ? 'Creating...' : 'Create'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Password reveal modal */}
      {reveal && (
        <div style={styles.modal}>
          <div style={styles.modalBox}>
            <h3 style={styles.modalTitle}>Password for {reveal.username}</h3>
            <p style={{ color: '#9ca3af', fontSize: '13px', marginBottom: '8px' }}>
              Copy this password — it won&apos;t be shown again.
            </p>
            <div style={styles.pwBox}>
              <code style={{ color: '#e2e8f0', fontSize: '16px' }}>{reveal.password}</code>
              <button style={styles.btnSm} onClick={() => { navigator.clipboard.writeText(reveal.password); }}>Copy</button>
            </div>
            <button style={{ ...styles.btnPrimary, marginTop: '16px', width: '100%' }} onClick={() => setReveal(null)}>Done</button>
          </div>
        </div>
      )}
    </div>
  );
}

function roleStyle(role) {
  const colors = { super_admin: '#7c3aed', admin: '#2563eb', analyser: '#0891b2' };
  return {
    background: colors[role] || '#374151',
    color: '#fff',
    padding: '2px 8px',
    borderRadius: '4px',
    fontSize: '11px',
    fontWeight: 600,
  };
}

const styles = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  panel: { background: '#1a1d27', borderRadius: '12px', border: '1px solid #2a2d3a', width: '90vw', maxWidth: '1100px', maxHeight: '85vh', overflow: 'auto', padding: '24px' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' },
  headerTitle: { fontSize: '18px', fontWeight: 700, color: '#e2e8f0' },
  btnClose: { background: 'none', border: '1px solid #374151', color: '#9ca3af', borderRadius: '6px', padding: '4px 10px', cursor: 'pointer', fontSize: '18px' },
  btnCreate: { background: '#4f46e5', border: 'none', color: '#fff', borderRadius: '6px', padding: '6px 14px', cursor: 'pointer', fontSize: '13px', fontWeight: 600 },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { textAlign: 'left', padding: '10px 12px', fontSize: '11px', color: '#6b7280', textTransform: 'uppercase', borderBottom: '1px solid #2a2d3a' },
  td: { padding: '10px 12px', fontSize: '13px', color: '#d1d5db', verticalAlign: 'middle' },
  btnSm: { background: '#374151', border: 'none', color: '#d1d5db', borderRadius: '4px', padding: '4px 8px', cursor: 'pointer', fontSize: '11px', fontWeight: 500 },
  info: { color: '#6b7280', textAlign: 'center' },
  errorText: { color: '#f87171', textAlign: 'center' },
  modal: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  modalBox: { background: '#1a1d27', border: '1px solid #2a2d3a', borderRadius: '10px', padding: '28px', width: '380px' },
  modalTitle: { margin: '0 0 16px', fontSize: '16px', color: '#e2e8f0', fontWeight: 700 },
  input: { padding: '9px 12px', background: '#0f1117', border: '1px solid #2a2d3a', borderRadius: '7px', color: '#e2e8f0', fontSize: '13px', outline: 'none' },
  btnPrimary: { background: '#4f46e5', border: 'none', color: '#fff', borderRadius: '7px', padding: '8px 16px', cursor: 'pointer', fontSize: '13px', fontWeight: 600 },
  btnCancel: { background: '#374151', border: 'none', color: '#d1d5db', borderRadius: '7px', padding: '8px 16px', cursor: 'pointer', fontSize: '13px' },
  pwBox: { display: 'flex', alignItems: 'center', gap: '12px', background: '#0f1117', border: '1px solid #2a2d3a', borderRadius: '8px', padding: '12px 16px' },
};
