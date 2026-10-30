-- Owner notifications system
-- Adds owner_notifications table for tracking system events requiring owner attention

-- Create owner_notifications table
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

-- Create indexes for efficient queries
CREATE INDEX idx_owner_notifications_owner_read ON owner_notifications(owner_user_id, is_read);
CREATE INDEX idx_owner_notifications_pharmacy ON owner_notifications(pharmacy_id);
CREATE INDEX idx_owner_notifications_created ON owner_notifications(created_at DESC);
