# 🏥 Multi-Pharmacy Management System Enhancement Plan

## Current State Analysis

Your system already has:
- ✅ Multi-tenant database schema (pharmacy_id on all tables)
- ✅ User roles (owner, pharmacist, cashier)
- ✅ Basic authentication

## Required Enhancements

### 1. Enhanced User Roles & Permissions

**Current Roles:**
- `owner` - Single pharmacy owner
- `pharmacist` - Works at one pharmacy
- `cashier` - POS operations only

**New Structure:**
- `system_owner` - **Owns multiple pharmacies**, sees consolidated view
- `pharmacy_manager` - Manages one specific pharmacy
- `pharmacist` - Works at one pharmacy, full access to that pharmacy
- `cashier` - POS only at one pharmacy

### 2. Owner Dashboard (Consolidated View)

Owner needs to see:
- **All Pharmacies Overview**
  - Total pharmacies count
  - Aggregate sales across all locations
  - Aggregate inventory value
  - Aggregate profit/loss
  - Performance comparison between pharmacies

- **Per-Pharmacy Breakdown**
  - Individual pharmacy sales
  - Individual pharmacy inventory
  - Individual pharmacy staff
  - Individual pharmacy alerts (expiry, stock)

- **Pharmacy Management**
  - Add new pharmacy locations
  - Assign managers/pharmacists to pharmacies
  - View/edit pharmacy details
  - Deactivate/activate pharmacies

- **Staff Management**
  - View all staff across all pharmacies
  - Assign staff to specific pharmacies
  - Set roles and permissions
  - Track staff activities (audit log)

- **Consolidated Reports**
  - Sales report (all pharmacies combined)
  - Inventory report (all pharmacies)
  - Profit/loss by pharmacy
  - Best performing drugs across network
  - Stock transfer between pharmacies

### 3. Pharmacist Dashboard (Single Pharmacy View)

Pharmacist sees only their assigned pharmacy:
- Sales for their pharmacy
- Inventory for their pharmacy
- Cannot see other pharmacies
- Cannot manage staff

### 4. Database Enhancements Needed

**New Fields:**
- `users.is_system_owner` - Boolean, true if owns multiple pharmacies
- `users.can_access_all_pharmacies` - Boolean, for system owner
- `pharmacy.owner_id` - References the system owner
- `pharmacy.active` - Boolean, to enable/disable pharmacies

**New Tables:**
- `pharmacy_assignments` - Which users can access which pharmacies
  - user_id
  - pharmacy_id
  - role (manager, pharmacist, cashier)
  - created_at

### 5. UI Changes Required

**New Pages:**
1. **Owner Dashboard** (`/owner-dashboard`)
   - Pharmacy selector/switcher at top
   - "All Pharmacies" view (default)
   - Aggregated metrics cards
   - Pharmacy comparison table
   - Quick actions per pharmacy

2. **Pharmacy Management** (`/owner/pharmacies`)
   - List all pharmacies
   - Add new pharmacy
   - Edit pharmacy details
   - Assign staff
   - View pharmacy status

3. **Staff Management** (`/owner/staff`)
   - List all staff across all pharmacies
   - Add new staff member
   - Assign to pharmacy
   - Set roles
   - View activity

4. **Consolidated Reports** (`/owner/reports`)
   - Multi-pharmacy comparison
   - Network-wide analytics
   - Export consolidated data

**Enhanced Navigation:**
- Top bar shows: "Viewing: [Pharmacy Name]" or "Viewing: All Pharmacies"
- Pharmacy switcher dropdown (for owner only)
- Role-based menu items

### 6. API Changes Required

**New Endpoints:**

