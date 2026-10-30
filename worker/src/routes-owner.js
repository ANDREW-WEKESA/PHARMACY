import { Hono } from 'hono';
import { q, audit, bad, HttpError, str, int, money, eatDate, nowUtc, normPhone, hashPassword } from './lib.js';
import { need, body } from './routes-core.js';

const app = new Hono();
const OWNER_ONLY = need('owner');

// Middleware to verify system owner
const SYSTEM_OWNER = async (c, next) => {
  const user = c.get('user');
  if (!user.is_system_owner) {
    throw new HttpError(403, 'This feature is only available to system owners.');
  }
  await next();
};

// ---------- consolidated dashboard ----------
app.get('/dashboard', OWNER_ONLY, SYSTEM_OWNER, async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const today = eatDate();
  
  // Get all pharmacies owned by this user
  const pharmacies = await q.all(db, 
    'SELECT * FROM pharmacy WHERE owner_user_id = ? AND active = 1 ORDER BY name', 
    user.id
  );
  
  let totalSales = 0;
  let totalInventoryValue = 0;
  let totalCustomers = 0;
  const pharmacyStats = [];
  
  for (const pharmacy of pharmacies) {
    // Sales today
    const salesData = await q.first(db,
      `SELECT COALESCE(SUM(total),0) sales_today, COUNT(*) sales_count 
       FROM sales 
       WHERE pharmacy_id = ? AND status='completed' AND date(sale_date) = ?`,
      pharmacy.id, today
    );
    
    // Inventory value
    const inventoryData = await q.first(db,
      `SELECT COALESCE(SUM(b.qty_units * b.selling_price / d.pack_size), 0) inventory_value
       FROM batches b 
       JOIN drugs d ON d.id = b.drug_id 
       WHERE d.pharmacy_id = ? AND b.active = 1 AND b.qty_units > 0`,
      pharmacy.id
    );
    
    // Low stock count
    const lowStockData = await q.first(db,
      `SELECT COUNT(*) low_stock_count
       FROM drugs d
       LEFT JOIN (
         SELECT drug_id, SUM(qty_units) stock_units 
         FROM batches WHERE active = 1 GROUP BY drug_id
       ) s ON s.drug_id = d.id
       WHERE d.pharmacy_id = ? AND d.active = 1 AND COALESCE(s.stock_units, 0) <= d.reorder_level`,
      pharmacy.id
    );
    
    // Expiry alerts (next 90 days)
    const expiryData = await q.first(db,
      `SELECT COUNT(DISTINCT b.id) expiry_alerts
       FROM batches b
       JOIN drugs d ON d.id = b.drug_id
       WHERE d.pharmacy_id = ? AND b.active = 1 AND b.qty_units > 0 
         AND b.expiry_date BETWEEN ? AND date(?, '+90 days')`,
      pharmacy.id, today, today
    );
    
    // Customer count
    const customerData = await q.first(db,
      'SELECT COUNT(*) customer_count FROM customers WHERE pharmacy_id = ?',
      pharmacy.id
    );
    
    const stats = {
      pharmacy_id: pharmacy.id,
      pharmacy_name: pharmacy.name,
      sales_today: money(salesData.sales_today),
      sales_count: salesData.sales_count,
      inventory_value: money(inventoryData.inventory_value),
      low_stock_count: lowStockData.low_stock_count,
      expiry_alerts: expiryData.expiry_alerts,
      customer_count: customerData.customer_count,
      status: pharmacy.active ? 'active' : 'inactive'
    };
    
    pharmacyStats.push(stats);
    totalSales += stats.sales_today;
    totalInventoryValue += stats.inventory_value;
    totalCustomers += stats.customer_count;
  }
  
  return c.json({
    total_pharmacies: pharmacies.length,
    total_sales: money(totalSales),
    total_inventory_value: money(totalInventoryValue),
    total_customers: totalCustomers,
    pharmacies: pharmacyStats
  });
});

