# Multi-pharmacy owner frontend implementation

System owner accounts can now manage multiple pharmacy locations through three new pages (Owner Dashboard, Pharmacy Management, Staff Management), with a global pharmacy switcher and context provider. The implementation adds a checkbox to initial setup, extends navigation with owner-only routes, and provides aggregated metrics and per-pharmacy comparison views.

**Watch for:** PharmacySwitcher still stores selection without filtering views **(confirmed)**; password autocomplete remains unconditional on edit **(confirmed)**; StaffForm allows assigning pharmacy to 'owner' role **(confirmed)**.

**Verdict**: NEEDS_CHANGES

## High-level view

PharmacyContext loads the pharmacy list from `/api/owner/pharmacies` only when the user is a system owner, stores the selected pharmacy ID in localStorage, and provides a switcher hook. The selected pharmacy ID is persisted but not consumed by any component to filter API calls or views — it's stored for future use by backend endpoints.

Navigation splits into system-owner routes (owner-dashboard, owner-pharmacies, owner-staff) requiring both the owner role and `is_system_owner=1`, and regular routes that all users see. System owners default to the owner dashboard; regular users land on the original dashboard. PharmacySwitcher appears in the mobile bar and only renders when `isSystemOwner` is true.

AuthNew.jsx adds an `is_system_owner` checkbox to the setup form with conditional helper text. The checkbox value is sent as 0 or 1 in the POST body.

OwnerDashboard fetches aggregated metrics and a comparison table showing per-pharmacy sales, inventory value, low stock count, expiry alerts, and staff count. PharmacyManagement provides CRUD for pharmacy locations. StaffManagement shows all staff across all pharmacies with client-side filtering by pharmacy and search, and an add/edit modal with role and pharmacy assignment dropdowns.

<details>
<summary>Issues (4)</summary>

1. **PharmacySwitcher stores selection but doesn't filter any view** — `selectedPharmacyId` is persisted to localStorage and provided by context, but no component reads it to filter API calls or UI. The switcher dropdown changes state without changing what the user sees. Either wire it to backend endpoints that accept `pharmacy_id` or add UI indicator that it's non-functional.

2. **Password field in StaffForm uses unconditional autocomplete="new-password"** — The password input has `autoComplete="new-password"` even in edit mode when the field is optional. This causes browsers to incorrectly prompt to save blank passwords or suggest new passwords when the user only wanted to change other fields. Use `autoComplete={f.id ? "off" : "new-password"}` or conditional logic.

3. **StaffForm allows assigning pharmacy to owner role** — The role dropdown in StaffForm filters out 'owner' from ROLE_LABEL, but the pharmacy assignment dropdown is always rendered and allows selecting a pharmacy even when role is 'owner'. The backend may reject this, but the UI should either hide the pharmacy dropdown when role is 'owner' or show a message explaining that owners are not assigned to specific pharmacies in a multi-pharmacy setup.

4. **PharmacyContext missing fallback for undefined user** — The context logs a warning when user is missing but continues rendering with `isSystemOwner = false` and empty `pharmacyList`. Downstream consumers of `usePharmacy()` cannot distinguish "not a system owner" from "context failed to initialize." Add loading or error state to the context return value.

</details>

<details>
<summary>Details</summary>

## PharmacySwitcher disconnected from data flow

PharmacySwitcher renders a dropdown that calls `switchPharmacy(id)`, updating `selectedPharmacyId` in state and localStorage. The selected ID is provided by the context but no component reads it to filter API requests or UI state. Dashboard, Stock, Sales, Reports, and other pages don't pass `pharmacy_id` to the backend based on the switcher's selection.

The switcher changes state without changing behavior. This is likely groundwork for future backend filtering, but the UI presents it as a working filter.

## Password autocomplete signal on edit

StaffForm's password field uses `autoComplete="new-password"` unconditionally, even in edit mode when the password is optional. Browsers treat `autocomplete="new-password"` as a signal to generate and save a new credential. On edit forms where the password field is left blank to keep the current password, this causes incorrect password save prompts.

The autocomplete attribute should be conditional based on `f.id`.

## Pharmacy assignment for owner role

StaffForm filters 'owner' from the role dropdown:

```jsx
<select value={f.role} onChange={set('role')}>
  {Object.entries(ROLE_LABEL).filter(([k]) => k !== 'owner').map(([k, v]) => (
    <option key={k} value={k}>{v}</option>
  ))}
</select>
```

But the pharmacy assignment dropdown renders unconditionally:

```jsx
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
```

If a staff record is edited and the role is manually changed to 'owner' in the database, or if the backend validation allows it, the UI allows selecting a pharmacy for an owner role. Owners in a multi-pharmacy system manage all locations and should not be assigned to a single pharmacy.

The UI should either disable or hide the pharmacy dropdown when `f.role === 'owner'`, or show helper text explaining that owners are not assigned to specific pharmacies.

## PharmacyContext user guard incomplete

PharmacyProvider warns to console when user is missing but renders with `isSystemOwner = false` and empty `pharmacyList`. Downstream components calling `usePharmacy()` receive valid values but cannot distinguish "not a system owner" from "context failed to initialize."

A loading or error field in the context return value would allow consumers to handle initialization failure explicitly.

</details>

<details>
<summary>File map</summary>

Changed files:

- `contexts/PharmacyContext.jsx` — React context for system owner state, selected pharmacy ID, pharmacy list, switcher/refresh methods
- `components/PharmacySwitcher.jsx` — Dropdown to store selected pharmacy (system owners only); no active filtering
- `pages/OwnerDashboard.jsx` — Aggregated metrics and per-pharmacy comparison table
- `pages/PharmacyManagement.jsx` — CRUD for pharmacy locations with modal form
- `pages/StaffManagement.jsx` — Cross-pharmacy staff list with client-side filtering, role dropdown excludes 'owner'
- `App.jsx` — PharmacyProvider wrapper, extended NAV with `requiresSystemOwner` flag, navigation filtering
- `pages/AuthNew.jsx` — `is_system_owner` checkbox in setup form with helper text

</details>
