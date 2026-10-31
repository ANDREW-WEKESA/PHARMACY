// End-to-end API test. Run against a FRESH local database:  npm run test:api
const BASE = process.env.BASE || 'http://localhost:8787';
let pass = 0, fail = 0;
const ok = (cond, msg) => { cond ? pass++ : (fail++, console.log('  FAIL:', msg)); if (cond) console.log('  ok  :', msg); };
async function api(method, path, body, token) {
  const r = await fetch(BASE + '/api' + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
}
const future = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);

console.log('Setup + auth');
let r = await api('GET', '/setup/status'); ok(r.body.needsSetup === true, 'fresh database needs setup');
r = await api('GET', '/drugs'); ok(r.status === 401, 'API is locked without a token');
r = await api('POST', '/setup', { pharmacy_name: 'Test Chemist Ltd', owner_name: 'Owner One', owner_email: 'owner@test.co.ke', password: 'short' });
ok(r.status === 400, 'weak password rejected');
r = await api('POST', '/setup', { pharmacy_name: 'Test Chemist Ltd', licence_no: 'PPB/123', owner_name: 'Owner One', owner_email: 'owner@test.co.ke', password: 'Passw0rd!x' });
ok(r.status === 200 && r.body.token, 'setup creates pharmacy + owner');
const owner = r.body.token;
r = await api('POST', '/setup', { pharmacy_name: 'Again', owner_name: 'x', owner_email: 'x@x.com', password: 'Passw0rd!x' }); ok(r.status === 409, 'setup cannot run twice');
r = await api('POST', '/auth/login', { identifier: 'owner@test.co.ke', password: 'wrong-pass' }); ok(r.status === 401, 'wrong password rejected');
r = await api('POST', '/auth/login', { identifier: 'OWNER@test.co.ke', password: 'Passw0rd!x' }); ok(r.status === 200, 'login works (case-insensitive email)');

console.log('Users and roles');
r = await api('POST', '/users', { name: 'Pat Pharmacist', email: 'pat@test.co.ke', password: 'Passw0rd!x', role: 'pharmacist', reg_no: 'PPB-77' }, owner); ok(r.status === 201, 'owner creates pharmacist');
r = await api('POST', '/users', { name: 'Cathy Cashier', phone: '0712345678', password: 'Passw0rd!x', role: 'cashier' }, owner); ok(r.status === 201, 'owner creates cashier (phone login)');
r = await api('POST', '/users', { name: 'Sam Clerk', email: 'sam@test.co.ke', password: 'Passw0rd!x', role: 'stock_clerk' }, owner); ok(r.status === 201, 'owner creates stock clerk');
const login = async (id) => (await api('POST', '/auth/login', { identifier: id, password: 'Passw0rd!x' })).body.token;
const pharm = await login('pat@test.co.ke'), cash = await login('0712345678'), clerk = await login('sam@test.co.ke');
ok(pharm && cash && clerk, 'all roles can sign in (cashier by phone 0712345678)');
r = await api('POST', '/users', { name: 'X', email: 'x@x.com', password: 'Passw0rd!x', role: 'cashier' }, cash); ok(r.status === 403, 'cashier cannot create users');

