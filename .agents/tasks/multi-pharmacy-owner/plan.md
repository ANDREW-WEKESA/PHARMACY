# Multi-Pharmacy Owner Management Implementation Plan

## Task Statement (Verbatim)

Implement a complete multi-pharmacy management system for the pharmacy-standalone project at c:/dev/pharmacy-standalone (Cloudflare Workers + D1, Hono backend at worker/src/, React+Vite frontend at web/src/, existing multi-tenant schema with pharmacy_id on all tables, JWT auth roles owner/pharmacist/cashier, already in production). Enhance it so one owner manages multiple pharmacy locations with assigned staff.

Requirements (implement all):
1. DB migration worker/migrations/0003_multi_pharmacy_owner.sql: add users.is_system_owner BOOLEAN, users.assigned_pharmacy_id INTEGER, pharmacy.owner_user_id INTEGER, pharmacy.active BOOLEAN; create table pharmacy_staff_assignments(id INTEGER PRIMARY KEY, user_id INTEGER, pharmacy_id INTEGER, role TEXT, can_manage_staff BOOLEAN, created_at TEXT).
2. New worker/src/routes-owner.js (owner-only): GET /api/owner/dashboard (consolidated metrics: total_pharmacies, total_sales, total_inventory_value, total_customers, pharmacies[{id,name,sales_today,inventory_value,low_stock_count,expiry_alerts}]); GET/POST /api/owner/pharmacies; PUT /api/owner/pharmacies/:id; GET /api/owner/pharmacies/:id/stats; GET/POST /api/owner/staff; PUT /api/owner/staff/:id; POST /api/owner/staff/:id/assign; DELETE /api/owner/staff/:id/unassign; GET /api/owner/sales/consolidated; GET /api/owner/inventory/consolidated; GET /api/owner/reports/comparison. Update worker/src/index.js auth middleware: system owner accesses all pharmacies; non-owner hard-filtered to assigned_pharmacy_id; add pharmacy_id context; register app.route('/api/owner', ownerRoutes). Update ALL worker/src/routes-*.js to apply pharmacy filtering (owner: all or ?pharmacy_id= param; non-owner: forced to assigned_pharmacy_id) for sales, stock, catalog, reports.
3. Frontend: web/src/components/PharmacySwitcher.jsx (owner-only dropdown, 'All Pharmacies' default + each owned pharmacy, updates context); web/src/contexts/PharmacyContext.jsx (selectedPharmacyId null=all, pharmacyList, switchPharmacy(id), isSystemOwner); web/src/pages/OwnerDashboard.jsx (summary cards Total Pharmacies/Combined Sales/Combined Inventory/Total Staff; comparison table Name/Todays Sales/Inventory Value/Alerts/Staff Count/Status; quick actions; charts; color-coded badges); web/src/pages/PharmacyManagement.jsx (list pharmacies; add/edit modal; toggle active; assign staff; view stats); web/src/pages/StaffManagement.jsx (table Name/Email/Role/Assigned Pharmacy/Status/Actions; add/edit modal; deactivate; filter by pharmacy; search).
4. web/src/App.jsx: wrap in PharmacyContext provider; add routes /owner-dashboard, /owner/pharmacies, /owner/staff, /owner/reports; redirect owners to /owner-dashboard, others to /dashboard. Nav (web/src/ui.jsx or nav): owners see Owner Dashboard/My Pharmacies/All Staff/Consolidated Reports; regular users see regular menu; PharmacySwitcher in header for owners; show current pharmacy name.
5. web/src/pages/Auth.jsx setup: checkbox 'I manage multiple pharmacy locations' sets is_system_owner; add first pharmacy during setup; 'Add Another Pharmacy' button.
6. worker/src/routes-core.js: /setup supports is_system_owner, creates first pharmacy, sets owner_user_id; /auth/login returns is_system_owner, assigned_pharmacy_id, accessible pharmacies.
7. Verify: db:migrate local+remote; owner sees all pharmacies; pharmacist sees only assigned; test switcher, staff assignment, consolidated metrics.

