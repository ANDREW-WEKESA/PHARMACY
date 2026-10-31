// Demo data seeder for pharmacy system
import { createClient } from '@libsql/client';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Connect to local D1 database
const dbPath = join(__dirname, '../.wrangler/state/v3/d1/miniflare-D1DatabaseObject/REPLACE_WITH_YOUR_D1_DATABASE_ID.sqlite');
const db = createClient({ url: `file:${dbPath}` });

async function seed() {
  console.log('🌱 Seeding demo data...');

  // Create pharmacy
  await db.execute({
    sql: `INSERT OR REPLACE INTO pharmacy (id, name, address, phone, email, kra_pin, licence_no, 
          superintendent_name, superintendent_reg_no, mpesa_till, vat_rate, expiry_warn_days, 
          default_reorder_level, max_cashier_discount, receipt_footer) 
          VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: ['Demo Pharmacy', 'Nairobi, Kenya', '0712345678', 'info@pharmacy.com', 'P051234567X',
      'PPB/PH/001', 'Dr. John Kamau', 'P12345', '567214', 16, 30, 10, 5, 
      'Thank you for your business!']
  });

  // Create users
  await db.execute({
    sql: `INSERT OR REPLACE INTO users (id, name, email, phone, role, password_hash, password_salt, active) 
          VALUES (1, 'Admin User', 'admin@pharmacy.com', '0712345678', 'owner', 'demo', 'demo', 1)`,
    args: []
  });

  console.log('✓ Created pharmacy and admin user');

  // Create suppliers
  const suppliers = [
    ['Dawa Ltd', '0722111222', 'dawa@supply.co.ke', 'P051111111A'],
    ['MedSupply Kenya', '0733222333', 'med@supply.co.ke', 'P051222222B'],
    ['PharmaCorp', '0744333444', 'pharma@corp.co.ke', 'P051333333C']
  ];

  for (const [name, phone, email, pin] of suppliers) {
    await db.execute({
      sql: `INSERT INTO suppliers (name, phone, email, kra_pin, active) VALUES (?, ?, ?, ?, 1)`,
      args: [name, phone, email, pin]
    });
  }
  console.log('✓ Created 3 suppliers');

  // Create drugs
  const drugs = [
    ['Paracetamol', 'paracetamol', '500mg', 'Tablet', 'OTC', 'tablets', 10, 1, '8901234567890'],
    ['Amoxicillin', 'amoxicillin', '250mg', 'Capsule', 'POM', 'capsules', 21, 0, '8901234567891'],
    ['Ibuprofen', 'ibuprofen', '400mg', 'Tablet', 'PHARMACY_ONLY', 'tablets', 20, 1, '8901234567892'],
    ['Metformin', 'metformin', '500mg', 'Tablet', 'POM', 'tablets', 30, 0, '8901234567893'],
    ['Cetirizine', 'cetirizine', '10mg', 'Tablet', 'PHARMACY_ONLY', 'tablets', 10, 1, '8901234567894'],
    ['Omeprazole', 'omeprazole', '20mg', 'Capsule', 'PHARMACY_ONLY', 'capsules', 14, 0, '8901234567895'],
    ['Azithromycin', 'azithromycin', '500mg', 'Tablet', 'POM', 'tablets', 6, 0, '8901234567896'],
    ['Ciprofloxacin', 'ciprofloxacin', '500mg', 'Tablet', 'POM', 'tablets', 10, 0, '8901234567897'],
    ['Diclofenac', 'diclofenac', '50mg', 'Tablet', 'PHARMACY_ONLY', 'tablets', 20, 1, '8901234567898'],
    ['Loratadine', 'loratadine', '10mg', 'Tablet', 'OTC', 'tablets', 10, 1, '8901234567899']
  ];

  for (const [brand, generic, strength, form, cls, unit, pack, split, barcode] of drugs) {
    await db.execute({
      sql: `INSERT INTO drugs (brand_name, generic_name, strength, dosage_form, drug_class, 
            manufacturer, unit_name, pack_size, allow_split, barcode, active) 
            VALUES (?, ?, ?, ?, ?, 'Generic Pharma', ?, ?, ?, ?, 1)`,
      args: [brand, generic, strength, form, cls, unit, pack, split, barcode]
    });
  }
  console.log('✓ Created 10 drugs');

  // Get drug IDs
  const drugIds = await db.execute('SELECT id FROM drugs ORDER BY id');

  // Create batches for each drug
  const today = new Date();
  const futureDate = new Date(today);
  futureDate.setFullYear(today.getFullYear() + 2);
  const expiryDate = futureDate.toISOString().split('T')[0];

  let batchNum = 1000;
  for (const drug of drugIds.rows) {
    const quantity = 500 + Math.floor(Math.random() * 1000);
    const costPrice = 50 + Math.floor(Math.random() * 450);
    const sellingPrice = costPrice * (1.3 + Math.random() * 0.5); // 30-80% markup

    await db.execute({
      sql: `INSERT INTO batches (drug_id, batch_no, expiry_date, received_qty, current_qty, 
            cost_price, selling_price, supplier_id, received_date) 
            VALUES (?, ?, ?, ?, ?, ?, ?, 1, date('now'))`,
      args: [drug.id, `BATCH${batchNum++}`, expiryDate, quantity, quantity, 
             costPrice.toFixed(2), sellingPrice.toFixed(2)]
    });

    // Update drug selling price
    await db.execute({
      sql: `UPDATE drugs SET selling_price = ? WHERE id = ?`,
      args: [sellingPrice.toFixed(2), drug.id]
    });
  }
  console.log('✓ Created batches for all drugs');

  // Update stock levels
  await db.execute({
    sql: `UPDATE drugs SET stock_units = (
      SELECT COALESCE(SUM(current_qty), 0) FROM batches WHERE batches.drug_id = drugs.id
    )`
  });
  console.log('✓ Updated stock levels');

  // Create some customers
  const customers = [
    ['John Doe', '0712345678', 'johndoe@email.com'],
    ['Jane Smith', '0723456789', 'janesmith@email.com'],
    ['Peter Mwangi', '0734567890', null],
    ['Mary Wanjiru', '0745678901', 'mary@email.com']
  ];

  for (const [name, phone, email] of customers) {
    await db.execute({
      sql: `INSERT INTO customers (name, phone, email) VALUES (?, ?, ?)`,
      args: [name, phone, email]
    });
  }
  console.log('✓ Created 4 customers');

  console.log('✅ Demo data seeded successfully!');
  process.exit(0);
}

seed().catch(err => {
  console.error('❌ Error seeding data:', err);
  process.exit(1);
});
