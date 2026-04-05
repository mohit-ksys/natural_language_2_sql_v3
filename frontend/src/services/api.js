/**
 * Backend API service for DataWhisper — with JWT auth and silent refresh.
 */

const API_BASE = 'http://localhost:8001';

// ─── Auth helpers ─────────────────────────────────────────────────────────────

export function getAccessToken() {
  return localStorage.getItem('access_token');
}

export function getUser() {
  try {
    const raw = localStorage.getItem('user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function isLoggedIn() {
  return !!getAccessToken();
}

export function logout() {
  const refresh_token = localStorage.getItem('refresh_token');
  if (refresh_token) {
    fetch(`${API_BASE}/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token }),
    }).catch(() => {});
  }
  localStorage.removeItem('access_token');
  localStorage.removeItem('refresh_token');
  localStorage.removeItem('user');
  window.location.reload();
}

async function tryRefresh() {
  const refresh_token = localStorage.getItem('refresh_token');
  if (!refresh_token) return false;
  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token }),
    });
    if (res.ok) {
      const data = await res.json();
      localStorage.setItem('access_token', data.access_token);
      return true;
    }
  } catch {}
  return false;
}

/**
 * Central fetch wrapper — injects Authorization header and handles 401 silently.
 */
async function apiFetch(url, options = {}, _retry = false) {
  const token = getAccessToken();
  const headers = {
    ...options.headers,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const res = await fetch(url, { ...options, headers });

  if (res.status === 401 && !_retry) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      return apiFetch(url, options, true);
    } else {
      logout();
      throw new Error('Session expired');
    }
  }

  return res;
}

// ─── Auth endpoints ───────────────────────────────────────────────────────────

export async function login(username, password) {
  try {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (res.ok) {
      const data = await res.json();
      localStorage.setItem('access_token', data.access_token);
      localStorage.setItem('refresh_token', data.refresh_token);
      localStorage.setItem('user', JSON.stringify(data.user));
      return { ok: true, user: data.user };
    }
    const err = await res.json();
    return { ok: false, error: err.detail || 'Login failed' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ─── User management (superadmin) ─────────────────────────────────────────────

export async function fetchUsers() {
  try {
    const res = await apiFetch(`${API_BASE}/auth/users`);
    if (!res.ok) throw new Error((await res.json()).detail || 'Failed');
    return { ok: true, data: await res.json() };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export async function createUser(payload) {
  try {
    const res = await apiFetch(`${API_BASE}/auth/users/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error((await res.json()).detail || 'Failed');
    return { ok: true, data: await res.json() };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export async function resetPassword(username) {
  try {
    const res = await apiFetch(`${API_BASE}/auth/users/${encodeURIComponent(username)}/reset-password`, {
      method: 'PATCH',
    });
    if (!res.ok) throw new Error((await res.json()).detail || 'Failed');
    return { ok: true, data: await res.json() };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export async function deactivateUser(username) {
  try {
    const res = await apiFetch(`${API_BASE}/auth/users/${encodeURIComponent(username)}/deactivate`, {
      method: 'PATCH',
    });
    if (!res.ok) throw new Error((await res.json()).detail || 'Failed');
    return { ok: true, data: await res.json() };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export async function reactivateUser(username) {
  try {
    const res = await apiFetch(`${API_BASE}/auth/users/${encodeURIComponent(username)}/reactivate`, {
      method: 'PATCH',
    });
    if (!res.ok) throw new Error((await res.json()).detail || 'Failed');
    return { ok: true, data: await res.json() };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export async function fetchDashboardStats() {
  try {
    const res = await apiFetch(`${API_BASE}/dashboard/stats`);
    if (!res.ok) throw new Error((await res.json()).detail || 'Failed');
    return { ok: true, data: await res.json() };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export async function fetchDashboardLogs(params = {}) {
  const qs = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v != null && v !== '')
  ).toString();
  try {
    const res = await apiFetch(`${API_BASE}/dashboard/logs${qs ? '?' + qs : ''}`);
    if (!res.ok) throw new Error((await res.json()).detail || 'Failed');
    return { ok: true, data: await res.json() };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

export function formatUtcTimestamp(isoString) {
  try {
    const dt = new Date(isoString);
    const dayName = dt.toLocaleDateString('en-US', { weekday: 'long' });
    const dateStr = dt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: '2-digit' });
    const timeStr = dt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    const localTime = dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    return `${dayName}, ${dateStr}, at ${timeStr} UTC (${localTime})`;
  } catch {
    return isoString;
  }
}

export async function checkHealth() {
  try {
    const res = await fetch(`${API_BASE}/health`);
    if (res.ok) return { ok: true, data: await res.json() };
    return { ok: false, error: 'Backend health check failed' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ─── Query endpoints ──────────────────────────────────────────────────────────

export async function sendQuery(sessionId, userQuery, model = 'gemini-3.1-flash-lite-preview', execute = true, chatId = '', lmsType = null) {
  try {
    const res = await apiFetch(`${API_BASE}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: sessionId,
        chat_id: chatId,
        user_query: userQuery,
        model,
        execute,
        lms_type: lmsType,
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

export async function executeSql(sql, sessionId, originalQuery = '', feedbackId = '', lmsType = null) {
  try {
    const res = await apiFetch(`${API_BASE}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sql, session_id: sessionId, original_query: originalQuery,
        feedback_id: feedbackId, lms_type: lmsType,
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

export async function loadChatsFromBackend() {
  try {
    const res = await apiFetch(`${API_BASE}/chats/load`);
    if (res.ok) {
      const data = await res.json();
      return { ok: true, ...data };
    }
    return { ok: false, error: 'Failed to load chats', chats: [] };
  } catch (e) {
    return { ok: false, error: e.message, chats: [] };
  }
}

export async function saveChatsToBackend(chats, lastChatId) {
  try {
    const res = await apiFetch(`${API_BASE}/chats/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chats, lastChatId }),
    });
    if (res.ok) return { ok: true, ...(await res.json()) };
    return { ok: false, error: 'Failed to save chats' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export async function switchModel(modelId) {
  return { ok: true, model: modelId };
}

export async function requestMCQs(sessionId, userQuery, model = 'gemini-3.1-flash-lite-preview', chatId = '', lmsType = null) {
  try {
    const res = await apiFetch(`${API_BASE}/disambiguate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_query: userQuery, session_id: sessionId, chat_id: chatId, model, lms_type: lmsType }),
    });
    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.detail || 'Failed to generate MCQs');
    }
    return { ok: true, data: await res.json() };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export async function submitMCQAnswers(queryId, sessionId, answers, model = 'gemini-3.1-flash-lite-preview', execute = true, chatId = '') {
  try {
    const res = await apiFetch(`${API_BASE}/answer-mcq`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query_id: queryId, session_id: sessionId, chat_id: chatId, answers, model, execute }),
    });
    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.detail || 'Failed to process MCQ answers');
    }
    return { ok: true, data: await res.json() };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export async function submitEnglishFeedback(queryId, sessionId, feedback, model = 'gemini-3.1-flash-lite-preview', execute = true, chatId = '') {
  try {
    const res = await apiFetch(`${API_BASE}/english-feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query_id: queryId, session_id: sessionId, chat_id: chatId, feedback, model, execute }),
    });
    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.detail || 'Failed to process feedback');
    }
    return { ok: true, data: await res.json() };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