// ---------- pharmacy management ----------
app.get('/pharmacies', OWNER_ONLY, SYSTEM_OWNER, async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  
  const pharmacies = await q.all(db,
    `SELECT p.*, 
      (SELECT COUNT(*) FROM users WHERE assigned_pharmacy_id = p.id AND active = 1) staff_count,
      (SELECT COUNT(*) FROM drugs WHERE pharmacy_id = p.id AND active = 1) drug_count
     FROM pharmacy p 
     WHERE owner_user_id = ? 
     ORDER BY name`,
    user.id
  );
  
  return c.json({ pharmacies });
});

app.post('/pharmacies', OWNER_ONLY, SYSTEM_OWNER, async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const b = await body(c);
  
  const name = str(b.name, 120);
  if (!name) throw bad('Enter the pharmacy name.');
  
  const result = await q.run(db,
    `INSERT INTO pharmacy (name, address, phone, email, kra_pin, licence_no, 
      superintendent_name, superintendent_reg_no, mpesa_till, owner_user_id, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    name,
    str(b.address) || null,
    normPhone(str(b.phone, 30)) || null,
    str(b.email) || null,
    str(b.kra_pin, 30) || null,
    str(b.licence_no, 60) || null,
    str(b.superintendent_name) || null,
    str(b.superintendent_reg_no, 60) || null,
    str(b.mpesa_till, 30) || null,
    user.id
  );
  
  const pharmacyId = result.meta.last_row_id;
  await audit(db, user, 'pharmacy_created', 'pharmacy', pharmacyId, name);
  
  return c.json({ id: pharmacyId }, 201);
});

app.put('/pharmacies/:id', OWNER_ONLY, SYSTEM_OWNER, async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const id = int(c.req.param('id'));
  const b = await body(c);
  
  // Verify ownership
  const pharmacy = await q.first(db,
    'SELECT * FROM pharmacy WHERE id = ? AND owner_user_id = ?',
    id, user.id
  );
  
  if (!pharmacy) throw new HttpError(404, 'Pharmacy not found or you do not own it.');
  
  const name = str(b.name, 120) || pharmacy.name;
  const active = b.active == null ? pharmacy.active : b.active ? 1 : 0;
  
  await q.run(db,
    `UPDATE pharmacy SET 
      name = ?, address = ?, phone = ?, email = ?, kra_pin = ?, licence_no = ?,
      superintendent_name = ?, superintendent_reg_no = ?, mpesa_till = ?, active = ?
     WHERE id = ?`,
    name,
    b.address !== undefined ? str(b.address) || null : pharmacy.address,
    b.phone !== undefined ? normPhone(str(b.phone, 30)) || null : pharmacy.phone,
    b.email !== undefined ? str(b.email) || null : pharmacy.email,
    b.kra_pin !== undefined ? str(b.kra_pin, 30) || null : pharmacy.kra_pin,
    b.licence_no !== undefined ? str(b.licence_no, 60) || null : pharmacy.licence_no,
    b.superintendent_name !== undefined ? str(b.superintendent_name) || null : pharmacy.superintendent_name,
    b.superintendent_reg_no !== undefined ? str(b.superintendent_reg_no, 60) || null : pharmacy.superintendent_reg_no,
    b.mpesa_till !== undefined ? str(b.mpesa_till, 30) || null : pharmacy.mpesa_till,
    active,
    id
  );
  
  await audit(db, user, 'pharmacy_updated', 'pharmacy', id, { name, active });
  
  return c.json({ ok: true });
});

app.get('/pharmacies/:id/stats', OWNER_ONLY, SYSTEM_OWNER, async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const id = int(c.req.param('id'));
  
  // Verify ownership
  const pharmacy = await q.first(db,
    'SELECT * FROM pharmacy WHERE id = ? AND owner_user_id = ?',
    id, user.id
  );
  
  if (!pharmacy) throw new HttpError(404, 'Pharmacy not found or you do not own it.');
  
  const today = eatDate();
  const monthStart = today.slice(0, 8) + '01';
  
  // Total sales (all time, this month, today)
  const salesStats = await q.first(db,
    `SELECT 
      COALESCE(SUM(CASE WHEN status='completed' THEN total END), 0) total_sales,
      COALESCE(SUM(CASE WHEN status='completed' AND date(sale_date) >= ? THEN total END), 0) month_sales,
      COALESCE(SUM(CASE WHEN status='completed' AND date(sale_date) = ? THEN total END), 0) today_sales,
      COUNT(CASE WHEN status='completed' THEN 1 END) total_transactions
     FROM sales WHERE pharmacy_id = ?`,
    monthStart, today, id
  );
  
  // Inventory
  const inventoryStats = await q.first(db,
    `SELECT 
      COALESCE(SUM(b.qty_units * b.selling_price / d.pack_size), 0) inventory_value,
      COUNT(DISTINCT d.id) total_drugs
     FROM drugs d
     LEFT JOIN batches b ON b.drug_id = d.id AND b.active = 1 AND b.qty_units > 0
     WHERE d.pharmacy_id = ? AND d.active = 1`,
    id
  );
  
  // Staff
  const staffStats = await q.first(db,
    'SELECT COUNT(*) staff_count FROM users WHERE assigned_pharmacy_id = ? AND active = 1',
    id
  );
  
  // Customers
  const customerStats = await q.first(db,
    'SELECT COUNT(*) customer_count FROM customers WHERE pharmacy_id = ?',
    id
  );
  
  // Top drugs (this month)
  const topDrugs = await q.all(db,
    `SELECT d.brand_name, d.strength, SUM(si.qty_units) units_sold, SUM(si.line_total) revenue
     FROM sale_items si
     JOIN sales s ON s.id = si.sale_id
     JOIN drugs d ON d.id = si.drug_id
     WHERE s.pharmacy_id = ? AND s.status = 'completed' AND date(s.sale_date) >= ?
     GROUP BY si.drug_id
     ORDER BY revenue DESC
     LIMIT 10`,
    id, monthStart
  );
  
  return c.json({
    pharmacy,
    sales: {
      total: money(salesStats.total_sales),
      month: money(salesStats.month_sales),
      today: money(salesStats.today_sales),
      transactions: salesStats.total_transactions
    },
    inventory: {
      value: money(inventoryStats.inventory_value),
      drug_count: inventoryStats.total_drugs
    },
    staff_count: staffStats.staff_count,
    customer_count: customerStats.customer_count,
    top_drugs: topDrugs.map(d => ({ ...d, revenue: money(d.revenue) }))
  });
});

// ---------- staff management ----------
app.get('/staff', OWNER_ONLY, SYSTEM_OWNER, async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  
  // Get all staff from owned pharmacies
  const staff = await q.all(db,
    `SELECT u.id, u.name, u.email, u.phone, u.role, u.reg_no, u.active, u.assigned_pharmacy_id,
      p.name pharmacy_name
     FROM users u
     LEFT JOIN pharmacy p ON p.id = u.assigned_pharmacy_id
     WHERE (p.owner_user_id = ? OR u.id = ?)
     ORDER BY u.name`,
    user.id, user.id
  );
  
  // Get additional pharmacy assignments
  for (const s of staff) {
    const assignments = await q.all(db,
      `SELECT psa.pharmacy_id, p.name pharmacy_name, psa.role, psa.can_manage_staff
       FROM pharmacy_staff_assignments psa
       JOIN pharmacy p ON p.id = psa.pharmacy_id
       WHERE psa.user_id = ? AND p.owner_user_id = ?`,
      s.id, user.id
    );
    s.pharmacy_assignments = assignments;
  }
  
  return c.json({ staff });
});

app.post('/staff', OWNER_ONLY, SYSTEM_OWNER, async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const b = await body(c);
  
  const name = str(b.name, 120);
  const role = str(b.role);
  const email = str(b.email, 120).toLowerCase() || null;
  const phone = normPhone(str(b.phone, 30)) || null;
  const assignedPharmacyId = int(b.assigned_pharmacy_id, 0) || null;
  
  if (!name) throw bad('Enter the staff member\'s name.');
  if (!['owner', 'pharmacist', 'cashier', 'stock_clerk'].includes(role)) throw bad('Choose a valid role.');
  if (!email && !phone) throw bad('Enter an email or phone number.');
  if (String(b.password || '').length < 8) throw bad('Password must be at least 8 characters.');
  
  // Verify pharmacy ownership if assigned
  if (assignedPharmacyId) {
    const pharmacy = await q.first(db,
      'SELECT id FROM pharmacy WHERE id = ? AND owner_user_id = ?',
      assignedPharmacyId, user.id
    );
    if (!pharmacy) throw bad('You do not own the specified pharmacy.');
  }
  
  // Check for duplicates
  const dup = await q.first(db,
    'SELECT id FROM users WHERE (email IS NOT NULL AND lower(email)=?) OR (phone IS NOT NULL AND phone=?)',
    email, phone
  );
  if (dup) throw new HttpError(409, 'A user with that email or phone already exists.');
  
  const { hash, salt } = await hashPassword(String(b.password));
  const result = await q.run(db,
    `INSERT INTO users (name, email, phone, password_hash, password_salt, role, reg_no, assigned_pharmacy_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    name, email, phone, hash, salt, role, str(b.reg_no, 60) || null, assignedPharmacyId
  );
  
  const userId = result.meta.last_row_id;
  
  // Handle additional pharmacy assignments
  if (Array.isArray(b.pharmacy_assignments)) {
    for (const assignment of b.pharmacy_assignments) {
      const pharmacyId = int(assignment.pharmacy_id);
      const pharmacy = await q.first(db,
        'SELECT id FROM pharmacy WHERE id = ? AND owner_user_id = ?',
        pharmacyId, user.id
      );
      if (pharmacy) {
        await q.run(db,
          `INSERT INTO pharmacy_staff_assignments (user_id, pharmacy_id, role, can_manage_staff)
           VALUES (?, ?, ?, ?)`,
          userId, pharmacyId, str(assignment.role) || role, assignment.can_manage_staff ? 1 : 0
        );
      }
    }
  }
  
  await audit(db, user, 'staff_created', 'user', userId, `${name} (${role})`);
  
  return c.json({ id: userId }, 201);
});

