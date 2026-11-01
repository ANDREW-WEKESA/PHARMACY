import { Hono } from 'hono';
import { q, int, HttpError } from './lib.js';
import { need } from './routes-core.js';

const app = new Hono();

// Middleware to verify system owner
const SYSTEM_OWNER = async (c, next) => {
  const user = c.get('user');
  if (!user.is_system_owner) {
    throw new HttpError(403, 'This feature is only available to system owners.');
  }
  await next();
};

// Get notifications for owner
app.get('/', need('owner'), SYSTEM_OWNER, async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  
  const unreadOnly = c.req.query('unread_only') === 'true';
  const limit = Math.min(100, Math.max(1, int(c.req.query('limit'), 50)));
  const type = c.req.query('type'); // info, warning, critical, security
  const category = c.req.query('category'); // sales, stock, staff, auth, security, system
  const pharmacyId = int(c.req.query('pharmacy_id'), 0) || null;
  
  let sql = 'SELECT * FROM owner_notifications WHERE owner_user_id = ?';
  const params = [user.id];
  
  if (unreadOnly) {
    sql += ' AND is_read = 0';
  }
  
  if (type) {
    sql += ' AND type = ?';
    params.push(type);
  }
  
  if (category) {
    sql += ' AND category = ?';
    params.push(category);
  }
  
  if (pharmacyId) {
    sql += ' AND pharmacy_id = ?';
    params.push(pharmacyId);
  }
  
  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit);
  
  const notifications = await q.all(db, sql, ...params);
  
  // Parse metadata JSON
  for (const n of notifications) {
    if (n.metadata) {
      try {
        n.metadata = JSON.parse(n.metadata);
      } catch {
        n.metadata = null;
      }
    }
  }
  
  return c.json({ notifications });
});

// Get notification statistics
app.get('/stats', need('owner'), SYSTEM_OWNER, async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  
  const stats = await q.first(db,
    `SELECT 
      COUNT(*) total,
      SUM(CASE WHEN is_read = 0 THEN 1 ELSE 0 END) unread,
      SUM(CASE WHEN is_read = 0 AND type = 'critical' THEN 1 ELSE 0 END) critical_unread,
      SUM(CASE WHEN is_read = 0 AND type = 'warning' THEN 1 ELSE 0 END) warning_unread,
      SUM(CASE WHEN is_read = 0 AND type = 'security' THEN 1 ELSE 0 END) security_unread,
      SUM(CASE WHEN requires_action = 1 AND is_read = 0 THEN 1 ELSE 0 END) action_required
     FROM owner_notifications 
     WHERE owner_user_id = ?`,
    user.id
  );
  
  // Get counts by category
  const byCategory = await q.all(db,
    `SELECT category, COUNT(*) count, SUM(CASE WHEN is_read = 0 THEN 1 ELSE 0 END) unread
     FROM owner_notifications 
     WHERE owner_user_id = ?
     GROUP BY category`,
    user.id
  );
  
  return c.json({ 
    stats,
    by_category: byCategory
  });
});

// Mark notification as read
app.put('/:id/read', need('owner'), SYSTEM_OWNER, async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const id = int(c.req.param('id'));
  
  // Verify ownership
  const notification = await q.first(db,
    'SELECT id FROM owner_notifications WHERE id = ? AND owner_user_id = ?',
    id, user.id
  );
  
  if (!notification) {
    throw new HttpError(404, 'Notification not found');
  }
  
  await q.run(db,
    'UPDATE owner_notifications SET is_read = 1 WHERE id = ?',
    id
  );
  
  return c.json({ ok: true });
});

// Mark all notifications as read
app.put('/mark-all-read', need('owner'), SYSTEM_OWNER, async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  
  await q.run(db,
    'UPDATE owner_notifications SET is_read = 1 WHERE owner_user_id = ? AND is_read = 0',
    user.id
  );
  
  return c.json({ ok: true });
});

// Delete old notifications (optional cleanup)
app.delete('/cleanup', need('owner'), SYSTEM_OWNER, async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const daysOld = Math.max(7, int(c.req.query('days'), 90));
  
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysOld);
  const cutoff = cutoffDate.toISOString().slice(0, 19).replace('T', ' ');
  
  const result = await q.run(db,
    'DELETE FROM owner_notifications WHERE owner_user_id = ? AND is_read = 1 AND created_at < ?',
    user.id, cutoff
  );
  
  return c.json({ deleted: result.meta.changes });
});

export default app;
