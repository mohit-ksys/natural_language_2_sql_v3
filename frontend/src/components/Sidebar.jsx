import React, { useState, useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import { Popconfirm } from 'antd';
import { QuestionCircleOutlined } from '@ant-design/icons';

export default function Sidebar({ startNewChat, onOpenSettings, chats = [], loadChat, currentChatId, deleteChat, pinChat, renameChat, currentUser, onDashboard, onAdmin, onLogout }) {
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'dark');
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('sidebarCollapsed') === 'true');
  const [showAll, setShowAll] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [renamingId, setRenamingId] = useState(null);
  const [renameVal, setRenameVal] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const renameInputRef = useRef(null);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem('sidebarCollapsed', collapsed);
  }, [collapsed]);

  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  const toggleTheme = () => setTheme(prev => prev === 'light' ? 'dark' : 'light');

  const VISIBLE_COUNT = 5;

  const getDisplayTitle = (chat) => {
    const isUnnamed = !chat.title || chat.title === 'New Chat' || chat.title === 'Generating title...';
    return isUnnamed ? 'New Chat' : chat.title;
  };

  const startRename = (e, chat) => {
    e.stopPropagation();
    setRenamingId(chat.id);
    setRenameVal(getDisplayTitle(chat));
  };

  const commitRename = () => {
    const trimmed = renameVal.trim();
    if (trimmed && renamingId && renameChat) {
      renameChat(renamingId, trimmed);
    }
    setRenamingId(null);
  };

  const cancelRename = () => setRenamingId(null);

  function highlightTitle(title) {
    if (!debouncedSearch.trim()) return title;
    const idx = title.toLowerCase().indexOf(debouncedSearch.toLowerCase());
    if (idx === -1) return title;
    return (
      <>
        {title.slice(0, idx)}
        <mark className="search-highlight">{title.slice(idx, idx + debouncedSearch.length)}</mark>
        {title.slice(idx + debouncedSearch.length)}
      </>
    );
  }

  const getTimeGroup = (dateStr) => {
    if (!dateStr) return 'Older';
    const date = new Date(dateStr);
    const now = new Date();
    const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return 'Previous 7 Days';
    if (diffDays < 30) return 'Previous 30 Days';
    return 'Older';
  };

  // Sort: pinned first, then by createdAt desc
  // Also filter out deleted chats
  const activeChats = chats.filter(c => !c.isDeleted);
  
  const sortedChats = [...activeChats].sort((a, b) => {
    if (a.isPinned && !b.isPinned) return -1;
    if (!a.isPinned && b.isPinned) return 1;
    return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
  });

  // Filter by debounced search query
  const filteredChats = debouncedSearch.trim()
    ? sortedChats.filter(c => {
        const q = debouncedSearch.toLowerCase();
        const inTitle = getDisplayTitle(c).toLowerCase().includes(q);
        const inMsgs = Array.isArray(c.messages) && c.messages.some(m => m.text?.toLowerCase().includes(q));
        return inTitle || inMsgs;
      })
    : sortedChats;

  // Grouping logic (only when not searching)
  const groups = [];
  if (!debouncedSearch.trim()) {
    const pinned = filteredChats.filter(c => c.isPinned);
    if (pinned.length > 0) {
      groups.push({ label: 'Pinned', items: pinned });
    }

    const unpinned = filteredChats.filter(c => !c.isPinned);
    const unpinnedGroups = {};
    unpinned.forEach(chat => {
      const g = getTimeGroup(chat.createdAt);
      if (!unpinnedGroups[g]) unpinnedGroups[g] = [];
      unpinnedGroups[g].push(chat);
    });

    ['Today', 'Yesterday', 'Previous 7 Days', 'Previous 30 Days', 'Older'].forEach(label => {
      if (unpinnedGroups[label] && unpinnedGroups[label].length > 0) {
        groups.push({ label, items: unpinnedGroups[label] });
      }
    });
  } else {
    groups.push({ label: 'Search Results', items: filteredChats });
  }

  const handleDeleteClick = (e, chatId) => {
    e.stopPropagation();
    if (confirmDeleteId === chatId) {
      deleteChat(chatId);
      setConfirmDeleteId(null);
    } else {
      setConfirmDeleteId(chatId);
      setTimeout(() => setConfirmDeleteId(null), 3000);
    }
  };

  return (
    <aside className={`sidebar${collapsed ? ' collapsed' : ''}`}>

      {/* COLLAPSED RAIL */}
      {collapsed ? (
        <div className="rail">
          <button className="rail-btn rail-expand" onClick={() => setCollapsed(false)} title="Expand sidebar">›</button>
          <button className="rail-btn rail-new" onClick={() => startNewChat()} title="New Query">＋</button>
          <div className="rail-divider" />
          <div className="rail-chats">
            {sortedChats.slice(0, 10).map(chat => (
              <button
                key={chat.id}
                className={`rail-chat-btn ${currentChatId === chat.id ? 'active' : ''}`}
                onClick={() => loadChat(chat.id)}
                title={getDisplayTitle(chat)}
              >
                <span className="rail-chat-char">{getDisplayTitle(chat).charAt(0).toUpperCase()}</span>
              </button>
            ))}
          </div>
          <div style={{ flex: 1 }} />
          <div className="rail-divider" />
          <button className="rail-btn" onClick={toggleTheme} title={theme === 'light' ? 'Dark mode' : 'Light mode'}>{theme === 'light' ? '☾' : '☀'}</button>
          <button className="rail-btn" onClick={onOpenSettings} title="Settings">⚙</button>
        </div>
      ) : (
        /* EXPANDED SIDEBAR */
        <>
          <div className="sidebar-top">
            <button className="new-chat-btn" onClick={() => { startNewChat(); setSearchQuery(''); setSearchOpen(false); }}>
              <span className="new-chat-icon">＋</span>
              <span className="new-chat-text">New Query</span>
            </button>
            <button className="collapse-btn" onClick={() => { setSearchOpen(s => !s); setSearchQuery(''); }} title="Search chats">🔍</button>
            <button className="collapse-btn" onClick={() => setCollapsed(true)} title="Collapse">‹</button>
          </div>

          {searchOpen && (
            <div className="search-wrap">
              <input
                className="search-input"
                type="text"
                placeholder="Search history..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                autoFocus
              />
            </div>
          )}

          <div className="history-list">
            {groups.length > 0 ? groups.map(group => (
              <React.Fragment key={group.label}>
                <div className="sidebar-group-label">{group.label}</div>
                {group.items.map(chat => (
                  <div
                    key={chat.id}
                    className={`history-item ${String(currentChatId) === String(chat.id) ? 'active' : ''}`}
                    onClick={() => { if (renamingId !== chat.id) { loadChat(chat.id); setSearchQuery(''); setSearchOpen(false); } }}
                  >
                    <span className="history-icon">{chat.isPinned ? '📌' : '💬'}</span>

                    {renamingId === chat.id ? (
                      <input
                        ref={renameInputRef}
                        className="rename-input"
                        value={renameVal}
                        onChange={e => setRenameVal(e.target.value)}
                        onClick={e => e.stopPropagation()}
                        onKeyDown={e => {
                          if (e.key === 'Enter') commitRename();
                          if (e.key === 'Escape') cancelRename();
                        }}
                        onBlur={commitRename}
                      />
                    ) : (
                      <span className="history-title">{highlightTitle(getDisplayTitle(chat))}</span>
                    )}

                    {!renamingId && (
                      <div className="history-actions">
                        <button className="sidebar-action-btn" onClick={e => startRename(e, chat)} title="Rename">✎</button>
                        <button className={`sidebar-action-btn ${chat.isPinned ? 'pinned' : ''}`} onClick={e => { e.stopPropagation(); pinChat(chat.id); }} title={chat.isPinned ? 'Unpin' : 'Pin'}>
                          {chat.isPinned ? '📌' : '📍'}
                        </button>
                        <button
                          className={`sidebar-action-btn history-delete-btn ${confirmDeleteId === chat.id ? 'confirm' : ''}`}
                          onClick={e => handleDeleteClick(e, chat.id)}
                          title={confirmDeleteId === chat.id ? 'Confirm?' : 'Delete'}
                        >
                          {confirmDeleteId === chat.id ? '?' : '✕'}
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </React.Fragment>
            )) : (
              <div className="history-empty">
                <span className="history-empty-icon">◈</span>
                <span className="history-empty-title">{debouncedSearch ? 'No results found' : 'No chat history'}</span>
              </div>
            )}
          </div>

          <div className="sidebar-footer">
            {currentUser && (
              <div className="sidebar-user-info">
                <div className="sidebar-user-name">{currentUser.full_name || currentUser.username}</div>
                <div className="sidebar-user-role">{currentUser.role}</div>
              </div>
            )}
            {onDashboard && (
              <div className="footer-item" onClick={onDashboard}>
                <span className="footer-icon">◈</span>
                <span className="footer-text">Dashboard</span>
              </div>
            )}
            {onAdmin && (
              <div className="footer-item" onClick={onAdmin}>
                <span className="footer-icon">👥</span>
                <span className="footer-text">Users</span>
              </div>
            )}
            <div className="footer-item" onClick={toggleTheme}>
              <span className="footer-icon">{theme === 'light' ? '☾' : '☀'}</span>
              <span className="footer-text">{theme === 'light' ? 'Dark' : 'Light'}</span>
            </div>
            <div className="footer-item" onClick={onOpenSettings}>
              <span className="footer-icon">⚙</span>
              <span className="footer-text">Settings</span>
            </div>
            <Popconfirm
              title="Sign out"
              description="Are you sure you want to log out?"
              onConfirm={onLogout}
              okText="Yes"
              cancelText="No"
              placement="rightBottom"
              icon={<QuestionCircleOutlined style={{ color: '#ff4d4f' }} />}
            >
              <div className="footer-item" style={{ color: '#f87171' }}>
                <span className="footer-icon">⏏</span>
                <span className="footer-text">Sign Out</span>
              </div>
            </Popconfirm>
          </div>
        </>
      )}
    </aside>
  );
}

Sidebar.propTypes = {
  startNewChat: PropTypes.func.isRequired,
  onOpenSettings: PropTypes.func.isRequired,
  chats: PropTypes.array,
  loadChat: PropTypes.func.isRequired,
  currentChatId: PropTypes.string,
  deleteChat: PropTypes.func,
  pinChat: PropTypes.func,
  renameChat: PropTypes.func,
};
