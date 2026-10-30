import { useState } from 'react';
import { post } from '../api.js';
import { Field, ErrorBox } from '../ui.jsx';

export function Setup({ onDone }) {
  const [f, setF] = useState({ pharmacy_name: '', address: '', pharmacy_phone: '', kra_pin: '', licence_no: '', superintendent_name: '', superintendent_reg_no: '', mpesa_till: '', owner_name: '', owner_email: '', owner_phone: '', password: '', password2: '' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault(); setErr('');
    if (f.password !== f.password2) return setErr('The two passwords do not match.');
    setBusy(true);
    try { const { password2, ...body } = f; const r = await post('/setup', body); await onDone(r.token); }
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <div className="auth"><form className="auth-card" style={{ width: 'min(700px,100%)' }} onSubmit={submit}>
      <div className="auth-logo">💊</div>
      <h1>Set up your pharmacy</h1>
      <p>Enter the pharmacy's registered details once. They appear on receipts and reports, and you can change them later in Settings.</p>
      <div className="form-grid">
        <Field label="Registered pharmacy name *" className="full"><input required value={f.pharmacy_name} onChange={set('pharmacy_name')} autoFocus /></Field>
        <Field label="Address" className="full"><input value={f.address} onChange={set('address')} placeholder="Street, town, county" /></Field>
        <Field label="Pharmacy phone"><input value={f.pharmacy_phone} onChange={set('pharmacy_phone')} placeholder="0712 345 678" inputMode="tel" /></Field>
        <Field label="KRA PIN"><input value={f.kra_pin} onChange={set('kra_pin')} placeholder="P000000000X" /></Field>
        <Field label="Premises licence number (PPB)"><input value={f.licence_no} onChange={set('licence_no')} /></Field>
        <Field label="M-Pesa till / paybill"><input value={f.mpesa_till} onChange={set('mpesa_till')} /></Field>
        <Field label="Superintendent pharmacist"><input value={f.superintendent_name} onChange={set('superintendent_name')} /></Field>
        <Field label="Pharmacist registration number"><input value={f.superintendent_reg_no} onChange={set('superintendent_reg_no')} /></Field>
      </div>
      <h3 style={{ margin: '22px 0 10px' }}>Owner account</h3>
      <div className="form-grid">
        <Field label="Owner's full name *" className="full"><input required value={f.owner_name} onChange={set('owner_name')} /></Field>
        <Field label="Email"><input type="email" value={f.owner_email} onChange={set('owner_email')} autoComplete="username" /></Field>
        <Field label="Phone"><input value={f.owner_phone} onChange={set('owner_phone')} inputMode="tel" /></Field>
        <Field label="Password *" hint="At least 8 characters"><input type="password" required minLength={8} value={f.password} onChange={set('password')} autoComplete="new-password" /></Field>
        <Field label="Confirm password *"><input type="password" required value={f.password2} onChange={set('password2')} autoComplete="new-password" /></Field>
      </div>
      <p className="hint" style={{ margin: '8px 0 0' }}>Use the email or the phone to sign in. At least one is needed.</p>
      <ErrorBox error={err} />
      <button className="btn primary wide" style={{ marginTop: 14 }} disabled={busy}>{busy ? 'Setting up…' : 'Create pharmacy and sign in'}</button>
    </form></div>
  );
}

export function Login({ onDone, needsSetup }) {
  const [id, setId] = useState('admin'); const [pw, setPw] = useState('');
  const [name, setName] = useState('Admin User');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setErr(''); setBusy(true);
    try {
      if (needsSetup) {
        // First time setup - create default pharmacy and user
        const r = await post('/setup', {
          pharmacy_name: 'My Pharmacy',
          owner_name: name,
          owner_email: id.includes('@') ? id : '',
          owner_phone: id.includes('@') ? '' : id,
          password: pw
        });
        await onDone(r.token);
      } else {
        const r = await post('/auth/login', { identifier: id, password: pw });
        await onDone(r.token);
      }
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <div className="auth"><form className="auth-card" onSubmit={submit}>
      <div className="auth-logo">💊</div>
      <h1>{needsSetup ? 'Create Account' : 'Sign in'}</h1>
      <p>{needsSetup ? 'Set up your account to get started' : 'Enter your credentials'}</p>
      <div className="stack">
        {needsSetup && <Field label="Your name"><input value={name} onChange={(e) => setName(e.target.value)} required /></Field>}
        <Field label="Email or phone"><input value={id} onChange={(e) => setId(e.target.value)} autoFocus autoComplete="username" required /></Field>
        <Field label="Password"><input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete={needsSetup ? "new-password" : "current-password"} required minLength={needsSetup ? 8 : undefined} /></Field>
        <ErrorBox error={err} />
        <button className="btn primary wide" disabled={busy}>{busy ? (needsSetup ? 'Creating…' : 'Signing in…') : (needsSetup ? 'Create Account' : 'Sign in')}</button>
      </div>
    </form></div>
  );
}