console.log('Catalogue and stock');
r = await api('POST', '/suppliers', { name: 'Kenya Medical Supplies', phone: '0700000000' }, pharm); const supplier = r.body.id; ok(r.status === 201, 'supplier created');
const mk = async (d) => (await api('POST', '/drugs', d, pharm)).body.id;
const para = await mk({ brand_name: 'Panadol', generic_name: 'Paracetamol', strength: '500mg', dosage_form: 'Tablet', pack_size: 20, allow_split: 1, drug_class: 'OTC', buying_price: 100, selling_price: 200, reorder_level: 20, barcode: '6001' });
const amox = await mk({ brand_name: 'Amoxil', generic_name: 'Amoxicillin', strength: '500mg', pack_size: 10, allow_split: 0, drug_class: 'POM', buying_price: 150, selling_price: 300, reorder_level: 10 });
const mor = await mk({ brand_name: 'Morphine Sulphate', generic_name: 'Morphine', strength: '10mg', pack_size: 10, allow_split: 0, drug_class: 'CONTROLLED', buying_price: 500, selling_price: 900, reorder_level: 2 });
ok(para && amox && mor, 'three drugs created (OTC, POM, controlled)');
r = await api('POST', '/drugs', { brand_name: 'Dup', barcode: '6001' }, pharm); ok(r.status === 409, 'duplicate barcode blocked');
r = await api('POST', '/drugs', { brand_name: 'Nope' }, cash); ok(r.status === 403, 'cashier cannot create drugs');
r = await api('POST', '/deliveries', { supplier_id: supplier, invoice_no: 'INV-1', amount_paid: 500, items: [
  { drug_id: para, batch_no: 'P-OLD', expiry_date: future(40), packs: 5, buying_price: 100, selling_price: 200 },
  { drug_id: para, batch_no: 'P-NEW', expiry_date: future(400), packs: 10, buying_price: 100, selling_price: 200 },
  { drug_id: amox, batch_no: 'A-1', expiry_date: future(300), packs: 10, buying_price: 150, selling_price: 300 },
  { drug_id: mor, batch_no: 'M-1', expiry_date: future(300), packs: 3, buying_price: 500, selling_price: 900 },
] }, clerk);
ok(r.status === 201, 'stock clerk receives a delivery with 4 lines'); const deliveryTotal = r.body.total_cost;
ok(deliveryTotal === 5 * 100 + 10 * 100 + 10 * 150 + 3 * 500, `delivery total is right (${deliveryTotal})`);
r = await api('POST', '/deliveries', { items: [{ drug_id: para, batch_no: 'X', expiry_date: '2020-01-01', packs: 1 }] }, clerk); ok(r.status === 400, 'already-expired batch rejected');
r = await api('GET', '/drugs/' + para, null, pharm); ok(r.body.drug.stock_units === 300, 'Panadol stock = 15 packs x 20 = 300 units');

