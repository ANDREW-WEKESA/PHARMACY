import { useState } from 'react';
import { get, post, put, qs } from '../api.js';
import { ROLE_LABEL, eatTime, download } from '../util.js';
import { PageHead, Spinner, ErrorBox, useLoad, useDebounced, Empty, Badge, Modal, Field, Tabs, useToast } from '../ui.jsx';

export default function Settings({ user, pharmacy, refreshSession }) {
  const owner = user.role === 'owner';
  const [tab, setTab] = useState(owner ? 'pharmacy' : 'account');
  const tabs = [...(owner ? [{ id: 'pharmacy', label: 'Pharmacy' }, { id: 'users', label: 'Users' }] : []), { id: 'account', label: 'My account' }, ...(owner ? [{ id: 'audit', label: 'Audit log' }, { id: 'backup', label: 'Backup' }] : [])];
  return (
    <>
      <PageHead icon="⚙️" title="Settings" sub="Pharmacy details, staff and security" />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'pharmacy' && <PharmacyForm pharmacy={pharmacy} refresh={refreshSession} />}
      {tab === 'users' && <Users me={user} />}
      {tab === 'account' && <Account user={user} />}
      {tab === 'audit' && <Audit />}
      {tab === 'backup' && <Backup />}
    </>
  );
}

function PharmacyForm({ pharmacy, refresh }) {
  const toast = useToast(); const [f, setF] = useState(pharmacy); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async (e) => { e.preventDefault(); setErr(''); setBusy(true); try { await put('/settings', f); await refresh(); toast('Settings saved'); } catch (x) { setErr(x.message); } finally { setBusy(false); } };
  return <form className="card" onSubmit={save}><h3>Pharmacy details</h3>
    <p className="sub" style={{ marginTop: -6 }}>These appear on every receipt and report.</p>
    <div className="form-grid">
      <Field label="Registered pharmacy name" className="full"><input required value={f.name || ''} onChange={set('name')} /></Field>
      <Field label="Address" className="full"><input value={f.address || ''} onChange={set('address')} /></Field>
      <Field label="Phone"><input value={f.phone || ''} onChange={set('phone')} /></Field><Field label="Email"><input value={f.email || ''} onChange={set('email')} /></Field>
      <Field label="KRA PIN"><input value={f.kra_pin || ''} onChange={set('kra_pin')} /></Field><Field label="PPB premises licence no."><input value={f.licence_no || ''} onChange={set('licence_no')} /></Field>
      <Field label="Superintendent pharmacist"><input value={f.superintendent_name || ''} onChange={set('superintendent_name')} /></Field><Field label="Pharmacist registration no."><input value={f.superintendent_reg_no || ''} onChange={set('superintendent_reg_no')} /></Field>
      <Field label="M-Pesa till / paybill"><input value={f.mpesa_till || ''} onChange={set('mpesa_till')} /></Field>
      <Field label="Receipt footer message" className="full"><input value={f.receipt_footer || ''} onChange={set('receipt_footer')} /></Field>
    </div>
    <h3 style={{ margin: '20px 0 8px' }}>Rules and alerts</h3>
    <div className="form-grid">
      <Field label="VAT rate (%)" hint="Used for drugs marked as VAT-able. Prices include VAT."><input type="number" min="0" max="100" step="0.5" value={f.vat_rate} onChange={set('vat_rate')} /></Field>
      <Field label="Maximum cashier discount (%)"><input type="number" min="0" max="100" step="0.5" value={f.max_cashier_discount} onChange={set('max_cashier_discount')} /></Field>
      <Field label="Warn about expiry (days before)"><input type="number" min="1" value={f.expiry_warn_days} onChange={set('expiry_warn_days')} /></Field>
      <Field label="Default reorder level (units)"><input type="number" min="0" value={f.default_reorder_level} onChange={set('default_reorder_level')} /></Field>
    </div>
    <ErrorBox error={err} /><button className="btn primary" style={{ marginTop: 14 }} disabled={busy}>{busy ? 'Saving…' : 'Save settings'}</button></form>;
}

