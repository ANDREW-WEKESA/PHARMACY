import { useState } from 'react';
import { get, post, qs } from '../api.js';
import { KES, num, fmtDate, eatTime, todayEAT, addDaysStr, METHOD_LABEL, toCSV, download } from '../util.js';
import { PageHead, Spinner, ErrorBox, useLoad, Empty, Badge, Tabs, Modal, Field, useToast } from '../ui.jsx';

export default function Reports({ user, pharmacy }) {
  const mgmt = user.role !== 'cashier';
  const tabs = [{ id: 'daily', label: 'Daily cash-up' }, ...(mgmt ? [{ id: 'profit', label: 'Profit' }, { id: 'valuation', label: 'Stock value' }, { id: 'movers', label: 'Fast & slow movers' }, { id: 'controlled', label: 'Controlled drugs register' }, { id: 'payables', label: 'Supplier balances' }, { id: 'debtors', label: 'Customer debts' }] : [])];
  const [tab, setTab] = useState('daily');
  return (
    <>
      <PageHead icon="🧾" title="Reports" sub="Print or export for the owner, accountant or inspectors">
        <button className="btn ghost" onClick={() => window.print()}>🖨 Print / save as PDF</button>
      </PageHead>
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      <div className="report-print-head"><h2>{pharmacy.name}</h2><div>{pharmacy.address} {pharmacy.licence_no && `· PPB licence ${pharmacy.licence_no}`} {pharmacy.kra_pin && `· PIN ${pharmacy.kra_pin}`}</div></div>
      {tab === 'daily' && <Daily />}{tab === 'profit' && <Profit />}{tab === 'valuation' && <Valuation />}{tab === 'movers' && <Movers />}
      {tab === 'controlled' && <Controlled pharmacy={pharmacy} />}{tab === 'payables' && <Payables />}{tab === 'debtors' && <Debtors />}
    </>
  );
}

const Range = ({ from, to, setFrom, setTo }) => <div className="toolbar"><input type="date" style={{ width: 170 }} value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" /><span>to</span><input type="date" style={{ width: 170 }} value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" />
  {[['Today', 0], ['7 days', 6], ['30 days', 29]].map(([l, n]) => <button key={l} className="btn sm" onClick={() => { setFrom(addDaysStr(todayEAT(), -n)); setTo(todayEAT()); }}>{l}</button>)}</div>;

function Daily() {
  const [date, setDate] = useState(todayEAT());
  const r = useLoad(() => get('/reports/daily' + qs({ date })), [date]);
  const x = r.data;
  const methods = {}; x?.byMethod.forEach((m) => { (methods[m.cashier] ||= {})[m.method] = m.total; });
  const grand = x?.byCashier.reduce((s, c) => s + c.total, 0) || 0;
  return <div className="card"><div className="card-head"><h3>Cash-up for {fmtDate(date)}</h3><input type="date" style={{ width: 170 }} value={date} max={todayEAT()} onChange={(e) => setDate(e.target.value)} aria-label="Date" /></div>
    <ErrorBox error={r.error} retry={r.reload} />{r.loading && !x ? <Spinner /> : x?.byCashier.length === 0 ? <Empty icon="🧾" title="No sales on this day" /> : x && <>
      <div className="table-wrap"><table><thead><tr><th>Cashier</th><th className="r">Sales</th><th className="r">Cash</th><th className="r">M-Pesa</th><th className="r">Card</th><th className="r">Insurance</th><th className="r">Credit given</th><th className="r">Discounts</th><th className="r">Total</th></tr></thead><tbody>
        {x.byCashier.map((c) => <tr key={c.cashier}><td>{c.cashier}</td><td className="r">{c.sales}</td>{['cash', 'mpesa', 'card', 'insurance'].map((m) => <td className="r mono" key={m}>{KES(methods[c.cashier]?.[m] || 0)}</td>)}<td className="r mono">{KES(c.credit)}</td><td className="r mono">{KES(c.discount)}</td><td className="r mono"><strong>{KES(c.total)}</strong></td></tr>)}
        <tr><td colSpan={8}><strong>Total sales</strong></td><td className="r mono"><strong>{KES(grand)}</strong></td></tr></tbody></table></div>
      {x.creditIn.length > 0 && <p className="sub">Debt payments received today: {x.creditIn.map((c) => `${c.reference} ${KES(c.total)}`).join(', ')}</p>}
      {x.voided.n > 0 && <p className="sub">Voided or refunded: {x.voided.n} sale(s), {KES(x.voided.total)}</p>}</>}</div>;
}

