
const API_BASE = 'http://localhost:8000';
const LMS_API_BASE = 'http://localhost:5000';

function setCookie(name, value, days = 7) {
  const date = new Date();
  date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
  const expires = "; expires=" + date.toUTCString();
  document.cookie = name + "=" + (value || "") + expires + "; path=/; SameSite=Lax";
}

function getCookie(name) {
  const nameEQ = name + "=";
  const ca = document.cookie.split(';');
  for (let i = 0; i < ca.length; i++) {
    let c = ca[i];
    while (c.charAt(0) === ' ') c = c.substring(1, c.length);
    if (c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length, c.length);
  }
  return null;
}

export async function exportExcel(sql, lmsType, fileName) {
  const token = getAccessToken();
  const response = await fetch(`${API_BASE}/export-excel`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      sql,
      lms_type: lmsType,
      filename: fileName
    })
  });

  if (!response.ok) throw new Error('Export failed');

  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  a.remove();
}

function eraseCookie(name) {
  document.cookie = name + '=; Max-Age=-99999999; path=/; SameSite=Lax';
}



export function getAccessToken() {
  return localStorage.getItem('df_at') || getCookie('degreefyd_nlp_token');
}

export function getRefreshToken() {
  return null;
}

export function getUser() {
  try {
    const raw = localStorage.getItem('df_user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function isLoggedIn() {
  return !!getAccessToken();
}

export function logout() {
  apiFetch(`${LMS_API_BASE}/api/auth/logout`, {
    method: 'POST',
  }).finally(() => {
    localStorage.removeItem('df_at');
    localStorage.removeItem('df_user');
    eraseCookie('degreefyd_nlp_token');
    window.location.reload();
  });
}

async function tryRefresh() {
  try {
    const res = await fetch(`${LMS_API_BASE}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
    });
    if (res.ok) {
      const data = await res.json();
      localStorage.setItem('df_at', data.df_at);
      return true;
    }
  } catch (e) {
    console.error('Refresh failed:', e);
  }
  return false;
}


async function apiFetch(url, options = {}, _retry = false) {
  const token = getAccessToken();
  const headers = {
    ...options.headers,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const res = await fetch(url, { 
    ...options, 
    headers,
    credentials: 'include' 
  });

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


export async function loginStaff(email, password) {
  try {
    const res = await fetch(`${LMS_API_BASE}/api/auth/login/staff`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
      credentials: 'include',
    });
    
    if (res.ok) {
      const data = await res.json();
      localStorage.setItem('df_at', data.df_at);
      localStorage.setItem('df_user', JSON.stringify(data.user));
      return { ok: true, user: data.user };
    }
    
    const err = await res.json();
    return { ok: false, error: err.error || 'Login failed' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export async function validateSSO(token) {
  try {
    const res = await fetch(`${LMS_API_BASE}/api/auth/sso/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
      credentials: 'include',
    });
    
    if (res.ok) {
      const data = await res.json();
      localStorage.setItem('df_at', data.df_at);
      localStorage.setItem('df_user', JSON.stringify(data.user));
      return { ok: true, user: data.user };
    }
    
    const err = await res.json();
    return { ok: false, error: err.error || 'SSO Validation failed' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
export async function fetchLMSTargets() {
  try {
    const res = await apiFetch(`${LMS_API_BASE}/api/auth/lms-targets`);
    if (!res.ok) throw new Error((await res.json()).error || 'Failed to fetch LMS targets');
    return { ok: true, data: await res.json() };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

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


export async function fetchDashboardStats(params = {}) {
   const qs = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v != null && v !== '')
  ).toString();
  try {
    const res = await apiFetch(`${API_BASE}/dashboard/stats${qs ? '?' + qs : ''}`);
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


export async function sendQuery(sessionId, userQuery, model = 'gemini-3.1-flash-lite-preview', execute = true, chatId = '', lmsType = null, userMsgId = null, lmsId = null) {
  try {
    const res = await apiFetch(`${API_BASE}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: sessionId,
        chat_id: chatId,
        user_query: userQuery,
        user_msg_id: userMsgId,
        model,
        execute,
        lms_type: lmsType,
        lms_id: lmsId, 
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

export async function executeSql(sql, sessionId, originalQuery = '', feedbackId = '', lmsType = null, chatId = '', lmsId = null) {
  try {
    const res = await apiFetch(`${API_BASE}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sql, session_id: sessionId, original_query: originalQuery,
        feedback_id: feedbackId, lms_type: lmsType,
        lms_id: lmsId, 
        chat_id: chatId
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

export async function loadChatsFromBackend(lmsId = null) {
  try {
    const url = lmsId ? `${API_BASE}/chats/load?lms_id=${lmsId}` : `${API_BASE}/chats/load`;
    const res = await apiFetch(url);
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

export async function loadChatMessages(chatId, limit = 50, offset = 0) {
  try {
    const res = await apiFetch(`${API_BASE}/chats/${chatId}/messages?limit=${limit}&offset=${offset}`);
    console.log(`API loadChatMessages: chatId=${chatId}, limit=${limit}, offset=${offset}, response=`, res);
    if (res.ok) {
      const data = await res.json();
      return { ok: true, messages: data.messages, hasMore: data.has_more };
    }
    return { ok: false, error: 'Failed to load messages', messages: [], hasMore: false };
  } catch (e) {
    return { ok: false, error: e.message, messages: [], hasMore: false };
  }
}

export async function switchModel(modelId) {
  return { ok: true, model: modelId };
}

export async function requestMCQs(sessionId, userQuery, model = 'gemini-3.1-flash-lite-preview', chatId = '', lmsType = null, userMsgId = null, lmsId = null) {
  try {
    const res = await apiFetch(`${API_BASE}/disambiguate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_query: userQuery, session_id: sessionId, chat_id: chatId, model, lms_type: lmsType, user_msg_id: userMsgId, lms_id: lmsId }),
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

export async function submitMCQAnswers(queryId, sessionId, answers, model = 'gemini-3.1-flash-lite-preview', execute = true, chatId = '', lmsId = null) {
  try {
    const res = await apiFetch(`${API_BASE}/answer-mcq`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query_id: queryId, session_id: sessionId, chat_id: chatId, answers, model, execute, lms_id: lmsId }),
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

export async function submitEnglishFeedback(queryId, sessionId, feedback, model = 'gemini-3.1-flash-lite-preview', execute = true, chatId = '', lmsId = null) {
  try {
    const res = await apiFetch(`${API_BASE}/english-feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query_id: queryId, session_id: sessionId, chat_id: chatId, feedback, model, execute, lms_id: lmsId }),
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
