import { Hono } from 'hono';
import { q, str, int, money, eatDate, eatRange, addDays, isDate, bad } from './lib.js';
import { need } from './routes-core.js';

const app = new Hono();
const MGMT = need('owner', 'pharmacist');
const SALES_VIEW = need('owner', 'pharmacist', 'cashier');

function periodRange(c) {
  const today = eatDate();
  const from = isDate(c.req.query('from')) ? c.req.query('from') : addDays(today, -29);
  const to = isDate(c.req.query('to')) ? c.req.query('to') : today;
  if (from > to) throw bad('The start date is after the end date.');
  return { from, to, range: eatRange(from, to) };
}

// ---------- dashboard ----------
app.get('/dashboard', SALES_VIEW, async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const today = eatDate();
  const yesterday = addDays(today, -1);
  const own = user.role === 'cashier' ? ' AND s.cashier_id = ' + int(user.id) : '';
  const day = async (d) => {
    const [a, z] = eatRange(d);
    return q.first(db,
      `SELECT COUNT(*) n, COALESCE(SUM(s.total),0) total, COALESCE(SUM(s.vat),0) vat FROM sales s
       WHERE s.status='completed' AND s.sale_date >= ? AND s.sale_date < ?${own}`, a, z);
  };
  const t = await day(today);
  const y = await day(yesterday);
  const [ta, tz] = eatRange(today);

  let profit = null;
  if (user.role !== 'cashier') {
    const cost = await q.first(db,
      `SELECT COALESCE(SUM(i.unit_cost * i.qty_units),0) cost FROM sale_items i JOIN sales s ON s.id=i.sale_id
       WHERE s.status='completed' AND s.sale_date >= ? AND s.sale_date < ?`, ta, tz);
    profit = money(t.total - t.vat - cost.cost);
  }

  const periods = { day: [today, today], week: [addDays(today, -6), today], month: [today.slice(0, 8) + '01', today] };
  const top = {};
  for (const [k, [f, tt]] of Object.entries(periods)) {
    const [a, z] = eatRange(f, tt);
    top[k] = await q.all(db,
      `SELECT i.drug_id, d.brand_name, d.strength, SUM(i.qty_units) units, SUM(i.line_total) revenue, d.pack_size
       FROM sale_items i JOIN sales s ON s.id=i.sale_id JOIN drugs d ON d.id=i.drug_id
       WHERE s.status='completed' AND s.sale_date >= ? AND s.sale_date < ?${own}
       GROUP BY i.drug_id ORDER BY revenue DESC LIMIT 8`, a, z);
  }

  const [fa, fz] = eatRange(addDays(today, -13), today);
  const trendRows = await q.all(db,
    `SELECT date(s.sale_date,'+3 hours') day, COUNT(*) n, SUM(s.total) total FROM sales s
     WHERE s.status='completed' AND s.sale_date >= ? AND s.sale_date < ?${own} GROUP BY day`, fa, fz);
  const map = new Map(trendRows.map((r) => [r.day, r]));
  const trend = [];
  for (let i = 13; i >= 0; i--) {
    const d = addDays(today, -i);
    trend.push({ day: d, total: money(map.get(d)?.total || 0), n: map.get(d)?.n || 0 });
  }

  const byMethod = await q.all(db,
    `SELECT p.method, SUM(p.amount) total FROM payments p JOIN sales s ON s.id=p.sale_id
     WHERE s.status='completed' AND s.sale_date >= ? AND s.sale_date < ?${own} GROUP BY p.method ORDER BY total DESC`, ta, tz);

  return c.json({
    today: { count: t.n, total: money(t.total), average: t.n ? money(t.total / t.n) : 0, profit },
    yesterday: { count: y.n, total: money(y.total) },
    top, trend, byMethod,
  });
});

