import { Hono } from 'hono';
import {
  q, audit, bad, HttpError, str, num, int, normPhone, ROLES, hashPassword, verifyPassword, signJwt, nowUtc,
} from './lib.js';
import { notifyOwner } from './notification-service.js';

const app = new Hono();

export const need = (...roles) => async (c, next) => {
  const u = c.get('user');
  if (!roles.includes(u.role)) throw new HttpError(403, 'You do not have permission to do that.');
  await next();
};
export const body = async (c) => {
  try {
    const b = await c.req.json();
    if (b && typeof b === 'object') return b;
  } catch {}
  throw bad('Invalid request body');
};

// ---------- first-run setup ----------
app.get('/setup/status', async (c) => {
  const p = await q.first(c.env.DB, 'SELECT id,name FROM pharmacy WHERE id=1');
  return c.json({ needsSetup: !p, pharmacyName: p?.name || null });
});

app.post('/setup', async (c) => {
  const exists = await q.first(c.env.DB, 'SELECT id FROM pharmacy WHERE id=1');
  if (exists) throw new HttpError(409, 'This pharmacy is already set up.');
  const b = await body(c);
  const name = str(b.pharmacy_name, 120);
  const ownerName = str(b.owner_name, 120);
  const email = str(b.owner_email, 120).toLowerCase() || null;
  const phone = normPhone(str(b.owner_phone, 30)) || null;
  const password = String(b.password || '');
  const isSystemOwner = b.is_system_owner ? 1 : 0;
  if (!name) throw bad('Enter the pharmacy\'s registered name.');
  if (!ownerName) throw bad('Enter the owner\'s name.');
  if (!email && !phone) throw bad('Enter an email or phone number for the owner to sign in with.');
  if (password.length < 8) throw bad('Password must be at least 8 characters.');
  const { hash, salt } = await hashPassword(password);
  
  // Insert pharmacy first (without CHECK constraint, allowing auto-increment)
  const pharmacyResult = await q.run(c.env.DB,
    `INSERT INTO pharmacy (name,address,phone,email,kra_pin,licence_no,superintendent_name,superintendent_reg_no,mpesa_till,active)
     VALUES (?,?,?,?,?,?,?,?,?,1)`,
    name, str(b.address), normPhone(str(b.pharmacy_phone, 30)), str(b.pharmacy_email), str(b.kra_pin, 30),
    str(b.licence_no, 60), str(b.superintendent_name), str(b.superintendent_reg_no, 60), str(b.mpesa_till, 30));
  
  const pharmacyId = pharmacyResult.meta.last_row_id;
  
  // Insert user with is_system_owner and assigned_pharmacy_id
  const userResult = await q.run(c.env.DB,
    `INSERT INTO users (name,email,phone,password_hash,password_salt,role,is_system_owner,assigned_pharmacy_id) 
     VALUES (?,?,?,?,?,'owner',?,?)`,
    ownerName, email, phone, hash, salt, isSystemOwner, pharmacyId);
  
  const userId = userResult.meta.last_row_id;
  
  // Update pharmacy with owner_user_id
  await q.run(c.env.DB, 'UPDATE pharmacy SET owner_user_id=? WHERE id=?', userId, pharmacyId);
  
  const user = await q.first(c.env.DB, 
    'SELECT id,name,email,phone,role,is_system_owner,assigned_pharmacy_id FROM users WHERE id=?', userId);
  
  await audit(c.env.DB, user, 'setup', 'pharmacy', pharmacyId, name);
  const token = await signJwt({ sub: user.id }, c.env.JWT_SECRET || 'dev-secret-key-change-in-production');
  return c.json({ token, user });
});