console.log('Selling');
r = await api('POST', '/sales', { items: [{ drug_id: para, qty_units: 30 }], payments: [{ method: 'cash', amount: 1000 }] }, cash);
ok(r.status === 201, 'cashier sells OTC drug'); const sale1 = r.body;
ok(sale1.total === 300 && sale1.change === 700, `30 loose units x KES 10 = 300, change 700 (got total ${sale1.total}, change ${sale1.change})`);
r = await api('GET', '/sales/' + sale1.id, null, cash); const items = r.body.items;
ok(items.length === 1 && items[0].batch_no === 'P-OLD', 'FEFO: oldest-expiry batch sold first');
r = await api('GET', '/stock?status=instock&q=Panadol', null, pharm); const old = r.body.batches.find((b) => b.batch_no === 'P-OLD');
ok(old.qty_units === 70, `P-OLD reduced from 100 to 70 (got ${old.qty_units})`);
r = await api('POST', '/sales', { items: [{ drug_id: para, qty_units: 95 }], payments: [{ method: 'cash', amount: 950 }] }, cash);
ok(r.status === 201, 'sale spanning two batches works'); const sale2 = r.body;
r = await api('GET', '/sales/' + sale2.id, null, cash); ok(r.body.items.length === 2, 'sale split across 2 batches (70 + 25)');
r = await api('POST', '/sales', { items: [{ drug_id: amox, qty_units: 5 }], payments: [{ method: 'cash', amount: 500 }] }, cash); ok(r.status === 400, 'cannot sell part of a pack when splitting is off');
r = await api('POST', '/sales', { items: [{ drug_id: amox, qty_units: 10 }], payments: [{ method: 'cash', amount: 300 }] }, cash);
ok(r.status === 400 || r.status === 403, 'prescription drug blocked without prescriber/approval');
r = await api('POST', '/sales', { items: [{ drug_id: amox, qty_units: 10 }], customer: { name: 'Jane Patient', phone: '0722000111' }, prescription: { prescriber_name: 'Dr Mwangi', prescriber_facility: 'Kisii Hospital' }, payments: [{ method: 'cash', amount: 300 }] }, cash);
ok(r.status === 403 && r.body.code === 'approval_required', 'cashier needs pharmacist approval for POM');
r = await api('POST', '/sales', { items: [{ drug_id: amox, qty_units: 10 }], customer: { name: 'Jane Patient', phone: '0722000111' }, prescription: { prescriber_name: 'Dr Mwangi', prescriber_facility: 'Kisii Hospital' }, approval: { identifier: 'pat@test.co.ke', password: 'bad' }, payments: [{ method: 'cash', amount: 300 }] }, cash);
ok(r.status === 403 && r.body.code === 'approval_failed', 'wrong pharmacist login rejected');
r = await api('POST', '/sales', { items: [{ drug_id: amox, qty_units: 10 }], customer: { name: 'Jane Patient', phone: '0722000111' }, prescription: { prescriber_name: 'Dr Mwangi', prescriber_facility: 'Kisii Hospital' }, approval: { identifier: 'pat@test.co.ke', password: 'Passw0rd!x' }, payments: [{ method: 'cash', amount: 300 }] }, cash);
ok(r.status === 201, 'POM sale approved by pharmacist login'); const saleRx = r.body;
r = await api('POST', '/sales', { items: [{ drug_id: mor, qty_units: 10 }], customer: { name: 'Jane Patient', phone: '0722000111' }, prescription: { prescriber_name: 'Dr Mwangi' }, payments: [{ method: 'cash', amount: 900 }] }, pharm);
ok(r.status === 400, 'controlled drug needs prescriber facility');
r = await api('POST', '/sales', { items: [{ drug_id: mor, qty_units: 10 }], customer: { name: 'Jane Patient', phone: '0722000111' }, prescription: { prescriber_name: 'Dr Mwangi', prescriber_facility: 'Kisii Hospital' }, payments: [{ method: 'mpesa', amount: 900, reference: 'QWE123' }] }, pharm);
ok(r.status === 201, 'pharmacist sells controlled drug'); const saleCtrl = r.body;
r = await api('GET', '/reports/controlled', null, pharm);
const outs = r.body.rows.filter((x) => x.direction === 'out'); ok(r.body.rows.length >= 2 && outs.length === 1, 'controlled register has the receipt and the sale');
ok(r.body.rows[r.body.rows.length - 1].balance_units === 20, `register balance after sale is 20 (got ${r.body.rows[r.body.rows.length - 1].balance_units})`);
r = await api('POST', '/sales', { items: [{ drug_id: para, qty_units: 20 }], discount_percent: 10, discount_reason: 'regular', payments: [{ method: 'cash', amount: 500 }] }, cash);
ok(r.status === 403, 'cashier discount above the 5% limit is blocked');
r = await api('POST', '/sales', { items: [{ drug_id: para, qty_units: 20 }], discount_percent: 4, discount_reason: 'regular', payments: [{ method: 'cash', amount: 500 }] }, cash); ok(r.status === 201 && r.body.total === 192, `4% discount applied (total ${r.body.total})`);
r = await api('POST', '/sales', { items: [{ drug_id: para, qty_units: 20 }], payments: [{ method: 'cash', amount: 100 }] }, cash); ok(r.status === 400, 'part payment without customer details rejected');
r = await api('POST', '/sales', { items: [{ drug_id: para, qty_units: 20 }], customer: { name: 'Mama Mboga', phone: '0733111222' }, payments: [{ method: 'cash', amount: 100 }] }, cash);
ok(r.status === 201 && r.body.balance_due === 100, 'credit sale records balance due 100'); const creditSale = r.body;
r = await api('GET', '/customers?debtors=1', null, cash); ok(r.body.customers.length === 1 && r.body.customers[0].credit_balance === 100, 'debtors list shows Mama Mboga owing 100');
r = await api('POST', `/customers/${r.body.customers[0].id}/payment`, { amount: 60, method: 'mpesa' }, cash); ok(r.status === 200, 'part payment of debt recorded');
r = await api('GET', '/customers?debtors=1', null, cash); ok(r.body.customers[0].credit_balance === 40, 'debt reduced to 40');
r = await api('POST', '/sales', { items: [{ drug_id: para, qty_units: 5000 }], payments: [{ method: 'cash', amount: 99999 }] }, cash); ok(r.status === 400 && /in stock/.test(r.body.error), 'cannot oversell: ' + r.body.error);

