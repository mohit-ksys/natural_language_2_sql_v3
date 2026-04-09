import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Routes, Route, Navigate, useNavigate, useParams } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import SettingsModal from './components/SettingsModal';
import AdminPanel from './components/AdminPanel';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import ChatPage from './pages/ChatPage';
import { 
  isLoggedIn, getUser, logout, checkHealth, 
  loadChatsFromBackend, saveChatsToBackend 
} from './services/api';

export default function App() {
  const [authed, setAuthed] = useState(isLoggedIn);
  const [currentUser, setCurrentUser] = useState(getUser);
  const navigate = useNavigate();

  const handleLogin = (user) => {
    setCurrentUser(user);
    setAuthed(true);
    navigate('/');
  };

  const handleLogout = async () => {
    if (chatSaveRef.current) {
      try { await chatSaveRef.current(); } catch {}
    }
    logout();
    setAuthed(false);
    setCurrentUser(null);
    navigate('/login');
  };

  const chatSaveRef = useRef(null);

  return (
    <Routes>
      <Route path="/login" element={!authed ? <Login onLogin={handleLogin} /> : <Navigate to="/" />} />
      
      {/* Protected Routes wrapped in MainLayout */}
      <Route
        path="/*"
        element={
          authed ? (
            <MainLayout
              currentUser={currentUser}
              onLogout={handleLogout}
              registerSave={(fn) => { chatSaveRef.current = fn; }}
            />
          ) : (
            <Navigate to="/login" />
          )
        }
      />
    </Routes>
  );
}

function MainLayout({ currentUser, onLogout, registerSave }) {
  const navigate = useNavigate();
  const params = useParams();
  const chatIdFromUrl = params['*'].split('c/')[1] || null;

  const [chats, setChats] = useState([]);
  const [backendStatus, setBackendStatus] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAdminOpen, setIsAdminOpen] = useState(false);

  // Promoting settings and model state to App for consistency
  const [model, setModel] = useState('gemini-3.1-flash-lite-preview');
  const [thinkOn, setThinkOn] = useState(false);

  const DEFAULT_SETTINGS = { datahubConnected: false, autoRunQuery: false, hideQuery: false, mcqEnabled: false };
  const [settings, setSettings] = useState(() => {
    try {
      const saved = localStorage.getItem('dw-settings');
      if (saved) return { ...DEFAULT_SETTINGS, ...JSON.parse(saved), datahubConnected: false };
    } catch {}
    return DEFAULT_SETTINGS;
  });

  const role = (currentUser?.role || "").toLowerCase();
  const canViewDashboard = role === 'super_admin' || role === 'supervisor';

  useEffect(() => {
    const initApp = async () => {
      const healthRes = await checkHealth();
      setBackendStatus(healthRes.ok ? 'connected' : 'disconnected');

      try {
        const result = await loadChatsFromBackend();
        if (result.ok && result.chats) {
          setChats(result.chats);
        }
      } catch (e) {
        console.error('Failed to init chats:', e);
      }
      setIsLoading(false);
    };
    initApp();
  }, []);

  const saveChatsToBackendAsync = (chatsToSave, lastId) => {
    saveChatsToBackend(chatsToSave, lastId).catch(e => console.error('Failed to save chats:', e));
  };

  const renameChat = (id, newTitle) => {
    const updated = chats.map(c => c.id === id ? { ...c, title: newTitle } : c);
    setChats(updated);
    saveChatsToBackendAsync(updated, chatIdFromUrl);
  };

  const pinChat = (id) => {
    const updated = chats.map(c => c.id === id ? { ...c, isPinned: !c.isPinned } : c);
    setChats(updated);
    saveChatsToBackendAsync(updated, chatIdFromUrl);
  };

  const deleteChat = (id) => {
    const updated = chats.filter(c => c.id !== id);
    setChats(updated);
    if (id === chatIdFromUrl) navigate('/');
    saveChatsToBackendAsync(updated, id === chatIdFromUrl ? null : chatIdFromUrl);
  };

  if (isLoading) {
    return (
      <div className="app loading" style={{ background: '#0f1117', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
         <div style={{ textAlign: 'center', color: '#9ca3af' }}>
           <div style={{ fontSize: '20px', fontWeight: 600, marginBottom: '8px' }}>Initializing GrepSQL AI...</div>
           <div style={{ fontSize: '12px' }}>Establishing secure connection...</div>
         </div>
      </div>
    );
  }

  return (
    <div className="app">
      <Sidebar
        startNewChat={() => navigate('/')}
        onOpenSettings={() => setIsSettingsOpen(true)}
        chats={chats}
        loadChat={(id) => navigate(`/c/${id}`)}
        currentChatId={chatIdFromUrl}
        deleteChat={deleteChat}
        pinChat={pinChat}
        renameChat={renameChat}
        currentUser={currentUser}
        onDashboard={canViewDashboard ? () => navigate('/dashboard') : null}
        onAdmin={currentUser?.role === 'super_admin' ? () => setIsAdminOpen(true) : null}
        onLogout={onLogout}
      />

      <main className="main">
        <Routes>
          <Route path="/" element={
            <ChatPage 
              key="new" 
              chats={chats} setChats={setChats} 
              settings={settings} currentUser={currentUser} 
              registerSave={registerSave}
              model={model} setModel={setModel}
              thinkOn={thinkOn} setThinkOn={setThinkOn}
              isInitialLoading={isLoading}
            />
          } />
          <Route path="c/:chatId" element={
            <ChatPage 
              key="existing" 
              chats={chats} setChats={setChats} 
              settings={settings} currentUser={currentUser} 
              registerSave={registerSave}
              model={model} setModel={setModel}
              thinkOn={thinkOn} setThinkOn={setThinkOn}
              isInitialLoading={isLoading}
            />
          } />
          <Route path="dashboard" element={canViewDashboard ? <Dashboard onBack={() => navigate('/')} /> : <Navigate to="/" />} />
        </Routes>
      </main>

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        setSettings={setSettings}
        backendStatus={backendStatus}
        currentUser={currentUser}
      />

      {isAdminOpen && <AdminPanel onClose={() => setIsAdminOpen(false)} />}
    </div>
  );
}