function Users({ me }) {
  const toast = useToast(); const r = useLoad(() => get('/users')); const [edit, setEdit] = useState(null);
  return <div className="card"><div className="card-head"><h3>Staff accounts</h3><button className="btn primary sm" onClick={() => setEdit({ name: '', email: '', phone: '', role: 'cashier', password: '', reg_no: '', active: 1 })}>+ Add user</button></div>
    <div className="infobox">Owner: everything. Pharmacist: sells, approves prescriptions, manages stock and catalogue. Cashier: sells and views own sales. Stock clerk: receives stock and records damages.</div>
    <ErrorBox error={r.error} retry={r.reload} />{r.loading && !r.data ? <Spinner /> :
      <div className="table-wrap"><table><thead><tr><th>Name</th><th>Sign-in</th><th>Role</th><th>Status</th><th /></tr></thead><tbody>
        {r.data?.users.map((u) => <tr key={u.id}><td><strong>{u.name}</strong>{u.reg_no && <div className="sub">Reg: {u.reg_no}</div>}</td><td>{u.email}<div className="sub">{u.phone}</div></td><td>{ROLE_LABEL[u.role]}</td><td>{u.active ? <Badge kind="ok">Active</Badge> : <Badge>Disabled</Badge>}</td><td><button className="btn sm" onClick={() => setEdit({ ...u, password: '' })}>Edit</button></td></tr>)}</tbody></table></div>}
    {edit && <UserForm u={edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); toast('User saved'); r.reload(); }} />}</div>;
}
function UserForm({ u, onClose, onDone }) {
  const [f, setF] = useState(u); const [err, setErr] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => { setErr(''); try { f.id ? await put('/users/' + f.id, { ...f, password: f.password || undefined }) : await post('/users', f); onDone(); } catch (e) { setErr(e.message); } };
  return <Modal title={f.id ? 'Edit user' : 'Add user'} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Save</button></>}>
    <div className="form-grid"><Field label="Full name *" className="full"><input autoFocus value={f.name} onChange={set('name')} /></Field>
      <Field label="Email"><input type="email" value={f.email || ''} onChange={set('email')} /></Field><Field label="Phone"><input value={f.phone || ''} onChange={set('phone')} /></Field>
      <Field label="Role"><select value={f.role} onChange={set('role')}>{Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      <Field label="Registration no." hint="Pharmacists"><input value={f.reg_no || ''} onChange={set('reg_no')} /></Field>
      <Field label={f.id ? 'New password (leave blank to keep)' : 'Password *'} hint="At least 8 characters" className="full"><input type="password" value={f.password} onChange={set('password')} autoComplete="new-password" /></Field>
      {f.id && <label className="check full"><input type="checkbox" checked={!!f.active} onChange={(e) => setF({ ...f, active: e.target.checked ? 1 : 0 })} /> Account is active (untick to stop this person signing in)</label>}</div>
    <ErrorBox error={err} /></Modal>;
}

function Account({ user }) {
  const toast = useToast(); const [f, setF] = useState({ current_password: '', new_password: '', again: '' }); const [err, setErr] = useState('');
  const save = async (e) => { e.preventDefault(); setErr(''); if (f.new_password !== f.again) return setErr('The new passwords do not match.'); try { await post('/auth/change-password', { current_password: f.current_password, new_password: f.new_password }); toast('Password changed'); setF({ current_password: '', new_password: '', again: '' }); } catch (x) { setErr(x.message); } };
  return <form className="card" onSubmit={save} style={{ maxWidth: 520 }}><h3>My account</h3><p><strong>{user.name}</strong> · {ROLE_LABEL[user.role]}<br /><span className="sub">{user.email} {user.phone}</span></p>
    <div className="stack"><Field label="Current password"><input type="password" value={f.current_password} onChange={(e) => setF({ ...f, current_password: e.target.value })} autoComplete="current-password" required /></Field>
      <Field label="New password" hint="At least 8 characters"><input type="password" value={f.new_password} onChange={(e) => setF({ ...f, new_password: e.target.value })} autoComplete="new-password" required minLength={8} /></Field>
      <Field label="Repeat new password"><input type="password" value={f.again} onChange={(e) => setF({ ...f, again: e.target.value })} autoComplete="new-password" required /></Field></div>
    <ErrorBox error={err} /><button className="btn primary" style={{ marginTop: 12 }}>Change password</button></form>;
}

function Audit() {
  const [search, setSearch] = useState(''); const dq = useDebounced(search); const [page, setPage] = useState(1);
  const r = useLoad(() => get('/audit' + qs({ q: dq, page })), [dq, page]); const x = r.data; const pages = x ? Math.max(1, Math.ceil(x.total / 50)) : 1;
  return <div className="card"><h3>Audit log</h3><p className="sub" style={{ marginTop: -6 }}>Every login, sale, void, price change and stock adjustment. It cannot be edited.</p>
    <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search by action, person or detail" style={{ marginBottom: 12 }} aria-label="Search audit log" />
    <ErrorBox error={r.error} retry={r.reload} />{r.loading && !x ? <Spinner /> : x?.rows.length === 0 ? <Empty icon="🔎" title="Nothing found" /> : <>
      <div className="table-wrap"><table><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Record</th><th>Detail</th></tr></thead><tbody>{x?.rows.map((a) => <tr key={a.id}><td style={{ whiteSpace: 'nowrap' }}>{eatTime(a.created_at)}</td><td>{a.user_name || '—'}</td><td><Badge kind={/void|refund|failed|deactiv/.test(a.action) ? 'bad' : 'gray'}>{a.action.replace(/_/g, ' ')}</Badge></td><td>{a.entity} {a.entity_id}</td><td className="sub" style={{ maxWidth: 320, wordBreak: 'break-word' }}>{a.detail}</td></tr>)}</tbody></table></div>
      <div className="pager"><button className="btn sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Previous</button><span>Page {page} of {pages}</span><button className="btn sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next →</button></div></>}</div>;
}

function Backup() {
  const toast = useToast(); const [busy, setBusy] = useState(false);
  const run = async () => { setBusy(true); try { const d = await get('/backup'); download(`pharmacy-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(d), 'application/json'); toast('Backup downloaded'); } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); } };
  return <div className="card" style={{ maxWidth: 620 }}><h3>Backup</h3>
    <p>Download a full copy of your data (drugs, stock, sales, register, audit log) as a file. Keep it somewhere safe, such as your email or a flash disk. Passwords are never included.</p>
    <p className="sub">The hosting service also keeps automatic backups of the database (Cloudflare D1 Time Travel), which can restore the database to any point in the last 30 days on a paid plan or 7 days on the free plan.</p>
    <button className="btn primary" disabled={busy} onClick={run}>{busy ? 'Preparing…' : '⬇ Download backup now'}</button></div>;
}