// ---------- auth ----------
app.post('/auth/login', async (c) => {
  const b = await body(c);
  const idRaw = str(b.identifier, 120).toLowerCase();
  const password = String(b.password || '');
  if (!idRaw || !password) throw bad('Enter your email or phone and password.');
  // simple lockout: 8 failed attempts per identifier in 15 minutes
  const since = new Date(Date.now() - 15 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
  const fails = await q.first(c.env.DB,
    `SELECT COUNT(*) n FROM audit_log WHERE action='login_failed' AND detail=? AND created_at>=?`, idRaw, since);
  if (fails.n >= 8) throw new HttpError(429, 'Too many failed attempts. Try again in 15 minutes.');
  const phone = normPhone(idRaw);
  const u = await q.first(c.env.DB, 
    'SELECT * FROM users WHERE lower(email)=? OR phone=?', idRaw, phone);
  const ok = u && u.active && (await verifyPassword(password, u.password_hash, u.password_salt));
  if (!ok) {
    await audit(c.env.DB, null, 'login_failed', 'user', null, idRaw);
    
    // Notify owner of failed login attempt if user exists and has pharmacy
    if (u && u.assigned_pharmacy_id) {
      const pharmacy = await q.first(c.env.DB, 'SELECT owner_user_id, id FROM pharmacy WHERE id=?', u.assigned_pharmacy_id);
      if (pharmacy && pharmacy.owner_user_id) {
        await notifyOwner(c.env.DB, pharmacy.owner_user_id, {
          pharmacyId: pharmacy.id,
          type: 'security',
          category: 'auth',
          title: 'Failed Login Attempt',
          message: `Failed login attempt for user ${u.name} (${idRaw})`,
          metadata: { user_id: u.id, user_name: u.name, identifier: idRaw, timestamp: nowUtc() },
          requiresAction: false
        });
      }
    }
    
    throw new HttpError(401, 'Wrong email/phone or password.');
  }
  await audit(c.env.DB, u, 'login', 'user', u.id, null);
  const token = await signJwt({ sub: u.id }, c.env.JWT_SECRET || 'dev-secret-key-change-in-production');
  
  // Build response with owner fields
  const userResponse = { 
    id: u.id, 
    name: u.name, 
    email: u.email, 
    phone: u.phone, 
    role: u.role, 
    reg_no: u.reg_no,
    is_system_owner: u.is_system_owner || 0,
    assigned_pharmacy_id: u.assigned_pharmacy_id || null
  };
  
  // If system owner, fetch accessible pharmacies
  if (u.is_system_owner) {
    const accessiblePharmacies = await q.all(c.env.DB,
      'SELECT id, name FROM pharmacy WHERE owner_user_id = ? AND active = 1 ORDER BY name',
      u.id);
    userResponse.accessible_pharmacies = accessiblePharmacies;
  } else {
    userResponse.accessible_pharmacies = [];
  }
  
  return c.json({ token, user: userResponse });
});

app.get('/auth/me', async (c) => {
  const p = await q.first(c.env.DB, 'SELECT * FROM pharmacy WHERE id=1');
  return c.json({ user: c.get('user'), pharmacy: p });
});

app.post('/auth/change-password', async (c) => {
  const b = await body(c);
  const u = await q.first(c.env.DB, 'SELECT * FROM users WHERE id=?', c.get('user').id);
  if (!(await verifyPassword(String(b.current_password || ''), u.password_hash, u.password_salt))) throw bad('Current password is wrong.');
  if (String(b.new_password || '').length < 8) throw bad('New password must be at least 8 characters.');
  const { hash, salt } = await hashPassword(String(b.new_password));
  await q.run(c.env.DB, 'UPDATE users SET password_hash=?,password_salt=? WHERE id=?', hash, salt, u.id);
  await audit(c.env.DB, u, 'password_changed', 'user', u.id, null);
  
  // Notify owner of password change
  if (u.assigned_pharmacy_id) {
    const pharmacy = await q.first(c.env.DB, 'SELECT owner_user_id, id FROM pharmacy WHERE id=?', u.assigned_pharmacy_id);
    if (pharmacy && pharmacy.owner_user_id && pharmacy.owner_user_id !== u.id) {
      await notifyOwner(c.env.DB, pharmacy.owner_user_id, {
        pharmacyId: pharmacy.id,
        type: 'security',
        category: 'auth',
        title: 'Password Changed',
        message: `User ${u.name} changed their password`,
        metadata: { user_id: u.id, user_name: u.name, timestamp: nowUtc() },
        requiresAction: false
      });
    }
  }
  
  return c.json({ ok: true });
});

// Password reset request - Generate token and send email
app.post('/auth/reset-password-request', async (c) => {
  const b = await body(c);
  const email = str(b.email, 120).toLowerCase();
  if (!email) throw bad('Email is required');
  
  const u = await q.first(c.env.DB, 'SELECT id,name,email FROM users WHERE lower(email)=?', email);
  
  // Always return success to prevent email enumeration
  await new Promise(resolve => setTimeout(resolve, 500)); // Simulate processing
  
  if (u) {
    // Generate reset token (valid for 1 hour)
    const resetToken = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour
    
    // Store token in database (you'd need a password_resets table)
    // For now, we'll create a temporary token in audit log
    await audit(c.env.DB, null, 'password_reset_requested', 'user', u.id, JSON.stringify({ 
      email, 
      token: resetToken, 
      expires: expiresAt 
    }));
    
    // Send email using MailChannels (free on Cloudflare)
    // Check if MAILCHANNELS is configured
    if (c.env.SEND_EMAIL === 'true') {
      const resetLink = `${new URL(c.req.url).origin}/reset-password?token=${resetToken}`;
      
      try {
        await fetch('https://api.mailchannels.net/tx/v1/send', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            personalizations: [{ to: [{ email: u.email, name: u.name }] }],
            from: { email: c.env.FROM_EMAIL || 'noreply@pharmacy.com', name: 'Pharmacy System' },
            subject: 'Password Reset Request',
            content: [{
              type: 'text/html',
              value: `
                <div style="font-family: 'Inter', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                  <h2 style="color: #667eea;">Password Reset Request</h2>
                  <p>Hi ${u.name},</p>
                  <p>You requested to reset your password. Click the button below to reset it:</p>
                  <div style="text-align: center; margin: 30px 0;">
                    <a href="${resetLink}" style="background: linear-gradient(135deg, #667eea, #764ba2); color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: 600; display: inline-block;">Reset Password</a>
                  </div>
                  <p>Or copy this link: <a href="${resetLink}">${resetLink}</a></p>
                  <p style="color: #666; font-size: 14px;">This link expires in 1 hour.</p>
                  <p style="color: #666; font-size: 14px;">If you didn't request this, please ignore this email.</p>
                  <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
                  <p style="color: #999; font-size: 12px;">Pharmacy Management System</p>
                </div>
              `
            }]
          })
        });
      } catch (err) {
        console.error('Email send failed:', err);
        // Don't throw error to prevent email enumeration
      }
    } else {
      // Development mode: log the reset link
      console.log(`Password reset link for ${u.email}: /reset-password?token=${resetToken}`);
    }
  }
  
  return c.json({ ok: true, message: 'If an account exists with that email, a reset link has been sent.' });
});

