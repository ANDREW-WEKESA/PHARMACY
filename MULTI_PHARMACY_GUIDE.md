# 🏥 Multi-Pharmacy Management System - Complete Guide

## Overview

Your pharmacy system now supports **one owner managing multiple pharmacy locations** with staff assigned to specific pharmacies. This guide covers everything you need to know.

## 🎯 System Architecture

### User Roles

**System Owner (is_system_owner = 1)**
- Manages multiple pharmacy locations
- Can view consolidated data across all pharmacies
- Can switch between specific pharmacy views
- Manages staff and assignments
- Full access to all features across all locations

**Pharmacy Staff (is_system_owner = 0)**
- Assigned to one specific pharmacy (assigned_pharmacy_id)
- Can only see their assigned pharmacy's data
- Cannot see other pharmacies
- Cannot manage staff or settings
- Roles: pharmacist, cashier, stock_clerk

---

## 🚀 Getting Started as System Owner

### 1. Initial Setup

When you first set up the system:
1. Visit production URL
2. Click "Create Account"
3. ✅ **Check "I manage multiple pharmacy locations"**
4. Fill in your details and first pharmacy information
5. Submit - you're now a system owner!

### 2. Your Owner Dashboard

Login redirects system owners to: `/owner-dashboard`

**Dashboard shows:**
- **Summary Cards**: Total Pharmacies, Combined Sales Today, Combined Inventory Value, Total Staff
- **Pharmacy Comparison Table**: All your pharmacies with:
  - Name, Status, Today's Sales, Inventory Value
  - Low Stock Alerts, Expiry Alerts, Staff Count
  - Actions (Edit, View Stats)

### 3. Pharmacy Switcher

**Top-right dropdown** (only visible to owners):
- "All Pharmacies" (default) - sees combined data
- Each pharmacy name - filters to that pharmacy only

**When you switch to a specific pharmacy:**
- Dashboard, Sales, Stock, Catalog, Reports all filter to show ONLY that pharmacy's data
- Current selection shown in header: "Viewing: [Pharmacy Name]"
- Selection persists in localStorage

---

## 📍 Managing Multiple Pharmacies

### Add New Pharmacy

1. Navigate to **"My Pharmacies"** page
2. Click **"Add New Pharmacy"** button
3. Fill in details:
   - Pharmacy Name (required)
   - Address, Phone, Email
   - KRA PIN, License Number
   - Superintendent Name & Reg No
   - M-Pesa Till Number
4. Click "Save"
5. New pharmacy appears in list immediately

### Edit Pharmacy

1. Go to "My Pharmacies"
2. Find pharmacy in list
3. Click "Edit" button
4. Update any details
5. Toggle "Active" to enable/disable pharmacy

### View Pharmacy Stats

Click "View Stats" to see detailed breakdown:
- Sales (all-time, this month, today)
- Inventory value
- Staff count
- Customer count
- Top 10 selling drugs

---

## 👥 Managing Staff Across Pharmacies

### View All Staff

Navigate to **"All Staff"** page

**Table shows:**
- Name, Email, Role
- Assigned Pharmacy
- Status (Active/Inactive)
- Actions (Edit, Change Pharmacy, Deactivate)

**Filters:**
- Filter by pharmacy dropdown
- Search by name/email

### Add New Staff Member

1. Click **"Add Staff Member"** button
2. Fill in form:
   - **Name** (required)
   - **Email** (required)
   - **Phone** (optional)
   - **Password** (required, min 8 chars)
   - **Role**: pharmacist, cashier, or stock_clerk
   - **Assign to Pharmacy** (select from your pharmacies)
   - Pharmacist Registration Number (if applicable)
3. Click "Create"
4. Staff member can now login

**Important:** Staff will only see their assigned pharmacy's data

### Edit Staff

1. Find staff in table
2. Click "Edit"
3. Update details:
   - Change name, email, phone
   - Change role
   - Reassign to different pharmacy
   - Update password (optional)
   - Activate/deactivate
4. Click "Save"

### Change Staff Pharmacy Assignment

Quick reassignment:
1. Find staff in table
2. Click "Edit"
3. Change "Assigned Pharmacy" dropdown
4. Click "Save"

The staff member will immediately only see the new pharmacy's data on next login.

---

## 📊 Consolidated Reports

### Sales Report (All Pharmacies)

API: `GET /api/owner/sales/consolidated?days=30`

Shows sales trends across all your pharmacies with breakdown per location.

### Inventory Report (All Pharmacies)

API: `GET /api/owner/inventory/consolidated`

Shows inventory summary for each pharmacy:
- Drug count
- Total units
- Total value
- Expired batches
- Expiring soon alerts

