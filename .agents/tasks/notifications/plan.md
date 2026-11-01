# Implementation Plan: Owner Notification System

## Overview
Implement a comprehensive owner notification system for the multi-pharmacy management platform. The system will notify pharmacy owners of abnormal activities, security events, staff changes, and critical alerts across all their pharmacies.

## Key Architecture Decisions

### Owner Identification Pattern
**Decision**: Use `pharmacy.owner_user_id` to identify the owner for notifications.
**Rationale**: The multi-pharmacy owner migration (0003) added `owner_user_id` to the pharmacy table, linking each pharmacy to its owning user. This is the authoritative source for ownership.
**Implementation**: 
```javascript
const pharmacy = await q.first(db, 'SELECT owner_user_id FROM pharmacy WHERE id=?', pharmacyId);
if (pharmacy?.owner_user_id) {
  await notifyOwner(db, pharmacy.owner_user_id, { pharmacyId, type, category, title, message, metadata });
}
```

### Abnormal Activity Detection Heuristics
**Decision**: Use simple threshold-based detection initially.
**Rationale**: Complex ML/statistical detection can come later; start with clear thresholds.
**Thresholds**:
- Abnormal sale: total > `pharmacy.expiry_warn_days * 100` (e.g., 90 * 100 = 9,000 KES)
- Abnormal stock adjustment: `Math.abs(qty_change) > 500` units
- Security events: Always notify on failed login, password change, new user, role change, deactivation

### Multi-Pharmacy Filtering
**Decision**: Store nullable `pharmacy_id` in notifications; null means system-wide notification.
**Rationale**: Some notifications (e.g., "New pharmacy added") are not pharmacy-specific.
**Implementation**: Frontend filters by selected pharmacy when `pharmacyId` is not null.

---

## Implementation Steps

### 1. Database Migration (0004_owner_notifications.sql)

**What**: Create the `owner_notifications` table with proper schema and indexes.

**Files**: 
- Create: `worker/migrations/0004_owner_notifications.sql`

**SQL**:
```sql
-- Owner notification system
CREATE TABLE owner_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_user_id INTEGER NOT NULL REFERENCES users(id),
  pharmacy_id INTEGER REFERENCES pharmacy(id),
  type TEXT NOT NULL CHECK(type IN ('info','warning','critical','security')),
  category TEXT NOT NULL CHECK(category IN ('sales','stock','staff','auth','security','system')),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata TEXT,
  is_read INTEGER NOT NULL DEFAULT 0,
  requires_action INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_owner_notifications_owner_read ON owner_notifications(owner_user_id, is_read);
CREATE INDEX idx_owner_notifications_pharmacy ON owner_notifications(pharmacy_id);
CREATE INDEX idx_owner_notifications_created ON owner_notifications(created_at DESC);
```

**Verify**: 
```bash
npm run db:migrate:local
wrangler d1 execute pharmacy-db --local --command "SELECT name FROM sqlite_master WHERE type='table' AND name='owner_notifications'"
```
Expected: Returns row with name='owner_notifications'

---

### 2. Notification Service Core (notification-service.js)

**What**: Create the core notification service with `notifyOwner()` function and detector helpers.

**Files**: 
- Create: `worker/src/notification-service.js`

**Implementation**:
```javascript
import { q, nowUtc } from './lib.js';

export async function notifyOwner(db, ownerId, {
  pharmacyId = null,
  type = 'info',
  category = 'system',
  title,
  message,
  metadata = null,
  requiresAction = false
}) {
  const metadataJson = metadata ? JSON.stringify(metadata) : null;
  await q.run(db,
    `INSERT INTO owner_notifications (owner_user_id, pharmacy_id, type, category, title, message, metadata, requires_action)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ownerId, pharmacyId, type, category, title, message, metadataJson, requiresAction ? 1 : 0
  );
}

export function detectAbnormalSale(pharmacy, sale) {
  const threshold = (pharmacy.expiry_warn_days || 90) * 100;
  return sale.total > threshold;
}

