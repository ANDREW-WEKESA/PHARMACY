import { Hono } from 'hono';
import {
  q, audit, auditStmt, bad, HttpError, str, num, int, money, isDate, eatDate, nowUtc, DRUG_CLASSES,
} from './lib.js';
import { need, body } from './routes-core.js';
import { notifyOwner, detectAbnormalStock } from './notification-service.js';

const app = new Hono();
const WRITE = need('owner', 'pharmacist');

// units currently on hand (all active batches, expired included) for a drug
export async function drugTotalUnits(db, drugId) {
  const r = await q.first(db, 'SELECT COALESCE(SUM(qty_units),0) n FROM batches WHERE drug_id=? AND active=1', drugId);
  return r.n;
}
export function registerStmt(db, { drug_id, batch_id, direction, qty_units, balance_units, patient_name, patient_phone,
  prescriber_name, prescriber_facility, sale_id_sql, user_id, approved_by, note }) {
  return db.prepare(
    `INSERT INTO controlled_register (drug_id,batch_id,direction,qty_units,balance_units,patient_name,patient_phone,
       prescriber_name,prescriber_facility,sale_id,user_id,approved_by,note)
     VALUES (?,?,?,?,?,?,?,?,?,${sale_id_sql || 'NULL'},?,?,?)`)
    .bind(drug_id, batch_id ?? null, direction, qty_units, balance_units, patient_name ?? null, patient_phone ?? null,
      prescriber_name ?? null, prescriber_facility ?? null, user_id ?? null, approved_by ?? null, note ?? null);
}

// ---------- drugs ----------
const STOCK_JOIN = `
  LEFT JOIN (
    SELECT drug_id,
      SUM(CASE WHEN expiry_date >= ? THEN qty_units ELSE 0 END) units,
      SUM(CASE WHEN expiry_date <  ? THEN qty_units ELSE 0 END) expired_units,
      MIN(CASE WHEN qty_units > 0 AND expiry_date >= ? THEN expiry_date END) next_expiry
    FROM batches WHERE active=1 GROUP BY drug_id
  ) s ON s.drug_id = d.id`;

app.get('/drugs', async (c) => {
  const today = eatDate();
  const is_system_owner = c.get('is_system_owner');
  const pharmacy_id = c.get('pharmacy_id');
  const search = str(c.req.query('q'));
  const cls = str(c.req.query('class'));
  const active = c.req.query('active');
  const inStock = c.req.query('in_stock') === '1';
  const limit = Math.min(500, Math.max(1, int(c.req.query('limit'), 200)));
  const where = [];
  const args = [today, today, today];
  
  // Pharmacy filtering
  if (is_system_owner) {
    const filterPharmacy = int(c.req.query('pharmacy_id'));
    if (filterPharmacy) {
      where.push('d.pharmacy_id = ?');
      args.push(filterPharmacy);
    }
  } else {
    where.push('d.pharmacy_id = ?');
    args.push(pharmacy_id);
  }
  
  if (active !== 'all') where.push('d.active = 1');
  if (search) {
    where.push('(d.brand_name LIKE ? OR d.generic_name LIKE ? OR d.barcode = ? OR d.category LIKE ?)');
    args.push(`%${search}%`, `%${search}%`, search, `%${search}%`);
  }
  if (DRUG_CLASSES.includes(cls)) { where.push('d.drug_class = ?'); args.push(cls); }
  if (inStock) where.push('COALESCE(s.units,0) > 0');
  const rows = await q.all(c.env.DB,
    `SELECT d.*, COALESCE(s.units,0) stock_units, COALESCE(s.expired_units,0) expired_units, s.next_expiry,
            sp.name preferred_supplier
     FROM drugs d ${STOCK_JOIN} LEFT JOIN suppliers sp ON sp.id = d.preferred_supplier_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY (d.barcode = ?) DESC, d.brand_name LIMIT ${limit}`, ...args, search || '');
  return c.json({ drugs: rows });
});

app.get('/drugs/:id', async (c) => {
  const id = int(c.req.param('id'));
  const today = eatDate();
  const d = await q.first(c.env.DB,
    `SELECT d.*, COALESCE(s.units,0) stock_units, COALESCE(s.expired_units,0) expired_units, s.next_expiry
     FROM drugs d ${STOCK_JOIN} WHERE d.id=?`, today, today, today, id);
  if (!d) throw new HttpError(404, 'Drug not found');
  const batches = await q.all(c.env.DB, `SELECT * FROM batches WHERE drug_id=? AND active=1 ORDER BY expiry_date`, id);
  const prices = await q.all(c.env.DB, 'SELECT * FROM price_history WHERE drug_id=? ORDER BY id DESC LIMIT 20', id);
  const alternatives = d.generic_name
    ? await q.all(c.env.DB, `SELECT id,brand_name,strength,selling_price FROM drugs WHERE active=1 AND id<>? AND lower(generic_name)=lower(?) ORDER BY brand_name LIMIT 20`, id, d.generic_name)
    : [];
  return c.json({ drug: d, batches, prices, alternatives });
});