app.put('/staff/:id', OWNER_ONLY, SYSTEM_OWNER, async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const id = int(c.req.param('id'));
  const b = await body(c);
  
  // Get staff member and verify they belong to owned pharmacy
  const staff = await q.first(db,
    `SELECT u.* FROM users u
     LEFT JOIN pharmacy p ON p.id = u.assigned_pharmacy_id
     WHERE u.id = ? AND (p.owner_user_id = ? OR u.id = ?)`,
    id, user.id, user.id
  );
  
  if (!staff) throw new HttpError(404, 'Staff member not found or you do not manage them.');
  
  const name = str(b.name, 120) || staff.name;
  const role = b.role ? str(b.role) : staff.role;
  const active = b.active == null ? staff.active : b.active ? 1 : 0;
  const email = b.email !== undefined ? str(b.email, 120).toLowerCase() || null : staff.email;
  const phone = b.phone !== undefined ? normPhone(str(b.phone, 30)) || null : staff.phone;
  const assignedPharmacyId = b.assigned_pharmacy_id !== undefined ? int(b.assigned_pharmacy_id, 0) || null : staff.assigned_pharmacy_id;
  
  if (!email && !phone) throw bad('A user needs an email or phone number.');
  
  // Verify new pharmacy ownership if changed
  if (assignedPharmacyId && assignedPharmacyId !== staff.assigned_pharmacy_id) {
    const pharmacy = await q.first(db,
      'SELECT id FROM pharmacy WHERE id = ? AND owner_user_id = ?',
      assignedPharmacyId, user.id
    );
    if (!pharmacy) throw bad('You do not own the specified pharmacy.');
  }
  
  await q.run(db,
    'UPDATE users SET name=?, email=?, phone=?, role=?, reg_no=?, active=?, assigned_pharmacy_id=? WHERE id=?',
    name, email, phone, role,
    b.reg_no !== undefined ? str(b.reg_no, 60) || null : staff.reg_no,
    active, assignedPharmacyId, id
  );
  
  if (b.password) {
    if (String(b.password).length < 8) throw bad('Password must be at least 8 characters.');
    const { hash, salt } = await hashPassword(String(b.password));
    await q.run(db, 'UPDATE users SET password_hash=?, password_salt=? WHERE id=?', hash, salt, id);
  }
  
  await audit(db, user, 'staff_updated', 'user', id, { name, role, active });
  
  return c.json({ ok: true });
});

