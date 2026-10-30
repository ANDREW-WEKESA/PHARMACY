# Multi-Pharmacy Owner Frontend Implementation Plan

## Overview

This plan implements the complete frontend for the multi-pharmacy owner management system. The backend is already complete (migration applied, owner routes at /api/owner/*, auth middleware updated). This is a pure frontend implementation task following the existing React patterns, component library (ui.jsx), and API conventions (api.js).

**Project Context:**
- **Frontend:** React 18.3 + Vite, custom component library in ui.jsx
- **State Management:** useState/useContext, custom useLoad hook for data fetching
- **API Layer:** api.js (get, post, put functions with JWT token handling)
- **Styling:** CSS classes in existing styles, no Tailwind or external UI libraries
- **Build:** `npm run build:web` (in web/ directory, outputs to web/dist)
- **Verification:** Manual browser testing (no automated frontend tests exist)

**Key Patterns Discovered:**
- Pages use PageHead for title/subtitle/actions, useLoad for data fetching with loading/error states
- Forms use Modal + Field components from ui.jsx, controlled inputs with useState
- Data display uses Badge for status, Empty for no-data states, Spinner for loading
- Toast notifications via useToast() hook for success/error feedback
- Navigation via hash routing in App.jsx (location.hash = '#/page-id')
- User role filtering applied in App.jsx (NAV array filtered by user.role)
- Existing pages: Dashboard, Sales, Stock, Catalog, Reports, Settings, AuditLog
- Settings.jsx shows good user management patterns (table + add/edit modal)

---

## Implementation Plan

### 1. Create PharmacyContext for System Owner State Management

**What to do:**
Create `web/src/contexts/PharmacyContext.jsx` to manage pharmacy selection state for system owners. This context provides: `isSystemOwner` (boolean), `selectedPharmacyId` (null = all pharmacies, number = specific pharmacy), `pharmacyList` (array of owned pharmacies), `switchPharmacy(id)` function, and `refreshPharmacies()` function. 

The context automatically fetches the pharmacy list on mount if the user is a system owner (GET /api/owner/pharmacies). It persists `selectedPharmacyId` to localStorage (key: 'selected_pharmacy_id') so the selection survives page refreshes.

**Files to create:**
- `c:\dev\pharmacy-standalone\web\src\contexts\PharmacyContext.jsx`

**Implementation details:**
```javascript
import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { get } from '../api.js';

const PharmacyContext = createContext(null);

export function PharmacyProvider({ children, user }) {
  const isSystemOwner = user?.is_system_owner === 1;
  const [selectedPharmacyId, setSelectedPharmacyId] = useState(() => {
    try {
      const stored = localStorage.getItem('selected_pharmacy_id');
      return stored ? parseInt(stored) : null;
    } catch {
      return null;
    }
  });
  const [pharmacyList, setPharmacyList] = useState([]);

  useEffect(() => {
    if (isSystemOwner) {
      get('/owner/pharmacies')
        .then(data => setPharmacyList(data.pharmacies || []))
        .catch(err => console.error('Failed to load pharmacies:', err));
    }
  }, [isSystemOwner]);

  const switchPharmacy = useCallback((id) => {
    setSelectedPharmacyId(id);
    try {
      if (id === null) {
        localStorage.removeItem('selected_pharmacy_id');
      } else {
        localStorage.setItem('selected_pharmacy_id', String(id));
      }
    } catch {}
  }, []);

  const refreshPharmacies = useCallback(async () => {
    if (isSystemOwner) {
      const data = await get('/owner/pharmacies');
      setPharmacyList(data.pharmacies || []);
    }
  }, [isSystemOwner]);

  return (
    <PharmacyContext.Provider value={{ 
      isSystemOwner, 
      selectedPharmacyId, 
      pharmacyList, 
      switchPharmacy,
      refreshPharmacies
    }}>
      {children}
    </PharmacyContext.Provider>
  );
}

export const usePharmacy = () => useContext(PharmacyContext);
```

**Pattern:** Similar to ToastProvider in ui.jsx - context provider with hooks, localStorage for persistence

**Verify:** After implementing App.jsx integration (step 7), login as system owner and check browser DevTools console for pharmacy fetch, check localStorage for selected_pharmacy_id key

---

### 2. Create PharmacySwitcher Dropdown Component

**What to do:**
Create `web/src/components/PharmacySwitcher.jsx` - a dropdown that shows "All Pharmacies" (when selectedPharmacyId is null) or the selected pharmacy name. Only renders if user is a system owner. Dropdown lists "All Pharmacies" option plus each pharmacy from pharmacyList. Calls switchPharmacy(id) on change. Uses 44px min-height for touch targets (mobile responsive requirement). Style with existing CSS patterns (button/select styles).

**Files to create:**
- `c:\dev\pharmacy-standalone\web\src\components\PharmacySwitcher.jsx`

**Implementation details:**
```javascript
import { usePharmacy } from '../contexts/PharmacyContext.jsx';

export function PharmacySwitcher() {
  const { isSystemOwner, selectedPharmacyId, pharmacyList, switchPharmacy } = usePharmacy();

  if (!isSystemOwner) return null;

  const selectedName = selectedPharmacyId === null 
    ? 'All Pharmacies' 
    : pharmacyList.find(p => p.id === selectedPharmacyId)?.name || 'All Pharmacies';

  return (
    <div style={{ marginRight: 12 }}>
      <select 
        value={selectedPharmacyId ?? 'all'} 
        onChange={(e) => switchPharmacy(e.target.value === 'all' ? null : parseInt(e.target.value))}
        style={{ 
          minHeight: 44, 
          padding: '8px 12px', 
          borderRadius: 6,
          border: '1px solid var(--line)',
          background: 'var(--bg)',
          color: 'var(--ink)',
          fontSize: 14,
          cursor: 'pointer'
        }}
        aria-label="Select pharmacy"
      >
        <option value="all">🏢 All Pharmacies</option>
        {pharmacyList.map(p => (
          <option key={p.id} value={p.id}>
            {p.name} {p.active === 0 ? '(Inactive)' : ''}
          </option>
        ))}
      </select>
    </div>
  );
}
```

**Pattern:** Conditional rendering based on role, controlled select with onChange, CSS custom properties for theming

**Verify:** After App.jsx integration, login as system owner, verify dropdown appears in header with "All Pharmacies" default and all pharmacies listed

---

### 3. Create OwnerDashboard Page

**What to do:**
Create `web/src/pages/OwnerDashboard.jsx` showing consolidated metrics across all owned pharmacies. Fetch data from GET /api/owner/dashboard (returns total_pharmacies, total_sales_today, total_inventory_value, total_staff, pharmacies array with per-pharmacy breakdown). 

Display summary cards at top: Total Pharmacies, Combined Sales Today, Combined Inventory Value, Total Staff. Below, show pharmacy comparison table with columns: Name, Status, Today's Sales, Inventory Value, Low Stock Alerts, Expiry Alerts, Staff Count, Actions (View Details button). Use Badge for status (active/inactive), KES() for money formatting, num() for counts. Add "Add Pharmacy" button in PageHead actions.

**Files to create:**
- `c:\dev\pharmacy-standalone\web\src\pages\OwnerDashboard.jsx`

**Implementation details:**
```javascript
import { get } from '../api.js';
import { KES, num } from '../util.js';
import { PageHead, Spinner, ErrorBox, useLoad, Empty, Badge } from '../ui.jsx';

export default function OwnerDashboard({ user, go }) {
  const d = useLoad(() => get('/owner/dashboard'));

  if (d.loading && !d.data) {
    return (
      <>
        <PageHead icon="🏢" title="Owner Dashboard" sub="Consolidated view of all your pharmacies" />
        <Spinner />
      </>
    );
  }

  const x = d.data;

  return (
    <>
      <PageHead icon="🏢" title="Owner Dashboard" sub="Consolidated view of all your pharmacies">
        <button className="btn primary" onClick={() => go('owner-pharmacies')}>+ Add Pharmacy</button>
      </PageHead>
      <ErrorBox error={d.error} retry={d.reload} />
      
      {x && (
        <>
          <div className="grid g4" style={{ marginBottom: 18 }}>
            <div className="stat">
              <span>Total Pharmacies</span>
              <strong>{num(x.total_pharmacies)}</strong>
              <small>{x.total_pharmacies === 1 ? '1 location' : `${x.total_pharmacies} locations`}</small>
            </div>
            <div className="stat good">
              <span>Combined Sales Today</span>
              <strong>{KES(x.total_sales_today)}</strong>
              <small>Across all pharmacies</small>
            </div>
            <div className="stat">
              <span>Total Inventory Value</span>
              <strong>{KES(x.total_inventory_value)}</strong>
              <small>Current stock value</small>
            </div>
            <div className="stat">
              <span>Total Staff</span>
              <strong>{num(x.total_staff)}</strong>
              <small>Active employees</small>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h3>Pharmacy Comparison</h3>
            </div>
            {x.pharmacies?.length === 0 ? (
              <Empty icon="🏪" title="No pharmacies yet" sub="Add your first pharmacy to get started" />
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Status</th>
                      <th className="r">Today's Sales</th>
                      <th className="r">Inventory Value</th>
                      <th className="r">Low Stock</th>
                      <th className="r">Expiry Alerts</th>
                      <th className="r">Staff</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {x.pharmacies?.map(p => (
                      <tr key={p.id}>
                        <td><strong>{p.name}</strong></td>
                        <td>
                          <Badge kind={p.active ? 'ok' : 'gray'}>
                            {p.active ? 'Active' : 'Inactive'}
                          </Badge>
                        </td>
                        <td className="r mono">{KES(p.sales_today || 0)}</td>
                        <td className="r mono">{KES(p.inventory_value || 0)}</td>
                        <td className="r">
                          {p.low_stock_count > 0 ? (
                            <Badge kind="warn">{num(p.low_stock_count)}</Badge>
                          ) : (
                            <span className="sub">—</span>
                          )}
                        </td>
                        <td className="r">
                          {p.expiry_alerts > 0 ? (
                            <Badge kind="warn">{num(p.expiry_alerts)}</Badge>
                          ) : (
                            <span className="sub">—</span>
                          )}
                        </td>
                        <td className="r">{num(p.staff_count || 0)}</td>
                        <td>
                          <button 
                            className="btn sm" 
                            onClick={() => go('owner-pharmacies')}
                          >
                            View
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
```

**Pattern:** Dashboard.jsx structure (stat cards + table), useLoad for data fetching, KES/num formatting, Badge for status

**Verify:** After App.jsx integration, login as system owner, navigate to owner-dashboard, verify summary cards show correct totals and pharmacy table displays all pharmacies with their metrics

---

### 4. Create PharmacyManagement Page

**What to do:**
Create `web/src/pages/PharmacyManagement.jsx` for CRUD operations on pharmacies. Shows list of pharmacies as cards (on mobile) or table (on desktop) with columns: Name, Address, Phone, Status, Actions. Add/Edit button opens Modal with form fields: name (required), address, phone, email, kra_pin, licence_no, superintendent_name, superintendent_reg_no, mpesa_till. Toggle active/inactive status. 

Uses POST /api/owner/pharmacies for create, PUT /api/owner/pharmacies/:id for update, GET /api/owner/pharmacies for list. On save success, call refreshPharmacies() from PharmacyContext to update the switcher dropdown.

**Files to create:**
- `c:\dev\pharmacy-standalone\web\src\pages\PharmacyManagement.jsx`

**Implementation details:**
```javascript
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
```

**Pattern:** Settings.jsx Users section (table + modal form), useLoad for list, controlled form with useState

**Verify:** After App.jsx integration, login as system owner, navigate to owner-pharmacies, add a new pharmacy, verify it saves and appears in both the list and the PharmacySwitcher dropdown

---

### 5. Create StaffManagement Page

**What to do:**
Create `web/src/pages/StaffManagement.jsx` for managing staff across all pharmacies. Shows table with columns: Name, Email, Role, Assigned Pharmacy, Status, Actions. Add/Edit modal includes: name (required), email, phone, password (required for new, optional for edit), role dropdown (owner/pharmacist/cashier/stock_clerk), assign pharmacy dropdown (with "Select pharmacy..." option), active checkbox.

Filter controls: pharmacy dropdown filter, search input (by name/email using debounced search). Uses GET /api/owner/staff for list, POST /api/owner/staff for create, PUT /api/owner/staff/:id for update. Role labels from ROLE_LABEL in util.js.

**Files to create:**
- `c:\dev\pharmacy-standalone\web\src\pages\StaffManagement.jsx`

**Implementation details:**
```javascript
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
            {Object.entries(ROLE_LABEL).map(([k, v]) => (
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
            autoComplete="new-password"
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
```

**Pattern:** Settings.jsx Users section + filter/search from Audit section, useDebounced for search, qs() for query params

**Verify:** After App.jsx integration, login as system owner, navigate to owner-staff, add a staff member and assign to a pharmacy, verify they appear in the filtered list, test search functionality

---

### 6. Add System Owner Checkbox to Setup Flow

**What to do:**
Modify `web/src/pages/AuthNew.jsx` setup form (when needsSetup is true) to add a checkbox "I manage multiple pharmacy locations" that sets `is_system_owner` in the form state. When checked, show helper text: "You'll be able to add more pharmacies and assign staff after setup". Send `is_system_owner: form.isSystemOwner ? 1 : 0` in the POST /setup body.

**Files to modify:**
- `c:\dev\pharmacy-standalone\web\src\pages\AuthNew.jsx`

**Changes:**
In the setup form, after the "Phone Number" field and before the "Password" field, add:

```javascript
<label className="check full" style={{ marginTop: 10 }}>
  <input 
    type="checkbox" 
    checked={!!form.isSystemOwner} 
    onChange={(e) => setForm({ ...form, isSystemOwner: e.target.checked })} 
  />
  {' '}I manage multiple pharmacy locations
</label>
{form.isSystemOwner && (
  <div style={{ 
    padding: 10, 
    background: '#f0f9ff', 
    border: '1px solid #0ea5e9', 
    borderRadius: 4,
    fontSize: 14,
    marginTop: 8
  }}>
    ℹ️ You'll be able to add more pharmacies and assign staff after setup
  </div>
)}
```

In the handleSetup function, modify the POST body to include:

```javascript
const { token } = await post('/setup', {
  pharmacy_name: form.pharmacyName,
  owner_name: form.name,
  owner_email: form.email,
  owner_phone: form.phone,
  password: form.password,
  is_system_owner: form.isSystemOwner ? 1 : 0
});
```

**Pattern:** Existing checkbox pattern in Settings.jsx, infobox styling from Dashboard.jsx

**Verify:** Clear localStorage, reload app, go through setup with checkbox checked, after login verify user.is_system_owner === 1 and owner menu appears

---

### 7. Integrate Context and Update Navigation in App.jsx

**What to do:**
Modify `web/src/App.jsx` to integrate PharmacyContext and add owner navigation routes. Wrap the Shell component content in PharmacyProvider. Add three new entries to the NAV array for owner pages (owner-dashboard, owner-pharmacies, owner-staff), each with requiresSystemOwner: true. Filter NAV items to show owner pages only to system owners. Change default route: if user.is_system_owner, default to 'owner-dashboard', else 'dashboard'. Add PharmacySwitcher to Shell header (before user avatar section).

**Files to modify:**
- `c:\dev\pharmacy-standalone\web\src\App.jsx`

**Changes:**

1. Add imports at top:
```javascript
import { PharmacyProvider } from './contexts/PharmacyContext.jsx';
import { PharmacySwitcher } from './components/PharmacySwitcher.jsx';
import OwnerDashboard from './pages/OwnerDashboard.jsx';
import PharmacyManagement from './pages/PharmacyManagement.jsx';
import StaffManagement from './pages/StaffManagement.jsx';
```

2. Update NAV array to add owner routes (add after the existing audit entry):
```javascript
{ id: 'owner-dashboard', label: 'Owner Dashboard', icon: '🏢', roles: ['owner'], requiresSystemOwner: true, C: OwnerDashboard },
{ id: 'owner-pharmacies', label: 'My Pharmacies', icon: '🏪', roles: ['owner'], requiresSystemOwner: true, C: PharmacyManagement },
{ id: 'owner-staff', label: 'All Staff', icon: '👥', roles: ['owner'], requiresSystemOwner: true, C: StaffManagement },
```

3. In Shell function, update items filtering:
```javascript
const items = NAV.filter((n) => 
  n.roles.includes(user.role) && 
  (!n.requiresSystemOwner || user.is_system_owner === 1)
);
```

4. In Shell function, update fromHash default route:
```javascript
const fromHash = () => { 
  const h = location.hash.replace('#/', ''); 
  if (items.some((i) => i.id === h)) return h;
  // Default route based on owner status
  return user.is_system_owner === 1 ? 'owner-dashboard' : items[0].id;
};
```

5. In Shell JSX, wrap the return content in PharmacyProvider and add PharmacySwitcher to mobile-bar and before .side-user:
```javascript
return (
  <PharmacyProvider user={user}>
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
        <div className="mobile-bar">
          <button onClick={() => setOpen(true)} aria-label="Open menu">☰</button>
          {pharmacy.name}
          <PharmacySwitcher />
        </div>
        <Cur key={page} user={user} pharmacy={pharmacy} go={go} refreshSession={refreshSession} />
      </main>
    </div>
  </PharmacyProvider>
);
```

Note: PharmacySwitcher will only render if user is system owner (conditional inside the component).

**Pattern:** Existing NAV filtering by role, hash routing, context provider wrapping

**Verify:** `npm run build:web`, login as system owner, verify owner menu items appear, default lands on owner-dashboard, PharmacySwitcher shows in header; login as regular user, verify no owner menu and no switcher

---

## API Endpoint Mapping

All backend endpoints are already implemented in `worker/src/routes-owner.js`:

| Endpoint | Method | Purpose | Response |
|----------|--------|---------|----------|
| /api/owner/dashboard | GET | Consolidated metrics | total_pharmacies, total_sales_today, total_inventory_value, total_staff, pharmacies[] |
| /api/owner/pharmacies | GET | List owned pharmacies | pharmacies[] |
| /api/owner/pharmacies | POST | Create pharmacy | { id, ...pharmacy } |
| /api/owner/pharmacies/:id | PUT | Update pharmacy | { id, ...pharmacy } |
| /api/owner/staff | GET | List staff (supports ?pharmacy_id=, ?q=) | staff[] |
| /api/owner/staff | POST | Create staff member | { id, ...user } |
| /api/owner/staff/:id | PUT | Update staff member | { id, ...user } |

All endpoints require system owner authentication (checked by middleware in worker/src/index.js).

---

## State Management Decisions

**PharmacyContext centralizes owner-specific state:**
- **selectedPharmacyId:** Persisted to localStorage, defaults to null (all pharmacies)
- **pharmacyList:** Loaded once on mount, refreshed explicitly after pharmacy CRUD
- **Why context:** Shared between PharmacySwitcher (header), owner pages (for filters), and future features (regular pages that need to respect selection)

**useLoad for data fetching:**
- All pages use the existing useLoad() hook for consistent loading/error states
- No additional state libraries needed (React useState/useContext sufficient)

**No global API filtering:**
- API calls in owner pages don't automatically append ?pharmacy_id= param
- Owner dashboard deliberately fetches ALL pharmacies (no filter)
- Future: Regular pages (Sales, Stock, etc.) will read selectedPharmacyId and append to API calls

---

## Component Structure

```
contexts/
  PharmacyContext.jsx          (Provider + usePharmacy hook)

components/
  PharmacySwitcher.jsx          (Dropdown, owner-only)
  NotificationCenter.jsx        (existing, unchanged)

pages/
  OwnerDashboard.jsx            (Summary cards + comparison table)
  PharmacyManagement.jsx        (List + add/edit modal)
    └─ PharmacyForm             (Internal modal component)
  StaffManagement.jsx           (Table + filters + add/edit modal)
    └─ StaffForm                (Internal modal component)
  AuthNew.jsx                   (Modified: system owner checkbox)
  
App.jsx                         (Modified: routes + context provider)
```

**Design rationale:**
- Form components (PharmacyForm, StaffForm) are internal to their pages, not separate files - follows existing pattern in Settings.jsx
- Owner pages follow Dashboard.jsx structure: PageHead + cards/tables, consistent UX
- All modals use existing ui.jsx Modal component for consistency

---

## Mobile Responsiveness

**Touch targets:** All interactive elements use min-height: 44px (WCAG AAA standard)

**Responsive patterns (inherited from existing CSS):**
- `.grid.g4` becomes single column on mobile (existing CSS)
- `.table-wrap` enables horizontal scroll on mobile (existing CSS)
- `.mobile-bar` shows on narrow screens, hides on desktop (existing CSS)
- Forms use `.form-grid` which stacks on mobile (existing CSS)

**PharmacySwitcher specific:**
- Native `<select>` element (best mobile UX, uses OS picker)
- min-height: 44px enforced
- Visible in mobile-bar on phones, in header on desktop

**Verification checklist:**
- [ ] Test on Chrome DevTools mobile view (iPhone SE, Galaxy S20)
- [ ] Verify all buttons/inputs meet 44px target size
- [ ] Confirm tables scroll horizontally on narrow screens
- [ ] Check modals are scrollable on short screens

---

## Caveats and Notes

**Backend assumptions verified:**
- Migration 0003_multi_pharmacy_owner.sql has been applied (users.is_system_owner, users.assigned_pharmacy_id, pharmacy.owner_user_id exist)
- Routes in worker/src/routes-owner.js are complete and tested
- Auth middleware in worker/src/index.js sets is_system_owner and pharmacy_id in context
- Setup endpoint (/setup) accepts is_system_owner parameter

**Limitations of this implementation:**
- No automatic filtering of regular pages (Sales, Stock, etc.) by selectedPharmacyId - that's a separate task
- No pharmacy deletion - only deactivation (backend doesn't implement DELETE)
- No staff bulk actions (bulk assign, bulk deactivate) - would require backend support
- No pharmacy statistics detail view - button exists but navigates to list page (detail endpoint exists but not consumed)

**Testing strategy (manual):**
1. Fresh setup with system owner checkbox → verify user.is_system_owner = 1
2. Create second pharmacy → verify appears in switcher
3. Create staff and assign to pharmacy 2 → verify assignment saved
4. Login as pharmacy 2 staff → verify only see assigned pharmacy (backend responsibility, frontend just displays)
5. Test all CRUD operations (create, read, update for pharmacies and staff)
6. Test filters and search in staff management
7. Mobile testing: verify touch targets, scrolling, responsive layout

**Build command:**
```powershell
cd c:\dev\pharmacy-standalone\web
npm run build
```

**Verification command:**
After build, start dev server:
```powershell
cd c:\dev\pharmacy-standalone
npm run dev:api
```
Then open http://localhost:8787 and manually test all flows.

---

## Implementation Order Rationale

1. **Context first** (step 1): Foundation for all other components
2. **Switcher next** (step 2): Small, testable, depends only on context
3. **Owner pages** (steps 3-5): Can be implemented in parallel, no interdependencies
4. **Setup integration** (step 6): Enables creation of system owner users for testing
5. **App.jsx last** (step 7): Wires everything together, integration step

This order allows early verification of individual pieces before full integration.

---

## File Checklist

**Files to create (5):**
- [x] c:\dev\pharmacy-standalone\web\src\contexts\PharmacyContext.jsx
- [x] c:\dev\pharmacy-standalone\web\src\components\PharmacySwitcher.jsx
- [x] c:\dev\pharmacy-standalone\web\src\pages\OwnerDashboard.jsx
- [x] c:\dev\pharmacy-standalone\web\src\pages\PharmacyManagement.jsx
- [x] c:\dev\pharmacy-standalone\web\src\pages\StaffManagement.jsx

**Files to modify (2):**
- [x] c:\dev\pharmacy-standalone\web\src\pages\AuthNew.jsx
- [x] c:\dev\pharmacy-standalone\web\src\App.jsx

**Total changes:** 7 files (5 new, 2 modified)

---

## Success Criteria

- [ ] System owner sees owner menu items (Owner Dashboard, My Pharmacies, All Staff)
- [ ] Regular users do not see owner menu items
- [ ] PharmacySwitcher appears for system owners only
- [ ] Owner dashboard shows consolidated metrics across all pharmacies
- [ ] Can create/edit/deactivate pharmacies
- [ ] Can create/edit/assign staff to pharmacies
- [ ] Filter and search work in staff management
- [ ] Setup flow includes system owner checkbox
- [ ] All forms validate and show errors appropriately
- [ ] All pages are mobile responsive (44px touch targets, scrollable tables)
- [ ] No existing functionality broken (regular dashboard, sales, stock pages still work)

---

**End of Plan**