function cleanDrug(b, pharmacy, existing = {}) {
  const brand = str(b.brand_name ?? existing.brand_name, 160);
  if (!brand) throw bad('Enter the drug\'s brand name.');
  const cls = str(b.drug_class ?? existing.drug_class ?? 'OTC');
  if (!DRUG_CLASSES.includes(cls)) throw bad('Choose a valid drug class.');
  const pack = Math.max(1, int(b.pack_size ?? existing.pack_size ?? 1, 1));
  const buying = money(Math.max(0, num(b.buying_price ?? existing.buying_price)));
  const selling = money(Math.max(0, num(b.selling_price ?? existing.selling_price)));
  if (selling > 0 && buying > selling) {
    // allowed (loss leader) but flag it clearly rather than blocking
  }
  return {
    brand_name: brand,
    generic_name: str(b.generic_name ?? existing.generic_name, 160) || null,
    strength: str(b.strength ?? existing.strength, 60) || null,
    dosage_form: str(b.dosage_form ?? existing.dosage_form, 60) || null,
    pack_size: pack,
    unit_name: str(b.unit_name ?? existing.unit_name ?? 'pack', 30) || 'pack',
    allow_split: (b.allow_split ?? existing.allow_split) ? 1 : 0,
    category: str(b.category ?? existing.category, 80) || null,
    manufacturer: str(b.manufacturer ?? existing.manufacturer, 120) || null,
    barcode: str(b.barcode ?? existing.barcode, 60) || null,
    drug_class: cls,
    storage: str(b.storage ?? existing.storage, 120) || null,
    buying_price: buying,
    selling_price: selling,
    vat_applicable: (b.vat_applicable ?? existing.vat_applicable) ? 1 : 0,
    reorder_level: Math.max(0, int(b.reorder_level ?? existing.reorder_level ?? pharmacy.default_reorder_level)),
    preferred_supplier_id: int(b.preferred_supplier_id ?? existing.preferred_supplier_id, 0) || null,
    notes: str(b.notes ?? existing.notes, 1000) || null,
  };
}
const DRUG_COLS = ['brand_name', 'generic_name', 'strength', 'dosage_form', 'pack_size', 'unit_name', 'allow_split', 'category',
  'manufacturer', 'barcode', 'drug_class', 'storage', 'buying_price', 'selling_price', 'vat_applicable', 'reorder_level',
  'preferred_supplier_id', 'notes'];

app.post('/drugs', WRITE, async (c) => {
  const pharmacy_id = c.get('pharmacy_id');
  const is_system_owner = c.get('is_system_owner');
  
  // System owners must have a pharmacy selected
  if (is_system_owner && !pharmacy_id) {
    throw bad('Please select a pharmacy before adding drugs.');
  }
  
  const pharmacy = await q.first(c.env.DB, 'SELECT * FROM pharmacy WHERE id=?', pharmacy_id || 1);
  const d = cleanDrug(await body(c), pharmacy);
  if (d.barcode) {
    const dup = await q.first(c.env.DB, 'SELECT id FROM drugs WHERE barcode=? AND pharmacy_id=? AND active=1', d.barcode, pharmacy_id || 1);
    if (dup) throw new HttpError(409, 'Another drug already uses that barcode.');
  }
  const r = await q.run(c.env.DB, `INSERT INTO drugs (${DRUG_COLS.join(',')}, pharmacy_id) VALUES (${DRUG_COLS.map(() => '?').join(',')}, ?)`,
    ...DRUG_COLS.map((k) => d[k]), pharmacy_id || 1);
  const id = r.meta.last_row_id;
  await q.run(c.env.DB, 'INSERT INTO price_history (drug_id,buying_price,selling_price,changed_by) VALUES (?,?,?,?)',
    id, d.buying_price, d.selling_price, c.get('user').id);
  await audit(c.env.DB, c.get('user'), 'drug_created', 'drug', id, d.brand_name);
  return c.json({ id }, 201);
});