app.post('/staff/:id/assign', OWNER_ONLY, SYSTEM_OWNER, async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const userId = int(c.req.param('id'));
  const b = await body(c);
  
  const pharmacyId = int(b.pharmacy_id);
  const role = str(b.role) || 'cashier';
  const canManageStaff = b.can_manage_staff ? 1 : 0;
  
  // Verify pharmacy ownership
  const pharmacy = await q.first(db,
    'SELECT id FROM pharmacy WHERE id = ? AND owner_user_id = ?',
    pharmacyId, user.id
  );
  if (!pharmacy) throw bad('Pharmacy not found or you do not own it.');
  
  // Check if assignment already exists
  const existing = await q.first(db,
    'SELECT id FROM pharmacy_staff_assignments WHERE user_id = ? AND pharmacy_id = ?',
    userId, pharmacyId
  );
  
  if (existing) throw new HttpError(409, 'This staff member is already assigned to this pharmacy.');
  
  await q.run(db,
    `INSERT INTO pharmacy_staff_assignments (user_id, pharmacy_id, role, can_manage_staff)
     VALUES (?, ?, ?, ?)`,
    userId, pharmacyId, role, canManageStaff
  );
  
  await audit(db, user, 'staff_assigned', 'pharmacy', pharmacyId, { user_id: userId, role });
  
  return c.json({ ok: true }, 201);
});