export function detectAbnormalStock(adjustment) {
  return Math.abs(adjustment.qty_change) > 500;
}

export function detectSecurityIssue(action) {
  return ['login_failed', 'password_changed', 'user_created', 'user_updated'].includes(action);
}
```

**Verify**: 
```bash
node -e "import('./worker/src/notification-service.js').then(m => console.log(Object.keys(m)))"
```
Expected: Shows exported functions

---

### 3. Notification API Routes (routes-notifications.js)

**What**: Create API endpoints for fetching, marking read, and getting stats on notifications.

**Files**: 
- Create: `worker/src/routes-notifications.js`
- Update: `worker/src/index.js` (add route registration)

**API Endpoints**:

#### GET /api/owner/notifications
Query params: `page` (default 1), `limit` (max 50), `unread` (0/1), `category`, `pharmacy_id`, `type`, `search`
Returns: `{ notifications: [...], total, page, pageSize }`

#### PUT /api/owner/notifications/:id/read
Marks single notification as read.
Returns: `{ ok: true }`

#### PUT /api/owner/notifications/mark-all-read
Query param: `pharmacy_id` (optional, to mark all for one pharmacy)
Marks all unread notifications for owner as read.
Returns: `{ ok: true, count }`

#### GET /api/owner/notifications/stats
Returns: `{ total, unread, critical, warning, info, security, by_category: { sales, stock, staff, auth, security, system } }`

**Implementation Pattern** (example for GET list):
```javascript
import { Hono } from 'hono';
import { q, str, int } from './lib.js';
import { need } from './routes-core.js';

const app = new Hono();
const OWNER_ONLY = need('owner');

app.get('/notifications', OWNER_ONLY, async (c) => {
  const user = c.get('user');
  if (!user.is_system_owner) {
    throw new HttpError(403, 'Notifications are only available to system owners.');
  }
  
  const page = Math.max(1, int(c.req.query('page'), 1));
  const limit = Math.min(50, Math.max(10, int(c.req.query('limit'), 25)));
  const where = ['owner_user_id = ?'];
  const args = [user.id];
  
  if (c.req.query('unread') === '1') {
    where.push('is_read = 0');
  }
  
  const category = str(c.req.query('category'));
  if (category && ['sales','stock','staff','auth','security','system'].includes(category)) {
    where.push('category = ?');
    args.push(category);
  }
  
  const pharmacyId = int(c.req.query('pharmacy_id'), 0);
  if (pharmacyId) {
    where.push('pharmacy_id = ?');
    args.push(pharmacyId);
  }
  
  const type = str(c.req.query('type'));
  if (type && ['info','warning','critical','security'].includes(type)) {
    where.push('type = ?');
    args.push(type);
  }
  
  const search = str(c.req.query('search'));
  if (search) {
    where.push('(title LIKE ? OR message LIKE ?)');
    const like = `%${search}%`;
    args.push(like, like);
  }
  
  const W = 'WHERE ' + where.join(' AND ');
  const total = await q.first(c.env.DB, `SELECT COUNT(*) n FROM owner_notifications ${W}`, ...args);
  const notifications = await q.all(c.env.DB,
    `SELECT n.*, p.name pharmacy_name
     FROM owner_notifications n
     LEFT JOIN pharmacy p ON p.id = n.pharmacy_id
     ${W}
     ORDER BY n.created_at DESC
     LIMIT ? OFFSET ?`,
    ...args, limit, (page - 1) * limit
  );
  
  return c.json({ notifications, total: total.n, page, pageSize: limit });
});

export default app;
```

**Update index.js**:
```javascript
import notificationRoutes from './routes-notifications.js';
// ... existing imports