// Complete password reset with token
app.post('/auth/reset-password-complete', async (c) => {
  const b = await body(c);
  const token = str(b.token, 120);
  const newPassword = String(b.password || '');
  
  if (!token) throw bad('Reset token is required');
  if (newPassword.length < 8) throw bad('Password must be at least 8 characters');
  
  // Find the reset request in audit log
  const resetRequest = await q.first(c.env.DB, 
    `SELECT * FROM audit_log 
     WHERE action='password_reset_requested' 
     AND detail LIKE ? 
     AND created_at >= datetime('now', '-1 hour')
     ORDER BY id DESC LIMIT 1`,
    `%"token":"${token}"%`
  );
  
  if (!resetRequest) {
    throw new HttpError(400, 'Invalid or expired reset token');
  }
  
  const detail = JSON.parse(resetRequest.detail);
  const userId = resetRequest.entity_id;
  
  // Check if already used
  const alreadyUsed = await q.first(c.env.DB,
    `SELECT id FROM audit_log 
     WHERE action='password_reset_completed' 
     AND detail LIKE ?`,
    `%"token":"${token}"%`
  );
  
  if (alreadyUsed) {
    throw new HttpError(400, 'This reset link has already been used');
  }
  
  // Update password
  const { hash, salt } = await hashPassword(newPassword);
  await q.run(c.env.DB, 
    'UPDATE users SET password_hash=?, password_salt=? WHERE id=?', 
    hash, salt, userId
  );
  
  // Mark as completed
  const user = await q.first(c.env.DB, 'SELECT * FROM users WHERE id=?', userId);
  await audit(c.env.DB, user, 'password_reset_completed', 'user', userId, JSON.stringify({ token }));
  
  return c.json({ ok: true, message: 'Password reset successfully. You can now login.' });
});

