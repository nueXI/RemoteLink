import { useState } from 'react';
import { getToken, clearToken } from './api/auth';
import Login from './components/Login';
import Chat from './components/Chat';
import Files from './components/Files';
import Screen from './components/Screen';
import './App.css';

type Tab = 'chat' | 'files' | 'screen';

export default function App() {
  const [authenticated, setAuthenticated] = useState(() => !!getToken());
  const [tab, setTab] = useState<Tab>('chat');
  const [senderName] = useState(() =>
    /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ? 'Phone' : 'PC'
  );

  if (!authenticated) {
    return <Login onSuccess={() => setAuthenticated(true)} />;
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-logo">
          <div className="app-logo-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
          </div>
          <span className="app-title">RemoteLink</span>
        </div>

        <div className="tab-switcher">
          <button className={tab === 'chat' ? 'active' : ''} onClick={() => setTab('chat')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            Chat
          </button>
          <button className={tab === 'files' ? 'active' : ''} onClick={() => setTab('files')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
            Files
          </button>
          <button className={tab === 'screen' ? 'active' : ''} onClick={() => setTab('screen')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <path d="M8 21h8M12 17v4" />
            </svg>
            Screen
          </button>
        </div>

        <div className="header-right">
          <span className="device-badge">{senderName}</span>
          <button
            className="btn-logout"
            onClick={() => { clearToken(); setAuthenticated(false); }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            <span>Logout</span>
          </button>
        </div>
      </header>

      <main>
        {tab === 'chat' ? <Chat senderName={senderName} /> : tab === 'files' ? <Files /> : <Screen />}
      </main>
    </div>
  );
}
