import { useCallback, useEffect, useState } from 'react';
import { get, post, getToken, setToken, setUnauthorizedHandler } from './api.js';
import { ROLE_LABEL } from './util.js';
import { Spinner, useToast } from './ui.jsx';
import { AuthNew } from './pages/AuthNew.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Stock from './pages/Stock.jsx';
import Sales from './pages/Sales.jsx';
import Catalog from './pages/Catalog.jsx';
import Reports from './pages/Reports.jsx';
import Settings from './pages/Settings.jsx';
import { AuditLog } from './pages/AuditLog.jsx';

const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: '📊', roles: ['owner', 'pharmacist', 'cashier'], C: Dashboard },
  { id: 'sales', label: 'Sales History', icon: '💊', roles: ['owner', 'pharmacist', 'cashier'], C: Sales },
  { id: 'stock', label: 'Stock Management', icon: '📦', roles: ['owner', 'pharmacist', 'stock_clerk'], C: Stock },
  { id: 'catalog', label: 'Drug Catalog', icon: '📖', roles: ['owner', 'pharmacist', 'cashier', 'stock_clerk'], C: Catalog },
  { id: 'reports', label: 'Reports', icon: '🧾', roles: ['owner', 'pharmacist', 'cashier'], C: Reports },
  { id: 'audit', label: 'Audit Log', icon: '📋', roles: ['owner'], C: AuditLog },
  { id: 'settings', label: 'Settings', icon: '⚙️', roles: ['owner', 'pharmacist', 'cashier', 'stock_clerk'], C: Settings },
];

export default function App() {
  const [boot, setBoot] = useState({ loading: true, needsSetup: false, error: '' });
  const [session, setSession] = useState(null); // { user, pharmacy }
  const toast = useToast();

  const logout = useCallback(() => { setToken(null); setSession(null); }, []);
  useEffect(() => { setUnauthorizedHandler(() => { setToken(null); setSession(null); toast('Your session ended. Please sign in again.', 'err'); }); }, [toast]);

  const refreshSession = useCallback(async () => {
    const me = await get('/auth/me');
    setSession(me);
  }, []);

  useEffect(() => {
    // Auto-login with bypass token
    setToken('bypass');
    (async () => {
      try {
        const s = await get('/setup/status');
        await refreshSession(); // Just load the session directly
        setBoot({ loading: false, needsSetup: false, error: '' });
      } catch (e) { setBoot({ loading: false, needsSetup: false, error: e.message }); }
    })();
  }, [refreshSession]);

  const onAuthed = async (token) => { setToken(token); await refreshSession(); setBoot((b) => ({ ...b, needsSetup: false })); };

  if (boot.loading) return <div className="auth"><Spinner /></div>;
  if (boot.error) return <div className="auth"><div className="auth-card"><h1>Can't reach the server</h1><p>{boot.error}</p><button className="btn primary" onClick={() => location.reload()}>Try again</button></div></div>;
  // Show new professional auth page
  if (!session) return <AuthNew onDone={onAuthed} needsSetup={boot.needsSetup} />;
  return <Shell session={session} refreshSession={refreshSession} logout={logout} />;
}

function Shell({ session, refreshSession, logout }) {
  const { user, pharmacy } = session;
  const items = NAV.filter((n) => n.roles.includes(user.role));
  const fromHash = () => { const h = location.hash.replace('#/', ''); return items.some((i) => i.id === h) ? h : items[0].id; };
  const [page, setPage] = useState(fromHash);
  const [open, setOpen] = useState(false);
  useEffect(() => { const h = () => setPage(fromHash()); window.addEventListener('hashchange', h); return () => window.removeEventListener('hashchange', h); }); // eslint-disable-line
  const go = (id) => { location.hash = '#/' + id; setPage(id); setOpen(false); };
  const Cur = items.find((i) => i.id === page)?.C || items[0].C;
  const initials = user.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  useEffect(() => { document.title = pharmacy.name; }, [pharmacy.name]);

  return (
    <div className="shell">
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <aside className={'sidebar' + (open ? ' open' : '')}>
        <div className="brand">
          <div className="brand-logo">💊</div>
          <h2>{pharmacy.name}</h2>
          <small>Pharmacy Management System</small>
        </div>
        <nav className="nav" aria-label="Main">
          {items.map((n) => <button key={n.id} className={page === n.id ? 'on' : ''} onClick={() => go(n.id)} aria-current={page === n.id ? 'page' : undefined}><span className="ico">{n.icon}</span>{n.label}</button>)}
        </nav>
        <div className="side-user">
          <div className="avatar">{initials}</div>
          <strong>{user.name}</strong>
          <small>{ROLE_LABEL[user.role]}</small>
          <button className="btn" onClick={logout}>🚪 Logout</button>
        </div>
      </aside>
      <main className="main">
        <div className="mobile-bar"><button onClick={() => setOpen(true)} aria-label="Open menu">☰</button>{pharmacy.name}</div>
        <Cur key={page} user={user} pharmacy={pharmacy} go={go} refreshSession={refreshSession} />
      </main>
    </div>
  );
}