// ---------- users (owner) ----------
app.get('/users', need('owner', 'pharmacist'), async (c) => {
  const rows = await q.all(c.env.DB, 'SELECT id,name,email,phone,role,reg_no,active,created_at FROM users ORDER BY active DESC, name');
  return c.json({ users: rows });
});

app.post('/users', need('owner'), async (c) => {
  const b = await body(c);
  const name = str(b.name, 120);
  const role = str(b.role);
  const email = str(b.email, 120).toLowerCase() || null;
  const phone = normPhone(str(b.phone, 30)) || null;
  if (!name) throw bad('Enter the user\'s name.');
  if (!ROLES.includes(role)) throw bad('Choose a valid role.');
  if (!email && !phone) throw bad('Enter an email or phone number.');
  if (String(b.password || '').length < 8) throw bad('Password must be at least 8 characters.');
  const dup = await q.first(c.env.DB, 'SELECT id FROM users WHERE (email IS NOT NULL AND lower(email)=?) OR (phone IS NOT NULL AND phone=?)', email, phone);
  if (dup) throw new HttpError(409, 'A user with that email or phone already exists.');
  const { hash, salt } = await hashPassword(String(b.password));
  const r = await q.run(c.env.DB,
    'INSERT INTO users (name,email,phone,password_hash,password_salt,role,reg_no) VALUES (?,?,?,?,?,?,?)',
    name, email, phone, hash, salt, role, str(b.reg_no, 60) || null);
  await audit(c.env.DB, c.get('user'), 'user_created', 'user', r.meta.last_row_id, `${name} (${role})`);
  
  // Notify owner of new user creation
  const owner = c.get('user');
  if (owner.assigned_pharmacy_id) {
    const pharmacy = await q.first(c.env.DB, 'SELECT owner_user_id, id FROM pharmacy WHERE id=?', owner.assigned_pharmacy_id);
    if (pharmacy && pharmacy.owner_user_id) {
      await notifyOwner(c.env.DB, pharmacy.owner_user_id, {
        pharmacyId: pharmacy.id,
        type: 'info',
        category: 'auth',
        title: 'New User Created',
        message: `New user ${name} (${role}) created by ${owner.name}`,
        metadata: { user_id: r.meta.last_row_id, user_name: name, role, created_by: owner.name },
        requiresAction: false
      });
    }
  }
  
  return c.json({ id: r.meta.last_row_id }, 201);
});