// ---------- daily cash-up ----------
app.get('/reports/daily', SALES_VIEW, async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const date = isDate(c.req.query('date')) ? c.req.query('date') : eatDate();
  const [a, z] = eatRange(date);
  const own = user.role === 'cashier' ? ' AND s.cashier_id = ' + int(user.id) : '';
  const byCashier = await q.all(db,
    `SELECT u.name cashier, COUNT(*) sales, SUM(s.total) total, SUM(s.discount) discount, SUM(s.balance_due) credit
     FROM sales s JOIN users u ON u.id=s.cashier_id
     WHERE s.status='completed' AND s.sale_date >= ? AND s.sale_date < ?${own} GROUP BY s.cashier_id ORDER BY total DESC`, a, z);
  const byMethod = await q.all(db,
    `SELECT u.name cashier, p.method, SUM(p.amount) total FROM payments p JOIN sales s ON s.id=p.sale_id JOIN users u ON u.id=s.cashier_id
     WHERE s.status='completed' AND s.sale_date >= ? AND s.sale_date < ?${own} GROUP BY s.cashier_id, p.method ORDER BY u.name, p.method`, a, z);
  const creditIn = await q.all(db,
    `SELECT p.reference, SUM(p.amount) total FROM payments p WHERE p.method='credit_payment' AND p.sale_id IS NULL
     AND p.paid_at >= ? AND p.paid_at < ? GROUP BY p.reference`, a, z);
  const voided = await q.first(db,
    `SELECT COUNT(*) n, COALESCE(SUM(total),0) total FROM sales s WHERE s.status<>'completed' AND s.sale_date >= ? AND s.sale_date < ?${own}`, a, z);
  return c.json({ date, byCashier, byMethod, creditIn, voided });
});

// ---------- profit ----------
app.get('/reports/profit', MGMT, async (c) => {
  const { from, to, range } = periodRange(c);
  const group = str(c.req.query('group')) || 'drug';
  const key = group === 'category' ? `COALESCE(d.category,'Uncategorised')` : group === 'day' ? `date(s.sale_date,'+3 hours')` : `d.brand_name || COALESCE(' ' || d.strength,'')`;
  const rows = await q.all(c.env.DB,
    `SELECT ${key} label, SUM(i.qty_units) units, SUM(i.line_total) revenue, SUM(i.unit_cost * i.qty_units) cost,
            SUM(i.line_total) - SUM(i.unit_cost * i.qty_units) profit
     FROM sale_items i JOIN sales s ON s.id=i.sale_id JOIN drugs d ON d.id=i.drug_id
     WHERE s.status='completed' AND s.sale_date >= ? AND s.sale_date < ? GROUP BY label ORDER BY ${group === 'day' ? 'label' : 'profit DESC'}`, ...range);
  const totals = rows.reduce((t, r) => ({ revenue: t.revenue + r.revenue, cost: t.cost + r.cost, profit: t.profit + r.profit }), { revenue: 0, cost: 0, profit: 0 });
  const disc = await q.first(c.env.DB,
    `SELECT COALESCE(SUM(discount),0) discount FROM sales WHERE status='completed' AND sale_date >= ? AND sale_date < ?`, ...range);
  return c.json({ from, to, group, rows, totals: { revenue: money(totals.revenue), cost: money(totals.cost), gross_profit: money(totals.profit), discounts: money(disc.discount), net_profit: money(totals.profit - disc.discount) } });
});