```
GET  /api/owner/dashboard          - Consolidated metrics
GET  /api/owner/pharmacies         - List all owned pharmacies
POST /api/owner/pharmacies         - Create new pharmacy
PUT  /api/owner/pharmacies/:id     - Update pharmacy
GET  /api/owner/pharmacies/:id     - Get pharmacy details
POST /api/owner/pharmacies/:id/assign-staff - Assign user to pharmacy

GET  /api/owner/staff              - All staff across pharmacies
POST /api/owner/staff              - Create new staff member
PUT  /api/owner/staff/:id          - Update staff
POST /api/owner/staff/:id/assign   - Assign to pharmacy

GET  /api/owner/reports/consolidated - All pharmacies combined
GET  /api/owner/reports/comparison   - Pharmacy comparison
GET  /api/owner/sales/all           - All sales across pharmacies
GET  /api/owner/inventory/all       - All inventory across pharmacies
```

**Middleware Changes:**
- Check user role (system_owner vs pharmacist)
- Filter data by pharmacy_id for non-owners
- Allow owners to query across all pharmacies

### 7. Setup Flow Changes

**Current:** Single pharmacy setup
**New:** System owner setup flow

```
1. Create system owner account
   - Name, email, password
   - "Do you manage multiple pharmacies?" checkbox

2. If multiple pharmacies:
   - Add first pharmacy details
   - Option to "Add another pharmacy" or "Continue"

3. Add first pharmacy:
   - Pharmacy name, address, license
   - Superintendent details
   - Settings (currency, VAT, etc.)

4. Invite staff:
   - Add pharmacy manager/pharmacists
   - Assign to specific pharmacy
   - Send invitation email

5. Complete setup
```

## Implementation Priority

### Phase 1: Critical (Must Have)
1. ✅ Database migration - already done
2. Add system_owner role and pharmacy assignments
3. Enhanced authentication middleware (check pharmacy access)
4. Owner consolidated dashboard
5. Pharmacy switcher UI component

### Phase 2: Important (Should Have)
6. Pharmacy management pages (add/edit/list)
7. Staff management and assignment
8. Role-based navigation and permissions
9. Per-pharmacy filtering in all pages

### Phase 3: Nice to Have
10. Consolidated reports
11. Pharmacy comparison analytics
12. Stock transfer between pharmacies
13. Cross-pharmacy reporting

## Example User Scenarios

### Scenario 1: Owner with 5 Pharmacies
- Logs in → sees "All Pharmacies" dashboard
- Views total sales: KES 5,000,000 across all 5 locations
- Clicks "Downtown Pharmacy" → switches to that pharmacy's view
- Sees that pharmacy's sales, inventory, staff
- Switches back to "All Pharmacies" view
- Goes to Reports → sees comparison chart of all 5 locations
- Identifies best performing pharmacy

### Scenario 2: Pharmacist at One Location
- Logs in → sees only "Westlands Pharmacy" dashboard
- No pharmacy switcher (locked to their pharmacy)
- Can only see/manage Westlands data
- Cannot see other pharmacies
- Cannot manage staff

### Scenario 3: Owner Adding New Pharmacy
- Goes to "Pharmacies" page
- Clicks "Add New Pharmacy"
- Fills in: "Eastleigh Branch", address, license
- Clicks "Save"
- Goes to "Staff" page
- Creates pharmacist: john@pharmacy.com
- Assigns to "Eastleigh Branch"
- John receives invitation email
- John logs in → sees only Eastleigh Branch

## Security Considerations

1. **Strict Pharmacy Isolation**
   - Pharmacists cannot access other pharmacies' data
   - All queries filtered by pharmacy_id
   - Owner can override (all pharmacies)

2. **Role Validation**
   - Middleware checks user role on every request
   - System owner: can access all pharmacies
   - Others: locked to assigned pharmacy

3. **Audit Logging**
   - Track when owner switches pharmacies
   - Track staff assignments
   - Track cross-pharmacy actions

## Next Steps

Would you like me to:
1. **Implement Phase 1** (Critical features) - Owner dashboard with consolidated view?
2. **Start with database migrations** - Add new fields and tables?
3. **Create the Owner Dashboard UI** - Multi-pharmacy view?
4. **All of the above** - Full implementation?

Let me know and I'll start building! 🚀
