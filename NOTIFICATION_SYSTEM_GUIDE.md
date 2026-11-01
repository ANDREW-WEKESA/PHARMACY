# 🔔 Owner Notification System - Complete Guide

## Overview

The pharmacy system now includes a comprehensive notification system that alerts system owners about important activities and abnormal behavior across all pharmacy locations.

## ✅ What's Implemented

### Backend (Complete)
- ✅ Database table: `owner_notifications`
- ✅ Notification service with detection logic
- ✅ API endpoints: `/api/owner/notifications`
- ✅ Integration with sales routes
- ✅ Integration with authentication routes
- ✅ Abnormal activity detection
- ✅ Migration applied to production

### Frontend (Partial - Components Created)
- ✅ NotificationContext (state management)
- ✅ NotificationBell (dropdown component)
- ⏳ Full notifications page (next step)
- ⏳ Integration into App.jsx (next step)

---

## 🎯 Notification Types

### 1. Sales Notifications

**High-Value Sale**
- **Trigger**: Sale total > (expiry_warn_days * 100)
- **Type**: Warning
- **Example**: "High-value sale of KES 150,000 - Sale S-000123"

**After-Hours Sale**
- **Trigger**: Sale recorded before 6 AM or after 10 PM
- **Type**: Warning
- **Example**: "After-hours sale at 2:00 - Sale S-000124"

**Large Discount**
- **Trigger**: Discount > 50% of subtotal
- **Type**: Warning
- **Example**: "Large discount of 65% applied - Sale S-000125"

### 2. Authentication/Security Notifications

**Failed Login Attempts**
- **Trigger**: Failed login for any user
- **Type**: Security
- **Example**: "Failed login attempt for user John Doe (john@pharmacy.com)"

**Password Changed**
- **Trigger**: User changes password (future)
- **Type**: Security

**New Staff Created**
- **Trigger**: System owner creates new staff (future)
- **Type**: Info

### 3. Stock Notifications (Future)

**Large Stock Adjustment**
- **Trigger**: Adjustment > 500 units or > 20% of current stock
- **Type**: Warning

**Expired Drugs Detected**
- **Trigger**: Drugs past expiry date still in system
- **Type**: Critical

**Stock Transfer**
- **Trigger**: Stock moved between pharmacies
- **Type**: Info

---

## 📊 Database Schema

### owner_notifications Table

```sql
CREATE TABLE owner_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_user_id INTEGER NOT NULL,           -- Which owner to notify
  pharmacy_id INTEGER,                       -- Which pharmacy (null = system-wide)
  type TEXT NOT NULL,                        -- info|warning|critical|security
  category TEXT NOT NULL,                    -- sales|stock|staff|auth|security|system
  title TEXT NOT NULL,                       -- Short title
  message TEXT NOT NULL,                     -- Full message
  metadata TEXT,                             -- JSON with extra details
  is_read INTEGER DEFAULT 0,                 -- Read status
  requires_action INTEGER DEFAULT 0,         -- Needs owner action
  created_at TEXT DEFAULT (datetime('now'))  -- Timestamp
);
```

**Indexes:**
- `idx_owner_notifications_owner_read` - Fast queries by owner + read status
- `idx_owner_notifications_pharmacy` - Filter by pharmacy
- `idx_owner_notifications_created` - Sort by time

---

## 🔌 API Endpoints

### GET /api/owner/notifications

Get notifications for logged-in owner.

**Query Parameters:**
- `unread_only=true` - Only unread notifications
- `limit=50` - Max results (default: 50, max: 100)
- `type=critical` - Filter by type (info|warning|critical|security)
- `category=sales` - Filter by category
- `pharmacy_id=2` - Filter by pharmacy