// After app.route('/api/owner', ownerRoutes);
app.route('/api/owner', notificationRoutes);
```

**Verify**: 
```bash
npm run dev:api
curl -H "Authorization: Bearer <owner-token>" http://localhost:8787/api/owner/notifications
```
Expected: Returns JSON with notifications array (empty initially)

---

### 4. Integrate Notifications into Sales Routes

**What**: Trigger notifications on refunds, voids, and abnormally large sales.

**Files**: 
- Update: `worker/src/routes-sales.js`

**Changes**:

1. Import notification service at top:
```javascript
import { notifyOwner, detectAbnormalSale } from './notification-service.js';
```

2. In `POST /sales` endpoint, after successful sale creation (after the `await db.batch(stmts)` line):
```javascript
// After await db.batch(stmts);
const pharmacy = await q.first(db, 'SELECT * FROM pharmacy WHERE id=?', pharmacy_id || 1);
if (pharmacy?.owner_user_id && detectAbnormalSale(pharmacy, { total })) {
  await notifyOwner(db, pharmacy.owner_user_id, {
    pharmacyId: pharmacy_id || 1,
    type: 'warning',
    category: 'sales',
    title: 'Large Sale Recorded',
    message: `Sale ${saleNo} totaling ${total} KES exceeds normal threshold.`,
    metadata: { sale_no: saleNo, total, cashier_id: user.id }
  });
}
```

3. In `POST /sales/:id/void` endpoint, after void/refund (after `await db.batch(stmts)`):
```javascript
const pharmacy = await q.first(db, 'SELECT owner_user_id FROM pharmacy WHERE id=?', s.pharmacy_id);
if (pharmacy?.owner_user_id) {
  await notifyOwner(db, pharmacy.owner_user_id, {
    pharmacyId: s.pharmacy_id,
    type: 'warning',
    category: 'sales',
    title: `Sale ${kind === 'voided' ? 'Voided' : 'Refunded'}`,
    message: `Sale ${s.sale_no} (${s.total} KES) was ${kind} by ${user.name}. Reason: ${reason}`,
    metadata: { sale_no: s.sale_no, total: s.total, reason, voided_by: user.id }
  });
}
```

**Verify**: 
1. Create a large sale > 9,000 KES, check `/api/owner/notifications` for warning
2. Void a sale, check for notification with reason

---

### 5. Integrate Notifications into Stock Routes

**What**: Trigger notifications on large stock adjustments.

**Files**: 
- Update: `worker/src/routes-stock.js`

**Changes**:

1. Import at top:
```javascript
import { notifyOwner, detectAbnormalStock } from './notification-service.js';
```

2. In `POST /adjustments` endpoint, after adjustment (after `await db.batch(stmts)`):
```javascript
const pharmacy = await q.first(db, 'SELECT owner_user_id, id FROM pharmacy WHERE id=?', drug.pharmacy_id);
if (pharmacy?.owner_user_id && detectAbnormalStock({ qty_change: change })) {
  await notifyOwner(db, pharmacy.owner_user_id, {
    pharmacyId: pharmacy.id,
    type: 'warning',
    category: 'stock',
    title: 'Large Stock Adjustment',
    message: `${drug.brand_name}: ${change > 0 ? '+' : ''}${change} units adjusted. Reason: ${reason}`,
    metadata: { drug_id: drug.id, drug_name: drug.brand_name, qty_change: change, reason, batch_id: batch.id }
  });
}
```

**Verify**: Create stock adjustment with qty_change > 500 or < -500, check notifications

---

### 6. Integrate Notifications into Core Routes (Auth & User Management)

**What**: Trigger notifications on security events: failed logins, password changes, new users, role changes, deactivations.

**Files**: 
- Update: `worker/src/routes-core.js`

**Changes**:

1. Import:
```javascript
import { notifyOwner } from './notification-service.js';
```

2. In `POST /auth/login`, after failed login audit (in the `if (!ok)` block, after `await audit(...)`):
```javascript
if (u && u.pharmacy_id) {
  const pharmacy = await q.first(c.env.DB, 'SELECT owner_user_id, id FROM pharmacy WHERE id=?', u.pharmacy_id);
  if (pharmacy?.owner_user_id) {
    await notifyOwner(c.env.DB, pharmacy.owner_user_id, {
      pharmacyId: pharmacy.id,
      type: 'security',
      category: 'auth',
      title: 'Failed Login Attempt',
      message: `Failed login for ${u.name} (${idRaw}) at ${nowUtc()}`,
      metadata: { user_id: u.id, identifier: idRaw }
    });
  }
}
```

3. In `POST /auth/change-password`, after success (after `await audit(...)`):
```javascript
const pharmacy = await q.first(c.env.DB, 'SELECT owner_user_id, id FROM pharmacy WHERE id=?', u.pharmacy_id || u.assigned_pharmacy_id);
if (pharmacy?.owner_user_id) {
  await notifyOwner(c.env.DB, pharmacy.owner_user_id, {
    pharmacyId: pharmacy.id,
    type: 'info',
    category: 'auth',
    title: 'Password Changed',
    message: `${u.name} changed their password.`,
    metadata: { user_id: u.id }
  });
}
```

4. In `POST /users`, after user creation (after `await audit(...)`):
```javascript
const pharmacy = await q.first(c.env.DB, 'SELECT owner_user_id, id FROM pharmacy WHERE id=?', c.get('pharmacy_id') || 1);
if (pharmacy?.owner_user_id) {
  await notifyOwner(c.env.DB, pharmacy.owner_user_id, {
    pharmacyId: pharmacy.id,
    type: 'info',
    category: 'staff',
    title: 'New User Created',
    message: `${name} (${role}) was added by ${c.get('user').name}.`,
    metadata: { user_id: r.meta.last_row_id, role, created_by: c.get('user').id }
  });
}
```

5. In `PUT /users/:id`, after role change or deactivation (after `await audit(...)`), add condition:
```javascript
if (role !== u.role || (!active && u.active)) {
  const pharmacy = await q.first(c.env.DB, 'SELECT owner_user_id, id FROM pharmacy WHERE id=?', u.pharmacy_id || u.assigned_pharmacy_id);
  if (pharmacy?.owner_user_id) {
    const changes = [];
    if (role !== u.role) changes.push(`role changed to ${role}`);
    if (!active && u.active) changes.push('deactivated');
    await notifyOwner(c.env.DB, pharmacy.owner_user_id, {
      pharmacyId: pharmacy.id,
      type: 'warning',
      category: 'staff',
      title: 'User Updated',
      message: `${u.name}: ${changes.join(', ')} by ${c.get('user').name}.`,
      metadata: { user_id: id, changes, updated_by: c.get('user').id }
    });
  }
}
```

**Verify**: 
1. Attempt failed login, check security notification
2. Change password, check info notification
3. Create new user, check staff notification
4. Change user role, check warning notification
5. Deactivate user, check warning notification

---

### 7. Integrate Notifications into Owner Routes (Pharmacy & Staff Management)

**What**: Trigger notifications on pharmacy creation/updates and staff assignments.

**Files**: 
- Update: `worker/src/routes-owner.js`

**Changes**:

1. Import:
```javascript
import { notifyOwner } from './notification-service.js';
```

2. In `POST /pharmacies`, after pharmacy creation (after `await audit(...)`):
```javascript
await notifyOwner(db, user.id, {
  pharmacyId: pharmacyId,
  type: 'info',
  category: 'system',
  title: 'New Pharmacy Added',
  message: `Pharmacy "${name}" has been created.`,
  metadata: { pharmacy_id: pharmacyId }
});
```

3. In `PUT /pharmacies/:id`, when active changes (add after `await audit(...)`):
```javascript
if (active !== pharmacy.active) {
  await notifyOwner(db, user.id, {
    pharmacyId: id,
    type: active ? 'info' : 'warning',
    category: 'system',
    title: `Pharmacy ${active ? 'Activated' : 'Deactivated'}`,
    message: `Pharmacy "${pharmacy.name}" was ${active ? 'activated' : 'deactivated'}.`,
    metadata: { pharmacy_id: id, active }
  });
}
```

4. In `POST /staff` and `PUT /staff/:id`, after significant changes (role change, deactivation), similar pattern to routes-core.js user updates.

**Verify**: 
1. Create pharmacy, check system notification
2. Deactivate pharmacy, check warning notification
3. Change staff role via owner routes, check notification

---

### 8. React Notification Context

**What**: Create React context for managing notification state, fetching, and actions.

**Files**: 
- Create: `web/src/contexts/NotificationContext.jsx`

**Implementation**:
```javascript
import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { get, put } from '../api.js';