function Profit() {
  const [from, setFrom] = useState(addDaysStr(todayEAT(), -29)); const [to, setTo] = useState(todayEAT()); const [group, setGroup] = useState('drug');
  const r = useLoad(() => get('/reports/profit' + qs({ from, to, group })), [from, to, group]); const x = r.data;
  return <div className="card"><Range {...{ from, to, setFrom, setTo }} /><div className="toolbar"><select value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Group by"><option value="drug">By drug</option><option value="category">By category</option><option value="day">By day</option></select>
    <button className="btn sm" disabled={!x?.rows.length} onClick={() => download('profit.csv', toCSV(x.rows, [{ label: 'Item', key: 'label' }, { label: 'Units', key: 'units' }, { label: 'Revenue', key: 'revenue' }, { label: 'Cost', key: 'cost' }, { label: 'Profit', key: 'profit' }]))}>⬇ Export</button></div>
    <ErrorBox error={r.error} retry={r.reload} />{r.loading && !x ? <Spinner /> : x && <>
      <div className="grid g4" style={{ marginBottom: 14 }}>{[['Revenue', x.totals.revenue], ['Cost of goods', x.totals.cost], ['Gross profit', x.totals.gross_profit], ['Net after discounts', x.totals.net_profit]].map(([l, v]) => <div className="stat" key={l} style={{ boxShadow: 'none', border: '1px solid var(--line)' }}><span>{l}</span><strong style={{ fontSize: 21 }}>{KES(v)}</strong></div>)}</div>
      {x.rows.length === 0 ? <Empty icon="📈" title="No sales in this period" /> : <div className="table-wrap"><table><thead><tr><th>Item</th><th className="r">Units</th><th className="r">Revenue</th><th className="r">Cost</th><th className="r">Profit</th><th className="r">Margin</th></tr></thead><tbody>
        {x.rows.map((p) => <tr key={p.label}><td>{p.label}</td><td className="r">{num(p.units)}</td><td className="r mono">{KES(p.revenue)}</td><td className="r mono">{KES(p.cost)}</td><td className="r mono"><strong>{KES(p.profit)}</strong></td><td className="r">{p.revenue ? Math.round((p.profit / p.revenue) * 100) + '%' : '—'}</td></tr>)}</tbody></table></div>}</>}</div>;
}

function Valuation() {
  const r = useLoad(() => get('/reports/stock-valuation')); const x = r.data;
  return <div className="card"><div className="card-head"><h3>Stock value on hand</h3><button className="btn sm" disabled={!x?.rows.length} onClick={() => download('stock-valuation.csv', toCSV(x.rows, [{ label: 'Drug', value: (d) => d.brand_name + ' ' + (d.strength || '') }, { label: 'Units', key: 'units' }, { label: 'Cost value', key: 'cost_value' }, { label: 'Retail value', key: 'retail_value' }]))}>⬇ Export</button></div>
    <ErrorBox error={r.error} retry={r.reload} />{r.loading && !x ? <Spinner /> : x && (x.rows.length === 0 ? <Empty icon="📦" title="No stock on hand" /> : <>
      <div className="grid g3" style={{ marginBottom: 14 }}>{[['At cost', x.totals.cost], ['At selling price', x.totals.retail], ['Potential margin', x.totals.potential_margin]].map(([l, v]) => <div className="stat" key={l} style={{ boxShadow: 'none', border: '1px solid var(--line)' }}><span>{l}</span><strong style={{ fontSize: 21 }}>{KES(v)}</strong></div>)}</div>
      <div className="table-wrap"><table><thead><tr><th>Drug</th><th className="r">Units</th><th className="r">Cost value</th><th className="r">Retail value</th></tr></thead><tbody>{x.rows.map((d) => <tr key={d.id}><td>{d.brand_name} {d.strength}</td><td className="r">{num(d.units)}</td><td className="r mono">{KES(d.cost_value)}</td><td className="r mono">{KES(d.retail_value)}</td></tr>)}</tbody></table></div></>)}</div>;
}