app.put('/drugs/:id', WRITE, async (c) => {
  const id = int(c.req.param('id'));
  const pharmacy_id = c.get('pharmacy_id');
  const is_system_owner = c.get('is_system_owner');
  const old = await q.first(c.env.DB, 'SELECT * FROM drugs WHERE id=? AND (pharmacy_id = ? OR ? = 1)', id, pharmacy_id, is_system_owner ? 1 : 0);
  if (!old) throw new HttpError(404, 'Drug not found');
  const pharmacy = await q.first(c.env.DB, 'SELECT * FROM pharmacy WHERE id=?', old.pharmacy_id);
  const b = await body(c);
  const d = cleanDrug(b, pharmacy, old);
  if (d.barcode) {
    const dup = await q.first(c.env.DB, 'SELECT id FROM drugs WHERE barcode=? AND pharmacy_id=? AND active=1 AND id<>?', d.barcode, old.pharmacy_id, id);
    if (dup) throw new HttpError(409, 'Another drug already uses that barcode.');
  }
  const active = b.active == null ? old.active : b.active ? 1 : 0;
  await q.run(c.env.DB, `UPDATE drugs SET ${DRUG_COLS.map((k) => k + '=?').join(',')}, active=? WHERE id=?`,
    ...DRUG_COLS.map((k) => d[k]), active, id);
  if (d.buying_price !== old.buying_price || d.selling_price !== old.selling_price) {
    await q.run(c.env.DB, 'INSERT INTO price_history (drug_id,buying_price,selling_price,changed_by) VALUES (?,?,?,?)',
      id, d.buying_price, d.selling_price, c.get('user').id);
    await audit(c.env.DB, c.get('user'), 'price_changed', 'drug', id,
      { from: [old.buying_price, old.selling_price], to: [d.buying_price, d.selling_price] });
  }
  await audit(c.env.DB, c.get('user'), active ? 'drug_updated' : 'drug_deactivated', 'drug', id, d.brand_name);
  return c.json({ ok: true });
});

// Bulk import: rows already parsed from CSV/Excel by the browser
app.post('/drugs/import', WRITE, async (c) => {
  const pharmacy_id = c.get('pharmacy_id');
  const is_system_owner = c.get('is_system_owner');
  
  if (is_system_owner && !pharmacy_id) {
    throw bad('Please select a pharmacy before importing drugs.');
  }
  
  const pharmacy = await q.first(c.env.DB, 'SELECT * FROM pharmacy WHERE id=?', pharmacy_id || 1);
  const b = await body(c);
  const rows = Array.isArray(b.rows) ? b.rows : [];
  if (!rows.length) throw bad('No rows to import.');
  if (rows.length > 2000) throw bad('Import up to 2,000 drugs at a time.');
  let created = 0, updated = 0;
  const errors = [];
  const stmts = [];
  for (let i = 0; i < rows.length; i++) {
    try {
      const d = cleanDrug(rows[i], pharmacy);
      const existing = await q.first(c.env.DB,
        `SELECT * FROM drugs WHERE pharmacy_id=? AND active=1 AND ((? IS NOT NULL AND barcode=?) OR (lower(brand_name)=lower(?) AND COALESCE(strength,'')=COALESCE(?,'')))`  ,
        pharmacy_id || 1, d.barcode, d.barcode, d.brand_name, d.strength);
      if (existing) {
        const m = cleanDrug(rows[i], pharmacy, existing);
        stmts.push(c.env.DB.prepare(`UPDATE drugs SET ${DRUG_COLS.map((k) => k + '=?').join(',')} WHERE id=?`).bind(...DRUG_COLS.map((k) => m[k]), existing.id));
        if (m.selling_price !== existing.selling_price || m.buying_price !== existing.buying_price) {
          stmts.push(c.env.DB.prepare('INSERT INTO price_history (drug_id,buying_price,selling_price,changed_by) VALUES (?,?,?,?)')
            .bind(existing.id, m.buying_price, m.selling_price, c.get('user').id));
        }
        updated++;
      } else {
        stmts.push(c.env.DB.prepare(`INSERT INTO drugs (${DRUG_COLS.join(',')}, pharmacy_id) VALUES (${DRUG_COLS.map(() => '?').join(',')}, ?)`).bind(...DRUG_COLS.map((k) => d[k]), pharmacy_id || 1));
        stmts.push(c.env.DB.prepare('INSERT INTO price_history (drug_id,buying_price,selling_price,changed_by) VALUES ((SELECT MAX(id) FROM drugs),?,?,?)')
          .bind(d.buying_price, d.selling_price, c.get('user').id));
        created++;
      }
    } catch (e) {
      errors.push({ row: i + 1, error: e.message });
    }
  }
  for (let i = 0; i < stmts.length; i += 90) await c.env.DB.batch(stmts.slice(i, i + 90));
  await audit(c.env.DB, c.get('user'), 'drugs_imported', 'drug', null, { created, updated, errors: errors.length });
  return c.json({ created, updated, errors });
});

