/**
 * Backend API service for DataWhisper
 * Communicates with FastAPI server at http://localhost:8001
 */

const API_BASE = 'http://localhost:8001';

/**
 * Convert UTC ISO timestamp (2026-03-29T17:56:42.790Z) to readable format:
 * "Sunday, March 29, 2026, at 17:56:42 UTC (5:56 PM)"
 */
export function formatUtcTimestamp(isoString) {
  try {
    const dt = new Date(isoString);
    const dayName = dt.toLocaleDateString('en-US', { weekday: 'long' });
    const dateStr = dt.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: '2-digit'
    });
    const timeStr = dt.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
    const localTime = dt.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });

    return `${dayName}, ${dateStr}, at ${timeStr} UTC (${localTime})`;
  } catch (e) {
    console.error('Error formatting timestamp:', e);
    return isoString;
  }
}

/**
 * Check if backend is available
 */
export async function checkHealth() {
  try {
    const res = await fetch(`${API_BASE}/health`, { method: 'GET' });
    if (res.ok) {
      const data = await res.json();
      return { ok: true, data };
    }
    return { ok: false, error: 'Backend health check failed' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Send query to backend and get SQL + answer
 */
export async function sendQuery(sessionId, userQuery, model = 'gemini-3.1-flash-lite-preview', execute = true, chatId = '') {
  try {
    const res = await fetch(`${API_BASE}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: sessionId,
        chat_id: chatId,
        user_query: userQuery,
        model,
        execute,
        thinking_enabled: false,
        thinking_level: 'high',
        include_thoughts: false,
      }),
    });

    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.detail || 'Query failed');
    }

    return { ok: true, data: await res.json() };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Execute already-generated SQL against the database
 */
export async function executeSql(sql, sessionId, originalQuery = '', feedbackId = '') {
  try {
    const res = await fetch(`${API_BASE}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sql,
        session_id: sessionId,
        original_query: originalQuery,
        feedback_id: feedbackId,
      }),
    });

    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.detail || 'Execution failed');
    }

    return { ok: true, data: await res.json() };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Load all chats from backend
 */
export async function loadChatsFromBackend() {
  try {
    const res = await fetch(`${API_BASE}/chats/load`, { method: 'GET' });
    if (res.ok) {
      const data = await res.json();
      return { ok: true, ...data };
    }
    return { ok: false, error: 'Failed to load chats', chats: [] };
  } catch (e) {
    return { ok: false, error: e.message, chats: [] };
  }
}

/**
 * Save chats to backend
 */
export async function saveChatsToBackend(chats, lastChatId) {
  try {
    const res = await fetch(`${API_BASE}/chats/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chats, lastChatId }),
    });

    if (res.ok) {
      const data = await res.json();
      return { ok: true, ...data };
    }
    return { ok: false, error: 'Failed to save chats' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Switch active model (local state only - backend doesn't track this)
 */
export async function switchModel(modelId) {
  return { ok: true, model: modelId };
}