**Response:**
```json
{
  "notifications": [
    {
      "id": 1,
      "owner_user_id": 1,
      "pharmacy_id": 2,
      "type": "warning",
      "category": "sales",
      "title": "Abnormal Sale Detected",
      "message": "High-value sale of KES 150,000 - Sale S-000123 at Downtown Pharmacy",
      "metadata": {
        "sale_no": "S-000123",
        "total": 150000,
        "discount": 0,
        "user_name": "Jane Doe",
        "user_id": 5
      },
      "is_read": 0,
      "requires_action": 0,
      "created_at": "2026-11-02 01:15:23"
    }
  ]
}
```

### GET /api/owner/notifications/stats

Get notification statistics.

**Response:**
```json
{
  "stats": {
    "total": 45,
    "unread": 12,
    "critical_unread": 2,
    "warning_unread": 8,
    "security_unread": 2,
    "action_required": 1
  },
  "by_category": [
    { "category": "sales", "count": 25, "unread": 7 },
    { "category": "auth", "count": 10, "unread": 3 },
    { "category": "stock", "count": 10, "unread": 2 }
  ]
}
```

### PUT /api/owner/notifications/:id/read

Mark single notification as read.

**Response:**
```json
{ "ok": true }
```

### PUT /api/owner/notifications/mark-all-read

Mark all notifications as read.

**Response:**
```json
{ "ok": true }
```

### DELETE /api/owner/notifications/cleanup?days=90

Delete old read notifications (optional maintenance).

**Response:**
```json
{ "deleted": 23 }
```

---

## 💻 Frontend Components

### NotificationContext

React context providing notification state and actions.

**Usage:**
```jsx
import { useNotifications } from '../contexts/NotificationContext.jsx';

function MyComponent() {
  const { 
    notifications,      // Array of notification objects
    unreadCount,        // Total unread count
    criticalCount,      // Unread critical count
    loading,            // Loading state
    fetchNotifications, // Refresh notifications
    markAsRead,         // Mark one as read
    markAllAsRead       // Mark all as read
  } = useNotifications();
  
  // Auto-refreshes every 30 seconds
  // Only available to system owners
}
```

### NotificationBell Component

Dropdown bell icon with unread badge.

**Features:**
- Shows unread count badge
- Red badge for critical notifications
- Dropdown shows latest 10 notifications
- Click notification to mark as read
- "View All" link to full page
- Auto-closes when clicking outside

**Usage:**
```jsx
import { NotificationBell } from '../components/NotificationBell.jsx';

// In header
<NotificationBell />
```

---

## 🔍 Detection Logic

### Abnormal Sale Detection

**Function:** `detectAbnormalSale(pharmacy, sale)`

```javascript
// After-hours check
if (saleHour < 6 || saleHour >= 22) {
  return { reason: 'After-hours sale', severity: 'warning' };
}

// High-value check
const threshold = (pharmacy.expiry_warn_days || 90) * 100;
if (sale.total > threshold) {
  return { reason: 'High-value sale', severity: 'warning' };
}

// Large discount check
const discountPercent = (sale.discount / sale.subtotal) * 100;
if (discountPercent > 50) {
  return { reason: 'Large discount', severity: 'warning' };
}
```

### Failed Login Detection

**Function:** Integrated in `/auth/login` endpoint

```javascript
// On failed login
if (!ok) {
  await audit(db, null, 'login_failed', 'user', null, identifier);
  
  // Notify owner
  if (user.assigned_pharmacy_id) {
    const pharmacy = await q.first(db, 
      'SELECT owner_user_id FROM pharmacy WHERE id=?', 
      user.assigned_pharmacy_id
    );
    
    if (pharmacy.owner_user_id) {
      await notifyOwner(db, pharmacy.owner_user_id, {
        pharmacyId: user.assigned_pharmacy_id,
        type: 'security',
        category: 'auth',
        title: 'Failed Login Attempt',
        message: `Failed login attempt for ${user.name}`,
        metadata: { user_id: user.id, identifier },
        requiresAction: false
      });
    }
  }
}
```

---

## 🚀 Testing the Notification System

### Test 1: High-Value Sale