// ---------- suppliers ----------
app.get('/suppliers', async (c) => {
  const is_system_owner = c.get('is_system_owner');
  const pharmacy_id = c.get('pharmacy_id');
  
  let wherePharmacy = '';
  const args = [];
  if (is_system_owner) {
    const filterPharmacy = int(c.req.query('pharmacy_id'));
    if (filterPharmacy) {
      wherePharmacy = 'WHERE s.pharmacy_id = ?';
      args.push(filterPharmacy);
    }
  } else {
    wherePharmacy = 'WHERE s.pharmacy_id = ?';
    args.push(pharmacy_id);
  }
  
  const rows = await q.all(c.env.DB,
    `SELECT s.*, COALESCE((SELECT SUM(total_cost - amount_paid) FROM deliveries d WHERE d.supplier_id = s.id),0) balance
     FROM suppliers s ${wherePharmacy} AND s.active=1 ORDER BY s.name`, ...args);
  return c.json({ suppliers: rows });
});
app.post('/suppliers', need('owner', 'pharmacist', 'stock_clerk'), async (c) => {
  const pharmacy_id = c.get('pharmacy_id');
  const is_system_owner = c.get('is_system_owner');
  
  if (is_system_owner && !pharmacy_id) {
    throw bad('Please select a pharmacy before adding suppliers.');
  }
  
  const b = await body(c);
  const name = str(b.name, 120);
  if (!name) throw bad('Enter the supplier\'s name.');
  const r = await q.run(c.env.DB, 'INSERT INTO suppliers (name,contact_person,phone,email,address,pharmacy_id) VALUES (?,?,?,?,?,?)',
    name, str(b.contact_person) || null, str(b.phone, 30) || null, str(b.email) || null, str(b.address) || null, pharmacy_id || 1);
  await audit(c.env.DB, c.get('user'), 'supplier_created', 'supplier', r.meta.last_row_id, name);
  return c.json({ id: r.meta.last_row_id }, 201);
});
app.put('/suppliers/:id', WRITE, async (c) => {
  const id = int(c.req.param('id'));
  const b = await body(c);
  const s = await q.first(c.env.DB, 'SELECT * FROM suppliers WHERE id=?', id);
  if (!s) throw new HttpError(404, 'Supplier not found');
  await q.run(c.env.DB, 'UPDATE suppliers SET name=?,contact_person=?,phone=?,email=?,address=?,active=? WHERE id=?',
    str(b.name, 120) || s.name, b.contact_person !== undefined ? str(b.contact_person) || null : s.contact_person,
    b.phone !== undefined ? str(b.phone, 30) || null : s.phone, b.email !== undefined ? str(b.email) || null : s.email,
    b.address !== undefined ? str(b.address) || null : s.address, b.active == null ? s.active : b.active ? 1 : 0, id);
  return c.json({ ok: true });
});

// ---------- stock (batches) ----------
app.get('/stock', async (c) => {
  const today = eatDate();
  const pharmacy = await q.first(c.env.DB, 'SELECT expiry_warn_days FROM pharmacy WHERE id=1');
  const warnUntil = eatDate(Date.now() + pharmacy.expiry_warn_days * 86400000);
  const status = str(c.req.query('status'));
  const search = str(c.req.query('q'));
  const where = ['b.active = 1'];
  const args = [];
  if (search) {
    where.push('(d.brand_name LIKE ? OR d.generic_name LIKE ? OR b.batch_no LIKE ? OR d.barcode = ?)');
    args.push(`%${search}%`, `%${search}%`, `%${search}%`, search);
  }
  if (status === 'expired') { where.push('b.expiry_date < ? AND b.qty_units > 0'); args.push(today); }
  else if (status === 'expiring') { where.push('b.expiry_date >= ? AND b.expiry_date <= ? AND b.qty_units > 0'); args.push(today, warnUntil); }
  else if (status === 'instock') where.push('b.qty_units > 0');
  else if (status !== 'all') where.push('(b.qty_units > 0 OR b.expiry_date >= ?)') && args.push(today);
  const rows = await q.all(c.env.DB,
    `SELECT b.*, d.brand_name, d.generic_name, d.strength, d.pack_size, d.unit_name, d.drug_class, d.reorder_level,
            sp.name supplier_name
     FROM batches b JOIN drugs d ON d.id=b.drug_id LEFT JOIN suppliers sp ON sp.id=b.supplier_id
     WHERE ${where.join(' AND ')} ORDER BY d.brand_name, b.expiry_date LIMIT 1000`, ...args);
  return c.json({ batches: rows, today, warnUntil });
});

