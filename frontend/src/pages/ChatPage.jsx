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
  model, setModel, thinkOn, setThinkOn, isInitialLoading, lmsId // Added lmsId
}) {
  const { chatId: urlId } = useParams();
  const navigate = useNavigate();
  
  const [messages, setMessages] = useState([]);
  const [chatId, setChatId] = useState(urlId || null);
  const [chatStarted, setChatStarted] = useState(!!urlId);
  const [msgCounter, setMsgCounter] = useState(0);
  const isNavigatingNewChat = useRef(false);
  
  const [tempSessionId, setTempSessionId] = useState(() => crypto.randomUUID());
  const sessionId = chatId || tempSessionId;

  useEffect(() => {
    const targetId = urlId || null;
    setChatId(targetId);
    
    if (!targetId) {
       safeSetMessages([]);
       setChatStarted(false);
       setOffset(0);
       setHasMore(false);
       setNotFound(false);
       setTempSessionId(crypto.randomUUID());
       return;
    }

    setChatStarted(true);
    setNotFound(false);
    
    let isMounted = true;
    const fetchMsgs = async () => {
      if (isNavigatingNewChat.current) {
        console.log('[Chat] Skipping initial fetch for newly created chat:', targetId);
        isNavigatingNewChat.current = false;
        return;
      }
      setIsMessagesLoading(true);
      safeSetMessages([]); 
      setOffset(0);
      setHasMore(false);

      try {
        console.log('Fetching messages for chatId:', targetId, 'lmsId:', lmsId);
        // Note: loadChatMessages doesn't strictly need lmsId if chatId is unique,
        // but it's good for verification in the future.
        const res = await loadChatMessages(targetId, LIMIT, 0);
        console.log('loadChatMessages Response:', res);
        if (isMounted) {
          if (res.ok) {
            const msgs = res.messages || [];
            safeSetMessages(msgs);
            setHasMore(res.hasMore || res.has_more); 
            setOffset(msgs.length);
            setMsgCounter(msgs.length);
          } else {
            // Only set not found if the API explicitly fails or returns 404
            setNotFound(true);
          }
        }
      } catch (err) {
        console.error('Fetch msgs failed:', err);
      } finally {
        if (isMounted) setIsMessagesLoading(false);
      }
    };

    fetchMsgs();
    return () => { isMounted = false; };
  }, [urlId]);

  const safeSetMessages = useCallback((updater) => {
    setMessages(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      if (!Array.isArray(next)) return next;
      const seen = new Set();
      return next.filter(m => {
        if (!m.id) return true;
        if (seen.has(m.id)) return false;
        seen.add(m.id);
        return true;
      });
    });
  }, []);

  const updateMessage = (msgId, updates) => {
    safeSetMessages(prev => prev.map(m => m.id === msgId ? { ...m, ...updates } : m));
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
  
  // Use the lmsId prop from App.jsx
  const currentLmsId = lmsId;

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

  const updateChatListWithNewChat = (newId, title, firstQueryMsg) => {
    setChats(prev => {
      if (prev.some(c => c.id === newId)) return prev;
      const newChat = {
        id: newId,
        title: title || generateChatTitle(firstQueryMsg),
        lastMessage: firstQueryMsg.slice(0, 50),
        createdAt: new Date().toISOString(),
        isPinned: false
      };
      return [newChat, ...prev];
    });
  };

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
    const q = query?.trim() || 'New Chat';
    if (q.length <= 38) return q;
    const cut = q.slice(0, 38);
    const lastSpace = cut.lastIndexOf(' ');
    return (lastSpace > 20 ? cut.slice(0, lastSpace) : cut) + '…';
  };

  const _updateTitleOnFirst = (isFirstQuery, chatIdToUse, text) => {
    if (isFirstQuery) {
      const newTitle = generateChatTitle(text);
      setChats(prev => prev.map(c => c.id === chatIdToUse ? { ...c, title: newTitle } : c));
    }
  };

  const handleSendMessage = async (text, isFix = false) => {
    const currentSessionId = sessionId;
    const chatIdToUse = chatId; 
    
    if (!chatStarted) setChatStarted(true);
    
    const userMsgId = `u-${crypto.randomUUID()}`;
    const userMsg = { id: userMsgId, type: 'user', text, isFix, timestamp: new Date().toISOString() };
    safeSetMessages(prev => [...prev, userMsg]);
    
    if (settings.mcqEnabled && !isFix) {
      setTimeout(async () => {
        try {
          const res = await requestMCQs(currentSessionId, text, model, chatIdToUse, lmsType, userMsgId, lmsId);
          console.log('[MCQ] requestMCQs Response:', res);
          if (res.ok && res.data.questions && res.data.questions.length > 0) {
            
            const newChatId = res.data.chat_id;
            if (!chatIdToUse && newChatId) {
              isNavigatingNewChat.current = true;
              updateChatListWithNewChat(newChatId, null, text);
              setChatId(newChatId);
              window.history.replaceState(null, '', `/c/${newChatId}`);
            }

            safeSetMessages(prev => [...prev, { 
              id: res.data.mcq_msg_id || res.data.query_id || `m-${Date.now()}`, 
              type: 'mcq', 
              questions: res.data.questions,
              original_query: text,
              query_id: res.data.query_id,
              userMsgId: userMsgId, // Preserve the original User Message ID
              model,
              chatId: newChatId || chatIdToUse,
              loading: false, 
              timestamp: new Date().toISOString()
            }]);
          } else {
            _directQuery(currentSessionId, text, chatIdToUse, userMsgId);
          }
        } catch (e) {
          console.error('[MCQ] requestMCQs failed:', e);
          _directQuery(currentSessionId, text, chatIdToUse, userMsgId);
        }
      }, 500);
    } else {
      _directQuery(currentSessionId, text, chatIdToUse, userMsgId);
    }
  };

  const _directQuery = async (currentSessionId, text, chatIdToUse, userMsgId) => {
    try {
      const canAutoRun = settings.autoRunQuery || (currentUser?.role !== 'super_admin' && currentUser?.role !== 'Supervisor');
      const res = await sendQuery(currentSessionId, text, model, canAutoRun, chatIdToUse, lmsType, userMsgId, currentLmsId);

      if (res.ok) {
        const { feedback_id, sql, execution_time, answer, chart_type, data, token_usage, session_context_alert, sql_auto_fixed, sql_error, thoughts, chat_id: newChatId } = res.data;
        
        if (!chatIdToUse && newChatId) {
          isNavigatingNewChat.current = true;
          updateChatListWithNewChat(newChatId, null, text);
          setChatId(newChatId);
          navigate(`/c/${newChatId}`, { replace: true });
        }

        const aiMsgId = feedback_id ? `a-${feedback_id}` : `a-${Date.now()}`;
        safeSetMessages(prev => [...prev, {
          id: aiMsgId, 
          type: 'ai', 
          model, 
          sql, 
          answer, 
          chart_type, 
          data, 
          execution_time,
          sessionId, 
          chatId: newChatId || chatIdToUse,
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
      } else {
        addToast(`Error: ${res.error}`);
        setMsgCounter(prev => prev + 1);
        safeSetMessages(prev => [...prev, { id: `err-${Date.now()}`, type: 'ai-error', error: res.error }]);
      }
    } catch (err) {
      addToast('Failed to generate query');
    }
  };

  const handleSubmitMCQAnswers = async (queryId, answers) => {
    if (!sessionId || !queryId) return;
    
    console.log(`[MCQ] Submitting answers for queryId: ${queryId}`);
    safeSetMessages(prev => prev.map(m => (m.query_id === queryId) ? { ...m, loading: true } : m));

    try {
      const chatIdToUse = chatId;
      const canAutoRun = settings.autoRunQuery || (currentUser?.role !== 'super_admin' && currentUser?.role !== 'Supervisor');
      
      let originalUserMsgId = null;
      const m_pre = messages.find(msg => msg.query_id === queryId);
      if (m_pre) originalUserMsgId = m_pre.userMsgId || null;

      const res = await submitMCQAnswers(queryId, sessionId, answers, model, canAutoRun, chatIdToUse, currentLmsId, originalUserMsgId);

      if (res.ok) {
        const { sql, answer, chart_type, data, execution_time, session_context_alert, sql_auto_fixed, sql_error, thoughts } = res.data;
        
        let originalQuery = '';
        let originalUserMsgId = null;
        const currentMsgs = messages; // Access snapshot or use safety
        const m = currentMsgs.find(msg => msg.query_id === queryId);
        if (m) {
          originalQuery = m.original_query || m.userQuery || '';
          originalUserMsgId = m.userMsgId || null;
        }

        const aiMsgId = res.data.feedback_id ? `a-${res.data.feedback_id}` : `a-${queryId}-${Date.now()}`;
        const newAiMsg = {
          id: aiMsgId, 
          type: 'ai', 
          model, 
          isRegen: false, 
          sql, 
          answer,
          chart_type, 
          data, 
          execution_time, 
          session_context_alert, 
          sessionId,
          chatId: chatIdToUse,
          userQuery: originalQuery,
          userMsgId: originalUserMsgId,
          feedbackId: res.data.feedback_id || '', 
          query_id: queryId,
          token_usage: res.data.token_usage || null,
          sql_auto_fixed: sql_auto_fixed || false, 
          sql_error: sql_error || null,
          thoughts: thoughts || res.data.thoughts || '',
          timestamp: new Date().toISOString(),
        };

        safeSetMessages(prev => {
          const filtered = prev.filter(m => {
            const mQueryId = m.query_id || m.extra?.query_id;
            const isMatch = mQueryId === queryId || m.id === queryId || (m.id && m.id.includes(queryId));
            return !isMatch;
          });
          return [...filtered, newAiMsg];
        });

        if (session_context_alert) addToast(session_context_alert, 3000);
      } else {
        addToast(`Error: ${res.error}`);
        safeSetMessages(prev => prev.map(m => (m.query_id === queryId) ? { ...m, loading: false } : m));
        safeSetMessages(prev => [...prev, { id: `${chatId}-err-${Date.now()}`, type: 'ai-error', error: res.error }]);
      }
    } catch (err) {
      console.error('[MCQ] Submission Error:', err);
      addToast('Failed to process MCQ answers');
      safeSetMessages(prev => prev.map(m => (m.query_id === queryId) ? { ...m, loading: false } : m));
    }
  };

  const handleSkipMCQ = async (queryId, originalQuery) => {
    if (!sessionId || !originalQuery) return;
    
    console.log(`[MCQ] Skipping all for queryId: ${queryId}`);
    setMessages(prev => prev.map(m => (m.query_id === queryId) ? { ...m, loading: true } : m));

    try {
      const canAutoRun = settings.autoRunQuery || (currentUser?.role !== 'super_admin' && currentUser?.role !== 'Supervisor');
      let originalUserMsgId = null;
      const m = messages.find(msg => msg.query_id === queryId);
      if (m) originalUserMsgId = m.userMsgId || null;

      const res = await sendQuery(sessionId, originalQuery, model, canAutoRun, chatId, lmsType, originalUserMsgId, currentLmsId);

      if (res.ok) {
        const { feedback_id, sql, answer, chart_type, data, execution_time, session_context_alert, sql_auto_fixed, sql_error, thoughts } = res.data;
        const aiMsgId = `a-${feedback_id}`;
        const newAiMsg = {
          id: aiMsgId, 
          type: 'ai', 
          model, 
          isRegen: false, 
          sql, 
          answer,
          chart_type, 
          data, 
          execution_time, 
          session_context_alert, 
          sessionId,
          chatId: chatId,
          userQuery: originalQuery, 
          feedbackId: res.data.feedback_id || '', 
          token_usage: res.data.token_usage || null,
          sql_auto_fixed: sql_auto_fixed || false, 
          sql_error: sql_error || null,
          thoughts: thoughts || '',
          timestamp: new Date().toISOString(),
        };

        safeSetMessages(prev => {
          const filtered = prev.filter(m => {
            const mQueryId = m.query_id || m.extra?.query_id;
            const isMatch = mQueryId === queryId || m.id === queryId || (m.id && m.id.includes(queryId));
            return !isMatch;
          });
          return [...filtered, newAiMsg];
        });

        if (session_context_alert) addToast(session_context_alert, 3000);
      } else {
        addToast(`Error: ${res.error}`);
        safeSetMessages(prev => prev.map(m => (m.query_id === queryId) ? { ...m, loading: false } : m));
      }
    } catch (err) {
      console.error('[MCQ] Skip Error:', err);
      addToast('Failed to generate query');
      safeSetMessages(prev => prev.map(m => (m.query_id === queryId) ? { ...m, loading: false } : m));
    }
  };

  const handleFix = (aiMsgId, fixText, mcqQueryId) => {
    if (!chatStarted) setChatStarted(true);
    safeSetMessages(prev => [...prev, { id: `${chatId}-u-${Date.now()}`, type: 'user', text: fixText, isFix: true }]);
   setTimeout(async () => {
      let res;
      if (mcqQueryId) {
        const canAutoRun = settings.autoRunQuery || (currentUser?.role !== 'super_admin' && currentUser?.role?.toLowerCase() !== 'supervisor');
        res = await submitEnglishFeedback(mcqQueryId, sessionId, fixText, model, canAutoRun, chatId, lmsId);
      } else {
        res = await sendQuery(sessionId, fixText, model, true, chatId, lmsType, null, lmsId);
      }
      if (res.ok) {
        const { feedback_id, sql, answer, chart_type, data, execution_time, token_usage, thoughts } = res.data;
        setMsgCounter(prev => prev + 1);
        safeSetMessages(prev => [...prev, {
          id: feedback_id ? `a-${feedback_id}` : `ai-fix-${Date.now()}`, 
          type: 'ai', 
          model, 
          isRegen: true, 
          sql, 
          answer,
          chart_type, 
          data, 
          execution_time, 
          sessionId, 
          chatId: chatId, 
          userQuery: fixText, 
          feedbackId: feedback_id || '',
          query_id: mcqQueryId || undefined,
          token_usage,
          thoughts: thoughts || '',
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
    
    // IMMEDIATELY ADD LOADING MESSAGE
    const loadingId = `regen-loading-${Date.now()}`;
    safeSetMessages(prev => [...prev, { id: loadingId, type: 'ai-loading' }]);
    
    const currentSessionId = sessionId;
    
    setTimeout(async () => {
      try {
        const res = await sendQuery(sessionId, lastUserMsg.text, model, true, chatId, lmsType, null, currentLmsId);
        if (res.ok) {
          const { feedback_id, sql, answer, chart_type, data, execution_time, token_usage, thoughts } = res.data;
          const newMsg = {
            id: feedback_id ? `a-${feedback_id}` : `ai-regen-${Date.now()}`, 
            type: 'ai', 
            model, 
            isRegen: true, 
            sql, 
            answer,
            chart_type, 
            data, 
            execution_time, 
            sessionId, 
            chatId: chatId, 
            userQuery: lastUserMsg.text, 
            feedbackId: feedback_id || '',
            token_usage,
            thoughts: thoughts || '',
            timestamp: new Date().toISOString(),
          };
          
          // REPLACE LOADING MESSAGE WITH REAL ONE
          safeSetMessages(prev => {
            const filtered = prev.filter(m => m.id !== loadingId);
            return [...filtered, newMsg];
          });
        } else {
          // REMOVE LOADING ON ERROR
          safeSetMessages(prev => prev.filter(m => m.id !== loadingId));
          addToast(`Error: ${res.error}`);
        }
      } catch (err) {
        // REMOVE LOADING ON ERROR
        safeSetMessages(prev => prev.filter(m => m.id !== loadingId));
        console.error('[Chat] Regen failed:', err);
        addToast('Regenerate failed');
      }
    }, 400); // Reduced delay
  };

  const handleLoadMore = async () => {
    if (isFetchingMore || !hasMore || !chatId) return;
    setIsFetchingMore(true);
    try {
      const res = await loadChatMessages(chatId, LIMIT, offset);
      if (res.ok && Array.isArray(res.messages)) {
        safeSetMessages(prev => [...res.messages, ...prev]);
        setHasMore(res.hasMore || res.has_more); 
        setOffset(prev => prev + res.messages.length);
      }
    } catch (err) {
      console.error('Load more failed:', err);
    } finally {
      setIsFetchingMore(false);
    }
  };

  if (notFound) {
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
      <Hero isHidden={chatStarted || (chatId && chatId.length > 5)} onSendChip={(text) => handleSendMessage(text, false)} />
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
        lmsId={lmsId}
      />
      <InputDock
        onSendMessage={t => handleSendMessage(t, false)}
        model={model}
        setModel={setModel}
        thinkOn={thinkOn}
        setThinkOn={setThinkOn}
        chatStarted={chatStarted || (chatId && chatId.length > 5)}
      />
      <div className={`toast ${showToast ? 'show' : ''}`} id="toast">{toastMsg}</div>
    </>
  );
}
