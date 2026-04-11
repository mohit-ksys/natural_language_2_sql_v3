import React, { useState, useEffect, useCallback } from 'react';
import { fetchDashboardStats, fetchDashboardLogs, fetchLMSTargets } from '../services/api';

export default function Dashboard({ onBack, lmsId }) {
  const [stats, setStats] = useState(null);
  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [selectedRow, setSelectedRow] = useState(null);
  const [lmsTargets, setLmsTargets] = useState([]);

  const initialFilters = {
    username: '',
    feedback_type: '',
    has_error: '',
    model: '',
    lms_type: '',
    lms_id: '',
    date_from: '',
    date_to: '',
  };

  const [filters, setFilters] = useState(initialFilters);

  const loadStats = async (pg=1) => {
    const params = { page: pg, page_size: 10, ...filters };
    const res = await fetchDashboardStats(params);
    if (res.ok) setStats(res.data);
  };

  const loadLogs = useCallback(async (pg = 1) => {
    setLoading(true);
    const params = { page: pg, page_size: 10, ...filters };
    const res = await fetchDashboardLogs(params);
    setLoading(false);
    if (res.ok) {
      setLogs(res.data.logs);
      setTotal(res.data.total);
      setPage(res.data.page);
      setTotalPages(res.data.total_pages);
    }
  }, [filters]);

  useEffect(() => { loadStats(); }, [loadLogs]);
  useEffect(() => { loadLogs(1); }, [loadLogs]);

  useEffect(() => {
    const fetchTargets = async () => {
      const res = await fetchLMSTargets();
      if (res.ok) setLmsTargets(res.data);
    };
    fetchTargets();
  }, []);

  const handleFilterChange = (key, val) => {
    setFilters(f => ({ ...f, [key]: val }));
  };

  const handleFilterSubmit = (e) => {
    e.preventDefault();
    loadLogs(1);
  };

  const handleClearFilters = () => {
    setFilters(initialFilters);
  };

  return (
    <div style={styles.container}>
      <div style={styles.topbar}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={styles.dashboardIcon}>📊</div>
          <span style={styles.title}>System Dashboard</span>
        </div>
        <button style={styles.backBtn} onClick={onBack}>Back to Chat</button>
      </div>

      {/* Stats cards */}
      {stats && (
        <>
          <div style={styles.cards}>
            <StatCard label="Queries (24h)" value={stats.total_queries_24h} />
            <StatCard label="Total Queries" value={stats.total_queries_all_time} />
            <StatCard label="Most Active (24h)" value={stats.most_active_user_24h || '—'} small />
            <StatCard label="Errors (24h)" value={stats.errors_24h} accent="#f87171" />
            <StatCard label="Feedback (24h)" value={stats.feedback_queries_24h} accent="#4ade80" />
          </div>
          
          <div style={{ ...styles.cards, marginTop: '12px' }}>
            <StatCard label="Tokens (24h)" value={`${(stats.tokens_24h?.total / 1000).toFixed(1)}k`} 
              sub={`${(stats.tokens_24h?.input / 1000).toFixed(1)}k in / ${(stats.tokens_24h?.output / 1000).toFixed(1)}k out`} />
            <StatCard label="Cost (24h)" value={`$${stats.tokens_24h?.cost_total.toFixed(4)}`} accent="#fbbf24"
              sub={`$${stats.tokens_24h?.cost_input.toFixed(4)} in / $${stats.tokens_24h?.cost_output.toFixed(4)} out`} />
            <StatCard label="Total Tokens" value={`${(stats.tokens_all_time?.total / 1000000).toFixed(2)}M`} />
            <StatCard label="Total Cost" value={`$${stats.tokens_all_time?.cost_total.toFixed(2)}`} accent="#fbbf24" />
          </div>
        </>
      )}

      {/* Filters */}
      <form style={styles.filters} onSubmit={handleFilterSubmit}>
        <FilterInput label="Username" value={filters.username} onChange={v => handleFilterChange('username', v)} />
        <FilterSelect label="Feedback" value={filters.feedback_type} onChange={v => handleFilterChange('feedback_type', v)}
          options={[['', 'All'], ['logic', 'Logic'], ['sql', 'SQL'], ['english', 'English'], ['any', 'Any']]} />
        <FilterSelect label="Error" value={filters.has_error} onChange={v => handleFilterChange('has_error', v)}
          options={[['', 'All'], ['yes', 'Has Error'], ['no', 'No Error']]} />
        <FilterSelect label="LMS Type" value={filters.lms_type} onChange={v => handleFilterChange('lms_type', v)}
          options={[['', 'All'], ['online', 'Online'], ['regular', 'Regular']]} />
        <FilterSelect label="Target LMS" value={filters.lms_id} onChange={v => handleFilterChange('lms_id', v)}
          options={[['', 'All'], ...lmsTargets.map(t => [t.id, t.lms_name])]} />
        <FilterInput label="Model" value={filters.model} onChange={v => handleFilterChange('model', v)} />
        <FilterInput label="From" type="date" value={filters.date_from} onChange={v => handleFilterChange('date_from', v)} />
        <FilterInput label="To" type="date" value={filters.date_to} onChange={v => handleFilterChange('date_to', v)} />
        <div style={{ display: 'flex', gap: '8px' }}>
          <button type="submit" style={styles.filterBtn}>Apply</button>
          <button type="button" style={styles.clearBtn} onClick={handleClearFilters}>Clear</button>
        </div>
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
                  {['Timestamp (IST)', 'User', 'Query', 'Model', 'LMS', 'Exec (s)', 'Cost ($)', 'Error', 'Feedback'].map(h => (
                    <th key={h} style={styles.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {logs.map(row => (
                  <tr key={row.id} style={styles.tr} onClick={() => setSelectedRow(row)}>
<td style={styles.td}>
  {row.created_at_ist 
    ? new Date(row.created_at_ist.replace(' ', 'T')).toLocaleString('en-IN', {
        timeZone: 'UTC'
      })
    : '—'}
</td>
                  <td style={styles.td}>{row.username || '—'}</td>
                    <td style={styles.td}>{(row.user_query || '').slice(0, 60)}{(row.user_query || '').length > 60 ? '…' : ''}</td>
                    <td style={styles.td}>{(row.model || '').replace('gemini-', '')}</td>
                    <td style={styles.td}>{row.lms_type || '—'}</td>
                    <td style={styles.td}>{row.execution_time != null ? row.execution_time.toFixed(2) : '—'}</td>
                    <td style={{ ...styles.td, color: '#fbbf24', fontFamily: 'monospace' }}>
                      {row.total_cost != null ? `$${row.total_cost.toFixed(5)}` : '—'}
                    </td>
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
            <DrawerField label="Timestamp (IST)" value={selectedRow.created_at_ist ? new Date(selectedRow.created_at_ist.replace(' ', 'T')).toLocaleString('en-IN', {
                timeZone: 'UTC'
              }) : null} />
            <DrawerField label="Timestamp (UTC)" value={selectedRow.created_at_utc ? new Date(selectedRow.created_at_utc).toUTCString() : null} />
            <DrawerField label="User Query" value={selectedRow.user_query} multiline />
            
            <div style={{ padding: '12px', background: 'rgba(251, 191, 36, 0.05)', borderRadius: '8px', border: '1px solid rgba(251, 191, 36, 0.1)', marginBottom: '16px' }}>
              <div style={{ fontSize: '11px', color: '#fbbf24', marginBottom: '8px', textTransform: 'uppercase', fontWeight: 600 }}>Token Usage & Cost</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <DrawerField label="In Tokens" value={selectedRow.token_usage?.input_tokens} mono />
                <DrawerField label="In Cost" value={selectedRow.input_token_cost != null ? `$${selectedRow.input_token_cost.toFixed(6)}` : null} mono />
                <DrawerField label="Out Tokens" value={selectedRow.token_usage?.output_tokens} mono />
                <DrawerField label="Out Cost" value={selectedRow.output_token_cost != null ? `$${selectedRow.output_token_cost.toFixed(6)}` : null} mono />
                <div style={{ gridColumn: 'span 2', height: '1px', background: 'rgba(251, 191, 36, 0.1)', margin: '4px 0' }} />
                <DrawerField label="Total Cost" value={selectedRow.total_cost != null ? `$${selectedRow.total_cost.toFixed(5)}` : null} mono />
              </div>
            </div>

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

function StatCard({ label, value, small, accent, sub }) {
  return (
    <div style={{ background: '#0a0a0a', border: '1px solid #1a1a1a', borderRadius: '12px', padding: '16px 20px', minWidth: '160px', flex: 1 }}>
      <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ fontSize: small ? '14px' : '24px', fontWeight: 700, color: accent || '#e2e8f0', wordBreak: 'break-all', lineHeight: 1.2 }}>{value ?? '—'}</div>
      {sub && <div style={{ fontSize: '10px', color: '#64748b', marginTop: '4px' }}>{sub}</div>}
    </div>
  );
}

function FilterInput({ label, value, onChange, type = 'text' }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <label style={{ fontSize: '11px', color: '#64748b' }}>{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)}
        style={{ 
          padding: '8px 12px', 
          background: '#050505', 
          border: '1px solid #1a1a1a', 
          borderRadius: '8px', 
          color: '#e2e8f0', 
          fontSize: '13px', 
          outline: 'none', 
          width: '140px',
          colorScheme: 'dark',
          cursor: 'pointer'
        }} />
    </div>
  );
}

function FilterSelect({ label, value, onChange, options }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <label style={{ fontSize: '11px', color: '#64748b' }}>{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)}
        style={{ padding: '8px 12px', background: '#050505', border: '1px solid #1a1a1a', borderRadius: '8px', color: '#e2e8f0', fontSize: '13px', outline: 'none', appearance: 'none', cursor: 'pointer' }}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  );
}

function DrawerField({ label, value, multiline, code, error, mono }) {
  if (value == null || value === '') return null;
  return (
    <div style={{ marginBottom: '16px' }}>
      <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      {multiline
        ? <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '12px', background: code ? '#000' : 'transparent', color: error ? '#f87171' : '#cbd5e1', padding: code ? '12px' : 0, borderRadius: code ? '8px' : 0, border: code ? '1px solid #1a1a1a' : 'none', lineHeight: 1.6 }}>{value}</pre>
        : <span style={{ fontSize: '14px', color: mono ? '#818cf8' : '#cbd5e1', fontFamily: mono ? 'JetBrains Mono, monospace' : 'inherit' }}>{value}</span>
      }
    </div>
  );
}

const styles = {
  container: { padding: '32px', color: '#e2e8f0', fontFamily: 'Inter, sans-serif',background: '#0f1117', minHeight: '100vh',overflowY: 'auto' },
  topbar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' },
  dashboardIcon: { fontSize: '20px', width: '38px', height: '38px', background: 'rgba(99, 102, 241, 0.1)', border: '1px solid rgba(99, 102, 241, 0.25)', borderRadius: '10px', display: 'grid', placeItems: 'center' },
  title: { fontSize: '20px', fontWeight: 700, letterSpacing: '-0.02em' },
  backBtn: { background: '#111', border: '1px solid #222', color: '#94a3b8', borderRadius: '8px', padding: '8px 16px', cursor: 'pointer', fontSize: '13px', fontWeight: 500, transition: 'all 0.2s' },
  cards: { display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '32px' },
  filters: { display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end', background: '#0a0a0a', border: '1px solid #1a1a1a', borderRadius: '12px', padding: '16px 20px', marginBottom: '16px' },
  filterBtn: { padding: '9px 20px', background: '#4f46e5', border: 'none', color: '#fff', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 600, transition: 'background 0.2s' },
  clearBtn: { padding: '8px 16px', background: 'transparent', border: '1px solid #222', color: '#94a3b8', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 500, transition: 'all 0.2s' },
  resultCount: { fontSize: '12px', color: '#64748b', marginBottom: '12px', paddingLeft: '4px' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { textAlign: 'left', padding: '12px 16px', fontSize: '11px', color: '#64748b', textTransform: 'uppercase', borderBottom: '1px solid #1a1a1a', whiteSpace: 'nowrap', fontWeight: 600, letterSpacing: '0.06em' },
  tr: { cursor: 'pointer', borderBottom: '1px solid #111', transition: 'background 0.1s' },
  td: { padding: '12px 16px', fontSize: '13px', color: '#cbd5e1', verticalAlign: 'top' },
  errorBadge: { background: 'rgba(239, 68, 68, 0.1)', color: '#f87171', border: '1px solid rgba(239, 68, 68, 0.2)', padding: '2px 6px', borderRadius: '4px', fontSize: '10px', fontWeight: 600 },
  fbBadge: { background: 'rgba(34, 197, 94, 0.1)', color: '#4ade80', border: '1px solid rgba(34, 197, 94, 0.2)', padding: '2px 6px', borderRadius: '4px', fontSize: '10px', fontWeight: 600 },
  pagination: { display: 'flex', gap: '16px', alignItems: 'center', marginTop: '32px', justifyContent: 'center' },
  pageBtn: { background: '#111', border: '1px solid #222', color: '#94a3b8', borderRadius: '8px', padding: '7px 16px', cursor: 'pointer', fontSize: '13px', transition: 'all 0.2s' },
  info: { color: '#64748b', textAlign: 'center', padding: '64px' },
  drawerOverlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)', zIndex: 1000, display: 'flex', justifyContent: 'flex-end' },
  drawer: { background: '#050505', borderLeft: '1px solid #1a1a1a', width: '560px', maxWidth: '90vw', minHeight: '100vh', overflowY: 'auto', padding: '40px', boxShadow: '-20px 0 40px rgba(0,0,0,0.5)' },
  closeBtn: { background: 'transparent', border: '1px solid #222', color: '#64748b', borderRadius: '8px', padding: '4px 12px', cursor: 'pointer', fontSize: '20px', lineHeight: 1 },
};
