-- Multi-pharmacy owner support
-- Adds system owner functionality and pharmacy ownership tracking

-- Add is_system_owner flag to users (0 = regular user, 1 = system owner who can manage multiple pharmacies)
ALTER TABLE users ADD COLUMN is_system_owner INTEGER DEFAULT 0;

-- Add assigned_pharmacy_id to users (which pharmacy they work at by default)
ALTER TABLE users ADD COLUMN assigned_pharmacy_id INTEGER REFERENCES pharmacy(id);

-- Add owner_user_id to pharmacy (which user owns this pharmacy)
ALTER TABLE pharmacy ADD COLUMN owner_user_id INTEGER REFERENCES users(id);

-- Add active flag to pharmacy (1 = active, 0 = inactive/archived)
ALTER TABLE pharmacy ADD COLUMN active INTEGER DEFAULT 1;

-- Create pharmacy_staff_assignments table for managing staff across multiple locations
CREATE TABLE pharmacy_staff_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  pharmacy_id INTEGER NOT NULL REFERENCES pharmacy(id),
  role TEXT NOT NULL CHECK (role IN ('owner','pharmacist','cashier','stock_clerk')),
  can_manage_staff INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Create indexes for efficient lookups
CREATE INDEX idx_staff_assignments_user ON pharmacy_staff_assignments(user_id);
CREATE INDEX idx_staff_assignments_pharmacy ON pharmacy_staff_assignments(pharmacy_id);

-- Set default values for existing data (backward compatibility)
UPDATE users SET assigned_pharmacy_id = 1 WHERE assigned_pharmacy_id IS NULL;
UPDATE pharmacy SET active = 1 WHERE active IS NULL;