function Movers() {
  const r = useLoad(() => get('/reports/movers?days=30')); const x = r.data;
  return <div className="grid g2"><div className="card"><h3>Fast movers (last 30 days)</h3><ErrorBox error={r.error} retry={r.reload} />{r.loading && !x ? <Spinner /> : x?.fast.length === 0 ? <Empty icon="📈" title="No sales yet" /> : <div className="table-wrap"><table><thead><tr><th>Drug</th><th className="r">Units sold</th><th className="r">Revenue</th></tr></thead><tbody>{x?.fast.map((d) => <tr key={d.id}><td>{d.brand_name} {d.strength}</td><td className="r">{num(d.units)}</td><td className="r mono">{KES(d.revenue)}</td></tr>)}</tbody></table></div>}</div>
    <div className="card"><h3>Dead stock (no sale in 90 days)</h3>{r.loading && !x ? <Spinner /> : x?.dead.length === 0 ? <Empty icon="✅" title="No dead stock" /> : <div className="table-wrap"><table><thead><tr><th>Drug</th><th className="r">Units</th><th className="r">Tied up (cost)</th><th>Last sold</th></tr></thead><tbody>{x?.dead.map((d) => <tr key={d.id}><td>{d.brand_name} {d.strength}</td><td className="r">{num(d.stock_units)}</td><td className="r mono">{KES(d.cost_value)}</td><td>{d.last_sold ? eatTime(d.last_sold, false) && fmtDate(d.last_sold.slice(0, 10)) : 'Never'}</td></tr>)}</tbody></table></div>}</div></div>;
}

function Controlled({ pharmacy }) {
  const [from, setFrom] = useState(addDaysStr(todayEAT(), -29)); const [to, setTo] = useState(todayEAT()); const [drug, setDrug] = useState('');
  const r = useLoad(() => get('/reports/controlled' + qs({ from, to, drug_id: drug })), [from, to, drug]); const x = r.data;
  return <div className="card"><div className="card-head"><h3>Controlled drugs register</h3></div>
    <div className="report-print-head"><div>Superintendent pharmacist: {pharmacy.superintendent_name} {pharmacy.superintendent_reg_no && `(${pharmacy.superintendent_reg_no})`}</div></div>
    <Range {...{ from, to, setFrom, setTo }} /><div className="toolbar"><select value={drug} onChange={(e) => setDrug(e.target.value)} aria-label="Drug"><option value="">All controlled drugs</option>{x?.drugs.map((d) => <option key={d.id} value={d.id}>{d.brand_name} {d.strength}</option>)}</select>
      <button className="btn sm" disabled={!x?.rows.length} onClick={() => download('controlled-register.csv', toCSV(x.rows, [{ label: 'Date', key: 'entry_date' }, { label: 'Drug', value: (e) => e.brand_name + ' ' + (e.strength || '') }, { label: 'Batch', key: 'batch_no' }, { label: 'In/Out', key: 'direction' }, { label: 'Quantity', key: 'qty_units' }, { label: 'Balance', key: 'balance_units' }, { label: 'Patient', key: 'patient_name' }, { label: 'Phone', key: 'patient_phone' }, { label: 'Prescriber', key: 'prescriber_name' }, { label: 'Facility', key: 'prescriber_facility' }, { label: 'Dispensed by', key: 'user_name' }, { label: 'Approved by', key: 'approved_by_name' }, { label: 'Note', key: 'note' }]))}>⬇ Export</button></div>
    <ErrorBox error={r.error} retry={r.reload} />{r.loading && !x ? <Spinner /> : x?.rows.length === 0 ? <Empty icon="🔒" title="No controlled drug movements" sub="Receipts, sales and adjustments appear here automatically." /> :
      <div className="table-wrap"><table><thead><tr><th>Date</th><th>Drug / batch</th><th>In / out</th><th className="r">Qty</th><th className="r">Balance</th><th>Patient</th><th>Prescriber</th><th>Dispensed / approved</th><th>Note</th></tr></thead><tbody>
        {x?.rows.map((e) => <tr key={e.id}><td>{eatTime(e.entry_date)}</td><td>{e.brand_name} {e.strength}<div className="sub">{e.batch_no}</div></td><td>{e.direction === 'in' ? <Badge kind="ok">In</Badge> : <Badge kind="bad">Out</Badge>}</td><td className="r">{e.qty_units}</td><td className="r"><strong>{e.balance_units}</strong></td>
          <td>{e.patient_name}<div className="sub">{e.patient_phone}</div></td><td>{e.prescriber_name}<div className="sub">{e.prescriber_facility}</div></td><td>{e.user_name}{e.approved_by_name && <div className="sub">Approved: {e.approved_by_name}</div>}</td><td className="sub">{e.note}</td></tr>)}</tbody></table></div>}</div>;
}

