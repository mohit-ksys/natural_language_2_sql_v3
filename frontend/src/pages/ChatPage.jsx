import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Hero from '../components/Hero';
import Thread from '../components/Thread';
import InputDock from '../components/InputDock';
import { 
  sendQuery, requestMCQs, submitMCQAnswers, submitEnglishFeedback, 
  loadChatMessages, saveChatsToBackend 
} from '../services/api';

export default function ChatPage({ 
  currentUser, registerSave, chats, setChats, settings,
  model, setModel, thinkOn, setThinkOn, isInitialLoading
}) {
  const { chatId } = useParams();
  const navigate = useNavigate();
  
  const [messages, setMessages] = useState([]);
  const [chatStarted, setChatStarted] = useState(false);
  const [msgCounter, setMsgCounter] = useState(0);

  const updateMessage = (msgId, updates) => {
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, ...updates } : m));
  };
  const [hasMore, setHasMore] = useState(false);
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  const [isMessagesLoading, setIsMessagesLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [offset, setOffset] = useState(0);
  const LIMIT = 50;

  const [toastMsg, setToastMsg] = useState('');
  const [showToast, setShowToast] = useState(false);
  const toastQueue = useRef([]);
  const toastBusy = useRef(false);
  const processToastFn = useRef(null);

  const lmsType = currentUser?.role === 'super_admin'
    ? (settings.lmsTypeOverride || 'online')
    : (currentUser?.lms_type || null);

  useEffect(() => {
    if (!chatId) {
       setMessages([]);
       setChatStarted(false);
       setOffset(0);
       setHasMore(false);
       setNotFound(false);
       return;
    }
   if (!isInitialLoading && chats && chats.length > 0) {
      const exists = chats.some(c => c.id === chatId);
      if (!exists) {
        setNotFound(true);
        return;
      }
    }

    let isMounted = true;
    const fetchMsgs = async () => {
      setIsMessagesLoading(true);
      setMessages([]); 
      setChatStarted(false);
      setOffset(0);
      setHasMore(false);
      setNotFound(false);

   
      try {
        const res = await loadChatMessages(chatId, LIMIT, 0);
        if (isMounted) {
          if (res.ok) {
            const msgs = res.messages || [];
            if (msgs.length === 0 && !res.has_more) {
                   
            }
            setMessages(msgs);
            setHasMore(res.hasMore || res.has_more);
            setOffset(msgs.length);
            setChatStarted(msgs.length > 0);
            setMsgCounter(msgs.length);
          } else {
            setNotFound(true);
          }
        }
      } catch (err) {
        console.error('Failed to load messages for chat:', chatId, err);
        if (isMounted) setNotFound(true);
      } finally {
        if (isMounted) setIsMessagesLoading(false);
      }
    };

    fetchMsgs();
    return () => { isMounted = false; };
  }, [chatId]);

  const saveChatsToBackendAsync = (chatsToSave, lastId) => {
    saveChatsToBackend(chatsToSave, lastId).catch(e => console.error('Failed to save chats:', e));
  };

  useEffect(() => {
    if (!chatId || !messages || messages.length === 0) return;
    
    setChats(prev => {
      if (!prev || !Array.isArray(prev)) return prev;
       const updatedChats = prev.map(c => {
        if (c.id === chatId) {
          const validMsgs = Array.isArray(messages) ? messages : [];
          const lastMsg = [...validMsgs].reverse().find(m => m.type === 'ai' || m.type === 'user');
          const preview = lastMsg?.text ? lastMsg.text.slice(0, 50) : (lastMsg?.answer ? lastMsg.answer.slice(0, 50) : '');
          return { ...c, lastMessage: preview, messages: validMsgs }; 
        }
        return { ...c, messages: undefined };
      });
      saveChatsToBackendAsync(updatedChats, chatId);
      return updatedChats;
    });
  }, [messages, chatId]);

  useEffect(() => {
    if (!registerSave) return;
    registerSave(async () => {
      if (!chatId) return;
      const finalChats = chats.map(c => {
        if (c.id === chatId) {
          const lastMsg = [...messages].reverse().find(m => m.type === 'ai' || m.type === 'user');
          return { ...c, lastMessage: lastMsg?.text?.slice(0, 50) || lastMsg?.answer?.slice(0, 50) || '' };
        }
        return c;
      });
      await saveChatsToBackend(finalChats, chatId);
    });
  }, [registerSave, chatId, chats, messages]);

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

  const generateChatTitle = (query) => {
    const q = query.trim();
    if (!q) return 'New Chat';
    if (q.length <= 38) return q;
    const cut = q.slice(0, 38);
    const lastSpace = cut.lastIndexOf(' ');
    return (lastSpace > 20 ? cut.slice(0, lastSpace) : cut) + '…';
  };

  const _ensureChat = (text) => {
    let chatIdToUse = chatId;
    let isFirstQuery = false;
    if (!chatId) {
      isFirstQuery = true;
      chatIdToUse = `chat-${Date.now()}`;
      const newChat = { id: chatIdToUse, title: 'Generating title...', messages: [], lastMessage: '', createdAt: new Date().toISOString(), isPinned: false };
      setChats(prev => [newChat, ...prev]);
    } else {
      const currentChat = chats.find(c => c.id === chatId);
      if (currentChat && (currentChat.title === 'New Chat' || currentChat.title === 'Generating title...')) {
        isFirstQuery = true;
      }
    }
    return { chatIdToUse, isFirstQuery };
  };

  const _updateTitleOnFirst = (isFirstQuery, chatIdToUse, text) => {
    if (isFirstQuery) {
      const newTitle = generateChatTitle(text);
      setChats(prev => prev.map(c => c.id === chatIdToUse ? { ...c, title: newTitle } : c));
    }
  };

  const handleSendMessage = async (text, isFix = false) => {
    if (!chatStarted) setChatStarted(true);
    const { chatIdToUse, isFirstQuery } = _ensureChat(text);
    
    const userMsgId = `${chatIdToUse}-u-${Date.now()}`;
    const userMsg = { id: userMsgId, type: 'user', text, isFix, timestamp: new Date().toISOString() };
    setMessages(prev => [...prev, userMsg]);
    
    const sessionId = chatIdToUse.replace('chat-', 'session-');

    if (settings.mcqEnabled && !isFix) {
      setTimeout(async () => {
        try {
          const res = await requestMCQs(sessionId, text, model, chatIdToUse, lmsType, userMsgId);
          if (res.ok && res.data.questions && res.data.questions.length > 0) {
            setMessages(prev => [...prev, { 
              id: res.data.query_id || `mcq-${Date.now()}`, 
              type: 'mcq', 
              questions: res.data.questions,
              original_query: text,
              query_id: res.data.query_id,
              model,
              chatId: chatIdToUse,
              timestamp: new Date().toISOString()
            }]);
          } else {
            // Fallback if no questions returned or failed
            _directQuery(sessionId, text, chatIdToUse, isFirstQuery, userMsgId);
          }
        } catch (e) {
          _directQuery(sessionId, text, chatIdToUse, isFirstQuery, userMsgId);
        }
      }, 500);
    } else {
      _directQuery(sessionId, text, chatIdToUse, isFirstQuery, userMsgId);
    }
  };

  const _directQuery = async (sessionId, text, chatIdToUse, isFirstQuery, userMsgId) => {
    try {
      const canAutoRun = settings.autoRunQuery || (currentUser?.role !== 'super_admin' && currentUser?.role !== 'Supervisor');
      const res = await sendQuery(sessionId, text, model, canAutoRun, chatIdToUse, lmsType, userMsgId);

      if (res.ok) {
        const { feedback_id, sql, execution_time, answer, chart_type, data, token_usage, session_context_alert, sql_auto_fixed, sql_error, thoughts } = res.data;
        _updateTitleOnFirst(isFirstQuery, chatIdToUse, text);
        const aiMsgId = feedback_id ? `ai-${feedback_id}` : `${chatIdToUse}-ai-${Date.now()}`;
        setMessages(prev => [...prev, {
          id: aiMsgId, 
          type: 'ai', 
          model,
          sql, 
          answer, 
          chart_type, 
          data, 
          execution_time,
          sessionId, 
          chatId: chatIdToUse,
          userQuery: text, 
          feedbackId: feedback_id,
          token_usage, 
          session_context_alert,
          sql_auto_fixed,
          sql_error,
          thoughts,
          timestamp: new Date().toISOString(),
        }]);
        if (session_context_alert) addToast(session_context_alert, 3000);
        if (isFirstQuery) navigate(`/c/${chatIdToUse}`, { replace: true });
      } else {
        addToast(`Error: ${res.error}`);
        setMsgCounter(prev => prev + 1);
        setMessages(prev => [...prev, { id: `ai-${userMsgCounter + 1}`, type: 'ai-error', error: res.error }]);
      }
    } catch (err) {
      addToast('Failed to generate query');
    }
  };

  const handleSubmitMCQAnswers = async (queryId, answers) => {
    const sessionId = chatId?.replace('chat-', 'session-');
    if (!sessionId) return;
    try {
      const chatIdToUse = chatId;
      const canAutoRun = settings.autoRunQuery || (currentUser?.role !== 'super_admin' && currentUser?.role !== 'Supervisor');
      const res = await submitMCQAnswers(queryId, sessionId, answers, model, canAutoRun, chatIdToUse);

      if (res.ok) {
        const { sql, answer, chart_type, data, execution_time, session_context_alert, sql_auto_fixed, sql_error } = res.data;
        const nextCounter = msgCounter + 1;
        setMsgCounter(nextCounter);
        setMessages(prev => {
          const filtered = prev.filter(m => !(m.type === 'mcq' && m.query_id === queryId));
          return [...filtered, {
            id: `ai-${queryId}`, type: 'ai', model, isRegen: false, sql, answer,
            chart_type, data, execution_time, session_context_alert, sessionId,
            chatId: chatIdToUse,
            userQuery: prev.find(m => m.type === 'mcq' && m.query_id === queryId)?.original_query || '',
            feedbackId: res.data.feedback_id || '', query_id: queryId,
            token_usage: res.data.token_usage || null,
            sql_auto_fixed: sql_auto_fixed || false, sql_error: sql_error || null,
            timestamp: new Date().toISOString(),
          }];
        });
        if (session_context_alert) addToast(session_context_alert, 3000);
      } else {
        addToast(`Error: ${res.error}`);
        const nextCounter = msgCounter + 1;
        setMsgCounter(nextCounter);
        setMessages(prev => [...prev, { id: `${chatId}-err-${Date.now()}`, type: 'ai-error', error: res.error }]);
      }
    } catch (err) {
      addToast('Failed to process MCQ answers');
    }
  };

  const handleSkipMCQ = async (queryId, originalQuery) => {
    const sessionId = chatId?.replace('chat-', 'session-');
    if (!sessionId || !originalQuery) return;
    try {
      const canAutoRun = settings.autoRunQuery || (currentUser?.role !== 'super_admin' && currentUser?.role !== 'Supervisor');
      const res = await sendQuery(sessionId, originalQuery, model, canAutoRun, chatId, lmsType);

      if (res.ok) {
        const { sql, answer, chart_type, data, execution_time, session_context_alert, sql_auto_fixed, sql_error } = res.data;
        const nextCounter = msgCounter + 1;
        setMsgCounter(nextCounter);
        setMessages(prev => {
          const filtered = prev.filter(m => !(m.type === 'mcq' && m.query_id === queryId));
          return [...filtered, {
            id: `${chatId}-ai-${Date.now()}`, type: 'ai', model, isRegen: false, sql, answer,
            chart_type, data, execution_time, session_context_alert, sessionId,
            chatId: chatId,
            userQuery: originalQuery, feedbackId: '', token_usage: res.data.token_usage || null,
            sql_auto_fixed: sql_auto_fixed || false, sql_error: sql_error || null,
            timestamp: new Date().toISOString(),
          }];
        });
        if (session_context_alert) addToast(session_context_alert, 3000);
      } else {
        addToast(`Error: ${res.error}`);
      }
    } catch (err) {
      addToast('Failed to generate query');
    }
  };

  const handleFix = (aiMsgId, fixText, mcqQueryId) => {
    const fixMsgCounter = msgCounter + 1;
    setMsgCounter(fixMsgCounter);
    setMessages(prev => [...prev, { id: `${chatId}-u-${Date.now()}`, type: 'user', text: fixText, isFix: true }]);
    const sessionId = chatId.replace('chat-', 'session-');
    setTimeout(async () => {
      let res;
      if (mcqQueryId) {
        const canAutoRun = settings.autoRunQuery || (currentUser?.role !== 'super_admin' && currentUser?.role?.toLowerCase() !== 'supervisor');
        res = await submitEnglishFeedback(mcqQueryId, sessionId, fixText, model, canAutoRun, chatId);
      } else {
        res = await sendQuery(sessionId, fixText, model, true, chatId, lmsType);
      }
      if (res.ok) {
        const { sql, answer, chart_type, data, execution_time } = res.data;
        setMsgCounter(prev => prev + 1);
        setMessages(prev => [...prev, {
          id: `${chatId}-ai-fix-${Date.now()}`, type: 'ai', model, isRegen: true, sql, answer,
          chart_type, data, execution_time, sessionId, chatId: chatId, userQuery: fixText, feedbackId: '',
          query_id: mcqQueryId || undefined,
          timestamp: new Date().toISOString(),
        }]);
      } else {
        addToast(`Error: ${res.error}`);
      }
    }, 1400);
  };

  const handleRegen = () => {
    const lastUserMsg = [...messages].reverse().find(m => m.type === 'user');
    if (!lastUserMsg) return;
    const sessionId = chatId.replace('chat-', 'session-');
    const regenMsgCounter = msgCounter + 1;
    setMsgCounter(regenMsgCounter);
    setTimeout(async () => {
      const res = await sendQuery(sessionId, lastUserMsg.text, model, true, chatId, lmsType);
      if (res.ok) {
        const { sql, answer, chart_type, data, execution_time } = res.data;
        setMessages(prev => [...prev, {
          id: `${chatId}-ai-regen-${Date.now()}`, type: 'ai', model, isRegen: true, sql, answer,
          chart_type, data, execution_time, sessionId, chatId: chatId, userQuery: lastUserMsg.text, feedbackId: '',
          timestamp: new Date().toISOString(),
        }]);
      }
    }, 1400);
  };

  const handleLoadMore = async () => {
    if (isFetchingMore || !hasMore || !chatId) return;
    setIsFetchingMore(true);
    try {
      const res = await loadChatMessages(chatId, LIMIT, offset);
      if (res.ok && Array.isArray(res.messages)) {
        setMessages(prev => [...res.messages, ...prev]);
        setHasMore(res.hasMore || res.has_more); 
        setOffset(prev => prev + res.messages.length);
      }
    } catch (err) {
      console.error('Load more failed:', err);
    } finally {
      setIsFetchingMore(false);
    }
  };

  if (notFound || (!isInitialLoading && !!chatId && chats.length > 0 && !chats.some(c => c.id === chatId))) {
    return (
      <div className="chat-not-found" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#9ca3af', background: '#050505', position: 'relative', zIndex: 10 }}>
         <div style={{ fontSize: '56px', marginBottom: '20px', background: 'rgba(239,68,68,0.1)', width: '100px', height: '100px', borderRadius: '50%', display: 'grid', placeItems: 'center', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}>◈</div>
         <div style={{ fontSize: '22px', fontWeight: 700, color: '#e2e8f0', letterSpacing: '-0.01em' }}>Conversation not found</div>
         <p style={{ fontSize: '14px', color: '#64748b', marginTop: '10px', maxWidth: '320px', textAlign: 'center', lineHeight: 1.6 }}>The thread you're looking for was either deleted, expired, or you don't have permission to view it.</p>
         <button onClick={() => navigate('/')} style={{ marginTop: '32px', background: '#4f46e5', border: 'none', color: '#fff', padding: '10px 24px', borderRadius: '10px', cursor: 'pointer', fontSize: '14px', fontWeight: 600, transition: 'all 0.2s', boxShadow: '0 4px 12px rgba(79,70,229,0.3)' }}>
            Back to Dashboard
         </button>
      </div>
    );
  }

  return (
    <>
      <Hero isHidden={chatStarted || !!chatId} onSendChip={(text) => handleSendMessage(text, false)} />
      {isMessagesLoading && !chatStarted && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6b7280' }}>
           <div className="spinner-small" style={{ marginRight: '10px' }} />
           <span>Loading conversation...</span>
        </div>
      )}
      <Thread
        messages={messages}
        addToast={addToast}
        onFix={handleFix}
        onRegen={handleRegen}
        onUpdate={updateMessage}
        onSubmitMCQAnswers={handleSubmitMCQAnswers}
        onSkipMCQ={handleSkipMCQ}
        settings={settings}
        currentUser={currentUser}
        onLoadMore={handleLoadMore}
        hasMore={hasMore}
        isFetchingMore={isFetchingMore}
        isMessagesLoading={isMessagesLoading}
      />
      <InputDock
        onSendMessage={t => handleSendMessage(t, false)}
        model={model}
        setModel={setModel}
        thinkOn={thinkOn}
        setThinkOn={setThinkOn}
        chatStarted={chatStarted || !!chatId}
      />
      <div className={`toast ${showToast ? 'show' : ''}`} id="toast">{toastMsg}</div>
    </>
  );
}