// Low / out of stock and expiry summary (used by dashboard + reorder list)
app.get('/stock/alerts', async (c) => {
  const today = eatDate();
  const is_system_owner = c.get('is_system_owner');
  const pharmacy_id = c.get('pharmacy_id');
  
  let wherePharmacy = '';
  const args = [today, today, today];
  if (is_system_owner) {
    const filterPharmacy = int(c.req.query('pharmacy_id'));
    if (filterPharmacy) {
      wherePharmacy = ' AND d.pharmacy_id = ?';
      args.push(filterPharmacy);
    }
  } else {
    wherePharmacy = ' AND d.pharmacy_id = ?';
    args.push(pharmacy_id);
  }
  
  const pharmacy = await q.first(c.env.DB, 'SELECT expiry_warn_days FROM pharmacy WHERE id=?', pharmacy_id || 1);
  const low = await q.all(c.env.DB,
    `SELECT d.id, d.brand_name, d.strength, d.reorder_level, d.pack_size, d.preferred_supplier_id, sp.name supplier_name,
            COALESCE(s.units,0) stock_units
     FROM drugs d ${STOCK_JOIN} LEFT JOIN suppliers sp ON sp.id=d.preferred_supplier_id
     WHERE d.active=1${wherePharmacy} AND COALESCE(s.units,0) <= d.reorder_level ORDER BY COALESCE(s.units,0), d.brand_name`, ...args);
  const buckets = {};
  for (const [k, days] of [['d30', 30], ['d60', 60], ['d90', 90]]) {
    const bucketArgs = [today, eatDate(Date.now() + days * 86400000)];
    if (wherePharmacy) bucketArgs.push(args[args.length - 1]);
    buckets[k] = await q.all(c.env.DB,
      `SELECT b.id batch_id, b.batch_no, b.expiry_date, b.qty_units, d.brand_name, d.strength
       FROM batches b JOIN drugs d ON d.id=b.drug_id
       WHERE b.active=1 AND b.qty_units>0 AND b.expiry_date >= ? AND b.expiry_date <= ?${wherePharmacy} ORDER BY b.expiry_date`,
      ...bucketArgs);
  }
  const expiredArgs = [today];
  if (wherePharmacy) expiredArgs.push(args[args.length - 1]);
  const expired = await q.all(c.env.DB,
    `SELECT b.id batch_id, b.batch_no, b.expiry_date, b.qty_units, d.brand_name, d.strength
     FROM batches b JOIN drugs d ON d.id=b.drug_id WHERE b.active=1 AND b.qty_units>0 AND b.expiry_date < ?${wherePharmacy} ORDER BY b.expiry_date`, ...expiredArgs);
  return c.json({ low: low.filter((r) => r.stock_units > 0), out: low.filter((r) => r.stock_units <= 0), buckets, expired,
    warnDays: pharmacy.expiry_warn_days });
});

// ---------- deliveries (goods received) ----------
app.get('/deliveries', async (c) => {
  const rows = await q.all(c.env.DB,
    `SELECT d.*, s.name supplier_name, u.name received_by_name,
            (SELECT COUNT(*) FROM batches b WHERE b.delivery_id=d.id) lines
     FROM deliveries d LEFT JOIN suppliers s ON s.id=d.supplier_id LEFT JOIN users u ON u.id=d.received_by
     ORDER BY d.id DESC LIMIT 200`);
  return c.json({ deliveries: rows });
});

app.get('/deliveries/:id', async (c) => {
  const id = int(c.req.param('id'));
  const d = await q.first(c.env.DB, `SELECT d.*, s.name supplier_name FROM deliveries d LEFT JOIN suppliers s ON s.id=d.supplier_id WHERE d.id=?`, id);
  if (!d) throw new HttpError(404, 'Delivery not found');
  const items = await q.all(c.env.DB,
    `SELECT b.*, dr.brand_name, dr.strength, dr.pack_size FROM batches b JOIN drugs dr ON dr.id=b.drug_id WHERE b.delivery_id=?`, id);
  return c.json({ delivery: d, items });
});