app.delete('/staff/:id/unassign', OWNER_ONLY, SYSTEM_OWNER, async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const userId = int(c.req.param('id'));
  const pharmacyId = int(c.req.query('pharmacy_id'));
  
  // Verify pharmacy ownership
  const pharmacy = await q.first(db,
    'SELECT id FROM pharmacy WHERE id = ? AND owner_user_id = ?',
    pharmacyId, user.id
  );
  if (!pharmacy) throw bad('Pharmacy not found or you do not own it.');
  
  await q.run(db,
    'DELETE FROM pharmacy_staff_assignments WHERE user_id = ? AND pharmacy_id = ?',
    userId, pharmacyId
  );
  
  // If no assignments left and this was their assigned pharmacy, clear it
  const remainingAssignments = await q.first(db,
    'SELECT COUNT(*) count FROM pharmacy_staff_assignments WHERE user_id = ?',
    userId
  );
  
  const userRecord = await q.first(db, 'SELECT assigned_pharmacy_id FROM users WHERE id = ?', userId);
  
  if (remainingAssignments.count === 0 && userRecord.assigned_pharmacy_id === pharmacyId) {
    await q.run(db, 'UPDATE users SET assigned_pharmacy_id = NULL WHERE id = ?', userId);
  }
  
  await audit(db, user, 'staff_unassigned', 'pharmacy', pharmacyId, { user_id: userId });
  
  return c.json({ ok: true });
});