app.put('/users/:id', need('owner'), async (c) => {
  const id = int(c.req.param('id'));
  const b = await body(c);
  const u = await q.first(c.env.DB, 'SELECT * FROM users WHERE id=?', id);
  if (!u) throw new HttpError(404, 'User not found');
  const role = b.role ? str(b.role) : u.role;
  if (!ROLES.includes(role)) throw bad('Choose a valid role.');
  const active = b.active == null ? u.active : b.active ? 1 : 0;
  if (u.role === 'owner' && (role !== 'owner' || !active)) {
    const owners = await q.first(c.env.DB, `SELECT COUNT(*) n FROM users WHERE role='owner' AND active=1`);
    if (owners.n <= 1) throw bad('There must be at least one active owner.');
  }
  const email = b.email !== undefined ? str(b.email, 120).toLowerCase() || null : u.email;
  const phone = b.phone !== undefined ? normPhone(str(b.phone, 30)) || null : u.phone;
  if (!email && !phone) throw bad('A user needs an email or phone number.');
  await q.run(c.env.DB, 'UPDATE users SET name=?,email=?,phone=?,role=?,reg_no=?,active=? WHERE id=?',
    str(b.name, 120) || u.name, email, phone, role, b.reg_no !== undefined ? str(b.reg_no, 60) || null : u.reg_no, active, id);
  if (b.password) {
    if (String(b.password).length < 8) throw bad('Password must be at least 8 characters.');
    const { hash, salt } = await hashPassword(String(b.password));
    await q.run(c.env.DB, 'UPDATE users SET password_hash=?,password_salt=? WHERE id=?', hash, salt, id);
    await audit(c.env.DB, c.get('user'), 'password_reset', 'user', id, null);
  }
  await audit(c.env.DB, c.get('user'), 'user_updated', 'user', id, { role, active });
  
  // Notify owner of role change or deactivation
  const owner = c.get('user');
  if (owner.assigned_pharmacy_id && (role !== u.role || active !== u.active)) {
    const pharmacy = await q.first(c.env.DB, 'SELECT owner_user_id, id FROM pharmacy WHERE id=?', owner.assigned_pharmacy_id);
    if (pharmacy && pharmacy.owner_user_id) {
      let title = '';
      let message = '';
      let notifType = 'info';
      
      if (active === 0 && u.active === 1) {
        title = 'User Deactivated';
        message = `User ${u.name} was deactivated by ${owner.name}`;
        notifType = 'warning';
      } else if (role !== u.role) {
        title = 'User Role Changed';
        message = `User ${u.name} role changed from ${u.role} to ${role} by ${owner.name}`;
        notifType = 'info';
      } else {
        title = 'User Updated';
        message = `User ${u.name} was updated by ${owner.name}`;
      }
      
      await notifyOwner(c.env.DB, pharmacy.owner_user_id, {
        pharmacyId: pharmacy.id,
        type: notifType,
        category: 'auth',
        title,
        message,
        metadata: { user_id: id, user_name: u.name, old_role: u.role, new_role: role, old_active: u.active, new_active: active, updated_by: owner.name },
        requiresAction: false
      });
    }
  }
  
  return c.json({ ok: true });
});

// ---------- settings ----------
app.get('/settings', async (c) => c.json({ pharmacy: await q.first(c.env.DB, 'SELECT * FROM pharmacy WHERE id=1') }));

app.put('/settings', need('owner'), async (c) => {
  const b = await body(c);
  const p = await q.first(c.env.DB, 'SELECT * FROM pharmacy WHERE id=1');
  const name = str(b.name, 120) || p.name;
  const pick = (k, max = 200) => (b[k] !== undefined ? str(b[k], max) : p[k]);
  await q.run(c.env.DB,
    `UPDATE pharmacy SET name=?,address=?,phone=?,email=?,kra_pin=?,licence_no=?,superintendent_name=?,superintendent_reg_no=?,
       vat_rate=?,receipt_footer=?,mpesa_till=?,expiry_warn_days=?,default_reorder_level=?,max_cashier_discount=? WHERE id=1`,
    name, pick('address'), b.phone !== undefined ? normPhone(str(b.phone, 30)) : p.phone, pick('email'), pick('kra_pin', 30),
    pick('licence_no', 60), pick('superintendent_name'), pick('superintendent_reg_no', 60),
    Math.min(100, Math.max(0, num(b.vat_rate, p.vat_rate))), pick('receipt_footer', 300), pick('mpesa_till', 30),
    Math.max(1, int(b.expiry_warn_days, p.expiry_warn_days)), Math.max(0, int(b.default_reorder_level, p.default_reorder_level)),
    Math.min(100, Math.max(0, num(b.max_cashier_discount, p.max_cashier_discount))));
  await audit(c.env.DB, c.get('user'), 'settings_updated', 'pharmacy', 1, null);
  return c.json({ ok: true });
});

