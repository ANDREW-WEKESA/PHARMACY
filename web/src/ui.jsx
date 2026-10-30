import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

// ---------- toasts ----------
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((msg, kind = 'ok') => {
    const id = Math.random().toString(36).slice(2);
    setItems((x) => [...x, { id, msg, kind }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), kind === 'err' ? 6000 : 3000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => <div key={t.id} className={'toast ' + t.kind}>{t.msg}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}

// ---------- modal ----------
export function Modal({ title, onClose, children, wide, footer }) {
  useEffect(() => {
    const h = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={'modal' + (wide ? ' wide' : '')} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head"><h3>{title}</h3><button className="icon-btn" onClick={onClose} aria-label="Close">✕</button></div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

// ---------- small pieces ----------
export const Field = ({ label, hint, children, className = '' }) => (
  <label className={'field ' + className}><span className="field-label">{label}</span>{children}{hint && <span className="hint">{hint}</span>}</label>
);
export const PageHead = ({ icon, title, sub, children }) => (
  <div className="page-head">
    <div><h1>{icon && <span className="page-icon">{icon}</span>}{title}</h1>{sub && <p>{sub}</p>}</div>
    <div className="page-actions">{children}</div>
  </div>
);
export const Empty = ({ icon = '💊', title, sub }) => (
  <div className="empty"><div className="empty-icon">{icon}</div><strong>{title}</strong>{sub && <span>{sub}</span>}</div>
);
export const Badge = ({ kind = 'gray', children }) => <span className={'badge ' + kind}>{children}</span>;
export const Spinner = () => <div className="spinner" aria-label="Loading" />;
export const ErrorBox = ({ error, retry }) => error ? <div className="errbox">{error}{retry && <button className="btn sm" onClick={retry}>Try again</button>}</div> : null;

export function Tabs({ tabs, value, onChange }) {
  return <div className="tabs" role="tablist">{tabs.map((t) => (
    <button key={t.id} role="tab" aria-selected={value === t.id} className={value === t.id ? 'on' : ''} onClick={() => onChange(t.id)}>{t.label}</button>
  ))}</div>;
}

// load data with loading + error state
export function useLoad(fn, deps = []) {
  const [state, set] = useState({ loading: true, data: null, error: '' });
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const run = useCallback(async () => {
    set((s) => ({ ...s, loading: true, error: '' }));
    try { set({ loading: false, data: await fnRef.current(), error: '' }); }
    catch (e) { set((s) => ({ loading: false, data: s.data, error: e.message })); }
  }, []); // eslint-disable-line
  useEffect(() => { run(); }, deps); // eslint-disable-line
  return { ...state, reload: run };
}

export function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

export function Confirm({ title, message, confirmLabel = 'Confirm', danger, onConfirm, onClose }) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={title} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className={'btn ' + (danger ? 'danger' : 'primary')} disabled={busy} onClick={async () => { setBusy(true); try { await onConfirm(); } finally { setBusy(false); } }}>{confirmLabel}</button>
    </>}><p>{message}</p></Modal>
  );
}
