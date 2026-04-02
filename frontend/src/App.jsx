import React, { useState, useEffect, useRef, useCallback } from 'react';
import Sidebar from './components/Sidebar';
import Hero from './components/Hero';
import Thread from './components/Thread';
import InputDock from './components/InputDock';
import SettingsModal from './components/SettingsModal';
import { sendQuery, formatUtcTimestamp, checkHealth, loadChatsFromBackend, saveChatsToBackend, requestMCQs, submitMCQAnswers } from './services/api';

export default function App() {
  const [messages, setMessages] = useState([]);
  const [chatStarted, setChatStarted] = useState(false);
  const [chats, setChats] = useState([]);
  const [currentChatId, setCurrentChatId] = useState(null);
  const [msgCounter, setMsgCounter] = useState(0);

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const DEFAULT_SETTINGS = { datahubConnected: false, autoRunQuery: false, hideQuery: false, mcqEnabled: false };
  const [settings, setSettings] = useState(() => {
    try {
      const saved = localStorage.getItem('dw-settings');
      if (saved) return { ...DEFAULT_SETTINGS, ...JSON.parse(saved), datahubConnected: false };
    } catch {}
    return DEFAULT_SETTINGS;
  });

  const [model, setModel] = useState('gemini-3.1-flash-lite-preview');
  const [thinkOn, setThinkOn] = useState(false);

  const [toastMsg, setToastMsg] = useState('');
  const [showToast, setShowToast] = useState(false);

  // Toast queue so rapid toasts don't overwrite each other
  const toastQueue = useRef([]);
  const toastBusy = useRef(false);
  const processToastFn = useRef(null);

  const [isLoading, setIsLoading] = useState(true);
  const [backendStatus, setBackendStatus] = useState(null);

  // Load chats from backend
  useEffect(() => {
    const loadChats = async () => {
      try {
        const result = await loadChatsFromBackend();

        if (result.ok && result.chats && result.chats.length > 0) {
          setChats(result.chats);

          // Restore last active chat
          if (result.lastChatId) {
            const lastChat = result.chats.find(c => c.id === result.lastChatId);
            if (lastChat) {
              setCurrentChatId(result.lastChatId);
              const chatMessages = Array.isArray(lastChat.messages) ? lastChat.messages : [];
              setMessages(chatMessages);
              setChatStarted(chatMessages.length > 0);
              setMsgCounter(chatMessages.length);
              console.log(`✅ Restored chat: ${result.lastChatId} with ${chatMessages.length} messages from backend`);
              return;
            }
          }

          // If no lastChatId, load first chat
          const firstChat = result.chats[0];
          setCurrentChatId(firstChat.id);
          const chatMessages = Array.isArray(firstChat.messages) ? firstChat.messages : [];
          setMessages(chatMessages);
          setChatStarted(chatMessages.length > 0);
          setMsgCounter(chatMessages.length);
          console.log(`✅ Loaded first chat: ${firstChat.id} from backend`);
        } else {
          console.log('No saved chats found on backend - starting fresh');
        }
      } catch (e) {
        console.error('Failed to load chats from backend:', e);
      }
    };

    loadChats();
  }, []);

  // Helper function to save to backend
  const saveChatsToBackendAsync = (chatsToSave, lastChatId) => {
    saveChatsToBackend(chatsToSave, lastChatId).catch(e => {
      console.error('Failed to save chats to backend:', e);
    });
  };

  // Persist current chat messages whenever messages change
  useEffect(() => {
    if (currentChatId && messages && messages.length >= 0) {
      const updatedChats = chats.map(c => {
        if (c.id === currentChatId) {
          const lastMsg = messages[messages.length - 1];
          const preview = lastMsg && lastMsg.text ? lastMsg.text.slice(0, 50) : '';
          return { ...c, messages, lastMessage: preview };
        }
        return c;
      });

      setChats(updatedChats);
      // Save to backend
      saveChatsToBackendAsync(updatedChats, currentChatId);
    }
  }, [messages, currentChatId]);

  // Save data before page unloads
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (currentChatId && messages.length > 0) {
        const finalChats = chats.map(c => {
          if (c.id === currentChatId) {
            const lastMsg = messages[messages.length - 1];
            const preview = lastMsg && lastMsg.text ? lastMsg.text.slice(0, 50) : '';
            return { ...c, messages, lastMessage: preview };
          }
          return c;
        });
        // Synchronous save attempt
        navigator.sendBeacon(`${window.location.origin.replace('localhost:5173', 'localhost:8001')}/chats/save`,
          JSON.stringify({ chats: finalChats, lastChatId: currentChatId })
        );
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [currentChatId, messages, chats]);

  // Initialize on mount
  useEffect(() => {
    const initApp = async () => {
      // Check backend health
      const healthRes = await checkHealth();
      setBackendStatus(healthRes.ok ? 'connected' : 'disconnected');
      setIsLoading(false);
    };

    initApp();
  }, []);

  // Persist settings to localStorage (exclude runtime-only keys)
  useEffect(() => {
    try {
      const { datahubConnected, ...persistable } = settings;
      localStorage.setItem('dw-settings', JSON.stringify(persistable));
    } catch {}
  }, [settings]);

  // Toast queue processing
  processToastFn.current = () => {
    if (toastQueue.current.length === 0) { toastBusy.current = false; return; }
    toastBusy.current = true;
    const { msg, ms } = toastQueue.current.shift();
    setToastMsg(msg);
    setShowToast(true);
    setTimeout(() => {
      setShowToast(false);
      setTimeout(() => processToastFn.current?.(), 350);
    }, ms);
  };

  const addToast = useCallback((msg, ms = 2400) => {
    toastQueue.current.push({ msg, ms });
    if (!toastBusy.current) processToastFn.current?.();
  }, []);

  // Use the actual query as title, truncated neatly at a word boundary
  const generateChatTitle = (query) => {
    const q = query.trim();
    if (!q) return 'New Chat';
    if (q.length <= 38) return q;
    // Truncate at last space before limit
    const cut = q.slice(0, 38);
    const lastSpace = cut.lastIndexOf(' ');
    return (lastSpace > 20 ? cut.slice(0, lastSpace) : cut) + '…';
  };

  const _ensureChat = (text) => {
    let chatIdToUse = currentChatId;
    let isFirstQuery = false;
    if (!currentChatId) {
      isFirstQuery = true;
      chatIdToUse = `chat-${Date.now()}`;
      const newChat = {
        id: chatIdToUse,
        title: 'Generating title...',
        messages: [],
        lastMessage: '',
        createdAt: new Date().toISOString(),
        isPinned: false,
      };
      setChats(prev => [newChat, ...prev]);
      setCurrentChatId(chatIdToUse);
    }
    return { chatIdToUse, isFirstQuery };
  };

  const _updateTitleOnFirst = (isFirstQuery, chatIdToUse, text) => {
    if (isFirstQuery) {
      const newTitle = generateChatTitle(text);
      setChats(prev => {
        const updated = prev.map(c => c.id === chatIdToUse ? { ...c, title: newTitle } : c);
        saveChatsToBackendAsync(updated, chatIdToUse);
        return updated;
      });
    }
  };

  const handleSendMessage = async (text, isFix = false) => {
    if (!chatStarted) setChatStarted(true);

    const { chatIdToUse, isFirstQuery } = _ensureChat(text);

    // Add user message
    setMsgCounter(prev => prev + 1);
    const userMsgCounter = msgCounter + 1;
    const userMsgId = `u-${userMsgCounter}`;
    const newMsgs = [...messages, { id: userMsgId, type: 'user', text, isFix, timestamp: new Date().toISOString() }];
    setMessages(newMsgs);

    const sessionId = chatIdToUse.replace('chat-', 'session-');

    // MCQ path: request clarifying questions instead of direct SQL
    if (settings.mcqEnabled && !isFix) {
      setTimeout(async () => {
        try {
          const res = await requestMCQs(sessionId, text, model, chatIdToUse);
          if (res.ok) {
            _updateTitleOnFirst(isFirstQuery, chatIdToUse, text);
            setMsgCounter(prev => prev + 1);
            setMessages(prev => [
              ...prev,
              {
                id: `mcq-${userMsgCounter + 1}`,
                type: 'mcq',
                model: model,
                query_id: res.data.query_id,
                questions: res.data.questions,
                original_query: res.data.original_query,
                sessionId,
                chatId: chatIdToUse,
                timestamp: new Date().toISOString(),
              }
            ]);
          } else {
            // Fallback to direct query if MCQ fails
            console.warn('MCQ failed, falling back to direct query:', res.error);
            _directQuery(sessionId, text, chatIdToUse, isFirstQuery, userMsgCounter);
          }
        } catch (err) {
          console.error('MCQ Error:', err);
          _directQuery(sessionId, text, chatIdToUse, isFirstQuery, userMsgCounter);
        }
      }, 700);
      return;
    }

    // Direct path (MCQ disabled or fix)
    setTimeout(async () => {
      _directQuery(sessionId, text, chatIdToUse, isFirstQuery, userMsgCounter);
    }, 700);
  };

  const _directQuery = async (sessionId, text, chatIdToUse, isFirstQuery, userMsgCounter) => {
    try {
      const res = await sendQuery(sessionId, text, model, settings.autoRunQuery, chatIdToUse);

      if (res.ok) {
        const { sql, answer, chart_type, data, execution_time, session_context_alert } = res.data;
        _updateTitleOnFirst(isFirstQuery, chatIdToUse, text);

        setMsgCounter(prev => prev + 1);
        setMessages(prev => [
          ...prev,
          {
            id: `ai-${userMsgCounter + 1}`,
            type: 'ai',
            model: model,
            isRegen: false,
            sql,
            answer,
            chart_type,
            data,
            execution_time,
            session_context_alert,
            sessionId,
            userQuery: text,
            feedbackId: '',
            token_usage: res.data.token_usage || null,
            timestamp: new Date().toISOString(),
          }
        ]);

        if (session_context_alert) {
          addToast(session_context_alert, 3000);
        }
      } else {
        addToast(`❌ Error: ${res.error}`);
        setMsgCounter(prev => prev + 1);
        setMessages(prev => [
          ...prev,
          {
            id: `ai-${userMsgCounter + 1}`,
            type: 'ai-error',
            error: res.error,
          }
        ]);
      }
    } catch (err) {
      console.error('Error:', err);
      addToast('❌ Failed to generate query');
    }
  };

  const handleSubmitMCQAnswers = async (queryId, answers) => {
    const sessionId = currentChatId?.replace('chat-', 'session-');
    if (!sessionId) return;

    try {
      const res = await submitMCQAnswers(queryId, sessionId, answers, model, settings.autoRunQuery, currentChatId);
      if (res.ok) {
        const { sql, answer, chart_type, data, execution_time, session_context_alert } = res.data;
        setMsgCounter(prev => prev + 1);
        setMessages(prev => [
          ...prev,
          {
            id: `ai-${msgCounter + 1}`,
            type: 'ai',
            model: model,
            isRegen: false,
            sql,
            answer,
            chart_type,
            data,
            execution_time,
            session_context_alert,
            sessionId,
            userQuery: prev.find(m => m.type === 'mcq' && m.query_id === queryId)?.original_query || '',
            feedbackId: res.data.feedback_id || '',
            query_id: queryId,
            token_usage: res.data.token_usage || null,
            timestamp: new Date().toISOString(),
          }
        ]);
        if (session_context_alert) addToast(session_context_alert, 3000);
      } else {
        addToast(`❌ Error: ${res.error}`);
        setMsgCounter(prev => prev + 1);
        setMessages(prev => [...prev, { id: `ai-err-${msgCounter + 1}`, type: 'ai-error', error: res.error }]);
      }
    } catch (err) {
      console.error('MCQ submit error:', err);
      addToast('❌ Failed to process MCQ answers');
    }
  };

  const handleSkipMCQ = async (queryId, originalQuery) => {
    const sessionId = currentChatId?.replace('chat-', 'session-');
    if (!sessionId || !originalQuery) return;

    try {
      const res = await sendQuery(sessionId, originalQuery, model, settings.autoRunQuery, currentChatId);
      if (res.ok) {
        const { sql, answer, chart_type, data, execution_time, session_context_alert } = res.data;
        setMsgCounter(prev => prev + 1);
        setMessages(prev => [
          ...prev,
          {
            id: `ai-${msgCounter + 1}`,
            type: 'ai',
            model: model,
            isRegen: false,
            sql,
            answer,
            chart_type,
            data,
            execution_time,
            session_context_alert,
            sessionId,
            userQuery: originalQuery,
            feedbackId: '',
            token_usage: res.data.token_usage || null,
            timestamp: new Date().toISOString(),
          }
        ]);
        if (session_context_alert) addToast(session_context_alert, 3000);
      } else {
        addToast(`❌ Error: ${res.error}`);
      }
    } catch (err) {
      console.error('Skip MCQ error:', err);
      addToast('❌ Failed to generate query');
    }
  };

  const handleFix = (aiMsgId, fixText, mcqQueryId) => {
    // Add fix request as user message
    setMsgCounter(prev => prev + 1);
    const fixMsgCounter = msgCounter + 1;
    setMessages(prev => [
      ...prev,
      { id: `u-${fixMsgCounter}`, type: 'user', text: fixText, isFix: true }
    ]);

    const sessionId = currentChatId.replace('chat-', 'session-');
    setTimeout(async () => {
      let res;
      if (mcqQueryId) {
        // Use /english-feedback to preserve MCQ context
        const { submitEnglishFeedback } = await import('./services/api');
        res = await submitEnglishFeedback(mcqQueryId, sessionId, fixText, model, settings.autoRunQuery, currentChatId);
      } else {
        res = await sendQuery(sessionId, fixText, model, true, currentChatId);
      }
      if (res.ok) {
        const { sql, answer, chart_type, data, execution_time } = res.data;
        setMsgCounter(prev => prev + 1);
        setMessages(prev => [
          ...prev,
          {
            id: `ai-${fixMsgCounter + 1}`,
            type: 'ai',
            model: model,
            isRegen: true,
            sql,
            answer,
            chart_type,
            data,
            execution_time,
            sessionId,
            userQuery: fixText,
            feedbackId: '',
            query_id: mcqQueryId || undefined,
          }
        ]);
      } else {
        addToast(`❌ Error: ${res.error}`);
      }
    }, 1400);
  };

  const handleRegen = (aiMsgId) => {
    // Get the previous query to regenerate
    const lastUserMsg = [...messages].reverse().find(m => m.type === 'user');
    if (!lastUserMsg) return;

    const sessionId = currentChatId.replace('chat-', 'session-');
    const regenMsgCounter = msgCounter + 1;

    setTimeout(async () => {
      const res = await sendQuery(sessionId, lastUserMsg.text, model, true, currentChatId);
      if (res.ok) {
        const { sql, answer, chart_type, data, execution_time } = res.data;
        setMsgCounter(prev => prev + 1);
        setMessages(prev => [
          ...prev,
          {
            id: `ai-${regenMsgCounter}`,
            type: 'ai',
            model: model,
            isRegen: true,
            sql,
            answer,
            chart_type,
            data,
            execution_time,
            sessionId,
            userQuery: lastUserMsg.text,
            feedbackId: '',
          }
        ]);
      }
    }, 1400);
  };

  const startNewChat = () => {
    // Save current chat if it has messages
    let updatedChats = chats;
    if (currentChatId && messages.length > 0) {
      updatedChats = chats.map(c => {
        if (c.id === currentChatId) {
          const lastMsg = messages[messages.length - 1];
          const preview = lastMsg && lastMsg.text ? lastMsg.text.slice(0, 50) : '';
          return { ...c, messages, lastMessage: preview };
        }
        return c;
      });
      setChats(updatedChats);
      saveChatsToBackendAsync(updatedChats, currentChatId);
    }

    // Create new chat
    const newChatId = `chat-${Date.now()}`;
    const newChat = {
      id: newChatId,
      title: 'New Chat',
      messages: [],
      lastMessage: '',
      createdAt: new Date().toISOString(),
      isPinned: false,
    };

    const newChatsArray = [newChat, ...updatedChats];
    setChats(newChatsArray);
    saveChatsToBackendAsync(newChatsArray, newChatId);
    setCurrentChatId(newChatId);
    setMessages([]);
    setChatStarted(false);
    setMsgCounter(0);
  };

  const renameChat = (chatId, newTitle) => {
    const updatedChats = chats.map(c => c.id === chatId ? { ...c, title: newTitle } : c);
    setChats(updatedChats);
    saveChatsToBackendAsync(updatedChats, currentChatId);
  };

  const pinChat = (chatId) => {
    const updatedChats = chats.map(c => c.id === chatId ? { ...c, isPinned: !c.isPinned } : c);
    setChats(updatedChats);
    saveChatsToBackendAsync(updatedChats, currentChatId);
  };

  const deleteChat = (chatId) => {
    const updatedChats = chats.filter(c => c.id !== chatId);
    setChats(updatedChats);

    if (chatId === currentChatId) {
      // Switch to next available chat or blank state
      const nextChat = updatedChats[0];
      if (nextChat) {
        setCurrentChatId(nextChat.id);
        const chatMessages = Array.isArray(nextChat.messages) ? nextChat.messages : [];
        setMessages(chatMessages);
        setChatStarted(chatMessages.length > 0);
        setMsgCounter(chatMessages.length);
      } else {
        setCurrentChatId(null);
        setMessages([]);
        setChatStarted(false);
        setMsgCounter(0);
      }
    }

    saveChatsToBackendAsync(updatedChats, chatId === currentChatId ? (updatedChats[0]?.id || null) : currentChatId);
  };

  const loadChat = (chatId) => {
    // Save current chat before switching
    let updatedChats = chats;
    if (currentChatId && messages.length > 0) {
      updatedChats = chats.map(c => {
        if (c.id === currentChatId) {
          const lastMsg = messages[messages.length - 1];
          const preview = lastMsg && lastMsg.text ? lastMsg.text.slice(0, 50) : '';
          return { ...c, messages, lastMessage: preview };
        }
        return c;
      });
      setChats(updatedChats);
      saveChatsToBackendAsync(updatedChats, chatId);
    }

    // Load selected chat
    const chat = updatedChats.find(c => c.id === chatId);
    if (chat) {
      setCurrentChatId(chatId);
      const chatMessages = Array.isArray(chat.messages) ? chat.messages : [];
      setMessages(chatMessages);
      setChatStarted(chatMessages.length > 0);
      setMsgCounter(chatMessages.length);
      // Backend saves last chat ID via saveChatsToBackend
      console.log(`✅ Loaded chat: ${chatId} with ${chatMessages.length} messages`);
    }
  };

  if (isLoading) {
    return (
      <div className="app loading">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
          <div style={{ textAlign: 'center', color: '#999' }}>
            <div style={{ fontSize: '24px', marginBottom: '10px' }}>⟳ Initializing ChatWithDB...</div>
            <div style={{ fontSize: '12px' }}>Connecting to backend...</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <Sidebar
        startNewChat={startNewChat}
        onOpenSettings={() => setIsSettingsOpen(true)}
        chats={chats}
        loadChat={loadChat}
        currentChatId={currentChatId}
        deleteChat={deleteChat}
        pinChat={pinChat}
        renameChat={renameChat}
      />

      <main className="main">
        <Hero
          isHidden={chatStarted}
          onSendChip={(text) => handleSendMessage(text, false)}
        />

        <Thread
          messages={messages}
          addToast={addToast}
          onFix={handleFix}
          onRegen={handleRegen}
          onSubmitMCQAnswers={handleSubmitMCQAnswers}
          onSkipMCQ={handleSkipMCQ}
          settings={settings}
        />

        <InputDock
          onSendMessage={t => handleSendMessage(t, false)}
          model={model}
          setModel={setModel}
          thinkOn={thinkOn}
          setThinkOn={setThinkOn}
          chatStarted={chatStarted}
        />
      </main>

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        setSettings={setSettings}
        backendStatus={backendStatus}
      />

      <div className={`toast ${showToast ? 'show' : ''}`} id="toast">
        {toastMsg}
      </div>
    </div>
  );
}
