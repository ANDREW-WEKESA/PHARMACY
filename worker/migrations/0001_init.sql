-- Pharmacy Standalone schema (Phase 1 + 2)

CREATE TABLE pharmacy (
  id INTEGER PRIMARY KEY CHECK (id = 1),
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

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT UNIQUE,
  phone TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','pharmacist','cashier','stock_clerk')),
  reg_no TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  contact_person TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE drugs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand_name TEXT NOT NULL,
  generic_name TEXT,
  strength TEXT,
  dosage_form TEXT,
  pack_size INTEGER NOT NULL DEFAULT 1,       -- loose units per pack
  unit_name TEXT NOT NULL DEFAULT 'pack',
  allow_split INTEGER NOT NULL DEFAULT 0,     -- can sell loose units
  category TEXT,
  manufacturer TEXT,
  barcode TEXT,
  drug_class TEXT NOT NULL DEFAULT 'OTC' CHECK (drug_class IN ('OTC','PHARMACY_ONLY','POM','CONTROLLED')),
  storage TEXT,
  buying_price REAL NOT NULL DEFAULT 0,       -- per pack
  selling_price REAL NOT NULL DEFAULT 0,      -- per pack
  vat_applicable INTEGER NOT NULL DEFAULT 0,
  reorder_level INTEGER NOT NULL DEFAULT 10,  -- in loose units
  preferred_supplier_id INTEGER REFERENCES suppliers(id),
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_drugs_brand ON drugs(brand_name);
CREATE INDEX idx_drugs_generic ON drugs(generic_name);
CREATE INDEX idx_drugs_barcode ON drugs(barcode);

CREATE TABLE price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  drug_id INTEGER NOT NULL REFERENCES drugs(id),
  buying_price REAL NOT NULL,
  selling_price REAL NOT NULL,
  changed_by INTEGER REFERENCES users(id),
  changed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Stock is stored in loose units (pack_size * packs) so splitting works.
CREATE TABLE batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  drug_id INTEGER NOT NULL REFERENCES drugs(id),
  batch_no TEXT NOT NULL,
  expiry_date TEXT NOT NULL,                  -- YYYY-MM-DD
  qty_units INTEGER NOT NULL DEFAULT 0 CHECK (qty_units >= 0),  -- stock can never go negative
  buying_price REAL NOT NULL DEFAULT 0,       -- per pack
  selling_price REAL NOT NULL DEFAULT 0,      -- per pack
  supplier_id INTEGER REFERENCES suppliers(id),
  delivery_id INTEGER,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  active INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_batches_drug ON batches(drug_id, expiry_date);

CREATE TABLE deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id INTEGER REFERENCES suppliers(id),
  invoice_no TEXT,
  delivery_date TEXT NOT NULL,
  total_cost REAL NOT NULL DEFAULT 0,
  amount_paid REAL NOT NULL DEFAULT 0,
  notes TEXT,
  received_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT,
  credit_balance REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_customers_phone ON customers(phone);

CREATE TABLE sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_no TEXT NOT NULL UNIQUE,
  sale_date TEXT NOT NULL DEFAULT (datetime('now')),
  cashier_id INTEGER NOT NULL REFERENCES users(id),
  customer_id INTEGER REFERENCES customers(id),
  customer_name TEXT,
  customer_phone TEXT,
  subtotal REAL NOT NULL DEFAULT 0,
  discount REAL NOT NULL DEFAULT 0,
  vat REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  amount_paid REAL NOT NULL DEFAULT 0,
  balance_due REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','voided','refunded')),
  has_prescription INTEGER NOT NULL DEFAULT 0,
  has_controlled INTEGER NOT NULL DEFAULT 0,
  approved_by INTEGER REFERENCES users(id),
  prescriber_name TEXT,
  prescriber_facility TEXT,
  prescription_date TEXT,
  discount_reason TEXT,
  void_reason TEXT,
  voided_by INTEGER REFERENCES users(id),
  voided_at TEXT
);
CREATE INDEX idx_sales_date ON sales(sale_date);
CREATE INDEX idx_sales_cashier ON sales(cashier_id);

CREATE TABLE sale_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL REFERENCES sales(id),
  drug_id INTEGER NOT NULL REFERENCES drugs(id),
  batch_id INTEGER NOT NULL REFERENCES batches(id),
  drug_name TEXT NOT NULL,
  qty_units INTEGER NOT NULL,
  unit_price REAL NOT NULL,                   -- per loose unit
  unit_cost REAL NOT NULL DEFAULT 0,          -- per loose unit
  line_total REAL NOT NULL
);
CREATE INDEX idx_sale_items_sale ON sale_items(sale_id);
CREATE INDEX idx_sale_items_drug ON sale_items(drug_id);

CREATE TABLE payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER REFERENCES sales(id),
  customer_id INTEGER REFERENCES customers(id),
  method TEXT NOT NULL CHECK (method IN ('cash','mpesa','card','insurance','credit_payment')),
  amount REAL NOT NULL,
  reference TEXT,
  received_by INTEGER REFERENCES users(id),
  paid_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_payments_sale ON payments(sale_id);

CREATE TABLE stock_adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id INTEGER NOT NULL REFERENCES batches(id),
  drug_id INTEGER NOT NULL REFERENCES drugs(id),
  qty_change INTEGER NOT NULL,                -- loose units, +/-
  reason TEXT NOT NULL CHECK (reason IN ('damage','expired','loss','count_correction','return_to_supplier','customer_return','other')),
  note TEXT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  witness TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE stock_takes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','posted')),
  started_by INTEGER REFERENCES users(id),
  posted_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  posted_at TEXT
);
CREATE TABLE stock_take_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stock_take_id INTEGER NOT NULL REFERENCES stock_takes(id),
  batch_id INTEGER NOT NULL REFERENCES batches(id),
  system_qty INTEGER NOT NULL,
  counted_qty INTEGER
);

CREATE TABLE controlled_register (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  drug_id INTEGER NOT NULL REFERENCES drugs(id),
  batch_id INTEGER REFERENCES batches(id),
  entry_date TEXT NOT NULL DEFAULT (datetime('now')),
  direction TEXT NOT NULL CHECK (direction IN ('in','out')),
  qty_units INTEGER NOT NULL,
  balance_units INTEGER NOT NULL,
  patient_name TEXT,
  patient_phone TEXT,
  prescriber_name TEXT,
  prescriber_facility TEXT,
  sale_id INTEGER REFERENCES sales(id),
  user_id INTEGER REFERENCES users(id),
  approved_by INTEGER REFERENCES users(id),
  note TEXT
);
CREATE INDEX idx_ctrl_drug ON controlled_register(drug_id, id);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  user_name TEXT,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id TEXT,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_audit_created ON audit_log(created_at);

-- one row per drug + batch number + expiry (re-receiving the same batch adds to it)
CREATE UNIQUE INDEX uq_batch ON batches(drug_id, batch_no, expiry_date);