app.post('/deliveries', need('owner', 'pharmacist', 'stock_clerk'), async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const b = await body(c);
  const items = Array.isArray(b.items) ? b.items : [];
  if (!items.length) throw bad('Add at least one item to the delivery.');
  if (items.length > 100) throw bad('A delivery can have up to 100 lines.');
  const date = isDate(b.delivery_date) ? b.delivery_date : eatDate();
  const today = eatDate();
  const supplierId = int(b.supplier_id, 0) || null;
  if (supplierId && !(await q.first(db, 'SELECT id FROM suppliers WHERE id=? AND active=1', supplierId))) throw bad('Supplier not found.');

  const drugCache = new Map();
  const balances = new Map(); // running controlled balances for this delivery
  let total = 0;
  const stmts = [];
  const lines = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const n = i + 1;
    const did = int(it.drug_id);
    if (!drugCache.has(did)) drugCache.set(did, await q.first(db, 'SELECT * FROM drugs WHERE id=? AND active=1', did));
    const drug = drugCache.get(did);
    if (!drug) throw bad(`Line ${n}: drug not found.`);
    const batchNo = str(it.batch_no, 60);
    if (!batchNo) throw bad(`Line ${n} (${drug.brand_name}): enter the batch number.`);
    if (!isDate(it.expiry_date)) throw bad(`Line ${n} (${drug.brand_name}): enter a valid expiry date.`);
    if (it.expiry_date < today) throw bad(`Line ${n} (${drug.brand_name}): this batch is already expired and cannot be received.`);
    const packs = Math.max(0, int(it.packs));
    const loose = Math.max(0, int(it.loose_units));
    if (loose && !drug.allow_split && loose >= drug.pack_size) throw bad(`Line ${n} (${drug.brand_name}): loose units must be less than one pack.`);
    const units = packs * drug.pack_size + loose;
    if (units <= 0) throw bad(`Line ${n} (${drug.brand_name}): enter a quantity.`);
    const buy = money(Math.max(0, num(it.buying_price, drug.buying_price)));
    const sell = money(Math.max(0, num(it.selling_price, drug.selling_price)));
    total += (units / drug.pack_size) * buy;
    lines.push({ drug, batchNo, expiry: it.expiry_date, units, buy, sell });
  }
  total = money(total);
  const paid = Math.min(total, money(Math.max(0, num(b.amount_paid))));

  stmts.push(db.prepare('INSERT INTO deliveries (supplier_id,invoice_no,delivery_date,total_cost,amount_paid,notes,received_by) VALUES (?,?,?,?,?,?,?)')
    .bind(supplierId, str(b.invoice_no, 60) || null, date, total, paid, str(b.notes, 500) || null, user.id));
  for (const l of lines) {
    stmts.push(db.prepare(
      `INSERT INTO batches (drug_id,batch_no,expiry_date,qty_units,buying_price,selling_price,supplier_id,delivery_id)
       VALUES (?,?,?,?,?,?,?,(SELECT MAX(id) FROM deliveries))
       ON CONFLICT(drug_id,batch_no,expiry_date) DO UPDATE SET qty_units = qty_units + excluded.qty_units,
         buying_price = excluded.buying_price, selling_price = excluded.selling_price, active = 1,
         delivery_id = excluded.delivery_id, supplier_id = excluded.supplier_id`)
      .bind(l.drug.id, l.batchNo, l.expiry, l.units, l.buy, l.sell, supplierId));
    if (l.buy !== l.drug.buying_price || l.sell !== l.drug.selling_price) {
      stmts.push(db.prepare('UPDATE drugs SET buying_price=?, selling_price=? WHERE id=?').bind(l.buy, l.sell, l.drug.id));
      stmts.push(db.prepare('INSERT INTO price_history (drug_id,buying_price,selling_price,changed_by) VALUES (?,?,?,?)')
        .bind(l.drug.id, l.buy, l.sell, user.id));
      l.drug.buying_price = l.buy; l.drug.selling_price = l.sell;
    }
    if (l.drug.drug_class === 'CONTROLLED') {
      if (!balances.has(l.drug.id)) balances.set(l.drug.id, await drugTotalUnits(db, l.drug.id));
      const bal = balances.get(l.drug.id) + l.units;
      balances.set(l.drug.id, bal);
      stmts.push(db.prepare(
        `INSERT INTO controlled_register (drug_id,batch_id,direction,qty_units,balance_units,user_id,note)
         VALUES (?, (SELECT id FROM batches WHERE drug_id=? AND batch_no=? AND expiry_date=?), 'in', ?, ?, ?, ?)`)
        .bind(l.drug.id, l.drug.id, l.batchNo, l.expiry, l.units, bal, user.id, `Received. Invoice ${str(b.invoice_no, 60) || 'n/a'}`));
    }
  }
  stmts.push(auditStmt(db, user, 'delivery_received', 'delivery', null, { supplier_id: supplierId, invoice: b.invoice_no || null, lines: lines.length, total }));
  await db.batch(stmts);
  const d = await q.first(db, 'SELECT MAX(id) id FROM deliveries');
  return c.json({ id: d.id, total_cost: total }, 201);
});

app.post('/deliveries/:id/payment', WRITE, async (c) => {
  const id = int(c.req.param('id'));
  const b = await body(c);
  const d = await q.first(c.env.DB, 'SELECT * FROM deliveries WHERE id=?', id);
  if (!d) throw new HttpError(404, 'Delivery not found');
  const amount = money(num(b.amount));
  if (amount <= 0) throw bad('Enter an amount.');
  if (amount > money(d.total_cost - d.amount_paid) + 0.001) throw bad('That is more than the outstanding balance.');
  await q.run(c.env.DB, 'UPDATE deliveries SET amount_paid = amount_paid + ? WHERE id=?', amount, id);
  await audit(c.env.DB, c.get('user'), 'supplier_payment', 'delivery', id, { amount });
  return c.json({ ok: true });
});