// ---------- audit log + backup ----------
app.get('/audit', need('owner'), async (c) => {
  const page = Math.max(1, int(c.req.query('page'), 1));
  const search = str(c.req.query('q'));
  const like = `%${search}%`;
  const where = search ? 'WHERE action LIKE ? OR user_name LIKE ? OR detail LIKE ? OR entity LIKE ?' : '';
  const args = search ? [like, like, like, like] : [];
  const total = await q.first(c.env.DB, `SELECT COUNT(*) n FROM audit_log ${where}`, ...args);
  const rows = await q.all(c.env.DB, `SELECT * FROM audit_log ${where} ORDER BY id DESC LIMIT 50 OFFSET ?`, ...args, (page - 1) * 50);
  return c.json({ rows, total: total.n, page });
});

const BACKUP_TABLES = ['pharmacy', 'users', 'suppliers', 'drugs', 'price_history', 'batches', 'deliveries', 'customers', 'sales',
  'sale_items', 'payments', 'stock_adjustments', 'stock_takes', 'stock_take_lines', 'controlled_register', 'audit_log'];
app.get('/backup', need('owner'), async (c) => {
  const out = { exported_at: nowUtc(), version: 1, tables: {} };
  for (const t of BACKUP_TABLES) {
    out.tables[t] = await q.all(c.env.DB, t === 'users'
      ? 'SELECT id,name,email,phone,role,reg_no,active,created_at FROM users' // password hashes are never exported
      : `SELECT * FROM ${t}`);
  }
  await audit(c.env.DB, c.get('user'), 'backup_exported', null, null, null);
  return c.json(out);
});

// Multi-tenant migration
app.post('/migrate-multi-tenant', async (c) => {
  const db = c.env.DB;
  
  try {
    // Add pharmacy_id columns
    await db.batch([
      db.prepare(`ALTER TABLE users ADD COLUMN pharmacy_id INTEGER`),
      db.prepare(`UPDATE users SET pharmacy_id = 1 WHERE pharmacy_id IS NULL`)
    ].filter(Boolean));

    await db.batch([
      db.prepare(`ALTER TABLE suppliers ADD COLUMN pharmacy_id INTEGER`),
      db.prepare(`UPDATE suppliers SET pharmacy_id = 1 WHERE pharmacy_id IS NULL`)
    ]);

    await db.batch([
      db.prepare(`ALTER TABLE drugs ADD COLUMN pharmacy_id INTEGER`),
      db.prepare(`UPDATE drugs SET pharmacy_id = 1 WHERE pharmacy_id IS NULL`)
    ]);

    await db.batch([
      db.prepare(`ALTER TABLE customers ADD COLUMN pharmacy_id INTEGER`),
      db.prepare(`UPDATE customers SET pharmacy_id = 1 WHERE pharmacy_id IS NULL`)
    ]);

    await db.batch([
      db.prepare(`ALTER TABLE sales ADD COLUMN pharmacy_id INTEGER`),
      db.prepare(`UPDATE sales SET pharmacy_id = 1 WHERE pharmacy_id IS NULL`)
    ]);

    return c.json({ ok: true, message: 'Multi-tenant migration completed!' });
  } catch (e) {
    console.error('Migration error:', e);
    return c.json({ error: e.message, note: 'Columns may already exist' }, 500);
  }
});