### Pharmacy Comparison Report

API: `GET /api/owner/reports/comparison`

Compares all pharmacies side-by-side:
- Sales today vs this month
- Inventory value
- Staff count
- Customer count
- Status (active/inactive)

---

## 🔐 Security & Data Isolation

### How Data Filtering Works

**Backend (worker/src/index.js):**
```javascript
// Auth middleware sets pharmacy context
if (user.is_system_owner) {
  // Can access all pharmacies or filter by query param
  pharmacy_id = req.query.pharmacy_id || null;
} else {
  // Locked to assigned pharmacy
  pharmacy_id = user.assigned_pharmacy_id;
}
```

**All queries automatically filtered:**
- Sales, Stock, Drugs, Customers, Reports
- Staff can NEVER bypass this filter
- Owners can override with `?pharmacy_id=X` parameter

### Database Schema

**Key Fields Added (Migration 0003):**

```sql
-- Users table
users.is_system_owner INTEGER (0/1)
users.assigned_pharmacy_id INTEGER

-- Pharmacy table
pharmacy.owner_user_id INTEGER (who owns this pharmacy)
pharmacy.active INTEGER (1=active, 0=disabled)

-- Staff assignments table (for multiple assignments)
pharmacy_staff_assignments (
  user_id, pharmacy_id, role, can_manage_staff
)
```

---

## 🎨 Frontend Components

### New Components Created

1. **PharmacyContext** (`web/src/contexts/PharmacyContext.jsx`)
   - Global state for pharmacy selection
   - Provides: isSystemOwner, selectedPharmacyId, pharmacyList, switchPharmacy()

2. **PharmacySwitcher** (`web/src/components/PharmacySwitcher.jsx`)
   - Dropdown to switch between pharmacies
   - Shows current selection
   - Only visible to system owners

3. **OwnerDashboard** (`web/src/pages/OwnerDashboard.jsx`)
   - Consolidated view of all pharmacies
   - Summary cards and comparison table

4. **PharmacyManagement** (`web/src/pages/PharmacyManagement.jsx`)
   - Add/edit/manage pharmacy locations
   - Toggle active status

5. **StaffManagement** (`web/src/pages/StaffManagement.jsx`)
   - View all staff across pharmacies
   - Add/edit/assign staff to pharmacies

### Updated Components

**App.jsx:**
- Wrapped in PharmacyContext provider
- New routes: `/owner-dashboard`, `/owner/pharmacies`, `/owner/staff`
- Role-based redirects (owners → owner dashboard, staff → regular dashboard)

**Navigation:**
- System owners see: Owner Dashboard, My Pharmacies, All Staff, Reports
- Regular users see: Dashboard, Sales, Catalog, Stock, Reports, Settings

**All Data Pages (Dashboard, Sales, Stock, Catalog, Reports):**
- Now use selectedPharmacyId from context
- Append `?pharmacy_id=X` to API calls when specific pharmacy selected
- Automatically filter data based on selection

---

## 🌐 API Endpoints

### Owner-Only Endpoints

All at `/api/owner/*` - require system owner authentication

**Dashboard & Analytics:**
```
GET  /api/owner/dashboard
     → consolidated metrics, pharmacy breakdown

GET  /api/owner/reports/comparison
     → side-by-side pharmacy comparison

GET  /api/owner/sales/consolidated?days=30
     → sales trends across all pharmacies

GET  /api/owner/inventory/consolidated
     → inventory summary per pharmacy
```

**Pharmacy Management:**
```
GET  /api/owner/pharmacies
     → list all owned pharmacies

POST /api/owner/pharmacies
     → create new pharmacy
     Body: { name, address, phone, email, kra_pin, licence_no, ... }

PUT  /api/owner/pharmacies/:id
     → update pharmacy details
     Body: { name, address, active, ... }

GET  /api/owner/pharmacies/:id/stats
     → detailed stats for one pharmacy
```

**Staff Management:**
```
GET  /api/owner/staff
     → all staff across all pharmacies

POST /api/owner/staff
     → create new staff member
     Body: { name, email, password, role, assigned_pharmacy_id, ... }

PUT  /api/owner/staff/:id
     → update staff details
     Body: { name, role, assigned_pharmacy_id, active, ... }

POST /api/owner/staff/:id/assign
     → assign staff to additional pharmacy
     Body: { pharmacy_id, role, can_manage_staff }

DELETE /api/owner/staff/:id/unassign?pharmacy_id=X
       → remove staff from pharmacy
```

### Enhanced Auth Endpoints