function Payables() {
  const r = useLoad(() => get('/reports/payables')); const x = r.data;
  return <div className="card"><h3>Supplier balances (what we owe)</h3><ErrorBox error={r.error} retry={r.reload} />{r.loading && !x ? <Spinner /> : x?.rows.length === 0 ? <Empty icon="✅" title="No unpaid deliveries" /> : <><div className="warnbox">Total owed to suppliers: {KES(x?.total)}</div>
    <div className="table-wrap"><table><thead><tr><th>Supplier</th><th>Invoice</th><th>Date</th><th className="r">Total</th><th className="r">Paid</th><th className="r">Balance</th></tr></thead><tbody>{x?.rows.map((d) => <tr key={d.id}><td>{d.supplier_name || '—'}</td><td>{d.invoice_no}</td><td>{fmtDate(d.delivery_date)}</td><td className="r mono">{KES(d.total_cost)}</td><td className="r mono">{KES(d.amount_paid)}</td><td className="r mono"><strong>{KES(d.balance)}</strong></td></tr>)}</tbody></table></div></>}</div>;
}

function Debtors() {
  const toast = useToast();
  const r = useLoad(() => get('/customers?debtors=1')); const rows = r.data?.customers || [];
  const [pay, setPay] = useState(null); const [f, setF] = useState({ amount: '', method: 'cash', reference: '' }); const [err, setErr] = useState('');
  const save = async () => { setErr(''); try { await post(`/customers/${pay.id}/payment`, { amount: Number(f.amount), method: f.method, reference: f.reference }); toast('Payment recorded'); setPay(null); r.reload(); } catch (e) { setErr(e.message); } };
  return <div className="card"><h3>Customers who owe money</h3><ErrorBox error={r.error} retry={r.reload} />{r.loading && !r.data ? <Spinner /> : rows.length === 0 ? <Empty icon="✅" title="Nobody owes the pharmacy" /> : <>
    <div className="warnbox">Total receivable: {KES(rows.reduce((s, c) => s + c.credit_balance, 0))}</div>
    <div className="table-wrap"><table><thead><tr><th>Customer</th><th>Phone</th><th className="r">Owes</th><th /></tr></thead><tbody>{rows.map((c) => <tr key={c.id}><td>{c.name}</td><td>{c.phone}</td><td className="r mono"><strong>{KES(c.credit_balance)}</strong></td><td><button className="btn sm" onClick={() => { setPay(c); setF({ amount: String(c.credit_balance), method: 'cash', reference: '' }); setErr(''); }}>Record payment</button></td></tr>)}</tbody></table></div></>}
    {pay && <Modal title={`Payment from ${pay.name}`} onClose={() => setPay(null)} footer={<><button className="btn" onClick={() => setPay(null)}>Cancel</button><button className="btn primary" onClick={save}>Save payment</button></>}>
      <p>Owes {KES(pay.credit_balance)}.</p><div className="form-grid"><Field label="Amount (KES)"><input type="number" min="0" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} autoFocus /></Field>
      <Field label="Method"><select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}><option value="cash">Cash</option><option value="mpesa">M-Pesa</option><option value="card">Card</option></select></Field>
      <Field label="Reference" className="full"><input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} placeholder="M-Pesa code (optional)" /></Field></div><ErrorBox error={err} /></Modal>}
  </div>;
}