Constraints: Windows PowerShell; Hono patterns; existing web/src/ui.jsx components; match existing code style; use web/src/util.js and worker/src/lib.js; nowUtc() date patterns.

---

## Project Context Summary

**Project Type:** Cloudflare Workers + D1 database, Hono backend, React+Vite frontend  
**Build System:** npm workspaces, Wrangler for deployment  
**Test Framework:** Manual smoke tests in scripts/smoke-test.mjs  
**Key Patterns Discovered:**
- Backend uses Hono routing with middleware-based auth (JWT in Authorization header)
- Database access via q.all(), q.first(), q.run() helpers from lib.js
- Auth middleware sets c.get('user') and c.get('pharmacy_id') in context
- Date handling: nowUtc() for timestamps, eatDate() for Nairobi dates
- Frontend uses custom React hooks: useLoad(), useToast(), Modal, Field components from ui.jsx
- API calls via api.js (get, post, put) with token management
- Multi-tenant support partially exists: pharmacy_id already added to main tables in migration 0002_multi_tenant.sql
- Current limitation: all users belong to pharmacy_id=1, no multi-location owner support

**Authorization Model:**
- Current: Single pharmacy (id=1), all users have pharmacy_id=1
- Target: System owners see ALL pharmacies (or filter via ?pharmacy_id=); regular staff hard-filtered to assigned_pharmacy_id
- Critical: Every query in routes-sales.js, routes-stock.js, routes-reports.js, routes-core.js must enforce pharmacy_id filtering

**Build Commands:**
- Local DB migration: `npm run db:migrate:local`
- Remote DB migration: `npm run db:migrate:remote`
- Build web: `npm run build:web`
- Dev API: `npm run dev:api`
- Dev web: `npm run dev:web`
- Deploy: `npm run deploy`

**Verification Strategy:**
- After backend changes: Start dev:api, test endpoints with curl/Postman
- After frontend changes: `npm run build:web`, check compiled output, manual browser testing
- After migration: Run both local and remote migrations, verify tables exist
- Integration: Full flow test - setup system owner → create pharmacies → assign staff → switch contexts → verify data isolation

---

## Phase Plan

### Phase 1: Database Migration
Create migration 0003_multi_pharmacy_owner.sql with schema changes for multi-owner support.

**Files to Create:**
- `worker/migrations/0003_multi_pharmacy_owner.sql`

**Changes:**
1. Add `users.is_system_owner` INTEGER (0/1) DEFAULT 0
2. Add `users.assigned_pharmacy_id` INTEGER REFERENCES pharmacy(id)
3. Add `pharmacy.owner_user_id` INTEGER REFERENCES users(id)
4. Add `pharmacy.active` INTEGER DEFAULT 1
5. Create `pharmacy_staff_assignments` table with columns: id PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id), pharmacy_id INTEGER NOT NULL REFERENCES users(id), role TEXT NOT NULL, can_manage_staff INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now'))
6. Add indexes: idx_staff_assignments_user, idx_staff_assignments_pharmacy
7. Update existing data: UPDATE users SET assigned_pharmacy_id = 1; UPDATE pharmacy SET active = 1

**Dependencies:** None (first step)

**Verify:** 
```powershell
npm run db:migrate:local
# Then query tables to confirm columns exist
```

---

### Phase 2: Backend Auth Middleware Enhancement
Update worker/src/index.js auth middleware to support system owners and pharmacy context.

**Files to Modify:**
- `worker/src/index.js`

**Changes:**
1. After fetching user in auth middleware, check `user.is_system_owner`
2. If system owner: set `c.set('is_system_owner', true)` and `c.set('pharmacy_id', null)` (access all)
3. If NOT system owner: set `c.set('is_system_owner', false)` and `c.set('pharmacy_id', user.assigned_pharmacy_id || 1)`
4. Query param override: if system owner AND `?pharmacy_id=X` in query string, use X; else use null/assigned value
5. Update user SELECT to include: `is_system_owner, assigned_pharmacy_id`

