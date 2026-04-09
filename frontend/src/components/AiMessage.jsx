import React, { useState, useRef, useEffect } from 'react';
import PropTypes from 'prop-types';
import { executeSql } from '../services/api';
import { calcCost, formatCost, formatUsd, formatTokens } from '../services/tokenCost';
import * as XLSX from 'xlsx';

// Star labels and per-score action options
const STAR_NAMES=['','Wrong — bad query','Partially correct','Mostly right — small fix','Good — minor tweak','Perfect ✦'];
const STAR_OPTS={
  1:[{icon:'✎',name:'Fix via English',sub:'Describe the issue',act:'fix'},
     {icon:'↺',name:'Regenerate',sub:'Fresh attempt',act:'regen'}],
  2:[{icon:'✎',name:'Fix via English',sub:"Tell me what's off",act:'fix'},
     {icon:'↺',name:'Regenerate',sub:'New attempt',act:'regen'}],
  3:[{icon:'✎',name:'Fix the logic',sub:"Describe what's wrong",act:'fix'},
     {icon:'↺',name:'Regenerate',sub:'Try again',act:'regen'}],
  4:[{icon:'✎',name:'Fix the logic',sub:"What could improve?",act:'fix'},
     {icon:'↺',name:'Regenerate',sub:'Try again',act:'regen'}],
  5:[{icon:'✎',name:'Any improvements?',sub:'Share feedback',act:'fix'},
     {icon:'↺',name:'Regenerate',sub:'Try again',act:'regen'}]
};

// Render a markdown string into an array of React-renderable segments
function isTableRow(line) {
  return line.trim().startsWith('|') && line.trim().endsWith('|');
}

function isSeparatorRow(line) {
  return isTableRow(line) && /^\|[\s|:\-]+\|$/.test(line.trim());
}

function parseTableCells(line) {
  return line.trim().slice(1, -1).split('|').map(c => c.trim());
}

function renderAnswer(text) {
  if (!text) return [];

  function inlineHtml(str) {
    // Escape raw HTML first to prevent XSS, then apply markdown
    const escaped = str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    return escaped
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');
  }

  const lines = text.split('\n');
  const segments = [];
  let listItems = [];
  let i = 0;

  const flushList = () => {
    if (listItems.length > 0) {
      segments.push({ type: 'ul', items: [...listItems] });
      listItems = [];
    }
  };

  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.trimEnd();

    // Detect markdown table: header row | separator row | data rows
    if (isTableRow(line) && i + 1 < lines.length && isSeparatorRow(lines[i + 1])) {
      flushList();
      const headers = parseTableCells(line);
      i += 2; // skip header + separator
      const rows = [];
      while (i < lines.length && isTableRow(lines[i])) {
        rows.push(parseTableCells(lines[i]));
        i++;
      }
      segments.push({ type: 'table', headers, rows });
      continue;
    }

    if (!line.trim()) {
      flushList();
      if (i < lines.length - 1) segments.push({ type: 'spacer' });
      i++;
      continue;
    }
    const headingMatch = line.match(/^(#{1,3})\s+(.+)/);
    if (headingMatch) {
      flushList();
      segments.push({ type: 'heading', level: headingMatch[1].length, html: inlineHtml(headingMatch[2]) });
      i++;
      continue;
    }
    const bulletMatch = line.match(/^[-•*]\s+(.+)/);
    if (bulletMatch) { listItems.push(inlineHtml(bulletMatch[1])); i++; continue; }
    const numMatch = line.match(/^\d+\.\s+(.+)/);
    if (numMatch) { listItems.push(inlineHtml(numMatch[1])); i++; continue; }
    flushList();
    segments.push({ type: 'p', html: inlineHtml(line) });
    i++;
  }

  flushList();
  return segments;
}

function isNumeric(val) {
  if (val === null || val === undefined || val === '') return false;
  if (typeof val === 'string' && val.trim() === '') return false;
  const n = Number(val);
  return !isNaN(n) && isFinite(n);
}

function isDate(val) {
  if (typeof val !== 'string') return false;
  return /^\d{4}-\d{2}-\d{2}/.test(val) || /^\d{4}\/\d{2}\/\d{2}/.test(val);
}

// Formats a number in Indian style: 1,00,000 / 12,34,567.89
function formatIndianNumber(num) {
  const isNeg = num < 0;
  const abs = Math.abs(num);
  const [intPart, decPart] = abs.toFixed(
    Number.isInteger(abs) ? 0 : Math.min(4, (abs.toString().split('.')[1] || '').length)
  ).split('.');

  // Indian grouping: last 3 digits, then groups of 2
  let result = '';
  if (intPart.length <= 3) {
    result = intPart;
  } else {
    const last3 = intPart.slice(-3);
    const rest = intPart.slice(0, -3);
    const restGrouped = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',');
    result = restGrouped + ',' + last3;
  }
  if (decPart) result += '.' + decPart;
  return (isNeg ? '-' : '') + result;
}