// ---------- adjustments ----------
const NEGATIVE = ['damage', 'expired', 'loss', 'return_to_supplier'];
const CLERK_OK = ['damage', 'expired', 'loss'];

app.get('/adjustments', async (c) => {
  const rows = await q.all(c.env.DB,
    `SELECT a.*, d.brand_name, d.strength, b.batch_no, b.expiry_date, u.name user_name
     FROM stock_adjustments a JOIN drugs d ON d.id=a.drug_id JOIN batches b ON b.id=a.batch_id JOIN users u ON u.id=a.user_id
     ORDER BY a.id DESC LIMIT 300`);
  return c.json({ adjustments: rows });
});

async function adjustStatements(db, user, batch, drug, change, reason, note, witness, balanceHolder) {
  const stmts = [
    db.prepare('UPDATE batches SET qty_units = qty_units + ? WHERE id=?').bind(change, batch.id),
    db.prepare('INSERT INTO stock_adjustments (batch_id,drug_id,qty_change,reason,note,user_id,witness) VALUES (?,?,?,?,?,?,?)')
      .bind(batch.id, drug.id, change, reason, note || null, user.id, witness || null),
    auditStmt(db, user, 'stock_adjusted', 'batch', batch.id, { drug: drug.brand_name, batch: batch.batch_no, change, reason }),
  ];
  if (drug.drug_class === 'CONTROLLED') {
    if (balanceHolder.value == null) balanceHolder.value = await drugTotalUnits(db, drug.id);
    balanceHolder.value += change;
    stmts.push(registerStmt(db, {
      drug_id: drug.id, batch_id: batch.id, direction: change < 0 ? 'out' : 'in', qty_units: Math.abs(change),
      balance_units: balanceHolder.value, user_id: user.id, note: `Adjustment: ${reason}${witness ? '; witness ' + witness : ''}${note ? '; ' + note : ''}`,
    }));
  }
  return stmts;
}

app.post('/adjustments', need('owner', 'pharmacist', 'stock_clerk'), async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const b = await body(c);
  const reason = str(b.reason);
  const change = int(b.qty_change);
  if (!['damage', 'expired', 'loss', 'count_correction', 'return_to_supplier', 'customer_return', 'other'].includes(reason)) throw bad('Choose a reason.');
  if (user.role === 'stock_clerk' && !CLERK_OK.includes(reason)) throw new HttpError(403, 'Stock clerks can record damage, expiry and loss only.');
  if (!change) throw bad('Enter the quantity to add or remove.');
  if (NEGATIVE.includes(reason) && change > 0) throw bad('This reason removes stock, so the quantity must be negative.');
  if (reason === 'customer_return' && change < 0) throw bad('A customer return adds stock back, so the quantity must be positive.');
  const batch = await q.first(db, 'SELECT * FROM batches WHERE id=? AND active=1', int(b.batch_id));
  if (!batch) throw new HttpError(404, 'Batch not found');
  if (batch.qty_units + change < 0) throw bad(`Only ${batch.qty_units} units are in this batch.`);
  const drug = await q.first(db, 'SELECT * FROM drugs WHERE id=?', batch.drug_id);
  const witness = str(b.witness, 120);
  if (drug.drug_class === 'CONTROLLED' && !witness) throw bad('Controlled drugs need a witness name for every adjustment.');
  if (reason === 'other' && !str(b.note)) throw bad('Add a note explaining this adjustment.');
  const stmts = await adjustStatements(db, user, batch, drug, change, reason, str(b.note, 300), witness, { value: null });
  await db.batch(stmts);
  
  // Notify owner of abnormal adjustments
  if (detectAbnormalStock({ qty_change: change })) {
    const pharmacy = await q.first(db, 'SELECT owner_user_id, id FROM pharmacy WHERE id=?', drug.pharmacy_id);
    if (pharmacy && pharmacy.owner_user_id) {
      await notifyOwner(db, pharmacy.owner_user_id, {
        pharmacyId: pharmacy.id,
        type: 'warning',
        category: 'stock',
        title: 'Large Stock Adjustment',
        message: `${drug.brand_name}${drug.strength ? ' ' + drug.strength : ''}: ${change > 0 ? '+' : ''}${change} units adjusted. Reason: ${reason}`,
        metadata: { drug_id: drug.id, drug_name: drug.brand_name, qty_change: change, reason, batch_no: batch.batch_no },
        requiresAction: false
      });
    }
  }
  
  return c.json({ ok: true });
});