```
POST /api/setup
     Body: { is_system_owner: true, pharmacy_name, owner_name, owner_email, password }
     → creates system owner + first pharmacy

POST /api/auth/login
     Response includes: { is_system_owner, assigned_pharmacy_id, accessible_pharmacies }
```

---

## 🧪 Testing the Multi-Pharmacy System

### Test Scenario 1: Owner with Multiple Pharmacies

1. **Login as system owner** (admin@pharmacy.com)
   - Should redirect to `/owner-dashboard`
   - See summary cards with totals
   - See pharmacy comparison table

2. **Add second pharmacy**
   - Go to "My Pharmacies"
   - Click "Add New Pharmacy"
   - Fill: name="Downtown Branch", etc.
   - Save
   - Should appear in dashboard table

3. **Test pharmacy switcher**
   - Click dropdown (top-right)
   - Select "Downtown Branch"
   - Header shows: "Viewing: Downtown Branch"
   - Go to Dashboard → should show only Downtown data
   - Go to Sales → should show only Downtown sales
   - Switch to "All Pharmacies" → see combined data

4. **Add staff to Downtown**
   - Go to "All Staff"
   - Click "Add Staff Member"
   - Name: "Jane Pharmacist"
   - Email: jane@pharmacy.com
   - Password: password123
   - Role: pharmacist
   - Assign to: Downtown Branch
   - Save

5. **Logout and login as Jane**
   - Login: jane@pharmacy.com / password123
   - Should redirect to `/dashboard` (regular dashboard)
   - Should ONLY see Downtown Branch data
   - No pharmacy switcher visible
   - Cannot access other pharmacies

### Test Scenario 2: Pharmacy Filtering

1. Login as owner
2. Switch to specific pharmacy
3. Check each page filters correctly:
   - Dashboard: sales metrics filtered
   - Sales: transaction list filtered
   - Stock: inventory filtered
   - Catalog: drug list filtered
   - Reports: all reports filtered
4. Switch to "All Pharmacies"
5. Verify combined/aggregated data shows

### Test Scenario 3: Staff Management

1. Edit staff member
2. Change assigned pharmacy
3. Verify update saved
4. Login as that staff member
5. Verify they now see new pharmacy's data only

---

## 📦 Deployment Status

### ✅ Production Deployed

**URL:** https://pharmacy-standalone.andrewwekesa675.workers.dev

**Database:** Migration 0003 applied successfully

**Assets:**
- Frontend: 277.16 kB (78.32 kB gzipped)
- All multi-pharmacy components included

**Version:** 4c22a9ba-b0c7-4957-b161-7e6df8cb6476

### Commits Pushed to GitHub

```
7bbe4f0 fix: address review findings for multi-pharmacy frontend
36a0bc9 feat: wire pharmacy switcher to filter data and fix review findings
fa84496 fix: address review findings for multi-pharmacy owner frontend
8543876 feat: implement multi-pharmacy owner frontend components
c02aedb feat: database schema and auth for multi-pharmacy owners (FEAT-001)
```

---

## 🎓 Key Concepts

### System Owner vs Regular User

| Feature | System Owner | Regular User |
|---------|--------------|--------------|
| Can manage multiple pharmacies | ✅ Yes | ❌ No |
| Sees all pharmacies data | ✅ Yes | ❌ No (only assigned) |
| Can switch pharmacy view | ✅ Yes | ❌ No |
| Can add/edit pharmacies | ✅ Yes | ❌ No |
| Can manage staff | ✅ Yes | ❌ No |
| Consolidated reports | ✅ Yes | ❌ No |
| Access to owner routes | ✅ Yes | ❌ No |

### Data Isolation

**Guaranteed by backend:**
- Every API request checks user role
- System owners: optional filtering via query param
- Regular users: HARD filtered to assigned_pharmacy_id
- No way for staff to bypass restrictions

**Frontend enforces:**
- Role-based UI (different menus)
- Pharmacy switcher only for owners
- Context-aware API calls

---

## 🚧 Future Enhancements

Potential additions:
- Stock transfer between pharmacies
- Inter-pharmacy reports (which pharmacy sells more of X)
- Staff can work at multiple pharmacies (via pharmacy_staff_assignments table)
- Pharmacy-level settings override (different VAT rates, currencies)
- Performance benchmarking between locations
- Automated alerts to owner for low performing pharmacies

---

## 📞 Support

- **GitHub**: https://github.com/ANDREW-WEKESA/PHARMACY
- **Production**: https://pharmacy-standalone.andrewwekesa675.workers.dev
- **Documentation**: See DEPLOYMENT.md, EMAIL_SETUP.md, RESPONSIVE_GUIDE.md

---

**You're all set!** Your multi-pharmacy management system is ready to scale! 🎉