// ---------- movers ----------
app.get('/reports/movers', MGMT, async (c) => {
  const db = c.env.DB;
  const days = Math.min(365, Math.max(7, int(c.req.query('days'), 30)));
  const today = eatDate();
  const [a, z] = eatRange(addDays(today, -(days - 1)), today);
  const fast = await q.all(db,
    `SELECT d.id, d.brand_name, d.strength, SUM(i.qty_units) units, SUM(i.line_total) revenue
     FROM sale_items i JOIN sales s ON s.id=i.sale_id JOIN drugs d ON d.id=i.drug_id
     WHERE s.status='completed' AND s.sale_date >= ? AND s.sale_date < ? GROUP BY d.id ORDER BY units DESC LIMIT 20`, a, z);
  const [da] = eatRange(addDays(today, -89), today);
  const dead = await q.all(db,
    `SELECT d.id, d.brand_name, d.strength, SUM(b.qty_units) stock_units, SUM(b.qty_units * b.buying_price / d.pack_size) cost_value,
            MAX((SELECT MAX(s.sale_date) FROM sale_items i JOIN sales s ON s.id=i.sale_id WHERE i.drug_id=d.id AND s.status='completed')) last_sold
     FROM drugs d JOIN batches b ON b.drug_id=d.id AND b.active=1 AND b.qty_units>0
     WHERE d.active=1 AND NOT EXISTS (SELECT 1 FROM sale_items i JOIN sales s ON s.id=i.sale_id WHERE i.drug_id=d.id AND s.status='completed' AND s.sale_date >= ?)
     GROUP BY d.id ORDER BY cost_value DESC LIMIT 50`, da);
  return c.json({ days, fast, dead });
});

// ---------- stock valuation ----------
app.get('/reports/stock-valuation', MGMT, async (c) => {
  const rows = await q.all(c.env.DB,
    `SELECT d.id, d.brand_name, d.strength, d.pack_size, d.category, SUM(b.qty_units) units,
            SUM(b.qty_units * b.buying_price / d.pack_size) cost_value,
            SUM(b.qty_units * (CASE WHEN b.selling_price>0 THEN b.selling_price ELSE d.selling_price END) / d.pack_size) retail_value
     FROM batches b JOIN drugs d ON d.id=b.drug_id WHERE b.active=1 AND b.qty_units>0 GROUP BY d.id ORDER BY d.brand_name`);
  const totals = rows.reduce((t, r) => ({ cost: t.cost + r.cost_value, retail: t.retail + r.retail_value }), { cost: 0, retail: 0 });
  return c.json({ rows: rows.map((r) => ({ ...r, cost_value: money(r.cost_value), retail_value: money(r.retail_value) })),
    totals: { cost: money(totals.cost), retail: money(totals.retail), potential_margin: money(totals.retail - totals.cost) } });
});

// ---------- controlled drugs register ----------
app.get('/reports/controlled', MGMT, async (c) => {
  const { from, to, range } = periodRange(c);
  const drugId = int(c.req.query('drug_id'));
  const rows = await q.all(c.env.DB,
    `SELECT r.*, d.brand_name, d.strength, d.pack_size, b.batch_no, u.name user_name, a.name approved_by_name
     FROM controlled_register r JOIN drugs d ON d.id=r.drug_id LEFT JOIN batches b ON b.id=r.batch_id
     LEFT JOIN users u ON u.id=r.user_id LEFT JOIN users a ON a.id=r.approved_by
     WHERE r.entry_date >= ? AND r.entry_date < ? ${drugId ? 'AND r.drug_id=' + drugId : ''} ORDER BY r.id`, ...range);
  const drugs = await q.all(c.env.DB, `SELECT id, brand_name, strength FROM drugs WHERE drug_class='CONTROLLED' AND active=1 ORDER BY brand_name`);
  return c.json({ from, to, rows, drugs });
});

// ---------- payables ----------
app.get('/reports/payables', MGMT, async (c) => {
  const rows = await q.all(c.env.DB,
    `SELECT d.id, d.invoice_no, d.delivery_date, d.total_cost, d.amount_paid, d.total_cost - d.amount_paid balance, s.name supplier_name
     FROM deliveries d LEFT JOIN suppliers s ON s.id=d.supplier_id WHERE d.total_cost - d.amount_paid > 0.009 ORDER BY d.delivery_date`);
  const total = rows.reduce((t, r) => t + r.balance, 0);
  return c.json({ rows, total: money(total) });
});

export default app;
