import { useState } from 'react';
import { get, post, put, qs } from '../api.js';
import { ROLE_LABEL } from '../util.js';
import { PageHead, Spinner, ErrorBox, useLoad, useDebounced, Empty, Badge, Modal, Field, useToast } from '../ui.jsx';
import { usePharmacy } from '../contexts/PharmacyContext.jsx';

export default function StaffManagement({ user }) {
  const toast = useToast();
  const { pharmacyList } = usePharmacy();
  const [filterPharmacy, setFilterPharmacy] = useState('all');
  const [search, setSearch] = useState('');
  const dq = useDebounced(search);
  
  const s = useLoad(
    () => get('/owner/staff' + qs({ pharmacy_id: filterPharmacy !== 'all' ? filterPharmacy : '', q: dq })),
    [filterPharmacy, dq]
  );
  
  const [edit, setEdit] = useState(null);

  return (
    <>
      <PageHead icon="👥" title="All Staff" sub="Manage staff across all your pharmacies">
        <button 
          className="btn primary" 
          onClick={() => setEdit({ 
            name: '', 
            email: '', 
            phone: '', 
            password: '', 
            role: 'cashier',
            assigned_pharmacy_id: null,
            active: 1 
          })}
        >
          + Add Staff Member
        </button>
      </PageHead>

      <div className="card">
        <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          <select 
            value={filterPharmacy} 
            onChange={(e) => setFilterPharmacy(e.target.value)}
            style={{ minHeight: 44, padding: '8px 12px', flex: '0 0 auto' }}
            aria-label="Filter by pharmacy"
          >
            <option value="all">All Pharmacies</option>
            {pharmacyList.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <input 
            value={search} 
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or email"
            style={{ flex: '1 1 300px', minHeight: 44 }}
            aria-label="Search staff"
          />
        </div>

        <ErrorBox error={s.error} retry={s.reload} />
        
        {s.loading && !s.data ? (
          <Spinner />
        ) : s.data?.staff?.length === 0 ? (
          <Empty icon="👥" title="No staff found" sub="Add staff members to get started" />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Contact</th>
                  <th>Role</th>
                  <th>Assigned Pharmacy</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {s.data?.staff?.map(st => (
                  <tr key={st.id}>
                    <td>
                      <strong>{st.name}</strong>
                      {st.reg_no && <div className="sub">Reg: {st.reg_no}</div>}
                    </td>
                    <td>
                      {st.email || '—'}
                      {st.phone && <div className="sub">{st.phone}</div>}
                    </td>
                    <td>{ROLE_LABEL[st.role] || st.role}</td>
                    <td>{st.pharmacy_name || 'Not assigned'}</td>
                    <td>
                      <Badge kind={st.active ? 'ok' : 'gray'}>
                        {st.active ? 'Active' : 'Inactive'}
                      </Badge>
                    </td>
                    <td>
                      <button className="btn sm" onClick={() => setEdit({ ...st, password: '' })}>
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {edit && (
        <StaffForm 
          staff={edit} 
          pharmacyList={pharmacyList}
          onClose={() => setEdit(null)} 
          onDone={() => { 
            setEdit(null); 
            toast('Staff member saved'); 
            s.reload(); 
          }} 
        />
      )}
    </>
  );
}

function StaffForm({ staff, pharmacyList, onClose, onDone }) {
  const [f, setF] = useState(staff);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const save = async () => {
    setErr('');
    setBusy(true);
    try {
      const payload = { ...f };
      if (f.id && !f.password) delete payload.password; // Don't send empty password on update
      
      if (f.id) {
        await put('/owner/staff/' + f.id, payload);
      } else {
        await post('/owner/staff', payload);
      }
      onDone();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal 
      title={f.id ? 'Edit Staff Member' : 'Add Staff Member'} 
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={save} disabled={busy}>
            {busy ? 'Saving...' : 'Save'}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Full Name *" className="full">
          <input autoFocus value={f.name} onChange={set('name')} required />
        </Field>
        <Field label="Email">
          <input type="email" value={f.email || ''} onChange={set('email')} />
        </Field>
        <Field label="Phone">
          <input value={f.phone || ''} onChange={set('phone')} />
        </Field>
        <Field label="Role">
          <select value={f.role} onChange={set('role')}>
            {Object.entries(ROLE_LABEL).filter(([k]) => k !== 'owner').map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </Field>
        <Field label="Assign to Pharmacy">
          <select 
            value={f.assigned_pharmacy_id || ''} 
            onChange={(e) => setF({ ...f, assigned_pharmacy_id: e.target.value ? parseInt(e.target.value) : null })}
          >
            <option value="">Select pharmacy...</option>
            {pharmacyList.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Registration No." hint="For pharmacists">
          <input value={f.reg_no || ''} onChange={set('reg_no')} />
        </Field>
        <Field 
          label={f.id ? 'New Password (leave blank to keep)' : 'Password *'} 
          hint="At least 8 characters"
          className="full"
        >
          <input 
            type="password" 
            value={f.password} 
            onChange={set('password')} 
            autoComplete={f.id ? "off" : "new-password"}
            required={!f.id}
            minLength={8}
          />
        </Field>
        {f.id && (
          <label className="check full">
            <input 
              type="checkbox" 
              checked={!!f.active} 
              onChange={(e) => setF({ ...f, active: e.target.checked ? 1 : 0 })} 
            />
            {' '}Account is active
          </label>
        )}
      </div>
      <ErrorBox error={err} />
    </Modal>
  );
}
