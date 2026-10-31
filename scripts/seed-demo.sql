-- Demo data for pharmacy system

-- Update pharmacy
UPDATE pharmacy SET 
  name = 'Demo Pharmacy',
  address = 'Nairobi, Kenya',
  phone = '0712345678',
  email = 'info@demo-pharmacy.com',
  receipt_footer = 'Thank you for your business!'
WHERE id = 1;

-- Create suppliers
INSERT INTO suppliers (name, phone, email, kra_pin, active) VALUES 
  ('Dawa Ltd', '0722111222', 'dawa@supply.co.ke', 'P051111111A', 1),
  ('MedSupply Kenya', '0733222333', 'med@supply.co.ke', 'P051222222B', 1),
  ('PharmaCorp', '0744333444', 'pharma@corp.co.ke', 'P051333333C', 1);

-- Create drugs
INSERT INTO drugs (brand_name, generic_name, strength, dosage_form, drug_class, manufacturer, unit_name, pack_size, allow_split, barcode, selling_price, active) VALUES 
  ('Paracetamol 500mg', 'paracetamol', '500mg', 'Tablet', 'OTC', 'Generic Pharma', 'tablets', 10, 1, '8901234567890', 80.00, 1),
  ('Amoxicillin 250mg', 'amoxicillin', '250mg', 'Capsule', 'POM', 'Generic Pharma', 'capsules', 21, 0, '8901234567891', 250.00, 1),
  ('Ibuprofen 400mg', 'ibuprofen', '400mg', 'Tablet', 'PHARMACY_ONLY', 'Generic Pharma', 'tablets', 20, 1, '8901234567892', 120.00, 1),
  ('Metformin 500mg', 'metformin', '500mg', 'Tablet', 'POM', 'Generic Pharma', 'tablets', 30, 0, '8901234567893', 180.00, 1),
  ('Cetirizine 10mg', 'cetirizine', '10mg', 'Tablet', 'PHARMACY_ONLY', 'Generic Pharma', 'tablets', 10, 1, '8901234567894', 90.00, 1),
  ('Omeprazole 20mg', 'omeprazole', '20mg', 'Capsule', 'PHARMACY_ONLY', 'Generic Pharma', 'capsules', 14, 0, '8901234567895', 200.00, 1),
  ('Azithromycin 500mg', 'azithromycin', '500mg', 'Tablet', 'POM', 'Generic Pharma', 'tablets', 6, 0, '8901234567896', 350.00, 1),
  ('Ciprofloxacin 500mg', 'ciprofloxacin', '500mg', 'Tablet', 'POM', 'Generic Pharma', 'tablets', 10, 0, '8901234567897', 280.00, 1),
  ('Diclofenac 50mg', 'diclofenac', '50mg', 'Tablet', 'PHARMACY_ONLY', 'Generic Pharma', 'tablets', 20, 1, '8901234567898', 150.00, 1),
  ('Loratadine 10mg', 'loratadine', '10mg', 'Tablet', 'OTC', 'Generic Pharma', 'tablets', 10, 1, '8901234567899', 100.00, 1);

-- Create batches with stock
INSERT INTO batches (drug_id, batch_no, expiry_date, received_qty, current_qty, cost_price, selling_price, supplier_id, received_date) VALUES 
  (1, 'BATCH1001', '2026-12-31', 1000, 1000, 50.00, 80.00, 1, date('now')),
  (2, 'BATCH1002', '2026-12-31', 500, 500, 180.00, 250.00, 1, date('now')),
  (3, 'BATCH1003', '2026-12-31', 800, 800, 80.00, 120.00, 2, date('now')),
  (4, 'BATCH1004', '2026-12-31', 600, 600, 120.00, 180.00, 2, date('now')),
  (5, 'BATCH1005', '2026-12-31', 700, 700, 60.00, 90.00, 1, date('now')),
  (6, 'BATCH1006', '2026-12-31', 400, 400, 140.00, 200.00, 3, date('now')),
  (7, 'BATCH1007', '2026-12-31', 300, 300, 250.00, 350.00, 3, date('now')),
  (8, 'BATCH1008', '2026-12-31', 500, 500, 200.00, 280.00, 2, date('now')),
  (9, 'BATCH1009', '2026-12-31', 900, 900, 100.00, 150.00, 1, date('now')),
  (10, 'BATCH1010', '2026-12-31', 650, 650, 70.00, 100.00, 2, date('now'));

-- Update stock units for all drugs
UPDATE drugs SET stock_units = (
  SELECT COALESCE(SUM(current_qty), 0) FROM batches WHERE batches.drug_id = drugs.id
);

-- Create some customers
INSERT INTO customers (name, phone, email) VALUES 
  ('John Doe', '0712345678', 'johndoe@email.com'),
  ('Jane Smith', '0723456789', 'janesmith@email.com'),
  ('Peter Mwangi', '0734567890', NULL),
  ('Mary Wanjiru', '0745678901', 'mary@email.com');