console.log('Void, adjustments, expiry');
r = await api('POST', `/sales/${sale1.id}/void`, { reason: 'test' }, cash); ok(r.status === 403, 'cashier cannot void');
r = await api('POST', `/sales/${saleCtrl.id}/void`, { reason: 'wrong patient' }, pharm); ok(r.status === 200, 'pharmacist voids controlled sale');
r = await api('GET', '/drugs/' + mor, null, pharm); ok(r.body.drug.stock_units === 30, 'voided controlled sale returns stock (30 units)');
r = await api('POST', `/sales/${saleCtrl.id}/void`, { reason: 'again' }, pharm); ok(r.status === 400, 'cannot void twice');
r = await api('POST', `/sales/${creditSale.id}/void`, { reason: 'mistake' }, pharm); r = await api('GET', '/customers?debtors=1', null, cash);
ok(r.body.customers.length === 1 && r.body.customers[0].credit_balance === 0 || r.body.customers.length === 0, 'voiding a credit sale cancels the debt');
r = await api('GET', '/stock?status=instock&q=Amoxil', null, pharm); const amoxBatch = r.body.batches[0];
r = await api('POST', '/adjustments', { batch_id: amoxBatch.id, qty_change: -2, reason: 'count_correction' }, clerk); ok(r.status === 403, 'stock clerk cannot do count corrections');
r = await api('POST', '/adjustments', { batch_id: amoxBatch.id, qty_change: 3, reason: 'damage' }, clerk); ok(r.status === 400, 'damage must be a negative quantity');
r = await api('POST', '/adjustments', { batch_id: amoxBatch.id, qty_change: -999, reason: 'damage' }, clerk); ok(r.status === 400, 'cannot remove more than the batch holds');
r = await api('GET', '/stock?status=instock&q=Morphine', null, pharm); const morBatch = r.body.batches[0];
r = await api('POST', '/adjustments', { batch_id: morBatch.id, qty_change: -1, reason: 'damage' }, pharm); ok(r.status === 400, 'controlled adjustment needs a witness');
r = await api('POST', '/adjustments', { batch_id: morBatch.id, qty_change: -1, reason: 'damage', witness: 'Dr Otieno' }, pharm); ok(r.status === 200, 'controlled adjustment with witness works');

console.log('Stock take');
r = await api('POST', '/stocktakes', {}, clerk); ok(r.status === 201, 'stock take started'); const st = r.body.id;
r = await api('GET', '/stocktakes/' + st, null, clerk); const line = r.body.lines.find((l) => l.brand_name === 'Amoxil');
r = await api('PUT', `/stocktakes/${st}/lines`, { lines: [{ id: line.id, counted_qty: line.system_qty - 4 }] }, clerk); ok(r.status === 200, 'clerk enters counts');
r = await api('POST', `/stocktakes/${st}/post`, {}, clerk); ok(r.status === 403, 'clerk cannot post a stock take');
r = await api('POST', `/stocktakes/${st}/post`, {}, pharm); ok(r.status === 200 && r.body.adjusted === 1, 'pharmacist posts stock take, 1 variance adjusted');
r = await api('GET', '/drugs/' + amox, null, pharm); ok(r.body.drug.stock_units === 86, `stock matches the counted quantity (${r.body.drug.stock_units})`);

