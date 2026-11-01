-- Multi-tenant support: Allow multiple pharmacies

-- Remove single pharmacy constraint and allow multiple
ALTER TABLE pharmacy RENAME TO pharmacy_old;

CREATE TABLE pharmacy (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  address TEXT,
  phone TEXT,
  email TEXT,
  kra_pin TEXT,
  licence_no TEXT,
  superintendent_name TEXT,
  superintendent_reg_no TEXT,
  currency TEXT NOT NULL DEFAULT 'KES',
  vat_rate REAL NOT NULL DEFAULT 16,
  receipt_footer TEXT DEFAULT 'Thank you. Get well soon.',
  mpesa_till TEXT,
  expiry_warn_days INTEGER NOT NULL DEFAULT 90,
  default_reorder_level INTEGER NOT NULL DEFAULT 10,
  max_cashier_discount REAL NOT NULL DEFAULT 5,
  receipt_counter INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO pharmacy SELECT * FROM pharmacy_old;
DROP TABLE pharmacy_old;

-- Add pharmacy_id to users table
ALTER TABLE users ADD COLUMN pharmacy_id INTEGER REFERENCES pharmacy(id);
UPDATE users SET pharmacy_id = 1 WHERE pharmacy_id IS NULL;

-- Add pharmacy_id to suppliers
ALTER TABLE suppliers ADD COLUMN pharmacy_id INTEGER REFERENCES pharmacy(id);
UPDATE suppliers SET pharmacy_id = 1 WHERE pharmacy_id IS NULL;

-- Add pharmacy_id to drugs
ALTER TABLE drugs ADD COLUMN pharmacy_id INTEGER REFERENCES pharmacy(id);
UPDATE drugs SET pharmacy_id = 1 WHERE pharmacy_id IS NULL;

-- Add pharmacy_id to customers
ALTER TABLE customers ADD COLUMN pharmacy_id INTEGER REFERENCES pharmacy(id);
UPDATE customers SET pharmacy_id = 1 WHERE pharmacy_id IS NULL;

-- Add pharmacy_id to sales
ALTER TABLE sales ADD COLUMN pharmacy_id INTEGER REFERENCES pharmacy(id);
UPDATE sales SET pharmacy_id = 1 WHERE pharmacy_id IS NULL;

-- Create indexes for pharmacy_id lookups
CREATE INDEX idx_users_pharmacy ON users(pharmacy_id);
CREATE INDEX idx_suppliers_pharmacy ON suppliers(pharmacy_id);
CREATE INDEX idx_drugs_pharmacy ON drugs(pharmacy_id);
CREATE INDEX idx_customers_pharmacy ON customers(pharmacy_id);
CREATE INDEX idx_sales_pharmacy ON sales(pharmacy_id);