const NotificationContext = createContext(null);

export function NotificationProvider({ children, user }) {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [criticalCount, setCriticalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const isOwner = user?.role === 'owner' && user?.is_system_owner;

  const fetchNotifications = useCallback(async () => {
    if (!isOwner) return;
    setLoading(true);
    try {
      const data = await get('/owner/notifications?limit=50');
      setNotifications(data.notifications || []);
      setUnreadCount(data.notifications.filter(n => !n.is_read).length);
      setCriticalCount(data.notifications.filter(n => n.type === 'critical' && !n.is_read).length);
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [isOwner]);

  const markAsRead = useCallback(async (id) => {
    await put(`/owner/notifications/${id}/read`);
    await fetchNotifications();
  }, [fetchNotifications]);

  const markAllAsRead = useCallback(async () => {
    await put('/owner/notifications/mark-all-read');
    await fetchNotifications();
  }, [fetchNotifications]);

  useEffect(() => {
    if (!isOwner) return;
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 30000); // 30 seconds
    return () => clearInterval(interval);
  }, [isOwner, fetchNotifications]);

  return (
    <NotificationContext.Provider value={{
      notifications,
      unreadCount,
      criticalCount,
      loading,
      error,
      fetchNotifications,
      markAsRead,
      markAllAsRead
    }}>
      {children}
    </NotificationContext.Provider>
  );
}

export const useNotifications = () => useContext(NotificationContext);
```

**Verify**: Add console.log in fetchNotifications to verify it runs every 30s

---

### 9. Notification Bell Component

**What**: Create bell icon with badge and dropdown showing latest notifications.

**Files**: 
- Create: `web/src/components/NotificationBell.jsx`
- Update: `web/src/App.jsx` (add NotificationProvider and render bell)

**Implementation** (NotificationBell.jsx):
```javascript
import { useState, useEffect, useRef } from 'react';
import { useNotifications } from '../contexts/NotificationContext.jsx';
import { Badge } from '../ui.jsx';

export function NotificationBell() {
  const { notifications, unreadCount, criticalCount, markAsRead, markAllAsRead } = useNotifications();
  const [open, setOpen] = useState(false);
  const ref = useRef();

  useEffect(() => {
    const handleClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
      }
    };
    if (open) {
      document.addEventListener('mousedown', handleClick);
      return () => document.removeEventListener('mousedown', handleClick);
    }
  }, [open]);

  const badgeColor = criticalCount > 0 ? 'danger' : unreadCount > 0 ? 'warning' : 'gray';
  const latest = notifications.filter(n => !n.is_read).slice(0, 10);

  const typeIcon = (type) => {
    if (type === 'critical') return '🔴';
    if (type === 'warning') return '⚠️';
    if (type === 'security') return '🔒';
    return 'ℹ️';
  };

  return (
    <div className="notification-bell" ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setOpen(!open)} style={{ position: 'relative', background: 'none', border: 'none', fontSize: '1.5em', cursor: 'pointer' }}>
        🔔
        {unreadCount > 0 && (
          <Badge kind={badgeColor} style={{ position: 'absolute', top: -5, right: -5, fontSize: '0.6em', minWidth: '20px', borderRadius: '10px', padding: '2px 6px' }}>
            {unreadCount}
          </Badge>
        )}
      </button>
      
      {open && (
        <div style={{
          position: 'absolute',
          top: '100%',
          right: 0,
          marginTop: '8px',
          width: '320px',
          maxHeight: '400px',
          background: 'white',
          border: '1px solid #ddd',
          borderRadius: '8px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          zIndex: 1000,
          overflow: 'hidden'
        }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong>Notifications</strong>
            {unreadCount > 0 && (
              <button className="btn sm" onClick={markAllAsRead} style={{ fontSize: '0.85em' }}>Mark All Read</button>
            )}
          </div>
          
          <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
            {latest.length === 0 ? (
              <div style={{ padding: '24px', textAlign: 'center', color: '#999' }}>No new notifications</div>
            ) : (
              latest.map(n => (
                <div
                  key={n.id}
                  onClick={() => markAsRead(n.id)}
                  style={{
                    padding: '12px 16px',
                    borderBottom: '1px solid #f5f5f5',
                    cursor: 'pointer',
                    background: n.is_read ? 'white' : '#f0f7ff'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = '#fafafa'}
                  onMouseLeave={(e) => e.currentTarget.style.background = n.is_read ? 'white' : '#f0f7ff'}
                >
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <span style={{ fontSize: '1.2em' }}>{typeIcon(n.type)}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: n.is_read ? 'normal' : 'bold', fontSize: '0.9em' }}>{n.title}</div>
                      <div style={{ fontSize: '0.85em', color: '#666', marginTop: '4px' }}>
                        {n.message.slice(0, 80)}{n.message.length > 80 ? '...' : ''}
                      </div>
                      <div style={{ fontSize: '0.75em', color: '#999', marginTop: '4px' }}>
                        {n.pharmacy_name || 'System'} • {timeAgo(n.created_at)}
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
          
          <div style={{ padding: '12px 16px', borderTop: '1px solid #eee', textAlign: 'center' }}>
            <a href="#/owner-notifications" onClick={() => setOpen(false)} style={{ color: '#667eea', textDecoration: 'none', fontSize: '0.9em' }}>
              View All Notifications →
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

function timeAgo(utcStr) {
  const now = Date.now();
  const then = Date.parse(utcStr);
  const diff = Math.floor((now - then) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  return Math.floor(diff / 86400) + 'd ago';
}
```

**Update App.jsx**:
```javascript
import { NotificationProvider } from './contexts/NotificationContext.jsx';
import { NotificationBell } from './components/NotificationBell.jsx';

// In Shell component:
<PharmacyProvider user={user}>
  <NotificationProvider user={user}>
    <div className="shell">
      {/* ... sidebar ... */}
      <main className="main">
        <div className="mobile-bar">
          <button onClick={() => setOpen(true)}>☰</button>
          <span>{pharmacy.name}</span>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {user.is_system_owner && user.role === 'owner' && <NotificationBell />}
            <PharmacySwitcher />
          </div>
        </div>
        <Cur key={page} user={user} pharmacy={pharmacy} go={go} refreshSession={refreshSession} />
      </main>
    </div>
  </NotificationProvider>
</PharmacyProvider>
```

**Verify**: Log in as owner, verify bell appears with badge when notifications exist

---

### 10. Full Notifications Page

**What**: Create dedicated page for viewing, filtering, and managing all notifications.

**Files**: 
- Create: `web/src/pages/OwnerNotifications.jsx`
- Update: `web/src/App.jsx` (add route to NAV)

**Implementation** (OwnerNotifications.jsx - excerpt):
```javascript
import { useState } from 'react';
import { useNotifications } from '../contexts/NotificationContext.jsx';
import { usePharmacy } from '../contexts/PharmacyContext.jsx';
import { PageHead, Tabs, Badge, Modal, Spinner, ErrorBox, Empty } from '../ui.jsx';

export default function OwnerNotifications({ user }) {
  const { notifications, loading, error, fetchNotifications, markAsRead, markAllAsRead } = useNotifications();
  const { pharmacyList, selectedPharmacyId, switchPharmacy } = usePharmacy();
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [detailModal, setDetailModal] = useState(null);

  const filtered = notifications.filter(n => {
    if (filter === 'unread' && n.is_read) return false;
    if (filter === 'critical' && n.type !== 'critical') return false;
    if (['sales','stock','staff','auth','security','system'].includes(filter) && n.category !== filter) return false;
    if (selectedPharmacyId && n.pharmacy_id !== selectedPharmacyId) return false;
    if (search && !n.title.toLowerCase().includes(search.toLowerCase()) && !n.message.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const grouped = groupByTime(filtered);

  const handleBulkRead = async () => {
    for (const id of selectedIds) {
      await markAsRead(id);
    }
    setSelectedIds(new Set());
  };

  return (
    <>
      <PageHead icon="🔔" title="Notifications" sub="Manage your pharmacy notifications">
        <input
          type="search"
          placeholder="Search notifications..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: '200px', padding: '8px', border: '1px solid #ddd', borderRadius: '4px' }}
        />
      </PageHead>

      <Tabs
        tabs={[
          { id: 'all', label: 'All' },
          { id: 'unread', label: 'Unread' },
          { id: 'critical', label: 'Critical' },
          { id: 'sales', label: 'Sales' },
          { id: 'stock', label: 'Stock' },
          { id: 'staff', label: 'Staff' },
          { id: 'auth', label: 'Auth' },
          { id: 'security', label: 'Security' },
          { id: 'system', label: 'System' }
        ]}
        value={filter}
        onChange={setFilter}
      />

      {/* Pharmacy filter dropdown if multiple pharmacies */}
      {/* Render grouped notifications */}
      {/* Bulk actions bar */}
      {/* Detail modal */}
    </>
  );
}

function groupByTime(notifications) {
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const yesterday = new Date(now.getTime() - 86400000).toISOString().split('T')[0];
  const weekAgo = new Date(now.getTime() - 7 * 86400000).toISOString().split('T')[0];
  
  return {
    today: notifications.filter(n => n.created_at.startsWith(today)),
    yesterday: notifications.filter(n => n.created_at.startsWith(yesterday)),
    thisWeek: notifications.filter(n => n.created_at >= weekAgo && !n.created_at.startsWith(today) && !n.created_at.startsWith(yesterday)),
    older: notifications.filter(n => n.created_at < weekAgo)
  };
}
```

**Add route in App.jsx NAV array**:
```javascript
{ id: 'owner-notifications', label: 'Notifications', icon: '🔔', roles: ['owner'], requiresSystemOwner: true, C: OwnerNotifications },
```

**Verify**: Navigate to #/owner-notifications, test all filters and search

---

### 11. Update Owner Dashboard with Notification Summary

**What**: Add notification stats card and recent critical alerts to owner dashboard.

**Files**: 
- Update: `web/src/pages/OwnerDashboard.jsx`

**Changes**: After the main stats grid, add:
```javascript
import { useNotifications } from '../contexts/NotificationContext.jsx';

// Inside component:
const { notifications, unreadCount, criticalCount } = useNotifications();
const criticalAlerts = notifications.filter(n => n.type === 'critical' && !n.is_read).slice(0, 5);
const warningCount = notifications.filter(n => n.type === 'warning' && !n.is_read).length;

// After main stats grid:
<div className="grid g2" style={{ marginBottom: 18 }}>
  <div className="card">
    <div className="card-head"><h3>Notification Summary</h3></div>
    <div style={{ padding: '16px', display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
      <div style={{ flex: 1, minWidth: '100px', textAlign: 'center' }}>
        <Badge kind="primary" style={{ fontSize: '1.5em', padding: '8px 16px' }}>{unreadCount}</Badge>
        <div style={{ marginTop: '8px', fontSize: '0.9em', color: '#666' }}>Unread</div>
      </div>
      <div style={{ flex: 1, minWidth: '100px', textAlign: 'center' }}>
        <Badge kind="danger" style={{ fontSize: '1.5em', padding: '8px 16px' }}>{criticalCount}</Badge>
        <div style={{ marginTop: '8px', fontSize: '0.9em', color: '#666' }}>Critical</div>
      </div>
      <div style={{ flex: 1, minWidth: '100px', textAlign: 'center' }}>
        <Badge kind="warning" style={{ fontSize: '1.5em', padding: '8px 16px' }}>{warningCount}</Badge>
        <div style={{ marginTop: '8px', fontSize: '0.9em', color: '#666' }}>Warnings</div>
      </div>
    </div>
    <div style={{ padding: '0 16px 16px' }}>
      <button className="btn primary" onClick={() => go('owner-notifications')} style={{ width: '100%' }}>
        View All Notifications
      </button>
    </div>
  </div>

  <div className="card">
    <div className="card-head"><h3>Recent Critical Alerts</h3></div>
    {criticalAlerts.length === 0 ? (
      <Empty icon="✓" title="No critical alerts" sub="All systems operating normally" />
    ) : (
      <div style={{ padding: '8px' }}>
        {criticalAlerts.map(n => (
          <div key={n.id} style={{ padding: '8px', borderBottom: '1px solid #f5f5f5', cursor: 'pointer' }}>
            <div style={{ fontWeight: 'bold', fontSize: '0.9em' }}>🔴 {n.title}</div>
            <div style={{ fontSize: '0.85em', color: '#666', marginTop: '4px' }}>{n.message.slice(0, 60)}...</div>
            <div style={{ fontSize: '0.75em', color: '#999', marginTop: '4px' }}>{timeAgo(n.created_at)}</div>
          </div>
        ))}
      </div>
    )}
  </div>
</div>
```

**Verify**: Owner dashboard shows notification summary and critical alerts

---

## Verification Checklist

### Database
- [ ] Migration 0004 runs successfully
- [ ] Table owner_notifications exists with all columns
- [ ] All 3 indexes exist

### Backend API
- [ ] GET /api/owner/notifications returns empty array for new owner
- [ ] GET /api/owner/notifications/stats returns correct structure
- [ ] Creating large sale triggers notification
- [ ] Voiding sale triggers notification
- [ ] Large stock adjustment triggers notification
- [ ] Failed login triggers security notification
- [ ] Password change triggers notification
- [ ] New user creation triggers notification
- [ ] User role change triggers notification
- [ ] User deactivation triggers notification
- [ ] Pharmacy creation triggers notification
- [ ] Pharmacy deactivation triggers notification
- [ ] PUT /api/owner/notifications/:id/read works
- [ ] PUT /api/owner/notifications/mark-all-read works

### Frontend
- [ ] Notification bell appears for system owners only
- [ ] Badge shows correct unread count
- [ ] Badge color changes based on severity (red for critical, yellow for warnings)
- [ ] Bell dropdown shows latest 10 unread notifications
- [ ] Clicking notification marks it as read
- [ ] Mark All Read button works
- [ ] View All link navigates to notifications page
- [ ] Auto-refresh fetches new notifications every 30 seconds
- [ ] Notifications page shows all filters correctly
- [ ] Search filters notifications in real-time
- [ ] Pharmacy filter works for multi-pharmacy owners
- [ ] Time grouping works (Today/Yesterday/This Week/Older)
- [ ] Bulk selection and mark as read works
- [ ] Detail modal shows full notification with metadata
- [ ] Owner dashboard shows notification summary card
- [ ] Owner dashboard shows recent critical alerts
- [ ] Responsive design works on mobile

### Integration
- [ ] npm run test:api passes all existing tests
- [ ] No console errors in browser or Worker logs
- [ ] Build succeeds: npm run build:web
- [ ] Deployment succeeds: npm run deploy

---

## Notes

### Security Considerations
- All notification endpoints require `need('owner')` middleware
- Ownership verification: `notification.owner_user_id === user.id`
- SQL injection prevention: all queries use parameterized statements via q.*
- XSS prevention: metadata is stored as text, not rendered as HTML in UI

### Performance Considerations
- Notifications paginated (max 50 per page)
- Indexes on owner_user_id, is_read, and created_at for fast queries
- Auto-refresh interval set to 30 seconds (not too aggressive)
- Dropdown shows only 10 latest to keep UI fast

### Future Enhancements (not in this plan)
- Push notifications via service worker
- Email/SMS notifications for critical alerts
- Notification preferences (user can choose which events to be notified about)
- Notification archiving after X days
- More sophisticated abnormal activity detection (ML-based)
- Notification acknowledgment/resolution workflow