function formatNumber(val) {
  if (!isNumeric(val)) return val;
  const num = parseFloat(val);
  return formatIndianNumber(num);
}

// SQL syntax highlighter — returns line-numbered HTML
function highlightSql(sql) {
  const KW=['SELECT','FROM','WHERE','INNER JOIN','LEFT JOIN','RIGHT JOIN','OUTER JOIN','FULL JOIN','JOIN','GROUP BY','ORDER BY','HAVING','LIMIT','OFFSET','WITH','AS','ON','AND','OR','NOT','IN','IS','NULL','CASE','WHEN','THEN','ELSE','END','INSERT','UPDATE','DELETE','CREATE','DROP','ALTER','UNION','ALL','DISTINCT','BY','INTO','SET','VALUES','ASC','DESC','INTERVAL','OVER','PARTITION'];
  const FN=['SUM','COUNT','AVG','MAX','MIN','COALESCE','NOW','CURRENT_DATE','CURRENT_TIMESTAMP','ROUND','FLOOR','CEIL','RANK','ROW_NUMBER','DENSE_RANK','LAG','LEAD','DATE_TRUNC','EXTRACT','CAST','CONCAT','TRIM','UPPER','LOWER','LENGTH','NULLIF','MOD','ABS'];

  function highlight(line) {
    let o = line.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    o = o.replace(/(--[^\n]*)/g,'<span class="cmt">$1</span>');
    o = o.replace(/'([^']*)'/g,"<span class='str'>'$1'</span>");
    o = o.replace(/\b(\d+)\b/g,'<span class="num">$1</span>');
    FN.forEach(f=>{ o = o.replace(new RegExp(`\\b(${f})\\b`,'gi'),'<span class="fn">$1</span>') });
    KW.forEach(k=>{ o = o.replace(new RegExp(`\\b(${k})\\b`,'gi'),'<span class="kw">$1</span>') });
    return o;
  }

  // Collapse multiple consecutive blank lines into one, trim trailing blanks
  const lines = (sql || '').split('\n');
  const collapsed = [];
  let lastBlank = false;
  for (const line of lines) {
    const blank = line.trim() === '';
    if (blank && lastBlank) continue;
    collapsed.push(line);
    lastBlank = blank;
  }
  while (collapsed.length && collapsed[collapsed.length - 1].trim() === '') collapsed.pop();

  let lineNum = 0;
  return collapsed.map(line => {
    const blank = line.trim() === '';
    if (!blank) lineNum++;
    const num = blank ? '' : lineNum;
    return `<span class="sql-ln-row${blank ? ' sql-ln-blank' : ''}"><span class="sql-ln">${num}</span><span class="sql-ln-code">${highlight(line)}</span></span>`;
  }).join('\n');
}

