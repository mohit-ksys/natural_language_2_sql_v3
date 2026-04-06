import React, { useState, useEffect, useRef } from 'react';
import PropTypes from 'prop-types';

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

  // Debounce search query by 300ms
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

  // Sort: pinned first, then by createdAt desc
  const sortedChats = [...chats].sort((a, b) => {
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

  const visibleChats = showAll || debouncedSearch ? filteredChats : filteredChats.slice(0, VISIBLE_COUNT);
  const hiddenCount = filteredChats.length - VISIBLE_COUNT;

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

  const hasPinned = filteredChats.some(c => c.isPinned);

  const handleDeleteClick = (e, chatId) => {
    e.stopPropagation();
    if (confirmDeleteId === chatId) {
      // Second click: confirmed
      deleteChat(chatId);
      setConfirmDeleteId(null);
    } else {
      setConfirmDeleteId(chatId);
      // Auto-cancel after 3 seconds
      setTimeout(() => setConfirmDeleteId(null), 3000);
    }
  };

  return (
    <aside className={`sidebar${collapsed ? ' collapsed' : ''}`}>

      {/* COLLAPSED RAIL */}
      {collapsed ? (
        <div className="rail">
          {/* Expand toggle at top */}
          <button
            className="rail-btn rail-expand"
            onClick={() => setCollapsed(false)}
            title="Expand sidebar"
          >›</button>

          {/* New chat */}
          <button
            className="rail-btn rail-new"
            onClick={() => { startNewChat(); }}
            title="New Query"
          >＋</button>

          {/* Divider */}
          <div className="rail-divider" />

          {/* Recent chats as icon pills */}
          <div className="rail-chats">
            {sortedChats.slice(0, 8).map(chat => (
              <button
                key={chat.id}
                className={`rail-chat-btn ${currentChatId === chat.id ? 'active' : ''}`}
                onClick={() => loadChat(chat.id)}
                title={getDisplayTitle(chat)}
              >
                <span className="rail-chat-char">
                  {getDisplayTitle(chat).charAt(0).toUpperCase()}
                </span>
              </button>
            ))}
          </div>

          {/* Spacer */}
          <div style={{ flex: 1 }} />

          {/* Footer icons */}
          <div className="rail-divider" />
          <button className="rail-btn" onClick={toggleTheme} title={theme === 'light' ? 'Dark mode' : 'Light mode'}>
            {theme === 'light' ? '☾' : '☀'}
          </button>
          <button className="rail-btn" onClick={onOpenSettings} title="Settings">
            ⚙
          </button>
        </div>
      ) : (
        /* EXPANDED SIDEBAR */
        <>
          <div className="sidebar-top">
            <button className="new-chat-btn" onClick={() => { startNewChat(); setSearchQuery(''); setSearchOpen(false); }} title="New Query">
              <span className="new-chat-icon">＋</span>
              <span className="new-chat-text">New Query</span>
            </button>
            <button
              className="collapse-btn"
              onClick={() => { setSearchOpen(s => !s); setSearchQuery(''); }}
              title="Search chats"
              style={{ fontSize: '13px' }}
            >🔍</button>
            <button
              className="collapse-btn"
              onClick={() => setCollapsed(true)}
              title="Collapse sidebar"
            >‹</button>
          </div>

          {/* SEARCH INPUT */}
          {searchOpen && (
            <div className="search-wrap">
              <input
                className="search-input"
                type="text"
                placeholder="Search chats..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                autoFocus
              />
            </div>
          )}

          <div className="sidebar-section-label">{debouncedSearch ? 'Results' : 'Chat History'}</div>

          <div className="history-list">
            {filteredChats.length > 0 ? (
              <>
                {hasPinned && !debouncedSearch && (
                  <div className="sidebar-pin-label">📌 Pinned</div>
                )}
                {visibleChats.map((chat) => (
                  <div
                    key={chat.id}
                    className={`history-item ${currentChatId === chat.id ? 'active' : ''} ${chat.isPinned ? 'pinned' : ''}`}
                    onClick={() => { if (renamingId !== chat.id) { loadChat(chat.id); setSearchQuery(''); setSearchOpen(false); } }}
                    title={renamingId === chat.id ? undefined : getDisplayTitle(chat)}
                  >
                    <span className="history-icon">{chat.isPinned ? '📌' : '💬'}</span>

                    {/* RENAME inline editor */}
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

                    <div className="history-actions">
                      {renamingId !== chat.id && (
                        <button
                          className="history-rename-btn"
                          title="Rename chat"
                          onClick={e => startRename(e, chat)}
                        >✎</button>
                      )}
                      {pinChat && (
                        <button
                          className={`history-pin-btn ${chat.isPinned ? 'pinned' : ''}`}
                          title={chat.isPinned ? 'Unpin' : 'Pin chat'}
                          onClick={e => { e.stopPropagation(); pinChat(chat.id); }}
                        >{chat.isPinned ? '📌' : '📍'}</button>
                      )}
                      {deleteChat && (
                        <button
                          className={`history-delete-btn ${confirmDeleteId === chat.id ? 'confirm' : ''}`}
                          title={confirmDeleteId === chat.id ? 'Click again to confirm delete' : 'Delete chat'}
                          onClick={e => handleDeleteClick(e, chat.id)}
                        >{confirmDeleteId === chat.id ? '?' : '✕'}</button>
                      )}
                    </div>
                  </div>
                ))}
                {!showAll && !debouncedSearch && hiddenCount > 0 && (
                  <button className="show-more-btn" onClick={() => setShowAll(true)}>
                    <span className="show-more-icon">↓</span>
                    <span className="show-more-text">{hiddenCount} more</span>
                  </button>
                )}
                {showAll && !debouncedSearch && filteredChats.length > VISIBLE_COUNT && (
                  <button className="show-more-btn" onClick={() => setShowAll(false)}>
                    <span className="show-more-icon">↑</span>
                    <span className="show-more-text">Show less</span>
                  </button>
                )}
              </>
            ) : (
              <div className="history-empty">
                <span className="history-empty-icon">◈</span>
                <span className="history-empty-title">{debouncedSearch ? 'No results' : 'No chats yet'}</span>
                <span className="history-empty-sub">{debouncedSearch ? 'Try a different search' : 'Click + New Query to start'}</span>
              </div>
            )}
          </div>

          <div className="sidebar-footer">
            {currentUser && (
              <div className="sidebar-user-info">
                {currentUser.full_name || currentUser.username}
                <span className="sidebar-user-role">{currentUser.role}</span>
              </div>
            )}
            {onDashboard && (
              <div className="footer-item" onClick={onDashboard} title="Dashboard">
                <span className="footer-icon">◈</span>
                <span className="footer-text">Dashboard</span>
              </div>
            )}
            {onAdmin && (
              <div className="footer-item" onClick={onAdmin} title="User Management">
                <span className="footer-icon">👥</span>
                <span className="footer-text">Users</span>
              </div>
            )}
            <div className="footer-item" onClick={toggleTheme} title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}>
              <span className="footer-icon">{theme === 'light' ? '☾' : '☀'}</span>
              <span className="footer-text">{theme === 'light' ? 'Dark' : 'Light'}</span>
            </div>
            <div className="footer-item" onClick={onOpenSettings} title="Settings">
              <span className="footer-icon">⚙</span>
              <span className="footer-text">Settings</span>
            </div>
            {onLogout && (
              <div className="footer-item" onClick={onLogout} title="Sign out" style={{ color: '#f87171' }}>
                <span className="footer-icon">⏏</span>
                <span className="footer-text">Sign Out</span>
              </div>
            )}
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
