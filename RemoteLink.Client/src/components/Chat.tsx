import { useEffect, useRef, useState } from 'react';
import * as signalR from '@microsoft/signalr';
import { createChatConnection, getChatLog, getChatLogDates, deleteChatLog, type ChatMessage } from '../api/chat';

interface ChatProps {
  senderName: string;
}

function initials(name: string) {
  return name.slice(0, 2).toUpperCase();
}

function formatLogDate(date: string) {
  return new Date(date + 'T00:00:00').toLocaleDateString(undefined, {
    weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
  });
}

export default function Chat({ senderName }: ChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [showLogs, setShowLogs] = useState(false);
  const [logDates, setLogDates] = useState<string[]>([]);
  const [deletingDate, setDeletingDate] = useState<string | null>(null);

  const connectionRef = useRef<signalR.HubConnection | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const todayLoaded = useRef(false);

  useEffect(() => {
    const connection = createChatConnection();
    connectionRef.current = connection;

    connection.on('ReceiveMessage', (sender: string, message: string, timestamp: string) => {
      setMessages((prev) => [...prev, { sender, message, timestamp }]);
    });

    connection.onreconnecting(() => setStatus('connecting'));
    connection.onreconnected(() => setStatus('connected'));
    connection.onclose(() => setStatus('disconnected'));

    connection.start()
      .then(async () => {
        setStatus('connected');
        if (!todayLoaded.current) {
          todayLoaded.current = true;
          const today = new Date().toISOString().slice(0, 10);
          try {
            const history = await getChatLog(today);
            if (history.length > 0) setMessages(history);
          } catch { /* no log for today yet */ }
        }
      })
      .catch(() => setStatus('disconnected'));

    return () => { connection.stop(); };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || !connectionRef.current) return;
    await connectionRef.current.invoke('SendMessage', senderName, input.trim());
    setInput('');
  }

  async function copyMessage(index: number, text: string) {
    await navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 1500);
  }

  async function openLogs() {
    const dates = await getChatLogDates();
    setLogDates(dates);
    setShowLogs(true);
  }

  async function handleDelete(date: string) {
    setDeletingDate(date);
    try {
      await deleteChatLog(date);
      setLogDates((prev) => prev.filter((d) => d !== date));
    } finally {
      setDeletingDate(null);
    }
  }

  const statusLabel = status === 'connected' ? 'Connected' : status === 'connecting' ? 'Connecting…' : 'Disconnected';

  return (
    <div className="chat-panel">
      <div className="chat-statusbar" data-status={status}>
        <span className="status-dot" />
        {statusLabel}
        <button className="chat-logs-btn" onClick={showLogs ? () => setShowLogs(false) : openLogs}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
            <polyline points="10 9 9 9 8 9" />
          </svg>
          {showLogs ? 'Back' : 'Logs'}
        </button>
      </div>

      {showLogs ? (
        <div className="chat-logs-panel">
          {logDates.length === 0 ? (
            <div className="chat-empty">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              <p>No logs yet</p>
            </div>
          ) : (
            logDates.map((date) => (
              <div className="chat-log-item" key={date}>
                <span className="chat-log-date">{formatLogDate(date)}</span>
                <button
                  className="btn-delete-log"
                  disabled={deletingDate === date}
                  onClick={() => handleDelete(date)}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                    <path d="M10 11v6M14 11v6" />
                    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                  </svg>
                  {deletingDate === date ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            ))
          )}
        </div>
      ) : (
        <div className="chat-messages">
          {messages.length === 0 && (
            <div className="chat-empty">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              <p>No messages yet</p>
            </div>
          )}

          {messages.map((msg, i) => {
            const isOwn = msg.sender === senderName;
            return (
              <div key={i} className={`chat-message-row ${isOwn ? 'own' : ''}`}>
                <div className="chat-avatar">{initials(msg.sender)}</div>
                <div className="chat-bubble-wrap">
                  {!isOwn && <span className="chat-sender">{msg.sender}</span>}
                  <span
                    className="chat-bubble"
                    title="Click to copy"
                    onClick={() => copyMessage(i, msg.message)}
                  >
                    {msg.message}
                    {copiedIndex === i && <span className="chat-copied-toast">Copied!</span>}
                  </span>
                  <span className="chat-time">{new Date(msg.timestamp).toLocaleTimeString()}</span>
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>
      )}

      <form className="chat-input-area" onSubmit={sendMessage}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message…"
          disabled={status !== 'connected'}
        />
        <button type="submit" className="btn-send" disabled={status !== 'connected' || !input.trim()}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </form>
    </div>
  );
}
