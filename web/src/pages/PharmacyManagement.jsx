import { useState } from 'react';
import { get, post, put } from '../api.js';
import { PageHead, Spinner, ErrorBox, useLoad, Empty, Badge, Modal, Field, useToast } from '../ui.jsx';
import { usePharmacy } from '../contexts/PharmacyContext.jsx';

export default function PharmacyManagement({ user }) {
  const toast = useToast();
  const { refreshPharmacies } = usePharmacy();
  const p = useLoad(() => get('/owner/pharmacies'));
  const [edit, setEdit] = useState(null);

  return (
    <>
      <PageHead icon="🏪" title="My Pharmacies" sub="Manage all your pharmacy locations">
        <button 
          className="btn primary" 
          onClick={() => setEdit({ 
            name: '', 
            address: '', 
            phone: '', 
            email: '', 
            kra_pin: '', 
            licence_no: '', 
            superintendent_name: '', 
            superintendent_reg_no: '', 
            mpesa_till: '',
            active: 1 
          })}
        >
          + Add Pharmacy
        </button>
      </PageHead>
      
      <ErrorBox error={p.error} retry={p.reload} />
      
      {p.loading && !p.data ? (
        <Spinner />
      ) : p.data?.pharmacies?.length === 0 ? (
        <Empty icon="🏪" title="No pharmacies yet" sub="Add your first pharmacy location" />
      ) : (
        <div className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Address</th>
                  <th>Contact</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {p.data?.pharmacies?.map(ph => (
                  <tr key={ph.id}>
                    <td>
                      <strong>{ph.name}</strong>
                      {ph.licence_no && <div className="sub">Licence: {ph.licence_no}</div>}
                    </td>
                    <td>{ph.address || '—'}</td>
                    <td>
                      {ph.phone || '—'}
                      {ph.email && <div className="sub">{ph.email}</div>}
                    </td>
                    <td>
                      <Badge kind={ph.active ? 'ok' : 'gray'}>
                        {ph.active ? 'Active' : 'Inactive'}
                      </Badge>
                    </td>
                    <td>
                      <button className="btn sm" onClick={() => setEdit(ph)}>
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      
      {edit && (
        <PharmacyForm 
          pharmacy={edit} 
          onClose={() => setEdit(null)} 
          onDone={() => { 
            setEdit(null); 
            toast('Pharmacy saved'); 
            p.reload();
            refreshPharmacies(); 
          }} 
        />
      )}
    </>
  );
}

function PharmacyForm({ pharmacy, onClose, onDone }) {
  const [f, setF] = useState(pharmacy);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const save = async () => {
    setErr('');
    setBusy(true);
    try {
      if (f.id) {
        await put('/owner/pharmacies/' + f.id, f);
      } else {
        await post('/owner/pharmacies', f);
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
      title={f.id ? 'Edit Pharmacy' : 'Add Pharmacy'} 
      onClose={onClose}
      wide
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
        <Field label="Pharmacy Name *" className="full">
          <input autoFocus value={f.name} onChange={set('name')} required />
        </Field>
        <Field label="Address" className="full">
          <input value={f.address || ''} onChange={set('address')} />
        </Field>
        <Field label="Phone">
          <input value={f.phone || ''} onChange={set('phone')} />
        </Field>
        <Field label="Email">
          <input type="email" value={f.email || ''} onChange={set('email')} />
        </Field>
        <Field label="KRA PIN">
          <input value={f.kra_pin || ''} onChange={set('kra_pin')} />
        </Field>
        <Field label="PPB Licence No.">
          <input value={f.licence_no || ''} onChange={set('licence_no')} />
        </Field>
        <Field label="Superintendent Pharmacist">
          <input value={f.superintendent_name || ''} onChange={set('superintendent_name')} />
        </Field>
        <Field label="Pharmacist Reg No.">
          <input value={f.superintendent_reg_no || ''} onChange={set('superintendent_reg_no')} />
        </Field>
        <Field label="M-Pesa Till/Paybill">
          <input value={f.mpesa_till || ''} onChange={set('mpesa_till')} />
        </Field>
        {f.id && (
          <label className="check full">
            <input 
              type="checkbox" 
              checked={!!f.active} 
              onChange={(e) => setF({ ...f, active: e.target.checked ? 1 : 0 })} 
            />
            {' '}Pharmacy is active
          </label>
        )}
      </div>
      <ErrorBox error={err} />
    </Modal>
  );
}