// ---------- consolidated reports ----------
app.get('/sales/consolidated', OWNER_ONLY, SYSTEM_OWNER, async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const days = Math.min(90, Math.max(7, int(c.req.query('days'), 30)));
  const today = eatDate();
  
  // Get time series sales across all owned pharmacies
  const salesData = await q.all(db,
    `SELECT date(s.sale_date) day, p.name pharmacy_name, p.id pharmacy_id,
      COUNT(*) transaction_count, SUM(s.total) total_sales
     FROM sales s
     JOIN pharmacy p ON p.id = s.pharmacy_id
     WHERE p.owner_user_id = ? AND s.status = 'completed'
       AND s.sale_date >= date(?, '-' || ? || ' days')
     GROUP BY day, p.id
     ORDER BY day DESC, p.name`,
    user.id, today, days
  );
  
  return c.json({ days, sales: salesData.map(s => ({ ...s, total_sales: money(s.total_sales) })) });
});

app.get('/inventory/consolidated', OWNER_ONLY, SYSTEM_OWNER, async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const today = eatDate();
  
  // Aggregate inventory across owned pharmacies
  const inventoryData = await q.all(db,
    `SELECT p.id pharmacy_id, p.name pharmacy_name,
      COUNT(DISTINCT d.id) drug_count,
      COALESCE(SUM(b.qty_units), 0) total_units,
      COALESCE(SUM(b.qty_units * b.selling_price / d.pack_size), 0) total_value,
      COUNT(CASE WHEN b.expiry_date < ? THEN 1 END) expired_batches,
      COUNT(CASE WHEN b.expiry_date BETWEEN ? AND date(?, '+90 days') THEN 1 END) expiring_soon
     FROM pharmacy p
     LEFT JOIN drugs d ON d.pharmacy_id = p.id AND d.active = 1
     LEFT JOIN batches b ON b.drug_id = d.id AND b.active = 1 AND b.qty_units > 0
     WHERE p.owner_user_id = ?
     GROUP BY p.id
     ORDER BY p.name`,
    today, today, today, user.id
  );
  
  return c.json({ 
    inventory: inventoryData.map(i => ({ 
      ...i, 
      total_value: money(i.total_value) 
    })) 
  });
});

app.get('/reports/comparison', OWNER_ONLY, SYSTEM_OWNER, async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const today = eatDate();
  const monthStart = today.slice(0, 8) + '01';
  
  // Get all pharmacies
  const pharmacies = await q.all(db,
    'SELECT id, name, active FROM pharmacy WHERE owner_user_id = ? ORDER BY name',
    user.id
  );
  
  const comparison = [];
  
  for (const pharmacy of pharmacies) {
    // Sales today
    const salesToday = await q.first(db,
      `SELECT COALESCE(SUM(total), 0) sales_today
       FROM sales WHERE pharmacy_id = ? AND status='completed' AND date(sale_date) = ?`,
      pharmacy.id, today
    );
    
    // Sales this month
    const salesMonth = await q.first(db,
      `SELECT COALESCE(SUM(total), 0) sales_month
       FROM sales WHERE pharmacy_id = ? AND status='completed' AND date(sale_date) >= ?`,
      pharmacy.id, monthStart
    );
    
    // Inventory value
    const inventory = await q.first(db,
      `SELECT COALESCE(SUM(b.qty_units * b.selling_price / d.pack_size), 0) inventory_value
       FROM batches b
       JOIN drugs d ON d.id = b.drug_id
       WHERE d.pharmacy_id = ? AND b.active = 1 AND b.qty_units > 0`,
      pharmacy.id
    );
    
    // Staff count
    const staff = await q.first(db,
      'SELECT COUNT(*) staff_count FROM users WHERE assigned_pharmacy_id = ? AND active = 1',
      pharmacy.id
    );
    
    // Customer count
    const customers = await q.first(db,
      'SELECT COUNT(*) customer_count FROM customers WHERE pharmacy_id = ?',
      pharmacy.id
    );
    
    comparison.push({
      pharmacy_id: pharmacy.id,
      name: pharmacy.name,
      status: pharmacy.active ? 'active' : 'inactive',
      sales_today: money(salesToday.sales_today),
      sales_month: money(salesMonth.sales_month),
      inventory_value: money(inventory.inventory_value),
      staff_count: staff.staff_count,
      customer_count: customers.customer_count
    });
  }
  
  return c.json({ comparison });
});

export default app;