1. Login as system owner
2. Go to Sales page
3. Create sale with total > 9,000 (default threshold: 90 days * 100)
4. Complete the sale
5. **Expected**: Notification appears with "High-value sale" message

### Test 2: After-Hours Sale

1. Change system time to 2:00 AM or 11:00 PM
2. Create and complete a sale
3. **Expected**: "After-hours sale" notification

### Test 3: Large Discount

1. Create sale with 60% discount
2. Complete sale
3. **Expected**: "Large discount" notification

### Test 4: Failed Login

1. Logout
2. Attempt login with wrong password
3. Login as owner
4. **Expected**: "Failed login attempt" security notification

### Test 5: Notification Bell

1. Login as system owner
2. Check notification bell in header
3. **Expected**: Badge shows unread count
4. Click bell
5. **Expected**: Dropdown shows recent notifications
6. Click a notification
7. **Expected**: Marked as read, badge count decreases

---

## 📈 Future Enhancements

### Additional Detection Rules

**Stock Alerts:**
- Large stock adjustments (> 20% of inventory)
- Expired drugs not removed
- Stock out of critical items
- Stock transfers between pharmacies

**Staff Alerts:**
- New staff member added
- Staff role changed
- Staff deactivated
- Multiple failed logins from same IP

**System Alerts:**
- Pharmacy added/edited
- System settings changed
- Backup failures
- Database size warnings

### Email Notifications

For critical notifications:
- Send email via MailChannels
- Configurable per owner
- Email template with notification details
- Link back to system

### Notification Settings

Allow owners to configure:
- Enable/disable by category
- Email notifications on/off
- Critical only mode
- Sound alerts
- Auto-mark as read after X days
- Per-pharmacy preferences

### Advanced Features

- Notification digest (daily summary email)
- Slack/SMS integration
- Push notifications (PWA)
- Notification rules builder
- Escalation (if not read in X hours)
- Notification analytics dashboard

---

## 🛠️ Implementation Status

### ✅ Completed (Production)
- Database schema and migration
- Notification service core functions
- API endpoints for CRUD operations
- Sales abnormal detection
- Authentication failure detection
- NotificationContext provider
- NotificationBell component

### ⏳ Next Steps (To Complete)
1. Create full OwnerNotifications page
2. Integrate NotificationBell into App.jsx header
3. Wrap App in NotificationContext provider
4. Test end-to-end notification flow
5. Add more detection rules (stock, staff events)
6. Implement email notifications for critical alerts
7. Add notification settings page
8. Build and deploy frontend updates

---

## 📝 Code Examples

### Creating a Notification

```javascript
import { notifyOwner } from './notification-service.js';

// In any route handler
await notifyOwner(db, ownerId, {
  pharmacyId: 2,
  type: 'warning',          // info|warning|critical|security
  category: 'sales',        // sales|stock|staff|auth|security|system
  title: 'High-Value Sale',
  message: 'Sale S-000123 exceeded threshold',
  metadata: { 
    sale_no: 'S-000123', 
    total: 150000 
  },
  requiresAction: false
});
```

### Querying Notifications

```javascript
// Get unread critical notifications
const criticalNotifications = await q.all(db,
  `SELECT * FROM owner_notifications 
   WHERE owner_user_id = ? 
     AND is_read = 0 
     AND type = 'critical'
   ORDER BY created_at DESC 
   LIMIT 20`,
  ownerId
);
```

---

## 🎉 Summary

The owner notification system provides real-time awareness of important activities across all pharmacy locations. It helps owners:

✅ Monitor abnormal transactions
✅ Detect security issues
✅ Track staff activities
✅ Stay informed about all pharmacies
✅ Take quick action when needed

**Status**: Backend complete and deployed to production. Frontend components created, awaiting integration.

**Production URL**: https://pharmacy-standalone.andrewwekesa675.workers.dev

**Next Session**: Complete frontend integration and test full notification flow.