// Demo data seeder
app.post('/seed-demo', async (c) => {
  const db = c.env.DB;
  
  try {
    // Create suppliers
    await db.batch([
      q.stmt(db, `INSERT OR IGNORE INTO suppliers (id, name, phone, email, active) VALUES (1, 'Dawa Ltd', '0722111222', 'dawa@supply.co.ke', 1)`),
      q.stmt(db, `INSERT OR IGNORE INTO suppliers (id, name, phone, email, active) VALUES (2, 'MedSupply Kenya', '0733222333', 'med@supply.co.ke', 1)`),
      q.stmt(db, `INSERT OR IGNORE INTO suppliers (id, name, phone, email, active) VALUES (3, 'PharmaCorp', '0744333444', 'pharma@corp.co.ke', 1)`)
    ]);

    // Create drugs with batches
    const drugs = [
      { brand: 'Paracetamol 500mg', generic: 'paracetamol', strength: '500mg', form: 'Tablet', cls: 'OTC', pack: 10, split: 1, price: 80, cost: 50, qty: 1000 },
      { brand: 'Amoxicillin 250mg', generic: 'amoxicillin', strength: '250mg', form: 'Capsule', cls: 'POM', pack: 21, split: 0, price: 250, cost: 180, qty: 500 },
      { brand: 'Ibuprofen 400mg', generic: 'ibuprofen', strength: '400mg', form: 'Tablet', cls: 'PHARMACY_ONLY', pack: 20, split: 1, price: 120, cost: 80, qty: 800 },
      { brand: 'Metformin 500mg', generic: 'metformin', strength: '500mg', form: 'Tablet', cls: 'POM', pack: 30, split: 0, price: 180, cost: 120, qty: 600 },
      { brand: 'Cetirizine 10mg', generic: 'cetirizine', strength: '10mg', form: 'Tablet', cls: 'PHARMACY_ONLY', pack: 10, split: 1, price: 90, cost: 60, qty: 700 },
      { brand: 'Omeprazole 20mg', generic: 'omeprazole', strength: '20mg', form: 'Capsule', cls: 'PHARMACY_ONLY', pack: 14, split: 0, price: 200, cost: 140, qty: 400 },
      { brand: 'Azithromycin 500mg', generic: 'azithromycin', strength: '500mg', form: 'Tablet', cls: 'POM', pack: 6, split: 0, price: 350, cost: 250, qty: 300 },
      { brand: 'Ciprofloxacin 500mg', generic: 'ciprofloxacin', strength: '500mg', form: 'Tablet', cls: 'POM', pack: 10, split: 0, price: 280, cost: 200, qty: 500 },
      { brand: 'Diclofenac 50mg', generic: 'diclofenac', strength: '50mg', form: 'Tablet', cls: 'PHARMACY_ONLY', pack: 20, split: 1, price: 150, cost: 100, qty: 900 },
      { brand: 'Loratadine 10mg', generic: 'loratadine', strength: '10mg', form: 'Tablet', cls: 'OTC', pack: 10, split: 1, price: 100, cost: 70, qty: 650 }
    ];

    let batchNum = 1001;
    for (const d of drugs) {
      // Insert drug
      const drugResult = await q.run(db, 
        `INSERT INTO drugs (brand_name, generic_name, strength, dosage_form, drug_class, manufacturer, unit_name, pack_size, allow_split, barcode, selling_price, buying_price, active) 
        VALUES (?, ?, ?, ?, ?, 'Generic Pharma', 'tablets', ?, ?, ?, ?, ?, 1)`,
        d.brand, d.generic, d.strength, d.form, d.cls, d.pack, d.split, `890123456789${batchNum}`, d.price, d.cost
      );
      
      const drugId = drugResult.meta.last_row_id;
      
      // Insert batch
      await q.run(db, 
        `INSERT INTO batches (drug_id, batch_no, expiry_date, qty_units, buying_price, selling_price, supplier_id) 
        VALUES (?, ?, '2026-12-31', ?, ?, ?, 1)`,
        drugId, `BATCH${batchNum++}`, d.qty, d.cost, d.price
      );
    }

    // Create customers
    await db.batch([
      q.stmt(db, `INSERT OR IGNORE INTO customers (name, phone) VALUES ('John Doe', '0712345678')`),
      q.stmt(db, `INSERT OR IGNORE INTO customers (name, phone) VALUES ('Jane Smith', '0723456789')`),
      q.stmt(db, `INSERT OR IGNORE INTO customers (name, phone) VALUES ('Peter Mwangi', '0734567890')`),
      q.stmt(db, `INSERT OR IGNORE INTO customers (name, phone) VALUES ('Mary Wanjiru', '0745678901')`)
    ]);

    return c.json({ ok: true, message: 'Demo data seeded successfully! 10 drugs, 3 suppliers, 4 customers added.' });
  } catch (e) {
    console.error('Seed error:', e);
    return c.json({ error: e.message }, 500);
  }
});