// ---------- stock take ----------
app.get('/stocktakes', async (c) => {
  const rows = await q.all(c.env.DB,
    `SELECT t.*, u.name started_by_name,
       (SELECT COUNT(*) FROM stock_take_lines l WHERE l.stock_take_id=t.id) lines,
       (SELECT COUNT(*) FROM stock_take_lines l WHERE l.stock_take_id=t.id AND l.counted_qty IS NOT NULL) counted
     FROM stock_takes t LEFT JOIN users u ON u.id=t.started_by ORDER BY t.id DESC LIMIT 50`);
  return c.json({ stocktakes: rows });
});

app.post('/stocktakes', need('owner', 'pharmacist', 'stock_clerk'), async (c) => {
  const db = c.env.DB;
  const open = await q.first(db, `SELECT id FROM stock_takes WHERE status='open'`);
  if (open) throw new HttpError(409, 'Finish or post the open stock take first.', { id: open.id });
  const r = await q.run(db, 'INSERT INTO stock_takes (started_by) VALUES (?)', c.get('user').id);
  const id = r.meta.last_row_id;
  await q.run(db, `INSERT INTO stock_take_lines (stock_take_id,batch_id,system_qty)
                   SELECT ?, b.id, b.qty_units FROM batches b WHERE b.active=1 AND b.qty_units>0`, id);
  await audit(db, c.get('user'), 'stocktake_started', 'stocktake', id, null);
  return c.json({ id }, 201);
});

app.get('/stocktakes/:id', async (c) => {
  const id = int(c.req.param('id'));
  const t = await q.first(c.env.DB, 'SELECT * FROM stock_takes WHERE id=?', id);
  if (!t) throw new HttpError(404, 'Stock take not found');
  const lines = await q.all(c.env.DB,
    `SELECT l.*, d.brand_name, d.strength, d.pack_size, b.batch_no, b.expiry_date, b.qty_units current_qty
     FROM stock_take_lines l JOIN batches b ON b.id=l.batch_id JOIN drugs d ON d.id=b.drug_id
     WHERE l.stock_take_id=? ORDER BY d.brand_name, b.expiry_date`, id);
  return c.json({ stocktake: t, lines });
});

app.put('/stocktakes/:id/lines', need('owner', 'pharmacist', 'stock_clerk'), async (c) => {
  const id = int(c.req.param('id'));
  const t = await q.first(c.env.DB, 'SELECT * FROM stock_takes WHERE id=?', id);
  if (!t || t.status !== 'open') throw bad('This stock take is closed.');
  const b = await body(c);
  const lines = Array.isArray(b.lines) ? b.lines : [];
  const stmts = lines.slice(0, 500).map((l) =>
    c.env.DB.prepare('UPDATE stock_take_lines SET counted_qty=? WHERE id=? AND stock_take_id=?')
      .bind(l.counted_qty === null || l.counted_qty === '' || l.counted_qty === undefined ? null : Math.max(0, int(l.counted_qty)), int(l.id), id));
  if (stmts.length) await c.env.DB.batch(stmts);
  return c.json({ ok: true });
});

app.post('/stocktakes/:id/post', WRITE, async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const id = int(c.req.param('id'));
  const t = await q.first(db, 'SELECT * FROM stock_takes WHERE id=?', id);
  if (!t || t.status !== 'open') throw bad('This stock take is already posted.');
  const lines = await q.all(db,
    `SELECT l.*, b.qty_units current_qty FROM stock_take_lines l JOIN batches b ON b.id=l.batch_id
     WHERE l.stock_take_id=? AND l.counted_qty IS NOT NULL`, id);
  const stmts = [];
  const balances = new Map();
  let adjusted = 0;
  for (const l of lines) {
    const diff = l.counted_qty - l.current_qty;
    if (!diff) continue;
    const batch = await q.first(db, 'SELECT * FROM batches WHERE id=?', l.batch_id);
    const drug = await q.first(db, 'SELECT * FROM drugs WHERE id=?', batch.drug_id);
    const holder = { get value() { return balances.get(drug.id) ?? null; }, set value(v) { balances.set(drug.id, v); } };
    stmts.push(...(await adjustStatements(db, user, batch, drug, diff, 'count_correction', `Stock take #${id}`, drug.drug_class === 'CONTROLLED' ? user.name : null, holder)));
    adjusted++;
  }
  stmts.push(db.prepare(`UPDATE stock_takes SET status='posted', posted_by=?, posted_at=datetime('now') WHERE id=?`).bind(user.id, id));
  stmts.push(auditStmt(db, user, 'stocktake_posted', 'stocktake', id, { adjusted }));
  for (let i = 0; i < stmts.length; i += 90) await db.batch(stmts.slice(i, i + 90));
  return c.json({ adjusted });
});

export default app;
