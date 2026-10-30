# Multi-pharmacy owner frontend implementation

System owner accounts can now manage multiple pharmacy locations through three new pages (Owner Dashboard, Pharmacy Management, Staff Management), with a global pharmacy switcher and context provider. The implementation adds a checkbox to initial setup, extends navigation with owner-only routes, and provides aggregated metrics and per-pharmacy comparison views.

**Watch for:** PharmacySwitcher doesn't filter existing views, only stores selection **(confirmed)**; password field in StaffForm lacks proper autocomplete signal **(confirmed)**; PharmacyContext warning doesn't prevent undefined access downstream **(likely)**.

**Verdict**: NEEDS_CHANGES

## High-level view

PharmacyContext loads the pharmacy list from `/api/owner/pharmacies` only when the user is a system owner, stores the selected pharmacy ID in localStorage, and provides a switcher hook. The context wraps children in App.jsx, receives the user from Shell's session state, and warns to the console if user is missing. The selected pharmacy ID is persisted but not used to filter any API calls or views — it's stored for future use by backend endpoints or child components.

Navigation splits into system-owner routes (owner-dashboard, owner-pharmacies, owner-staff) requiring both the owner role and `is_system_owner=1`, and regular routes that all users see. System owners default to the owner dashboard; regular users land on the original dashboard. PharmacySwitcher appears in the mobile bar for all users but only renders when `isSystemOwner` is true.

AuthNew.jsx adds an `is_system_owner` checkbox to the setup form with conditional helper text. The checkbox value is sent as 0 or 1 in the POST body, allowing the initial account to be created as a system owner.

OwnerDashboard fetches aggregated metrics and a comparison table showing per-pharmacy sales today, inventory value, low stock count, expiry alerts, and staff count. PharmacyManagement provides CRUD for pharmacy locations with a modal form covering business details. StaffManagement shows all staff across all pharmacies with client-side filtering by pharmacy and search, and an add/edit modal with role (excluding 'owner') and pharmacy assignment dropdowns.

<details>
<summary>Issues (3)</summary>

1. **PharmacySwitcher stores selection but doesn't filter any view** — `selectedPharmacyId` is persisted to localStorage and provided by context, but no component reads it to filter API calls or UI. The switcher dropdown changes state without changing what the user sees. Either wire it to backend endpoints that accept `pharmacy_id` or clarify in the UI that it's non-functional until the backend supports it.

2. **Password field in StaffForm uses generic autocomplete** — The password input has `autoComplete="new-password"` which tells browsers this is a new password being set, but on edit mode (when password is optional), the field should use `autoComplete="off"` or `autoComplete="new-password"` only when `!f.id`. Current behavior may cause browsers to incorrectly suggest or save passwords.

3. **PharmacyContext warning doesn't prevent undefined access** — The context logs a warning when user is missing but still accesses `user?.is_system_owner`. If user is null or undefined, `isSystemOwner` becomes false and the pharmacy list fetch is skipped. This is a defensive fallback, but downstream consumers of `usePharmacy()` have no signal that the context failed to initialize. Consider returning a loading or error state from the hook.

</details>

<details>
<summary>Details</summary>

## PharmacySwitcher disconnected from data flow

PharmacySwitcher renders a dropdown that calls `switchPharmacy(id)`, which updates `selectedPharmacyId` in state and localStorage:

```jsx
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
```

The selected ID is provided by the context:

```jsx
<PharmacyContext.Provider value={{ 
  isSystemOwner, 
  selectedPharmacyId, 
  pharmacyList, 
  switchPharmacy,
  refreshPharmacies
}}>
```

But no component in the codebase reads `selectedPharmacyId` from the context to filter API requests or UI state. Dashboard, Stock, Sales, Reports, and other pages don't pass `pharmacy_id` to the backend based on the switcher's selection. The switcher changes state without changing behavior. This is likely deliberate — laying the groundwork for backend filtering — but the UI presents it as a working filter.

## Password autocomplete attribute on edit mode

StaffForm's password field uses `autoComplete="new-password"` unconditionally:

```jsx
<input 
  type="password" 
  value={f.password} 
  onChange={set('password')} 
  autoComplete="new-password"
  required={!f.id}
  minLength={8}
/>
```

When `f.id` exists (edit mode), the password field is optional (leave blank to keep the current password). Browsers treat `autocomplete="new-password"` as a signal to generate and save a new credential. On edit forms where the password is optional, this can cause browsers to incorrectly prompt to save a password that was left blank, or to suggest a new password when the user only wanted to change the name or role.

The autocomplete attribute should be conditional: `autoComplete={f.id ? "off" : "new-password"}` or omitted entirely on edit mode.

## PharmacyContext user prop guard incomplete

PharmacyProvider guards against missing user with a console warning:

```jsx
export function PharmacyProvider({ children, user }) {
  if (!user) {
    console.warn('PharmacyProvider: user prop is required but was not provided');
  }
  const isSystemOwner = user?.is_system_owner === 1;
```

The warning is helpful for debugging, but the context continues to render with `isSystemOwner = false` and an empty `pharmacyList`. Downstream components that call `usePharmacy()` receive valid values (false, null, []) but have no way to distinguish "not a system owner" from "context failed to initialize." If user arrives late or is accidentally undefined, the context silently degrades.

A more explicit guard could return early with a fallback provider state, or expose an `error` or `loading` field from the context to signal that initialization failed.

</details>

<details>
<summary>File map</summary>

Changed files:

- `contexts/PharmacyContext.jsx` — React context for system owner state, selected pharmacy ID, pharmacy list, switcher/refresh methods, and user prop warning
- `components/PharmacySwitcher.jsx` — Dropdown to store selected pharmacy (system owners only); no active filtering
- `pages/OwnerDashboard.jsx` — Aggregated metrics and per-pharmacy comparison table; View buttons removed
- `pages/PharmacyManagement.jsx` — CRUD for pharmacy locations with modal form
- `pages/StaffManagement.jsx` — Cross-pharmacy staff list with client-side filtering, role dropdown excludes 'owner'
- `App.jsx` — PharmacyProvider wrapper, extended NAV with `requiresSystemOwner` flag, navigation filtering
- `pages/AuthNew.jsx` — `is_system_owner` checkbox in setup form with helper text

</details>