// Get expiry alerts - color coded notifications
app.get('/expiry-alerts', async (c) => {
  const pharmacy_id = c.get('pharmacy_id');
  const today = new Date().toISOString().split('T')[0];
  
  // Get drugs expiring in next 90 days
  const alerts = await q.all(c.env.DB, `
    SELECT 
      d.id,
      d.brand_name,
      d.generic_name,
      b.batch_no,
      b.expiry_date,
      b.qty_units,
      CAST((julianday(b.expiry_date) - julianday(?)) AS INTEGER) as days_until_expiry,
      CASE 
        WHEN julianday(b.expiry_date) < julianday(?) THEN 'expired'
        WHEN julianday(b.expiry_date) - julianday(?) <= 30 THEN 'critical'
        WHEN julianday(b.expiry_date) - julianday(?) <= 90 THEN 'warning'
        ELSE 'ok'
      END as alert_level
    FROM drugs d
    JOIN batches b ON d.id = b.drug_id
    WHERE d.pharmacy_id = ? 
      AND b.active = 1 
      AND b.qty_units > 0
      AND julianday(b.expiry_date) - julianday(?) <= 90
    ORDER BY b.expiry_date ASC
  `, today, today, today, today, pharmacy_id, today);
  
  const summary = {
    expired: alerts.filter(a => a.alert_level === 'expired').length,
    critical: alerts.filter(a => a.alert_level === 'critical').length,
    warning: alerts.filter(a => a.alert_level === 'warning').length,
    total: alerts.length
  };
  
  return c.json({ alerts, summary });
});

// Get low stock alerts
app.get('/stock-alerts', async (c) => {
  const pharmacy_id = c.get('pharmacy_id');
  
  const alerts = await q.all(c.env.DB, `
    SELECT 
      d.id,
      d.brand_name,
      d.generic_name,
      d.stock_units,
      d.reorder_level,
      d.pack_size,
      CASE 
        WHEN d.stock_units = 0 THEN 'out_of_stock'
        WHEN d.stock_units <= d.reorder_level * 0.5 THEN 'critical'
        WHEN d.stock_units <= d.reorder_level THEN 'low'
        ELSE 'ok'
      END as alert_level
    FROM drugs d
    WHERE d.pharmacy_id = ? 
      AND d.active = 1
      AND d.stock_units <= d.reorder_level
    ORDER BY d.stock_units ASC
  `, pharmacy_id);
  
  const summary = {
    out_of_stock: alerts.filter(a => a.alert_level === 'out_of_stock').length,
    critical: alerts.filter(a => a.alert_level === 'critical').length,
    low: alerts.filter(a => a.alert_level === 'low').length,
    total: alerts.length
  };
  
  return c.json({ alerts, summary });
});

// System health check
app.get('/health-check', async (c) => {
  const pharmacy_id = c.get('pharmacy_id');
  const start = Date.now();
  
  try {
    // Check database connectivity
    const dbCheck = await q.first(c.env.DB, 'SELECT 1 as ok');
    const dbLatency = Date.now() - start;
    
    // Get system stats
    const stats = await c.env.DB.batch([
      q.stmt(c.env.DB, 'SELECT COUNT(*) as count FROM drugs WHERE pharmacy_id = ? AND active = 1', pharmacy_id),
      q.stmt(c.env.DB, 'SELECT COUNT(*) as count FROM sales WHERE pharmacy_id = ? AND created_at >= date("now", "-30 days")', pharmacy_id),
      q.stmt(c.env.DB, 'SELECT COUNT(*) as count FROM users WHERE pharmacy_id = ? AND active = 1', pharmacy_id),
    ]);
    
    return c.json({
      status: 'healthy',
      timestamp: nowUtc(),
      database: {
        connected: !!dbCheck,
        latency_ms: dbLatency
      },
      stats: {
        active_drugs: stats[0].results[0].count,
        sales_last_30_days: stats[1].results[0].count,
        active_users: stats[2].results[0].count
      },
      uptime: 'operational'
    });
  } catch (e) {
    return c.json({
      status: 'unhealthy',
      error: e.message,
      timestamp: nowUtc()
    }, 500);
  }
});

export default app;