**Pattern to Follow:** Existing auth middleware at line ~35 in index.js

**Dependencies:** Phase 1 (migration must run first)

**Verify:**
```powershell
npm run dev:api
# Test /api/auth/me with system owner vs regular user tokens
```

---

### Phase 3: Setup and Login Updates
Modify worker/src/routes-core.js to support system owner setup and return owner context on login.

**Files to Modify:**
- `worker/src/routes-core.js`

**Changes:**
1. **POST /setup**: 
   - Accept `b.is_system_owner` boolean
   - Insert pharmacy row (remove id=1 constraint, let it auto-increment)
   - INSERT user with `is_system_owner` value, get user_id
   - UPDATE pharmacy SET owner_user_id = user_id WHERE id = (inserted pharmacy id)
   - UPDATE user SET assigned_pharmacy_id = (inserted pharmacy id)
   - Return token with user including `is_system_owner, assigned_pharmacy_id`

2. **POST /auth/login**:
   - SELECT user with `is_system_owner, assigned_pharmacy_id`
   - Return user object with these fields
   - If system owner, fetch `accessible_pharmacies` array: SELECT id, name FROM pharmacy WHERE owner_user_id = user.id OR active = 1

**Pattern to Follow:** Existing /setup and /auth/login in routes-core.js lines 20-65

**Dependencies:** Phase 2 (auth middleware must set context)

**Verify:**
```powershell
# Test setup endpoint with is_system_owner: true
# Test login returns correct fields
```

---

### Phase 4: Owner Routes Implementation
Create worker/src/routes-owner.js with all owner-only endpoints.

**Files to Create:**
- `worker/src/routes-owner.js`

**Files to Modify:**
- `worker/src/index.js` (register owner routes: `app.route('/api/owner', ownerRoutes)`)