console.log('History, dashboard, reports, audit');
r = await api('GET', '/sales?q=Panadol', null, cash); ok(r.body.sales.length >= 2, 'search by drug name works');
r = await api('GET', '/sales?q=Jane', null, pharm); ok(r.body.sales.length >= 1, 'search by patient name works');
r = await api('GET', `/sales?q=${sale1.sale_no}`, null, pharm); ok(r.body.total === 1, 'search by sale number works');
r = await api('GET', '/sales?filter=voided', null, pharm); ok(r.body.total === 2, `voided filter shows 2 (got ${r.body.total})`);
r = await api('GET', '/sales?filter=prescription', null, pharm); ok(r.body.total >= 2, 'prescription filter works');
r = await api('GET', '/sales?filter=mpesa', null, pharm); ok(r.body.total >= 1, 'payment-method filter works');
r = await api('GET', '/sales', null, owner); const allCount = r.body.total; r = await api('GET', '/sales', null, cash); ok(r.body.total <= allCount, 'cashier sees only own sales');
r = await api('GET', '/dashboard', null, owner); ok(r.status === 200 && r.body.today.count > 0 && r.body.today.profit !== null, `dashboard today: ${r.body.today.count} sales, KES ${r.body.today.total}, profit ${r.body.today.profit}`);
r = await api('GET', '/dashboard', null, cash); ok(r.status === 200 && r.body.today.profit === null, 'cashier dashboard hides profit');
r = await api('GET', '/dashboard', null, clerk); ok(r.status === 403, 'stock clerk has no sales dashboard');
r = await api('POST', '/deliveries', { items: [{ drug_id: amox, batch_no: 'A-SOON', expiry_date: future(25), packs: 2, buying_price: 150, selling_price: 300 }] }, clerk); ok(r.status === 201, 'second delivery with a short-dated batch');
r = await api('GET', '/stock/alerts', null, pharm); ok(r.status === 200 && r.body.buckets.d30.some((b) => b.batch_no === 'A-SOON') && r.body.buckets.d90.some((b) => b.batch_no === 'A-SOON'), 'short-dated batch (25 days) shows in the 30 and 90 day expiry alerts');
ok(r.body.out.some((d) => d.brand_name === 'Panadol') === false, 'Panadol still has stock so it is not listed as out of stock');
r = await api('GET', '/sales?filter=today', null, owner); ok(r.body.total >= 5, 'today filter uses Nairobi calendar day');
r = await api('GET', '/reports/daily', null, owner); ok(r.body.byCashier.length >= 1, 'daily cash-up report works');
r = await api('GET', '/reports/profit', null, owner); ok(r.body.totals.revenue > 0, 'profit report works');
r = await api('GET', '/reports/profit', null, cash); ok(r.status === 403, 'cashier cannot view profit report');
r = await api('GET', '/reports/stock-valuation', null, pharm); ok(r.body.totals.cost > 0, `stock valuation: cost ${r.body.totals.cost}, retail ${r.body.totals.retail}`);
r = await api('GET', '/reports/payables', null, owner); ok(r.body.total === deliveryTotal - 500 + 300, 'supplier payable = total - paid (including the second unpaid delivery)');
r = await api('GET', '/audit', null, owner); ok(r.body.total > 10, 'audit log has entries');
r = await api('GET', '/audit', null, pharm); ok(r.status === 403, 'only owner sees audit log');
r = await api('GET', '/backup', null, owner); ok(r.body.tables.sales.length > 0 && !JSON.stringify(r.body).includes('password_hash'), 'backup export works and has no password hashes');
r = await api('PUT', '/settings', { vat_rate: 16, max_cashier_discount: 10 }, owner); ok(r.status === 200, 'owner updates settings');
r = await api('PUT', '/users/' + 1, { role: 'cashier' }, owner); ok(r.status === 400, 'last owner cannot be demoted');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
