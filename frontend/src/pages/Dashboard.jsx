import React, { useState, useEffect, useCallback } from 'react';
import { fetchDashboardStats, fetchDashboardLogs } from '../services/api';

export default function Dashboard({ onBack }) {
  const [stats, setStats] = useState(null);
  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [selectedRow, setSelectedRow] = useState(null);

  const [filters, setFilters] = useState({
    username: '',
    feedback_type: '',
    has_error: '',
    model: '',
    lms_type: '',
    date_from: '',
    date_to: '',
  });

  const loadStats = async () => {
    const res = await fetchDashboardStats();
    if (res.ok) setStats(res.data);
  };

  const loadLogs = useCallback(async (pg = 1) => {
    setLoading(true);
    const params = { page: pg, page_size: 50, ...filters };
    const res = await fetchDashboardLogs(params);
    setLoading(false);
    if (res.ok) {
      setLogs(res.data.logs);
      setTotal(res.data.total);
      setPage(res.data.page);
      setTotalPages(res.data.total_pages);
    }
  }, [filters]);

  useEffect(() => { loadStats(); }, []);
  useEffect(() => { loadLogs(1); }, [loadLogs]);

  const handleFilterChange = (key, val) => {
    setFilters(f => ({ ...f, [key]: val }));
  };

  const handleFilterSubmit = (e) => {
    e.preventDefault();
    loadLogs(1);
  };

  return (
    <div style={styles.wrapper}>
      <div style={styles.topbar}>
        <span style={styles.title}>Dashboard</span>
        <button style={styles.backBtn} onClick={onBack}>Back to Chat</button>
      </div>

      {/* Stats cards */}
      {stats && (
        <div style={styles.cards}>
          <StatCard label="Queries (24h)" value={stats.total_queries_24h} />
          <StatCard label="Total Queries" value={stats.total_queries_all_time} />
          <StatCard label="Most Active (24h)" value={stats.most_active_user_24h || '—'} small />
          <StatCard label="Errors (24h)" value={stats.errors_24h} accent="#f87171" />
          <StatCard label="Feedback (24h)" value={stats.feedback_queries_24h} accent="#4ade80" />
        </div>
      )}

      {/* Filters */}
      <form style={styles.filters} onSubmit={handleFilterSubmit}>
        <FilterInput label="Username" value={filters.username} onChange={v => handleFilterChange('username', v)} />
        <FilterSelect label="Feedback" value={filters.feedback_type} onChange={v => handleFilterChange('feedback_type', v)}
          options={[['', 'All'], ['logic', 'Logic'], ['sql', 'SQL'], ['english', 'English'], ['any', 'Any']]} />
        <FilterSelect label="Error" value={filters.has_error} onChange={v => handleFilterChange('has_error', v)}
          options={[['', 'All'], ['yes', 'Has Error'], ['no', 'No Error']]} />
        <FilterSelect label="LMS" value={filters.lms_type} onChange={v => handleFilterChange('lms_type', v)}
          options={[['', 'All'], ['online', 'Online'], ['regular', 'Regular']]} />
        <FilterInput label="Model" value={filters.model} onChange={v => handleFilterChange('model', v)} />
        <FilterInput label="From" type="date" value={filters.date_from} onChange={v => handleFilterChange('date_from', v)} />
        <FilterInput label="To" type="date" value={filters.date_to} onChange={v => handleFilterChange('date_to', v)} />
        <button type="submit" style={styles.filterBtn}>Apply</button>
      </form>

      <p style={styles.resultCount}>{total} total results</p>

      {/* Log table */}
      {loading
        ? <p style={styles.info}>Loading...</p>
        : (
          <div style={{ overflowX: 'auto' }}>
            <table style={styles.table}>
              <thead>
                <tr>
                  {['Timestamp (IST)', 'User', 'Query', 'Model', 'LMS', 'Exec (s)', 'Error', 'Feedback'].map(h => (
                    <th key={h} style={styles.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {logs.map(row => (
                  <tr key={row.id} style={styles.tr} onClick={() => setSelectedRow(row)}>
                    <td style={styles.td}>{row.created_at_ist ? new Date(row.created_at_ist).toLocaleString('en-IN') : '—'}</td>
                    <td style={styles.td}>{row.username || '—'}</td>
                    <td style={styles.td}>{(row.user_query || '').slice(0, 60)}{(row.user_query || '').length > 60 ? '…' : ''}</td>
                    <td style={styles.td}>{(row.model || '').replace('gemini-', '')}</td>
                    <td style={styles.td}>{row.lms_type || '—'}</td>
                    <td style={styles.td}>{row.execution_time != null ? row.execution_time.toFixed(2) : '—'}</td>
                    <td style={styles.td}>{row.error_message ? <span style={styles.errorBadge}>Error</span> : '—'}</td>
                    <td style={styles.td}>{row.has_any_feedback ? <span style={styles.fbBadge}>Yes</span> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      }

      {/* Pagination */}
      <div style={styles.pagination}>
        <button style={styles.pageBtn} disabled={page <= 1} onClick={() => loadLogs(page - 1)}>Prev</button>
        <span style={{ color: '#9ca3af', fontSize: '13px' }}>Page {page} / {totalPages}</span>
        <button style={styles.pageBtn} disabled={page >= totalPages} onClick={() => loadLogs(page + 1)}>Next</button>
      </div>

      {/* Row detail drawer */}
      {selectedRow && (
        <div style={styles.drawerOverlay} onClick={() => setSelectedRow(null)}>
          <div style={styles.drawer} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <span style={{ fontSize: '15px', fontWeight: 700, color: '#e2e8f0' }}>Query Detail</span>
              <button style={styles.closeBtn} onClick={() => setSelectedRow(null)}>×</button>
            </div>
            <DrawerField label="User" value={selectedRow.username} />
            <DrawerField label="Session ID" value={selectedRow.session_id} mono />
            <DrawerField label="Chat ID" value={selectedRow.chat_id} mono />
            <DrawerField label="Model" value={selectedRow.model} />
            <DrawerField label="LMS Type" value={selectedRow.lms_type} />
            <DrawerField label="Execution Time" value={selectedRow.execution_time != null ? `${selectedRow.execution_time}s` : null} />
            <DrawerField label="Timestamp (IST)" value={selectedRow.created_at_ist ? new Date(selectedRow.created_at_ist).toLocaleString('en-IN') : null} />
            <DrawerField label="Timestamp (UTC)" value={selectedRow.created_at_utc ? new Date(selectedRow.created_at_utc).toUTCString() : null} />
            <DrawerField label="User Query" value={selectedRow.user_query} multiline />
            <DrawerField label="Generated SQL" value={selectedRow.generated_sql} multiline code />
            <DrawerField label="Answer" value={selectedRow.answer} multiline />
            {selectedRow.error_message && <DrawerField label="Error" value={selectedRow.error_message} error />}
            {selectedRow.has_logic_feedback && <DrawerField label="Logic Feedback" value={selectedRow.logic_feedback_text} multiline />}
            {selectedRow.has_sql_feedback && <DrawerField label="Corrected SQL" value={selectedRow.corrected_sql} multiline code />}
            {selectedRow.has_english_feedback && (
              <>
                <DrawerField label="English Feedback" value={selectedRow.english_feedback_text} multiline />
                <DrawerField label="Regenerated SQL" value={selectedRow.regenerated_sql} multiline code />
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, small, accent }) {
  return (
    <div style={{ background: '#1a1d27', border: '1px solid #2a2d3a', borderRadius: '10px', padding: '16px 20px', minWidth: '140px' }}>
      <div style={{ fontSize: '11px', color: '#6b7280', marginBottom: '6px', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: small ? '14px' : '26px', fontWeight: 700, color: accent || '#e2e8f0', wordBreak: 'break-all' }}>{value ?? '—'}</div>
    </div>
  );
}

function FilterInput({ label, value, onChange, type = 'text' }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <label style={{ fontSize: '11px', color: '#6b7280' }}>{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)}
        style={{ padding: '6px 10px', background: '#0f1117', border: '1px solid #2a2d3a', borderRadius: '6px', color: '#e2e8f0', fontSize: '12px', outline: 'none', width: type === 'date' ? '140px' : '140px' }} />
    </div>
  );
}

function FilterSelect({ label, value, onChange, options }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <label style={{ fontSize: '11px', color: '#6b7280' }}>{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)}
        style={{ padding: '6px 10px', background: '#0f1117', border: '1px solid #2a2d3a', borderRadius: '6px', color: '#e2e8f0', fontSize: '12px', outline: 'none' }}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  );
}

function DrawerField({ label, value, multiline, code, error, mono }) {
  if (value == null || value === '') return null;
  return (
    <div style={{ marginBottom: '12px' }}>
      <div style={{ fontSize: '11px', color: '#6b7280', marginBottom: '4px', textTransform: 'uppercase' }}>{label}</div>
      {multiline
        ? <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '12px', background: code ? '#0f1117' : 'transparent', color: error ? '#f87171' : '#d1d5db', padding: code ? '8px' : 0, borderRadius: code ? '6px' : 0, border: code ? '1px solid #2a2d3a' : 'none' }}>{value}</pre>
        : <span style={{ fontSize: '13px', color: mono ? '#a5b4fc' : '#d1d5db', fontFamily: mono ? 'monospace' : 'inherit' }}>{value}</span>
      }
    </div>
  );
}

const styles = {
  wrapper: { background: '#0f1117', minHeight: '100vh', padding: '24px', color: '#e2e8f0', fontFamily: 'system-ui, sans-serif' },
  topbar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' },
  title: { fontSize: '22px', fontWeight: 700 },
  backBtn: { background: '#374151', border: 'none', color: '#d1d5db', borderRadius: '7px', padding: '7px 14px', cursor: 'pointer', fontSize: '13px' },
  cards: { display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '24px' },
  filters: { display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end', background: '#1a1d27', border: '1px solid #2a2d3a', borderRadius: '10px', padding: '16px', marginBottom: '12px' },
  filterBtn: { padding: '7px 16px', background: '#4f46e5', border: 'none', color: '#fff', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 600, alignSelf: 'flex-end' },
  resultCount: { fontSize: '12px', color: '#6b7280', marginBottom: '8px' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { textAlign: 'left', padding: '10px 12px', fontSize: '11px', color: '#6b7280', textTransform: 'uppercase', borderBottom: '1px solid #2a2d3a', whiteSpace: 'nowrap' },
  tr: { cursor: 'pointer', borderBottom: '1px solid #1e2130' },
  td: { padding: '9px 12px', fontSize: '12px', color: '#d1d5db', verticalAlign: 'top' },
  errorBadge: { background: '#7f1d1d', color: '#fca5a5', padding: '2px 6px', borderRadius: '4px', fontSize: '11px' },
  fbBadge: { background: '#14532d', color: '#86efac', padding: '2px 6px', borderRadius: '4px', fontSize: '11px' },
  pagination: { display: 'flex', gap: '12px', alignItems: 'center', marginTop: '16px', justifyContent: 'center' },
  pageBtn: { background: '#374151', border: 'none', color: '#d1d5db', borderRadius: '6px', padding: '6px 14px', cursor: 'pointer', fontSize: '13px' },
  info: { color: '#6b7280', textAlign: 'center', padding: '32px' },
  drawerOverlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 200, display: 'flex', justifyContent: 'flex-end' },
  drawer: { background: '#1a1d27', border: '1px solid #2a2d3a', width: '480px', maxWidth: '90vw', height: '100vh', overflowY: 'auto', padding: '24px' },
  closeBtn: { background: 'none', border: '1px solid #374151', color: '#9ca3af', borderRadius: '6px', padding: '4px 10px', cursor: 'pointer', fontSize: '18px' },
};