**Changes - routes-owner.js:**
1. **GET /owner/dashboard**: Aggregate across all owned pharmacies (WHERE pharmacy.owner_user_id = user.id):
   - total_pharmacies count
   - total_sales (today's completed sales sum)
   - total_inventory_value (SUM(batches.qty_units * batches.selling_price / drugs.pack_size))
   - total_customers count
   - pharmacies array: {id, name, sales_today, inventory_value, low_stock_count, expiry_alerts}

2. **GET /owner/pharmacies**: List all pharmacies WHERE owner_user_id = user.id

3. **POST /owner/pharmacies**: Create new pharmacy, set owner_user_id = user.id

4. **PUT /owner/pharmacies/:id**: Update pharmacy (verify ownership)

5. **GET /owner/pharmacies/:id/stats**: Detailed stats for one pharmacy

6. **GET /owner/staff**: List all users across owned pharmacies with JOIN pharmacy_staff_assignments

7. **POST /owner/staff**: Create user, optionally create staff assignment

8. **PUT /owner/staff/:id**: Update user details

9. **POST /owner/staff/:id/assign**: Create pharmacy_staff_assignments record

10. **DELETE /owner/staff/:id/unassign**: Delete assignment, update user.assigned_pharmacy_id

11. **GET /owner/sales/consolidated**: Aggregate sales across owned pharmacies

12. **GET /owner/inventory/consolidated**: Aggregate stock across owned pharmacies

13. **GET /owner/reports/comparison**: Compare pharmacies side-by-side

**Pattern to Follow:** routes-core.js structure, need() middleware pattern, q.all/q.first patterns

**Dependencies:** Phase 3 (setup/login must work)

**Verify:**
```powershell
# Test each endpoint with system owner token
# Verify non-owners get 403
```

---

### Phase 5: Existing Routes Pharmacy Filtering
Update worker/src/routes-sales.js, routes-stock.js, routes-reports.js, routes-core.js to enforce pharmacy_id filtering.

**Files to Modify:**
- `worker/src/routes-sales.js`
- `worker/src/routes-stock.js`
- `worker/src/routes-reports.js`
- `worker/src/routes-core.js`

**Changes (apply to EVERY query in these files):**
1. Read `pharmacy_id` from context: `const pharmacy_id = c.get('pharmacy_id')`
2. Read `is_system_owner` from context: `const is_system_owner = c.get('is_system_owner')`
3. If system owner:
   - Check query param: `const filter_id = int(c.req.query('pharmacy_id')) || null`
   - If filter_id: add `WHERE pharmacy_id = ?` and bind filter_id
   - Else: no filter (see all)
4. If NOT system owner:
   - ALWAYS add `WHERE pharmacy_id = ?` and bind pharmacy_id
   - Example: `SELECT * FROM sales WHERE pharmacy_id = ? AND status = 'completed'`

5. Update INSERT statements to include pharmacy_id:
   - Sales: `INSERT INTO sales (..., pharmacy_id) VALUES (..., ?)`
   - Stock: batch creates, drug creates
   - Customers: when creating new customer

**Critical Routes to Update:**
- routes-sales.js: POST /sales, GET /sales, GET /sales/:id
- routes-stock.js: GET /drugs, POST /drugs, POST /batches, GET /batches
- routes-reports.js: GET /dashboard, GET /reports/*
- routes-core.js: GET /users, GET /expiry-alerts, GET /stock-alerts

**Pattern:** Add `AND pharmacy_id = ?` to WHERE clauses, bind pharmacy_id variable

**Dependencies:** Phase 4 (need owner routes to test multi-pharmacy scenarios)

**Verify:**
```powershell
# Create two pharmacies as system owner
# Assign staff to pharmacy 2
# Login as pharmacy 2 staff, verify they ONLY see pharmacy 2 data
# Login as system owner, switch pharmacy context, verify filtering
```

---

### Phase 6: Frontend Context and Components
Create PharmacyContext and PharmacySwitcher component.

**Files to Create:**
- `web/src/contexts/PharmacyContext.jsx`
- `web/src/components/PharmacySwitcher.jsx`

**Files to Modify:**
- `web/src/App.jsx` (wrap in PharmacyContext.Provider)

**Changes - PharmacyContext.jsx:**
```javascript
import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { get } from '../api.js';

const PharmacyContext = createContext(null);

export function PharmacyProvider({ children, user }) {
  const [selectedPharmacyId, setSelectedPharmacyId] = useState(null); // null = all
  const [pharmacyList, setPharmacyList] = useState([]);
  const isSystemOwner = user?.is_system_owner || false;

  useEffect(() => {
    if (isSystemOwner) {
      get('/owner/pharmacies').then(data => setPharmacyList(data.pharmacies || []));
    }
  }, [isSystemOwner]);

  const switchPharmacy = useCallback((id) => {
    setSelectedPharmacyId(id);
  }, []);

  return (
    <PharmacyContext.Provider value={{ selectedPharmacyId, pharmacyList, switchPharmacy, isSystemOwner }}>
      {children}
    </PharmacyContext.Provider>
  );
}

export const usePharmacy = () => useContext(PharmacyContext);
```

**Changes - PharmacySwitcher.jsx:**
- Dropdown showing "All Pharmacies" (value null) + each pharmacy
- Only renders if isSystemOwner
- Calls switchPharmacy(id) on change
- Styled with existing ui.jsx patterns

**Changes - App.jsx:**
- Wrap `<Shell>` content in `<PharmacyProvider user={user}>`
- Pass pharmacy context to pages that need it

**Pattern:** Existing ToastProvider in ui.jsx, auth context in App.jsx

**Dependencies:** Phase 5 (backend routes must support filtering)

**Verify:**
```powershell
npm run build:web
# Open browser, login as system owner, verify switcher appears
```

---

### Phase 7: Owner Dashboard and Management Pages
Create owner-specific pages: OwnerDashboard, PharmacyManagement, StaffManagement.

**Files to Create:**
- `web/src/pages/OwnerDashboard.jsx`
- `web/src/pages/PharmacyManagement.jsx`
- `web/src/pages/StaffManagement.jsx`

**Changes - OwnerDashboard.jsx:**
- useLoad to fetch /api/owner/dashboard
- Summary cards: Total Pharmacies, Combined Sales Today, Combined Inventory Value, Total Staff
- Table: pharmacy comparison (Name, Today's Sales, Inventory Value, Low Stock Alerts, Expiry Alerts, Staff Count, Status badge)
- Quick actions: Add Pharmacy, View Staff, Generate Report
- Chart: sales trend across pharmacies (optional, can use existing dashboard chart patterns)
- Use existing Badge, PageHead, Field components from ui.jsx

**Changes - PharmacyManagement.jsx:**
- List pharmacies with cards/table
- Add/Edit modal: name, address, phone, email, kra_pin, licence_no, superintendent details
- Toggle active/inactive
- Assign Staff button (opens modal)
- View Stats link (navigates to detailed stats page or shows inline)
- Pattern: Similar to Settings.jsx structure

**Changes - StaffManagement.jsx:**
- Table: Name, Email, Role, Assigned Pharmacy, Status, Actions (Edit, Deactivate, Assign)
- Add/Edit modal: name, email, phone, role, password
- Assign to Pharmacy modal: select pharmacy, set role for that pharmacy, can_manage_staff checkbox
- Filter dropdown: by pharmacy
- Search bar: by name/email
- Pattern: Similar to existing Users management in Settings.jsx

**Pattern:** Existing Dashboard.jsx, Settings.jsx page structure

**Dependencies:** Phase 6 (context must exist)

**Verify:**
```powershell
npm run build:web
# Navigate to owner pages, verify UI renders, test CRUD operations
```

---

### Phase 8: App Navigation and Routing Updates
Update App.jsx navigation to show owner routes and redirect based on role.

**Files to Modify:**
- `web/src/App.jsx`

**Changes:**
1. Add to NAV array:
   - `{ id: 'owner-dashboard', label: 'Owner Dashboard', icon: '🏢', roles: ['owner'], requiresSystemOwner: true, C: OwnerDashboard }`
   - `{ id: 'owner-pharmacies', label: 'My Pharmacies', icon: '🏪', roles: ['owner'], requiresSystemOwner: true, C: PharmacyManagement }`
   - `{ id: 'owner-staff', label: 'All Staff', icon: '👥', roles: ['owner'], requiresSystemOwner: true, C: StaffManagement }`

2. Filter NAV items:
   - Regular owners (not system): see original menu
   - System owners: see owner menu items
   - Logic: `items.filter(n => n.roles.includes(user.role) && (!n.requiresSystemOwner || user.is_system_owner))`

3. Default route redirect:
   - If user.is_system_owner, redirect to '#/owner-dashboard'
   - Else redirect to '#/dashboard'

4. Add PharmacySwitcher to Shell header (next to user avatar, only if isSystemOwner)

5. Show current pharmacy name in header (from context if selected, else "All Pharmacies")

**Pattern:** Existing NAV array and Shell component in App.jsx

**Dependencies:** Phase 7 (pages must exist)

**Verify:**
```powershell
npm run build:web
# Login as system owner: see owner menu, default to owner-dashboard
# Login as regular staff: see original menu, default to dashboard
```

---

### Phase 9: Auth Page Setup Enhancement
Update web/src/pages/AuthNew.jsx setup flow to support system owner checkbox.

**Files to Modify:**
- `web/src/pages/AuthNew.jsx`

**Changes:**
1. Add checkbox: "I manage multiple pharmacy locations" → sets `is_system_owner` in form state
2. If checked, show info text: "You'll be able to add more pharmacies after setup"
3. Send `is_system_owner` in POST /setup body
4. Optional: "Add Another Pharmacy" button (can defer to PharmacyManagement page)

**Pattern:** Existing form in AuthNew.jsx

**Dependencies:** Phase 3 (setup endpoint must accept is_system_owner)

**Verify:**
```powershell
npm run build:web
# Fresh setup with checkbox checked, verify user is created as system owner
```

---

### Phase 10: End-to-End Integration Verification
Test complete flow with both local and remote environments.

**Verification Steps:**
1. **Local Migration:**
   ```powershell
   npm run db:migrate:local
   ```
   Verify tables and columns created

2. **Remote Migration:**
   ```powershell
   npm run db:migrate:remote
   ```
   Verify production database updated

3. **System Owner Setup:**
   - Fresh setup with "I manage multiple locations" checked
   - Verify user.is_system_owner = 1
   - Verify first pharmacy created with owner_user_id set

4. **Create Second Pharmacy:**
   - Login as system owner
   - Navigate to My Pharmacies
   - Add new pharmacy
   - Verify it appears in switcher

5. **Create and Assign Staff:**
   - Navigate to All Staff
   - Create new pharmacist
   - Assign to pharmacy 2
   - Verify user.assigned_pharmacy_id = 2

6. **Test Data Isolation:**
   - Login as pharmacy 2 pharmacist
   - Add a drug to catalog
   - Verify drug ONLY visible to pharmacy 2
   - System owner with pharmacy 2 filter sees it
   - System owner with pharmacy 1 filter does NOT see it

7. **Test Consolidated Dashboard:**
   - Login as system owner
   - View owner dashboard
   - Verify metrics aggregate across all pharmacies
   - Add sale to pharmacy 1, verify total updates

8. **Test Pharmacy Switcher:**
   - As system owner, switch between "All", "Pharmacy 1", "Pharmacy 2"
   - Verify sales/stock/reports filter correctly

9. **Deploy to Production:**
   ```powershell
   npm run deploy
   ```
   Test live URL with same scenarios

**Success Criteria:**
- ✅ Migrations run without errors local and remote
- ✅ System owner sees all pharmacies, can switch context
- ✅ Regular staff only see assigned pharmacy data
- ✅ Staff assignments work correctly
- ✅ Consolidated metrics accurate
- ✅ Data isolation enforced (pharmacy 1 staff cannot see pharmacy 2 data)
- ✅ No existing functionality broken (single pharmacy mode still works)

**Dependencies:** All previous phases

---

## Authorization Model Specification

### System Owner (is_system_owner = 1)
- **Access:** ALL pharmacies they own (pharmacy.owner_user_id = user.id)
- **Filtering:** 
  - No filter: sees aggregated data across all owned pharmacies
  - With ?pharmacy_id=X: sees only pharmacy X data
- **Routes:** Access to /api/owner/* routes + regular routes with filtering
- **Queries:** No hard pharmacy_id filter, optional filter via query param

### Regular Staff (is_system_owner = 0)
- **Access:** ONLY assigned_pharmacy_id
- **Filtering:** ALWAYS hard-filtered to assigned_pharmacy_id
- **Routes:** Standard routes (/api/sales, /api/stock, etc.), no access to /api/owner/*
- **Queries:** EVERY query MUST include `WHERE pharmacy_id = ?` bound to assigned_pharmacy_id

### Enforcement Points (Critical)
Every route that queries sales, stock, drugs, customers, batches, deliveries, reports MUST:
1. Read pharmacy_id from context: `const pharmacy_id = c.get('pharmacy_id')`
2. Read is_system_owner flag: `const is_system_owner = c.get('is_system_owner')`
3. Apply filtering logic:
   ```javascript
   let wherePharmacy = '';
   let pharmacyParam = [];
   if (is_system_owner) {
     const filter_id = int(c.req.query('pharmacy_id'));
     if (filter_id) {
       wherePharmacy = 'AND pharmacy_id = ?';
       pharmacyParam = [filter_id];
     }
     // else: no filter, see all
   } else {
     wherePharmacy = 'AND pharmacy_id = ?';
     pharmacyParam = [pharmacy_id];
   }
   const results = await q.all(db, `SELECT * FROM sales WHERE status='completed' ${wherePharmacy}`, ...pharmacyParam);
   ```

### Routes Requiring Updates (Complete List)
**routes-sales.js:**
- POST /sales (set pharmacy_id on insert)
- GET /sales (filter)
- GET /sales/:id (verify ownership)
- PUT /sales/:id (verify ownership)

**routes-stock.js:**
- GET /drugs (filter)
- POST /drugs (set pharmacy_id)
- PUT /drugs/:id (verify ownership)
- GET /batches (filter via drug ownership)
- POST /batches (inherit pharmacy_id from drug)
- GET /deliveries (filter)
- POST /deliveries (set pharmacy_id)

**routes-reports.js:**
- GET /dashboard (filter sales, stock)
- GET /reports/daily (filter)
- GET /reports/profit (filter)
- GET /reports/* (all report endpoints)

**routes-core.js:**
- GET /users (filter by pharmacy)
- GET /expiry-alerts (filter batches via drugs)
- GET /stock-alerts (filter drugs)
- GET /health-check (filter stats)
- GET /audit (filter by pharmacy context)

---

## File Manifest

**Created:**
- worker/migrations/0003_multi_pharmacy_owner.sql
- worker/src/routes-owner.js
- web/src/contexts/PharmacyContext.jsx
- web/src/components/PharmacySwitcher.jsx
- web/src/pages/OwnerDashboard.jsx
- web/src/pages/PharmacyManagement.jsx
- web/src/pages/StaffManagement.jsx

**Modified:**
- worker/src/index.js (auth middleware, register owner routes)
- worker/src/routes-core.js (setup, login, users, alerts)
- worker/src/routes-sales.js (pharmacy filtering)
- worker/src/routes-stock.js (pharmacy filtering)
- worker/src/routes-reports.js (pharmacy filtering)
- web/src/App.jsx (navigation, routing, context provider)
- web/src/pages/AuthNew.jsx (setup checkbox)

---

## Notes for Implementation

1. **Date Handling:** Use `nowUtc()` from lib.js for created_at timestamps
2. **Phone Normalization:** Use `normPhone()` for phone numbers
3. **Money:** Use `money()` function to round to 2 decimals
4. **Validation:** Use `str()`, `int()`, `num()` from lib.js
5. **Audit Trail:** Call `audit()` for significant actions (create pharmacy, assign staff)
6. **Error Handling:** Use `HttpError` for status-specific errors, `bad()` for 400 validation errors
7. **UI Components:** Reuse Modal, Field, Badge, PageHead, Empty, Spinner from ui.jsx
8. **API Calls:** Use get(), post(), put() from api.js with query string via qs() helper
9. **Toast Notifications:** Use useToast() hook for success/error messages
10. **Loading States:** Use useLoad() hook for data fetching with loading/error states

---

## Risk Mitigation

**Risk:** Breaking existing single-pharmacy deployments  
**Mitigation:** Default assigned_pharmacy_id to 1 for existing users; maintain backward compatibility

**Risk:** Data leakage between pharmacies  
**Mitigation:** Comprehensive filtering enforcement; test data isolation explicitly

**Risk:** Migration failures on production  
**Mitigation:** Test migrations on local first; use ALTER TABLE which is safer than recreating tables

**Risk:** Performance degradation with multiple pharmacies  
**Mitigation:** Add indexes on pharmacy_id columns; monitor query performance

**Risk:** Complex staff assignment logic  
**Mitigation:** Clear separation: assigned_pharmacy_id for default access, pharmacy_staff_assignments for additional permissions

