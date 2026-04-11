import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Routes, Route, Navigate, useNavigate, useParams } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import SettingsModal from './components/SettingsModal';
import AdminPanel from './components/AdminPanel';
import Login from './pages/Login';
import SSOLogin from './pages/SSOLogin';
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
      <Route path="/sso-login" element={<SSOLogin onLogin={handleLogin} />} />
      
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

import { Select, ConfigProvider, theme as antdTheme, Popconfirm } from 'antd';
import { QuestionCircleOutlined } from '@ant-design/icons';

function MainLayout({ currentUser, onLogout, registerSave }) {
  const navigate = useNavigate();
  const params = useParams();
  const chatIdFromUrl = params['*'].split('c/')[1] || null;

  const [chats, setChats] = useState([]);
  const [backendStatus, setBackendStatus] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAdminOpen, setIsAdminOpen] = useState(false);

  const [model, setModel] = useState('gemini-3.1-flash-lite-preview');
  const [thinkOn, setThinkOn] = useState(false);

  // LMS Selection state
  const [selectedLmsId, setSelectedLmsId] = useState(() => {
    return localStorage.getItem('selected_lms_id') || currentUser?.assigned_lms?.[0]?.id || '';
  });

  const handleLmsChange = (id) => {
    setSelectedLmsId(id);
    localStorage.setItem('selected_lms_id', id);
    // Reload chats for the new LMS
    initApp(id);
    // Redirect to New Chat to reset context
    navigate('/');
  };

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

  const initApp = async (lmsId = selectedLmsId) => {
    setIsLoading(true);
    const healthRes = await checkHealth();
    setBackendStatus(healthRes.ok ? 'connected' : 'disconnected');

    try {
      const result = await loadChatsFromBackend(lmsId);
      if (result.ok && result.chats) {
        setChats(result.chats);
      }
    } catch (e) {
      console.error('Failed to init chats:', e);
    }
    setIsLoading(false);
  };

  useEffect(() => {
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
    const updated = chats.map(c => c.id === id ? { ...c, isDeleted: true } : c);
    setChats(updated);
    if (id === chatIdFromUrl) {
      navigate('/');
      saveChatsToBackendAsync(updated, null);
    } else {
      saveChatsToBackendAsync(updated, chatIdFromUrl);
    }
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

  const filteredChats = chats.filter(c => !c.lms_id || c.lms_id === selectedLmsId);

  return (
    <ConfigProvider
      theme={{
        algorithm: antdTheme.darkAlgorithm,
        token: {
          colorPrimary: '#00FFB2',
          colorBgContainer: '#0a0a0a',
          colorBorder: '#333333',
          borderRadius: 10,
          fontFamily: 'Inter, sans-serif',
        },
      }}
    >
      <div className="app">
        <header className="app-navbar">
          <div className="navbar-logo">GrepSQL AI</div>
          <div className="navbar-actions">
            {console.log("Current User Data:", currentUser)}
            {currentUser?.assigned_lms?.length > 0 && (
              <div className="lms-selector-container">
                <Select
                  showSearch
                  className="lms-antd-select"
                  placeholder="Select LMS"
                  optionFilterProp="label"
                  value={selectedLmsId}
                  onChange={handleLmsChange}
                  dropdownStyle={{ background: '#0a0a0a', border: '1px solid #333' }}
                  options={currentUser.assigned_lms.map(lms => ({
                    value: lms.id,
                    label: lms.name
                  }))}
                />
              </div>
            )}
            <div className="user-profile">
              <span className="user-name">{currentUser?.name || currentUser?.full_name}</span>
              <Popconfirm
                title="Sign out"
                description="Are you sure you want to log out?"
                onConfirm={onLogout}
                okText="Yes"
                cancelText="No"
                icon={<QuestionCircleOutlined style={{ color: '#ff4d4f' }} />}
              >
                <button className="logout-mini-btn">Logout</button>
              </Popconfirm>
            </div>
          </div>
        </header>

      <div className="app-layout">
        <Sidebar
          startNewChat={() => navigate('/')}
          onOpenSettings={() => setIsSettingsOpen(true)}
          chats={filteredChats}
          loadChat={(id) => navigate(`/c/${id}`)}
          currentChatId={chatIdFromUrl}
          deleteChat={deleteChat}
          pinChat={pinChat}
          renameChat={renameChat}
          currentUser={currentUser}
          onLogout={onLogout}
          onDashboard={canViewDashboard ? () => navigate('/dashboard') : null}
          onAdmin={currentUser?.role === 'super_admin' ? () => setIsAdminOpen(true) : null}
        />

        <main className="main">
          <Routes>
            <Route path="/" element={
              <ChatPage 
                chats={chats} setChats={setChats} 
                settings={settings} currentUser={currentUser} 
                registerSave={registerSave}
                model={model} setModel={setModel}
                thinkOn={thinkOn} setThinkOn={setThinkOn}
                isInitialLoading={isLoading}
                lmsId={selectedLmsId}
              />
            } />
            <Route path="c/:chatId" element={
              <ChatPage 
                chats={chats} setChats={setChats} 
                settings={settings} currentUser={currentUser} 
                registerSave={registerSave}
                model={model} setModel={setModel}
                thinkOn={thinkOn} setThinkOn={setThinkOn}
                isInitialLoading={isLoading}
                lmsId={selectedLmsId}
              />
            } />
            <Route path="dashboard" element={canViewDashboard ? <Dashboard lmsId={selectedLmsId} onBack={() => navigate('/')} /> : <Navigate to="/" />} />
          </Routes>
        </main>
      </div>

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
    </ConfigProvider>
  );
}
