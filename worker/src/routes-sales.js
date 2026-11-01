import { Hono } from 'hono';
import {
  q, audit, auditStmt, bad, HttpError, str, num, int, money, eatDate, eatRange, addDays, isDate, normPhone, verifyPassword,
} from './lib.js';
import { need, body } from './routes-core.js';
import { drugTotalUnits } from './routes-stock.js';
import { notifyOwner, detectAbnormalSale } from './notification-service.js';

const app = new Hono();
const SELLERS = need('owner', 'pharmacist', 'cashier');
const WRITE = need('owner', 'pharmacist');
const pad6 = (n) => String(n).padStart(6, '0');

// ---------- create a sale ----------
app.post('/sales', SELLERS, async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const b = await body(c);
  const pharmacy_id = c.get('pharmacy_id');
  const is_system_owner = c.get('is_system_owner');
  
  // System owners must select a pharmacy
  if (is_system_owner && !pharmacy_id) {
    throw bad('Please select a pharmacy before creating a sale.');
  }
  
  const pharmacy = await q.first(db, 'SELECT * FROM pharmacy WHERE id=?', pharmacy_id || 1);
  const today = eatDate();

  const cart = Array.isArray(b.items) ? b.items : [];
  if (!cart.length) throw bad('Add at least one item to the sale.');
  if (cart.length > 60) throw bad('A sale can have up to 60 lines.');

  // merge duplicate drugs in the cart
  const want = new Map();
  for (const it of cart) {
    const id = int(it.drug_id);
    const units = int(it.qty_units);
    if (!id || units <= 0) throw bad('Every item needs a drug and a quantity above zero.');
    want.set(id, (want.get(id) || 0) + units);
  }

  // customer details
  const custName = str(b.customer?.name, 120);
  const custPhone = normPhone(str(b.customer?.phone, 30));

  // ---- allocate stock FEFO, price lines ----
  const lines = []; // one per batch used
  let needsPrescription = false, hasControlled = false;
  const drugs = new Map();
  for (const [drugId, units] of want) {
    const drug = await q.first(db, 'SELECT * FROM drugs WHERE id=? AND active=1 AND pharmacy_id=?', drugId, pharmacy_id || 1);
    if (!drug) throw bad('One of the drugs in the cart is no longer available.');
    drugs.set(drugId, drug);
    if (units % drug.pack_size !== 0 && !drug.allow_split) {
      throw bad(`${drug.brand_name} is sold in whole packs of ${drug.pack_size} only.`);
    }
    if (drug.drug_class === 'POM' || drug.drug_class === 'CONTROLLED') needsPrescription = true;
    if (drug.drug_class === 'CONTROLLED') hasControlled = true;
    const batches = await q.all(db,
      `SELECT * FROM batches WHERE drug_id=? AND active=1 AND qty_units>0 AND expiry_date >= ? ORDER BY expiry_date, id`, drugId, today);
    const available = batches.reduce((s, x) => s + x.qty_units, 0);
    if (available < units) {
      const expired = await q.first(db, `SELECT COALESCE(SUM(qty_units),0) n FROM batches WHERE drug_id=? AND active=1 AND expiry_date < ?`, drugId, today);
      throw bad(`${drug.brand_name}: only ${available} ${drug.unit_name === 'pack' ? 'units' : drug.unit_name + 's'} in stock` +
        (expired.n ? ` (${expired.n} expired and cannot be sold)` : '') + '.');
    }
    let left = units;
    for (const bt of batches) {
      if (left <= 0) break;
      const take = Math.min(left, bt.qty_units);
      const pack = bt.selling_price > 0 ? bt.selling_price : drug.selling_price;
      const unitPrice = pack / drug.pack_size;
      const unitCost = (bt.buying_price > 0 ? bt.buying_price : drug.buying_price) / drug.pack_size;
      lines.push({ drug, batch: bt, qty: take, unitPrice, unitCost, lineTotal: money(unitPrice * take) });
      left -= take;
    }
  }

  // ---- totals ----
  const subtotal = money(lines.reduce((s, l) => s + l.lineTotal, 0));
  let discount = 0;
  if (b.discount_percent != null && num(b.discount_percent) > 0) discount = money(subtotal * Math.min(100, num(b.discount_percent)) / 100);
  else if (num(b.discount) > 0) discount = money(Math.min(subtotal, num(b.discount)));
  const discountReason = str(b.discount_reason, 200);
  if (discount > 0) {
    if (!discountReason) throw bad('Enter a reason for the discount.');
    const pct = subtotal ? (discount / subtotal) * 100 : 0;
    if (user.role === 'cashier' && pct > pharmacy.max_cashier_discount + 0.0001) {
      throw new HttpError(403, `Cashiers can give up to ${pharmacy.max_cashier_discount}% discount. Ask a pharmacist or the owner.`);
    }
  }
  const total = money(subtotal - discount);
  // VAT is included in the price; extract it from VAT-able lines after discount share
  const ratio = subtotal ? total / subtotal : 1;
  const vatRate = pharmacy.vat_rate;
  const vat = money(lines.filter((l) => l.drug.vat_applicable).reduce((s, l) => s + (l.lineTotal * ratio * vatRate) / (100 + vatRate), 0));

  // ---- prescription / controlled rules ----
  const rx = b.prescription || {};
  let approverId = null;
  if (needsPrescription) {
    if (!str(rx.prescriber_name)) throw bad('Prescription drugs need the prescriber\'s name.');
    if (!custName) throw bad('Prescription drugs need the patient\'s name.');
    if (hasControlled) {
      if (!custPhone) throw bad('Controlled drugs need the patient\'s phone number.');
      if (!str(rx.prescriber_facility)) throw bad('Controlled drugs need the prescriber\'s facility.');
    }
    if (user.role === 'pharmacist' || user.role === 'owner') {
      approverId = user.id; // pharmacist/owner approves their own sale
    } else {
      const ap = b.approval || {};
      const idRaw = str(ap.identifier, 120).toLowerCase();
      if (!idRaw || !ap.password) throw new HttpError(403, 'A pharmacist must approve this sale. Ask them to enter their login.', { code: 'approval_required' });
      const approver = await q.first(db, `SELECT * FROM users WHERE (lower(email)=? OR phone=?) AND active=1 AND role IN ('pharmacist','owner')`, idRaw, normPhone(idRaw));
      if (!approver || !(await verifyPassword(String(ap.password), approver.password_hash, approver.password_salt))) {
        throw new HttpError(403, 'Pharmacist approval failed: wrong login.', { code: 'approval_failed' });
      }
      approverId = approver.id;
    }
  }

  // ---- payments ----
  const pays = (Array.isArray(b.payments) ? b.payments : [])
    .map((p) => ({ method: str(p.method), amount: money(num(p.amount)), reference: str(p.reference, 60) || null }))
    .filter((p) => p.amount > 0);
  for (const p of pays) if (!['cash', 'mpesa', 'card', 'insurance'].includes(p.method)) throw bad('Unknown payment method.');
  let paid = money(pays.reduce((s, p) => s + p.amount, 0));
  let change = 0;
  if (paid > total) {
    change = money(paid - total);
    let toRemove = change;
    for (let i = pays.length - 1; i >= 0 && toRemove > 0; i--) {
      if (pays[i].method !== 'cash') continue;
      const cut = Math.min(pays[i].amount, toRemove);
      pays[i].amount = money(pays[i].amount - cut);
      toRemove = money(toRemove - cut);
    }
    if (toRemove > 0) throw bad('Payment is more than the total. Only cash can give change.');
    paid = total;
  }
  const balanceDue = money(total - paid);
  let customerId = null;
  if (balanceDue > 0) {
    if (!custName || !custPhone) throw bad('Part or unpaid sales (credit) need the customer\'s name and phone.');
  }
  if (custPhone && custName) {
    const existing = await q.first(db, 'SELECT id FROM customers WHERE phone=?', custPhone);
    if (existing) customerId = existing.id;
    else customerId = (await q.run(db, 'INSERT INTO customers (name,phone) VALUES (?,?)', custName, custPhone)).meta.last_row_id;
  }

  // ---- sale number (unique constraint protects against races) ----
  const saleNo = 'S-' + pad6(pharmacy.receipt_counter + 1);
  const stmts = [
    db.prepare('UPDATE pharmacy SET receipt_counter = receipt_counter + 1 WHERE id=? AND receipt_counter = ?').bind(pharmacy_id || 1, pharmacy.receipt_counter),
    db.prepare(
      `INSERT INTO sales (sale_no,cashier_id,customer_id,customer_name,customer_phone,subtotal,discount,vat,total,amount_paid,balance_due,
         has_prescription,has_controlled,approved_by,prescriber_name,prescriber_facility,prescription_date,discount_reason,pharmacy_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(saleNo, user.id, customerId, custName || null, custPhone || null, subtotal, discount, vat, total, paid, balanceDue,
        needsPrescription ? 1 : 0, hasControlled ? 1 : 0, approverId, str(rx.prescriber_name, 120) || null,
        str(rx.prescriber_facility, 120) || null, isDate(rx.prescription_date) ? rx.prescription_date : null, discountReason || null, pharmacy_id || 1),
  ];
  const SALE_ID = '(SELECT id FROM sales WHERE sale_no=?)';
  const balances = new Map();
  for (const l of lines) {
    stmts.push(db.prepare(
      `INSERT INTO sale_items (sale_id,drug_id,batch_id,drug_name,qty_units,unit_price,unit_cost,line_total) VALUES (${SALE_ID},?,?,?,?,?,?,?)`)
      .bind(saleNo, l.drug.id, l.batch.id, l.drug.brand_name + (l.drug.strength ? ' ' + l.drug.strength : ''), l.qty,
        l.unitPrice, l.unitCost, l.lineTotal));
    // CHECK (qty_units >= 0) makes the whole batch roll back if someone else sold the stock meanwhile
    stmts.push(db.prepare('UPDATE batches SET qty_units = qty_units - ? WHERE id=?').bind(l.qty, l.batch.id));
    if (l.drug.drug_class === 'CONTROLLED') {
      if (!balances.has(l.drug.id)) balances.set(l.drug.id, await drugTotalUnits(db, l.drug.id));
      const bal = balances.get(l.drug.id) - l.qty;
      balances.set(l.drug.id, bal);
      stmts.push(db.prepare(
        `INSERT INTO controlled_register (drug_id,batch_id,direction,qty_units,balance_units,patient_name,patient_phone,prescriber_name,
           prescriber_facility,sale_id,user_id,approved_by,note)
         VALUES (?,?,'out',?,?,?,?,?,?,${SALE_ID},?,?,?)`)
        .bind(l.drug.id, l.batch.id, l.qty, bal, custName, custPhone, str(rx.prescriber_name, 120), str(rx.prescriber_facility, 120),
          saleNo, user.id, approverId, `Sale ${saleNo}`));
    }
  }
  for (const p of pays) {
    stmts.push(db.prepare(`INSERT INTO payments (sale_id,customer_id,method,amount,reference,received_by) VALUES (${SALE_ID},?,?,?,?,?)`)
      .bind(saleNo, customerId, p.method, p.amount, p.reference, user.id));
  }
  if (balanceDue > 0) stmts.push(db.prepare('UPDATE customers SET credit_balance = credit_balance + ? WHERE id=?').bind(balanceDue, customerId));
  stmts.push(auditStmt(db, user, 'sale_created', 'sale', saleNo, { total, items: lines.length, controlled: hasControlled }));

  try {
    await db.batch(stmts);
  } catch (e) {
    const msg = String(e.message || e);
    if (/CHECK|constraint/i.test(msg)) {
      throw new HttpError(409, 'Stock or the sale number changed while you were selling. Please review the cart and try again.');
    }
    throw e;
  }
  const sale = await q.first(db, 'SELECT id FROM sales WHERE sale_no=?', saleNo);
  
  // Notify owner of abnormal sales
  if (pharmacy.owner_user_id) {
    const abnormalCheck = detectAbnormalSale(pharmacy, { sale_date: new Date().toISOString(), total, subtotal, discount });
    if (abnormalCheck) {
      await notifyOwner(db, pharmacy.owner_user_id, {
        pharmacyId: pharmacy.id,
        type: abnormalCheck.severity === 'critical' ? 'critical' : 'warning',
        category: 'sales',
        title: 'Abnormal Sale Detected',
        message: `${abnormalCheck.reason} - Sale ${saleNo} for ${pharmacy.currency || 'KES'} ${money(total).toLocaleString()} at ${pharmacy.name}`,
        metadata: { sale_no: saleNo, total, discount, user_name: user.name, user_id: user.id },
        requiresAction: false
      });
    }
  }
  
  return c.json({ id: sale.id, sale_no: saleNo, total, change, balance_due: balanceDue }, 201);
});

// ---------- list sales (Sales History screen) ----------
app.get('/sales', async (c) => {
  const user = c.get('user');
  const is_system_owner = c.get('is_system_owner');
  const pharmacy_id = c.get('pharmacy_id');
  const search = str(c.req.query('q'));
  const filter = str(c.req.query('filter')) || 'all';
  const page = Math.max(1, int(c.req.query('page'), 1));
  const pageSize = Math.min(100, Math.max(5, int(c.req.query('page_size'), 25)));
  const where = [];
  const args = [];

  // Pharmacy filtering
  if (is_system_owner) {
    const filterPharmacy = int(c.req.query('pharmacy_id'));
    if (filterPharmacy) {
      where.push('s.pharmacy_id = ?');
      args.push(filterPharmacy);
    }
    // If no filter, show all owned pharmacies (implemented via query)
  } else {
    where.push('s.pharmacy_id = ?');
    args.push(pharmacy_id);
  }

  if (user.role === 'cashier') { where.push('s.cashier_id = ?'); args.push(user.id); }
  else if (int(c.req.query('cashier'))) { where.push('s.cashier_id = ?'); args.push(int(c.req.query('cashier'))); }

  if (search) {
    where.push(`(s.sale_no LIKE ? OR s.customer_name LIKE ? OR s.customer_phone LIKE ?
                 OR EXISTS (SELECT 1 FROM sale_items i WHERE i.sale_id=s.id AND i.drug_name LIKE ?))`);
    const like = `%${search}%`;
    args.push(like, like, like, like);
  }
  const today = eatDate();
  let from = null, to = null;
  if (filter === 'today') { from = to = today; }
  else if (filter === 'week') { from = addDays(today, -6); to = today; }
  else if (filter === 'month') { from = today.slice(0, 8) + '01'; to = today; }
  else if (filter === 'range' && isDate(c.req.query('from')) && isDate(c.req.query('to'))) { from = c.req.query('from'); to = c.req.query('to'); }
  if (from) { const [a, z] = eatRange(from, to); where.push('s.sale_date >= ? AND s.sale_date < ?'); args.push(a, z); }
  if (filter === 'voided') where.push(`s.status IN ('voided','refunded')`);
  else if (filter === 'credit') where.push('s.balance_due > 0');
  else if (filter === 'prescription') where.push('s.has_prescription = 1');
  else if (filter === 'controlled') where.push('s.has_controlled = 1');
  else if (['cash', 'mpesa', 'card', 'insurance'].includes(filter)) {
    where.push('EXISTS (SELECT 1 FROM payments p WHERE p.sale_id=s.id AND p.method=?)'); args.push(filter);
  }
  const W = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const count = await q.first(c.env.DB, `SELECT COUNT(*) n, COALESCE(SUM(CASE WHEN s.status='completed' THEN s.total END),0) sum FROM sales s ${W}`, ...args);
  const rows = await q.all(c.env.DB,
    `SELECT s.id,s.sale_no,s.sale_date,s.customer_name,s.customer_phone,s.total,s.discount,s.balance_due,s.status,s.has_prescription,s.has_controlled,
            u.name cashier_name,
            (SELECT group_concat(drug_name || ' x' || qty_units, ', ') FROM sale_items i WHERE i.sale_id=s.id) items,
            (SELECT group_concat(DISTINCT method) FROM payments p WHERE p.sale_id=s.id) methods
     FROM sales s JOIN users u ON u.id=s.cashier_id ${W} ORDER BY s.id DESC LIMIT ? OFFSET ?`, ...args, pageSize, (page - 1) * pageSize);
  return c.json({ sales: rows, total: count.n, sum_total: money(count.sum), page, pageSize });
});

// ---------- one sale (receipt / detail) ----------
app.get('/sales/:id', async (c) => {
  const user = c.get('user');
  const is_system_owner = c.get('is_system_owner');
  const pharmacy_id = c.get('pharmacy_id');
  const s = await q.first(c.env.DB,
    `SELECT s.*, u.name cashier_name, a.name approver_name, v.name voided_by_name
     FROM sales s JOIN users u ON u.id=s.cashier_id LEFT JOIN users a ON a.id=s.approved_by LEFT JOIN users v ON v.id=s.voided_by
     WHERE s.id=? AND (s.pharmacy_id = ? OR ? = 1)`, int(c.req.param('id')), pharmacy_id, is_system_owner ? 1 : 0);
  if (!s || (user.role === 'cashier' && s.cashier_id !== user.id)) throw new HttpError(404, 'Sale not found');
  const items = await q.all(c.env.DB,
    `SELECT i.*, b.batch_no, b.expiry_date, d.pack_size, d.unit_name FROM sale_items i
     JOIN batches b ON b.id=i.batch_id JOIN drugs d ON d.id=i.drug_id WHERE i.sale_id=? ORDER BY i.id`, s.id);
  const payments = await q.all(c.env.DB, 'SELECT * FROM payments WHERE sale_id=? ORDER BY id', s.id);
  const pharmacy = await q.first(c.env.DB, 'SELECT * FROM pharmacy WHERE id=?', s.pharmacy_id);
  return c.json({ sale: s, items, payments, pharmacy });
});

// ---------- void / refund ----------
app.post('/sales/:id/void', WRITE, async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const id = int(c.req.param('id'));
  const b = await body(c);
  const reason = str(b.reason, 200);
  if (!reason) throw bad('Enter a reason.');
  const kind = b.kind === 'refunded' ? 'refunded' : 'voided';
  const s = await q.first(db, 'SELECT * FROM sales WHERE id=?', id);
  if (!s) throw new HttpError(404, 'Sale not found');
  if (s.status !== 'completed') throw bad('This sale was already voided or refunded.');
  const items = await q.all(db, 'SELECT i.*, d.drug_class FROM sale_items i JOIN drugs d ON d.id=i.drug_id WHERE i.sale_id=?', id);
  const stmts = [];
  const balances = new Map();
  for (const it of items) {
    stmts.push(db.prepare('UPDATE batches SET qty_units = qty_units + ? WHERE id=?').bind(it.qty_units, it.batch_id));
    if (it.drug_class === 'CONTROLLED') {
      if (!balances.has(it.drug_id)) balances.set(it.drug_id, await drugTotalUnits(db, it.drug_id));
      const bal = balances.get(it.drug_id) + it.qty_units;
      balances.set(it.drug_id, bal);
      stmts.push(db.prepare(
        `INSERT INTO controlled_register (drug_id,batch_id,direction,qty_units,balance_units,patient_name,sale_id,user_id,note)
         VALUES (?,?,'in',?,?,?,?,?,?)`).bind(it.drug_id, it.batch_id, it.qty_units, bal, s.customer_name, id, user.id, `${kind} sale ${s.sale_no}: ${reason}`));
    }
  }
  if (s.balance_due > 0 && s.customer_id) {
    stmts.push(db.prepare('UPDATE customers SET credit_balance = MAX(0, credit_balance - ?) WHERE id=?').bind(s.balance_due, s.customer_id));
  }
  stmts.push(db.prepare(`UPDATE sales SET status=?, void_reason=?, voided_by=?, voided_at=datetime('now') WHERE id=?`).bind(kind, reason, user.id, id));
  stmts.push(auditStmt(db, user, kind === 'voided' ? 'sale_voided' : 'sale_refunded', 'sale', s.sale_no, { reason, total: s.total }));
  await db.batch(stmts);
  
  // Notify owner of refunds/voids
  const pharmacy = await q.first(db, 'SELECT owner_user_id, id FROM pharmacy WHERE id=?', s.pharmacy_id);
  if (pharmacy && pharmacy.owner_user_id) {
    await notifyOwner(db, pharmacy.owner_user_id, {
      pharmacyId: pharmacy.id,
      type: 'warning',
      category: 'sales',
      title: `Sale ${kind === 'voided' ? 'Voided' : 'Refunded'}`,
      message: `Sale ${s.sale_no} was ${kind} by ${user.name}. Reason: ${reason}. Amount: KES ${money(s.total)}`,
      metadata: { sale_no: s.sale_no, sale_id: id, kind, reason, total: s.total, voided_by: user.name },
      requiresAction: false
    });
  }
  
  return c.json({ ok: true });
});

// ---------- customers + credit ----------
app.get('/customers', async (c) => {
  const is_system_owner = c.get('is_system_owner');
  const pharmacy_id = c.get('pharmacy_id');
  const search = str(c.req.query('q'));
  const debtors = c.req.query('debtors') === '1';
  const where = [];
  const args = [];
  
  // Pharmacy filtering
  if (is_system_owner) {
    const filterPharmacy = int(c.req.query('pharmacy_id'));
    if (filterPharmacy) {
      where.push('pharmacy_id = ?');
      args.push(filterPharmacy);
    }
  } else {
    where.push('pharmacy_id = ?');
    args.push(pharmacy_id);
  }
  
  if (search) { where.push('(name LIKE ? OR phone LIKE ?)'); args.push(`%${search}%`, `%${search}%`); }
  if (debtors) where.push('credit_balance > 0');
  const rows = await q.all(c.env.DB, `SELECT * FROM customers ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${debtors ? 'credit_balance DESC' : 'name'} LIMIT 200`, ...args);
  return c.json({ customers: rows });
});

app.post('/customers/:id/payment', SELLERS, async (c) => {
  const id = int(c.req.param('id'));
  const b = await body(c);
  const cu = await q.first(c.env.DB, 'SELECT * FROM customers WHERE id=?', id);
  if (!cu) throw new HttpError(404, 'Customer not found');
  const amount = money(num(b.amount));
  if (amount <= 0) throw bad('Enter an amount.');
  if (amount > cu.credit_balance + 0.001) throw bad(`${cu.name} owes only KES ${cu.credit_balance}.`);
  const method = ['cash', 'mpesa', 'card'].includes(b.method) ? b.method : 'cash';
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE customers SET credit_balance = credit_balance - ? WHERE id=?').bind(amount, id),
    c.env.DB.prepare(`INSERT INTO payments (sale_id,customer_id,method,amount,reference,received_by) VALUES (NULL,?,'credit_payment',?,?,?)`)
      .bind(id, amount, `${method}${str(b.reference, 60) ? ' ' + str(b.reference, 60) : ''}`, c.get('user').id),
    auditStmt(c.env.DB, c.get('user'), 'credit_payment', 'customer', id, { amount, method }),
  ]);
  return c.json({ ok: true });
});

export default app;