// Short time string e.g. "2:34 PM"
function shortTime(isoStr) {
  if (!isoStr) return '';
  try {
    return new Date(isoStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
}

// Row count badge class
function rowBadgeClass(count) {
  if (count < 10) return 'badge-green';
  if (count < 100) return 'badge-amber';
  return 'badge-red';
}

// Exec time bar color + fill %
function execBarStyle(secs) {
  const pct = Math.min((parseFloat(secs) / 3) * 100, 100);
  const color = parseFloat(secs) < 0.5 ? 'var(--green)' : parseFloat(secs) < 2 ? 'var(--amber)' : 'var(--red)';
  return { pct, color };
}

const AiMessage = React.memo(({ msg, addToast, onFix, onRegen, onUpdate, settings, currentUser }) => {
  const { id, model, isRegen, sql: apiSql, answer: apiAnswer, chart_type, data, execution_time,
          session_context_alert, sessionId, chatId: msgChatId, userQuery, feedbackId: msgFeedbackId, token_usage, timestamp,
          query_id: mcqQueryId, sql_auto_fixed, sql_error, thoughts: apiThoughts, lms_type: msgLmsType } = msg;

  const tokenCost = token_usage
    ? calcCost(token_usage.model || model, token_usage.input_tokens, token_usage.output_tokens)
    : null;

  // SQL undo history
  const [sqlHistory, setSqlHistory] = useState([apiSql || '']);
  const [historyIdx, setHistoryIdx] = useState(0);

  const [isEditing, setIsEditing] = useState(false);
  const sql = sqlHistory[historyIdx] || '';
  const [editText, setEditText] = useState(apiSql || '');
  const [isEdited, setIsEdited] = useState(false);
  const [showAllData, setShowAllData] = useState(false);

  const isSuperAdmin = currentUser?.role === 'super_admin' || currentUser?.role === 'Supervisor';

  const isAdminRole = currentUser?.role === 'admin';

  const [fixPanelOpen, setFixPanelOpen] = useState(false);
  const [fixText, setFixText] = useState('');
  const [showExplain, setShowExplain] = useState(true);

  const [rating, setRating] = useState(0);
  const [previewRating, setPreviewRating] = useState(0);
  const [lockedRating, setLockedRating] = useState(false);

  const [copyText, setCopyText] = useState('⎘ Copy');
  const [copyAnswerText, setCopyAnswerText] = useState('⎘ Copy');
  const [runText, setRunText] = useState('▶ Run');
  const [runError, setRunError] = useState('');
  const [resultData, setResultData] = useState(data);
  const [resultAnswer, setResultAnswer] = useState(apiAnswer);
  const [resultExecTime, setResultExecTime] = useState(execution_time);
  const [resultThoughts, setResultThoughts] = useState(apiThoughts);
  const [savingFix, setSavingFix] = useState(false);

  // Table sorting
  const [sortCol, setSortCol] = useState(null);
  const [sortDir, setSortDir] = useState('asc');

  const fixInputRef = useRef(null);
  const editAreaRef = useRef(null);

  useEffect(() => {
    if (data) setResultData(data);
    if (apiAnswer) setResultAnswer(apiAnswer);
    if (execution_time) setResultExecTime(execution_time);
    if (apiThoughts) setResultThoughts(apiThoughts);
  }, [id, data, apiAnswer, execution_time, apiThoughts]);

  useEffect(() => {
    if (fixPanelOpen && fixInputRef.current) fixInputRef.current.focus();
  }, [fixPanelOpen]);

  // Close fix panel on Escape
  useEffect(() => {
    if (!fixPanelOpen) return;
    const handler = (e) => { if (e.key === 'Escape') setFixPanelOpen(false); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [fixPanelOpen]);

  useEffect(() => {
    if (isEditing && editAreaRef.current) {
      editAreaRef.current.focus();
      editAreaRef.current.selectionStart = editAreaRef.current.value.length;
    }
  }, [isEditing]);

  // Auto-run on mount if setting enabled (or always for non-superadmin) — intentional empty dep array (run once)
  const autoRunOnMount = useRef({ settings, sql, sessionId, isEdited, isSuperAdmin, data });
  useEffect(() => {
    const { settings: s, sql: q, sessionId: sid, isEdited: edited, isSuperAdmin: isSuper, data: existingData } = autoRunOnMount.current;
    // Skip auto-run if data is already present (e.g. loaded from saved chat)
    if ((s?.autoRunQuery || !isSuper) && !edited && q && sid && !existingData?.length) handleRun();
  }, []); // intentional: captures initial values via ref

  // Reset table sort when viewing a different message
  useEffect(() => {
    setSortCol(null);
    setSortDir('asc');
  }, [id]);

  // SQL undo/redo helpers
  const handleSaveEdit = () => {
    setHistoryIdx(sqlHistory.length);
    setSqlHistory([...sqlHistory, editText]);
    setIsEditing(false);
    setIsEdited(true);

    // Sync to parent state
    if (onUpdate) {
      onUpdate(id, { sql: editText, isEdited: true });
    }
  };

  const handleUndo = () => {
    if (historyIdx > 0) setHistoryIdx(h => h - 1);
  };

  const handleRedo = () => {
    if (historyIdx < sqlHistory.length - 1) setHistoryIdx(h => h + 1);
  };

  const handleFixSubmit = () => {
    if (!fixText.trim()) return;
    setSavingFix(true);
    setTimeout(() => {
      onFix(id, fixText, mcqQueryId);
      setFixPanelOpen(false);
    }, 1300);
  };

  const handleFbAction = (act) => {
    if (act === 'fix') setFixPanelOpen(true);
    else if (act === 'regen') setTimeout(() => onRegen(id), 1400);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(sql);
    setCopyText('✓ Copied');
    setTimeout(() => setCopyText('⎘ Copy'), 2000);
  };

  const handleCopyAnswer = () => {
    navigator.clipboard.writeText(resultAnswer || apiAnswer || '');
    setCopyAnswerText('✓ Copied');
    setTimeout(() => setCopyAnswerText('⎘ Copy'), 2000);
  };

  const handleRun = async () => {
    if (!sql || !sessionId) return;
    const lmsType = msgLmsType || msg.extra?.lmsType || msg.extra?.lms_type;
    const chatId = msgChatId || msg.extra?.chatId || msg.extra?.chat_id;
    setRunText('⟳ Running...');
    setRunError('');
    try {
      const res = await executeSql(sql, sessionId, userQuery, msgFeedbackId, lmsType, chatId);
      if (res.ok) {
        const { answer, data: resultRows, execution_time: execTime, thoughts: execThoughts } = res.data;
        setResultData(resultRows);
        setResultAnswer(answer);
        setResultExecTime(execTime);
        setResultThoughts(execThoughts);
        setRunText(`✓ ${resultRows?.length || 0} rows`);
        
        // SYNC TO PARENT STATE TO PREVENT OVERWRITE ON NEXT SAVE
        if (onUpdate) {
          onUpdate(id, { 
            answer, 
            data: resultRows, 
            execution_time: execTime, 
            thoughts: execThoughts 
          });
        }

        setTimeout(() => setRunText('▶ Run'), 3000);
      } else {
        setRunText('▶ Run');
        setRunError(`Error: ${res.error}`);
        addToast(`❌ ${res.error}`);
      }
    } catch (err) {
      setRunText('▶ Run');
      setRunError(err.message);
      addToast(`❌ Execution failed: ${err.message}`);
    }
  };

  const handleExportExcel = () => {
    if (!displayData || displayData.length === 0) return;
    const ws = XLSX.utils.json_to_sheet(displayData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Results');
    const fileName = `query_results_${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.xlsx`;
    XLSX.writeFile(wb, fileName);
  };

  // Table sort logic
  const handleSort = (col) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('asc'); }
  };

  const sortedData = React.useMemo(() => {
    if (!resultData || !sortCol) return resultData;
    return [...resultData].sort((a, b) => {
      const av = a[sortCol], bv = b[sortCol];
      if (isNumeric(av) && isNumeric(bv)) {
        return sortDir === 'asc' ? parseFloat(av) - parseFloat(bv) : parseFloat(bv) - parseFloat(av);
      }
      const as = String(av ?? ''), bs = String(bv ?? '');
      return sortDir === 'asc' ? as.localeCompare(bs) : bs.localeCompare(as);
    });
  }, [resultData, sortCol, sortDir]);

  const highlightedSql = React.useMemo(() => highlightSql(sql), [sql]);
  const renderedAnswer = React.useMemo(() => renderAnswer(resultAnswer || apiAnswer), [resultAnswer, apiAnswer]);
  const renderedThoughts = React.useMemo(() => renderAnswer(resultThoughts || apiThoughts || msg.extra?.thoughts), [resultThoughts, apiThoughts, msg.extra?.thoughts]);

  const execBar = resultExecTime ? execBarStyle(resultExecTime) : null;
  const displayData = sortedData || resultData;

  return (
    <div className="message msg-ai" data-id={id}>
      <div className="msg-ai-header">
        <div className="ai-avatar">◈</div>
        <span className="ai-name">GrepSQL AI</span>
        <span className="ai-model-tag">{model}</span>
        {isRegen && <span className="regen-badge">✦ Regenerated</span>}
        {sql_auto_fixed && (
          <span className="auto-fix-badge" title={sql_error ? `Original error: ${sql_error}` : 'SQL was automatically corrected after a DB error'}>
            ⚡ Auto-Fixed
          </span>
        )}
        {token_usage && (
          <span className="token-badge token-badge-hover">
            <span className="token-in">↑{formatTokens(token_usage.input_tokens)}</span>
            <span className="token-sep">·</span>
            <span className="token-out">↓{formatTokens(token_usage.output_tokens)}</span>
            {tokenCost && (<><span className="token-sep">·</span><span className="token-cost">{formatCost(tokenCost.totalCost)}</span></>)}
            {tokenCost && (
              <div className="token-popover">
                <div className="tp-title">Cost Breakdown</div>
                <div className="tp-model">{token_usage.model || model}</div>
                <table className="tp-table">
                  <thead>
                    <tr><th></th><th>Tokens</th><th>Rate/M</th><th>Cost (USD)</th></tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="tp-label">Input</td>
                      <td>{(token_usage.input_tokens || 0).toLocaleString()}</td>
                      <td>${tokenCost.inputRate.toFixed(2)}</td>
                      <td>{formatUsd(tokenCost.inputCost)}</td>
                    </tr>
                    <tr>
                      <td className="tp-label">Output</td>
                      <td>{(token_usage.output_tokens || 0).toLocaleString()}</td>
                      <td>${tokenCost.outputRate.toFixed(2)}</td>
                      <td>{formatUsd(tokenCost.outputCost)}</td>
                    </tr>
                  </tbody>
                  <tfoot>
                    <tr>
                      <td className="tp-label tp-total" colSpan={3}>Total</td>
                      <td className="tp-total">{formatUsd(tokenCost.totalCost)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </span>
        )}
        {timestamp && <span className="msg-timestamp">{shortTime(timestamp)}</span>}
      </div>

      {/* WHISPER QUERY */}
      {!settings?.hideQuery && isSuperAdmin && (
        <div className={`whisper-query ${isEditing ? 'edit-mode' : ''}`}>
          <div className="query-header">
            <span className="query-lang">
              SQL · PostgreSQL
              {isEdited && <span className="edited-mark" style={{marginLeft: 6}}>· edited</span>}
            </span>
            <div className="query-actions">
              {/* Undo / Redo */}
              <button
                className="query-btn"
                onClick={handleUndo}
                disabled={historyIdx === 0}
                title="Undo edit"
                style={historyIdx === 0 ? {opacity: 0.3, pointerEvents: 'none'} : {}}
              >↩ Undo</button>
              <button
                className="query-btn"
                onClick={handleRedo}
                disabled={historyIdx === sqlHistory.length - 1}
                title="Redo edit"
                style={historyIdx === sqlHistory.length - 1 ? {opacity: 0.3, pointerEvents: 'none'} : {}}
              >↪ Redo</button>
              {!isEditing ? (
                <button className="query-btn" onClick={() => { setEditText(sql); setIsEditing(true); }}>✎ Edit</button>
              ) : (
                <button className="query-btn btn-active" onClick={() => { setIsEditing(false); setEditText(sql); }}>✕ Cancel</button>
              )}
              <button className="query-btn" onClick={handleCopy}>{copyText}</button>
              <button className="query-btn" onClick={handleRun} disabled={runText === '⟳ Running...'} style={runText === '⟳ Running...' ? {color:'var(--green)',opacity:.65} : {}}>{runText}</button>
            </div>
          </div>

          {!isEditing ? (
            <div className="query-code" dangerouslySetInnerHTML={{ __html: highlightedSql }} />
          ) : (
            <textarea
              className="query-edit-textarea"
              ref={editAreaRef}
              value={editText}
              onChange={e => setEditText(e.target.value)}
              spellCheck="false"
              onKeyDown={e => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); handleSaveEdit(); }
                if (e.key === 'Escape') { setIsEditing(false); setEditText(sql); }
              }}
            />
          )}

          {isEditing && (
            <div className="edit-bar">
              <span className="edit-bar-label">✎ Editing live</span>
              <span className="edit-bar-hint"><kbd>⌘↵</kbd> save &nbsp; <kbd>Esc</kbd> cancel</span>
              <button className="cancel-btn" onClick={() => { setIsEditing(false); setEditText(sql); }}>Cancel</button>
              <button className="save-btn" onClick={handleSaveEdit}>Save Changes</button>
            </div>
          )}
        </div>
      )}

      {/* FIX VIA ENGLISH */}
      {fixPanelOpen && (
        <div className="fix-panel visible">
          <div className="fix-panel-header">
            <span className="fix-icon">⚡</span>
            <span className="fix-title">Fix via English — describe what's wrong or what needs to change</span>
          </div>
          <div className="fix-body">
            <textarea
              className="fix-textarea"
              ref={fixInputRef}
              rows={3}
              value={fixText}
              onChange={e => setFixText(e.target.value)}
              placeholder="e.g. Also include users with zero orders using LEFT JOIN..."
              onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') handleFixSubmit(); }}
            />
            <div className="fix-actions">
              <span className="fix-hint"><kbd>⌘↵</kbd> to regenerate</span>
              <button className="fix-close-btn" onClick={() => setFixPanelOpen(false)}>Cancel</button>
              <button className={`fix-regen-btn ${savingFix?'loading':''}`} onClick={handleFixSubmit}>
                {savingFix ? '⟳ Applying fix...' : '↺ Regenerate Query'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* LOADING SKELETON for non-superadmin */}
      {!isSuperAdmin && runText === '⟳ Running...' && (
        <div className="admin-query-skeleton">
          <div className="aqs-bar">
            <div className="think-pulse" style={{ marginRight: 8 }}><span></span><span></span><span></span></div>
            <span className="aqs-label">Fetching results…</span>
          </div>
          <div className="skeleton-line" style={{ width: '85%' }} />
          <div className="skeleton-line" style={{ width: '65%' }} />
          <div className="skeleton-line" style={{ width: '75%' }} />
          <div className="skeleton-line" style={{ width: '50%' }} />
        </div>
      )}

      {/* EXPLANATION / THOUGHTS */}
      {(resultThoughts || apiThoughts || msg.extra?.thoughts) && (
        <div className={`whisper-explanation ${showExplain ? 'open' : ''}`}>
          <div className="explanation-header" onClick={() => setShowExplain(!showExplain)}>
            <span className="explanation-icon">⬡</span>
            <span className="explanation-title">Explanation</span>
            <span className="explanation-toggle">{showExplain ? '−' : '+'}</span>
          </div>
          {showExplain && (
            <div className="explanation-body markdown-content">
              {renderedThoughts.map((seg, idx) => {
                 if (seg.type === 'spacer') return <div key={idx} className="answer-spacer" />;
                 return <p key={idx} dangerouslySetInnerHTML={{ __html: seg.html }} />;
              })}
            </div>
          )}
        </div>
      )}

      {/* ANSWER */}
      {(resultAnswer || apiAnswer) && (
        <div className="whisper-answer">
          <div className="answer-header">
            <span className="answer-icon">💬</span>
            <span>Answer</span>
            <button className="query-btn answer-copy-btn" onClick={handleCopyAnswer}>{copyAnswerText}</button>
          </div>
          <div className="answer-text markdown-content">
            {renderedAnswer.map((seg, idx) => {
              if (seg.type === 'heading') {
                const Tag = `h${seg.level + 2}`;
                return <Tag key={idx} className="answer-heading" dangerouslySetInnerHTML={{ __html: seg.html }} />;
              }
              if (seg.type === 'ul') {
                return (
                  <ul key={idx} className="answer-list">
                    {seg.items.map((item, j) => <li key={j} dangerouslySetInnerHTML={{ __html: item }} />)}
                  </ul>
                );
              }
              if (seg.type === 'table') {
                return (
                  <div key={idx} className="answer-table-wrap">
                    <table className="answer-table">
                      <thead>
                        <tr>{seg.headers.map((h, j) => <th key={j} dangerouslySetInnerHTML={{ __html: h }} />)}</tr>
                      </thead>
                      <tbody>
                        {seg.rows.map((row, ri) => (
                          <tr key={ri}>
                            {row.map((cell, ci) => <td key={ci} dangerouslySetInnerHTML={{ __html: cell }} />)}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              }
              if (seg.type === 'spacer') return <div key={idx} className="answer-spacer" />;
              return <p key={idx} dangerouslySetInnerHTML={{ __html: seg.html }} />;
            })}
          </div>
        </div>
      )}

      {/* DATA TABLE + CHART */}
      {displayData && displayData.length > 0 && (
        <div className="whisper-data">
          <div className="data-header">
            <span className="data-icon">📊</span>
            <span className={`row-count-badge ${rowBadgeClass(displayData.length)}`}>
              {displayData.length} {displayData.length === 1 ? 'row' : 'rows'}
            </span>

            {execBar && (
              <div className="exec-bar-wrap" title={`Executed in ${resultExecTime}s`}>
                <div className="exec-bar">
                  <div className="exec-bar-fill" style={{ width: `${execBar.pct}%`, background: execBar.color }} />
                </div>
                <span className="exec-bar-label">{resultExecTime}s</span>
              </div>
            )}

            {displayData.length > 5 && !showAllData && (
              <button className="show-all-btn" onClick={() => setShowAllData(true)}>
                Show All ({displayData.length})
              </button>
            )}
            {showAllData && (
              <button className="show-all-btn active" onClick={() => setShowAllData(false)}>
                Show Less
              </button>
            )}
            <button className="export-excel-btn" onClick={handleExportExcel} title="Export to Excel">
              ⬇ Excel
            </button>
          </div>

          {/* TABLE VIEW */}
          <div className="data-table">
              <table>
                <thead>
                  <tr>
                    {Object.keys(displayData[0]).map(col => (
                      <th
                        key={col}
                        className={sortCol === col ? 'th-sorted' : ''}
                        onClick={() => handleSort(col)}
                        style={{ cursor: 'pointer', userSelect: 'none' }}
                      >
                        {col}
                        <span className="sort-icon">
                          {sortCol === col ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ' ⇅'}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {displayData.slice(0, showAllData ? displayData.length : 5).map((row, idx) => (
                    <tr key={idx}>
                      {Object.entries(row).map(([colName, val], cellIdx) => {
                        const displayVal = val === null || val === undefined ? 'NULL' : val;
                        const isNum = isNumeric(displayVal);
                        const isD = isDate(displayVal?.toString());
                        const formatted = isNum ? formatNumber(displayVal) : displayVal?.toString() || '';
                        return (
                          <td key={cellIdx} className={isNum ? 'number' : isD ? 'date' : ''}>{formatted}</td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              {!showAllData && displayData.length > 5 && (
                <div style={{ padding: '10px 14px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '11px', borderTop: '1px solid var(--border)' }}>
                  Showing 5 of {displayData.length} rows —{' '}
                  <button onClick={() => setShowAllData(true)} style={{ background: 'none', border: 'none', color: 'var(--green)', cursor: 'pointer', textDecoration: 'underline' }}>load all</button>
                </div>
              )}
          </div>
        </div>
      )}

      {/* RUN ERROR */}
      {runError && (
        <div className="run-error">{runError}</div>
      )}

      {/* SESSION CONTEXT ALERT */}
      {session_context_alert && (
        <div className="session-alert">{session_context_alert}</div>
      )}

      <div className="msg-divider"></div>

      {/* RATING */}
      <div className="rating-row">
        <span className="rating-label">Rate this response</span>
        <div className="stars" onMouseLeave={() => !lockedRating && setPreviewRating(0)}>
          {[1,2,3,4,5].map(n => (
            <span
              key={n}
              className={`star ${previewRating >= n && !lockedRating ? 'preview' : ''} ${rating >= n ? 'lit' : ''}`}
              onMouseEnter={() => !lockedRating && setPreviewRating(n)}
              onClick={() => { setRating(n); setLockedRating(true); }}
            >★</span>
          ))}
        </div>
        <span className={`score-label ${lockedRating ? `s${rating}` : previewRating ? `s${previewRating}` : ''}`}>
          {lockedRating ? STAR_NAMES[rating] : previewRating ? STAR_NAMES[previewRating] : ''}
        </span>
        {!lockedRating && (
          <div className="action-btns">
            <button className="action-btn" onClick={() => setFixPanelOpen(true)}>✎ Fix via English</button>
            <button className="action-btn" onClick={() => handleFbAction('regen')}>↺ Regenerate</button>
            <button className="action-btn" onClick={() => setShowExplain(!showExplain)}>⬡ Explain</button>
          </div>
        )}
      </div>

      {/* CONTEXTUAL FEEDBACK */}
      {lockedRating > 0 && (
        <div className="rating-feedback visible">
          <div className="rfb-label-row">
            {rating <= 2 ? 'What went wrong?' : rating === 3 ? 'How can I improve it?' : rating === 4 ? 'Any final touches?' : 'Save or explore?'}
          </div>
          <div className="rfb-options">
            {(STAR_OPTS[rating] || []).map((o, i) => (
              <div key={i} className="rfb-option" onClick={(e) => {
                e.currentTarget.parentElement.querySelectorAll('.rfb-option').forEach(el=>el.classList.remove('chosen'));
                e.currentTarget.classList.add('chosen');
                handleFbAction(o.act);
              }}>
                <span className="rfb-icon">{o.icon}</span>
                <span className="rfb-name">{o.name}</span>
                <span className="rfb-sub">{o.sub}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});

AiMessage.propTypes = {
  msg: PropTypes.shape({
    id: PropTypes.string,
    model: PropTypes.string,
    isRegen: PropTypes.bool,
    sql: PropTypes.string,
    answer: PropTypes.string,
    data: PropTypes.array,
    execution_time: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    sessionId: PropTypes.string,
    userQuery: PropTypes.string,
    token_usage: PropTypes.object,
    timestamp: PropTypes.string,
    query_id: PropTypes.string,
  }).isRequired,
  addToast: PropTypes.func.isRequired,
  onFix: PropTypes.func.isRequired,
  onRegen: PropTypes.func.isRequired,
  settings: PropTypes.object,
  currentUser: PropTypes.object,
};

export default AiMessage;
