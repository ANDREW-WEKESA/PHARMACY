import { useEffect, useMemo, useRef, useState } from 'react';
import { get, post, qs } from '../api.js';
import { KES, num, eatTime, fmtDate, METHOD_LABEL, CLASS_LABEL, packsText, toCSV, download, todayEAT, addDaysStr } from '../util.js';
import { PageHead, Spinner, ErrorBox, useLoad, useDebounced, Empty, Badge, Modal, Field, Confirm, useToast } from '../ui.jsx';

const FILTERS = [
  ['all', 'All Sales'], ['today', 'Today'], ['week', 'Last 7 days'], ['month', 'This month'], ['range', 'Date range…'],
  ['cash', 'Paid by cash'], ['mpesa', 'Paid by M-Pesa'], ['card', 'Paid by card'], ['insurance', 'Paid by insurance'],
  ['credit', 'Credit (owed)'], ['prescription', 'Prescription sales'], ['controlled', 'Controlled drugs'], ['voided', 'Voided / refunded'],
];

export default function Sales({ user, pharmacy }) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [from, setFrom] = useState(addDaysStr(todayEAT(), -6));
  const [to, setTo] = useState(todayEAT());
  const [cashier, setCashier] = useState('');
  const [page, setPage] = useState(1);
  const [selling, setSelling] = useState(false);
  const [openId, setOpenId] = useState(null);
  const dq = useDebounced(search);
  const staff = useLoad(() => (user.role === 'cashier' ? Promise.resolve(null) : get('/users')), []);
  useEffect(() => setPage(1), [dq, filter, from, to, cashier]);
  const list = useLoad(() => get('/sales' + qs({ q: dq, filter, from: filter === 'range' ? from : '', to: filter === 'range' ? to : '', cashier, page, page_size: 25 })), [dq, filter, from, to, cashier, page]);
  const d = list.data;
  const pages = d ? Math.max(1, Math.ceil(d.total / d.pageSize)) : 1;

  const exportCsv = async () => {
    const all = await get('/sales' + qs({ q: dq, filter, from: filter === 'range' ? from : '', to: filter === 'range' ? to : '', cashier, page: 1, page_size: 100 }));
    download('sales.csv', toCSV(all.sales, [
      { label: 'Sale no', key: 'sale_no' }, { label: 'Date (UTC)', key: 'sale_date' }, { label: 'Cashier', key: 'cashier_name' },
      { label: 'Customer', key: 'customer_name' }, { label: 'Items', key: 'items' }, { label: 'Total', key: 'total' },
      { label: 'Balance due', key: 'balance_due' }, { label: 'Payment', key: 'methods' }, { label: 'Status', key: 'status' }]));
  };

  return (
    <>
      <PageHead icon="💊" title="Sales History" sub="Complete record of all pharmacy transactions" />
      <div className="glass">
        <div className="toolbar" style={{ marginBottom: 10 }}>
          <div className="searchbox grow"><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="🔍 Search patient, sale #, or drug…" aria-label="Search sales" /></div>
          <select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter sales" style={{ background: '#1f2340', color: '#fff', border: 'none' }}>
            {FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          {staff.data && <select value={cashier} onChange={(e) => setCashier(e.target.value)} aria-label="Filter by cashier" style={{ background: '#1f2340', color: '#fff', border: 'none' }}>
            <option value="">All cashiers</option>{staff.data.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>}
        </div>
        {filter === 'range' && <div className="toolbar"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 170 }} aria-label="From date" /><span>to</span><input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 170 }} aria-label="To date" /></div>}
        <button className="btn primary wide" onClick={() => setSelling(true)}>+ New Sale</button>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, gap: 10, flexWrap: 'wrap' }}>
          <button className="btn sm ghost" onClick={exportCsv} disabled={!d || !d.total}>⬇ Export CSV</button>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {d && d.total > 0 && <span style={{ opacity: .95, fontWeight: 600 }}>Completed total: {KES(d.sum_total)}</span>}
            <span className="badge" style={{ background: 'rgba(255,255,255,.3)', color: '#fff', fontSize: 14, padding: '8px 14px' }}>{d ? d.total : 0} transaction{d?.total === 1 ? '' : 's'}</span>
          </div>
        </div>
      </div>

      <ErrorBox error={list.error} retry={list.reload} />
      {list.loading && !d && <Spinner />}
      {d && d.total === 0 && (
        <div className="glass"><Empty icon="💊" title="No sales found" sub={dq || filter !== 'all' || cashier ? 'Nothing matches your search or filter.' : 'No sales recorded yet'} />
          {(dq || filter !== 'all' || cashier) && <div style={{ textAlign: 'center' }}><button className="btn ghost" onClick={() => { setSearch(''); setFilter('all'); setCashier(''); }}>Clear search and filters</button></div>}</div>
      )}
      {d && d.total > 0 && (
        <div className="card">
          <div className="table-wrap"><table className="resp">
            <thead><tr><th>Sale #</th><th>Date</th><th>Customer</th><th>Items</th><th>Payment</th><th className="r">Total</th><th>Status</th></tr></thead>
            <tbody>{d.sales.map((s) => (
              <tr key={s.id} className="clickable" onClick={() => setOpenId(s.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setOpenId(s.id)}>
                <td data-label="Sale #"><strong>{s.sale_no}</strong><div className="sub">{s.cashier_name}</div></td>
                <td data-label="Date">{eatTime(s.sale_date)}</td>
                <td data-label="Customer">{s.customer_name || <span className="sub">Walk-in</span>}{s.customer_phone && <div className="sub">{s.customer_phone}</div>}</td>
                <td data-label="Items" style={{ maxWidth: 280 }}>{s.items}{s.has_controlled ? <> <Badge kind="bad">Controlled</Badge></> : s.has_prescription ? <> <Badge kind="info">Rx</Badge></> : null}</td>
                <td data-label="Payment">{(s.methods || '').split(',').filter(Boolean).map((m) => METHOD_LABEL[m] || m).join(', ') || <span className="sub">—</span>}</td>
                <td className="r mono" data-label="Total"><strong>{KES(s.total)}</strong>{s.balance_due > 0 && <div className="sub" style={{ color: 'var(--bad)' }}>Owes {KES(s.balance_due)}</div>}</td>
                <td data-label="Status">{s.status === 'completed' ? <Badge kind="ok">Completed</Badge> : <Badge kind="bad">{s.status === 'voided' ? 'Voided' : 'Refunded'}</Badge>}</td>
              </tr>))}</tbody>
          </table></div>
          <div className="pager"><button className="btn sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Previous</button><span>Page {page} of {pages}</span><button className="btn sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next →</button></div>
        </div>
      )}

      {selling && <NewSale user={user} pharmacy={pharmacy} onClose={() => setSelling(false)} onDone={(id) => { setSelling(false); list.reload(); setOpenId(id); }} />}
      {openId && <SaleDetail id={openId} user={user} onClose={() => setOpenId(null)} onChanged={list.reload} />}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* New sale (point of sale)                                           */
/* ------------------------------------------------------------------ */
function NewSale({ user, pharmacy, onClose, onDone }) {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const dq = useDebounced(search, 200);
  const [cart, setCart] = useState([]); // { drug, units }
  const [cust, setCust] = useState({ name: '', phone: '' });
  const [rx, setRx] = useState({ prescriber_name: '', prescriber_facility: '', prescription_date: todayEAT() });
  const [approval, setApproval] = useState({ identifier: '', password: '' });
  const [discPct, setDiscPct] = useState(''); const [discReason, setDiscReason] = useState('');
  const [pays, setPays] = useState([{ method: 'cash', amount: '', reference: '' }]);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);
  const res = useLoad(() => get('/drugs' + qs({ q: dq, limit: 40 })), [dq]);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const price = (d) => d.selling_price / d.pack_size; // per loose unit
  const add = (drug, units) => {
    const step = units ?? drug.pack_size;
    if (drug.stock_units <= 0) return toast(`${drug.brand_name} is out of stock`, 'err');
    setCart((c) => {
      const i = c.findIndex((l) => l.drug.id === drug.id);
      if (i >= 0) { const n = [...c]; n[i] = { ...n[i], units: Math.min(drug.stock_units, n[i].units + step) }; return n; }
      return [...c, { drug, units: Math.min(drug.stock_units, step) }];
    });
    setSearch(''); inputRef.current?.focus();
  };
  const onEnter = (e) => {
    if (e.key !== 'Enter' || !search) return;
    const hit = res.data?.drugs.find((d) => d.barcode === search) || (res.data?.drugs.length === 1 ? res.data.drugs[0] : null);
    if (hit) { e.preventDefault(); add(hit); }
  };
  const setUnits = (i, v) => setCart((c) => c.map((l, k) => k === i ? { ...l, units: Math.max(0, Math.min(l.drug.stock_units, Math.floor(Number(v) || 0))) } : l));
  const step = (l) => (l.drug.allow_split ? 1 : l.drug.pack_size);

  const lines = cart.map((l) => ({ ...l, total: price(l.drug) * l.units }));
  const subtotal = lines.reduce((s, l) => s + l.total, 0);
  const pct = Math.min(100, Math.max(0, Number(discPct) || 0));
  const discount = Math.round(subtotal * pct) / 100;
  const total = Math.round((subtotal - discount) * 100) / 100;
  const paid = pays.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const change = Math.max(0, paid - total), due = Math.max(0, total - paid);
  const hasRx = cart.some((l) => ['POM', 'CONTROLLED'].includes(l.drug.drug_class));
  const hasCtrl = cart.some((l) => l.drug.drug_class === 'CONTROLLED');
  const isCashier = user.role === 'cashier';
  const nearExpiry = cart.filter((l) => l.drug.next_expiry && (Date.parse(l.drug.next_expiry) - Date.now()) / 86400000 < 30);

  const submit = async () => {
    setErr('');
    if (!cart.length || cart.some((l) => l.units <= 0)) return setErr('Add items and set a quantity for each.');
    setBusy(true);
    try {
      const r = await post('/sales', {
        items: cart.map((l) => ({ drug_id: l.drug.id, qty_units: l.units })),
        customer: cust, prescription: hasRx ? rx : undefined, approval: hasRx && isCashier ? approval : undefined,
        discount_percent: pct || undefined, discount_reason: discReason,
        payments: pays.map((p) => ({ method: p.method, amount: Number(p.amount) || 0, reference: p.reference })),
      });
      toast(`Sale ${r.sale_no} saved` + (r.change ? `. Give change ${KES(r.change)}` : ''));
      onDone(r.id);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <Modal title="New Sale" onClose={onClose} wide footer={<>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={busy || !cart.length} onClick={submit}>{busy ? 'Saving…' : `Complete sale · ${KES(total)}`}</button></>}>
      <div className="pos">
        <div>
          <Field label="Find a drug (name, generic or scan barcode)"><input ref={inputRef} value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={onEnter} placeholder="Type or scan, press Enter to add" /></Field>
          <div className="pos-results" style={{ marginTop: 10 }}>
            {res.loading && !res.data && <Spinner />}
            {res.data && res.data.drugs.length === 0 && <Empty icon="🔎" title="No drug found" sub="Check the spelling or add it in Drug Catalog" />}
            {res.data?.drugs.map((d) => (
              <div key={d.id} className={'pos-item' + (d.stock_units <= 0 ? ' disabled' : '')} tabIndex={0} onClick={() => add(d)} onKeyDown={(e) => e.key === 'Enter' && add(d)}>
                <div><strong>{d.brand_name}</strong> {d.strength}
                  <div className="sub">{d.generic_name} · {d.dosage_form || ''} {d.drug_class !== 'OTC' && d.drug_class !== 'PHARMACY_ONLY' && <Badge kind={d.drug_class === 'CONTROLLED' ? 'bad' : 'info'}>{d.drug_class === 'POM' ? 'Rx' : 'Controlled'}</Badge>}</div></div>
                <div style={{ textAlign: 'right' }}><strong>{KES(d.selling_price)}</strong><div className="sub">{d.stock_units > 0 ? `${packsText(d.stock_units, d)} in stock` : 'Out of stock'}</div></div>
              </div>))}
          </div>
        </div>

        <div>
          <h3 style={{ marginBottom: 6 }}>Cart</h3>
          {cart.length === 0 ? <Empty icon="🛒" title="Cart is empty" sub="Pick a drug on the left" /> : lines.map((l, i) => (
            <div className="cart-line" key={l.drug.id}>
              <div><strong>{l.drug.brand_name}</strong> {l.drug.strength}<div className="sub">{KES(l.drug.selling_price)} per pack{l.drug.pack_size > 1 ? ` of ${l.drug.pack_size}` : ''}{l.drug.allow_split && l.drug.pack_size > 1 ? ` · ${KES(price(l.drug))} per ${l.drug.unit_name === 'pack' ? 'unit' : l.drug.unit_name}` : ''}</div></div>
              <div style={{ textAlign: 'right' }}><strong>{KES(l.total)}</strong></div>
              <div className="qty"><button aria-label="Less" onClick={() => setUnits(i, l.units - step(l))}>−</button>
                <input type="number" min="0" value={l.units} onChange={(e) => setUnits(i, e.target.value)} aria-label="Units" /><button aria-label="More" onClick={() => setUnits(i, l.units + step(l))}>+</button>
                <span className="sub">units {l.drug.pack_size > 1 && `(${packsText(l.units, l.drug)})`}</span></div>
              <div style={{ textAlign: 'right' }}><button className="btn sm" onClick={() => setCart(cart.filter((_, k) => k !== i))}>Remove</button></div>
            </div>))}
          {nearExpiry.length > 0 && <div className="warnbox">⚠️ Short expiry: {nearExpiry.map((l) => `${l.drug.brand_name} (${fmtDate(l.drug.next_expiry)})`).join(', ')}</div>}

          {cart.length > 0 && <>
            <div className="form-grid" style={{ marginTop: 10 }}>
              <Field label={'Customer name' + (hasRx ? ' *' : '')}><input value={cust.name} onChange={(e) => setCust({ ...cust, name: e.target.value })} /></Field>
              <Field label={'Customer phone' + (hasCtrl ? ' *' : '')}><input value={cust.phone} onChange={(e) => setCust({ ...cust, phone: e.target.value })} inputMode="tel" /></Field>
            </div>
            {hasRx && <div className="infobox" style={{ marginTop: 10 }}>
              <strong>{hasCtrl ? 'Controlled drug' : 'Prescription drug'}: prescription details are required.</strong>
              <div className="form-grid" style={{ marginTop: 8 }}>
                <Field label="Prescriber name *"><input value={rx.prescriber_name} onChange={(e) => setRx({ ...rx, prescriber_name: e.target.value })} /></Field>
                <Field label={'Prescriber facility' + (hasCtrl ? ' *' : '')}><input value={rx.prescriber_facility} onChange={(e) => setRx({ ...rx, prescriber_facility: e.target.value })} /></Field>
                <Field label="Prescription date"><input type="date" value={rx.prescription_date} onChange={(e) => setRx({ ...rx, prescription_date: e.target.value })} /></Field>
              </div>
              {isCashier && <div className="form-grid" style={{ marginTop: 8 }}>
                <Field label="Pharmacist email or phone *" hint="A pharmacist must approve this sale"><input value={approval.identifier} onChange={(e) => setApproval({ ...approval, identifier: e.target.value })} autoComplete="off" /></Field>
                <Field label="Pharmacist password *"><input type="password" value={approval.password} onChange={(e) => setApproval({ ...approval, password: e.target.value })} autoComplete="new-password" /></Field></div>}
            </div>}

            <div className="form-grid" style={{ marginTop: 10 }}>
              <Field label="Discount %" hint={isCashier ? `Cashiers: up to ${pharmacy.max_cashier_discount}%` : ''}><input type="number" min="0" max="100" step="0.5" value={discPct} onChange={(e) => setDiscPct(e.target.value)} /></Field>
              {pct > 0 && <Field label="Discount reason *"><input value={discReason} onChange={(e) => setDiscReason(e.target.value)} /></Field>}
            </div>

            <div className="totals">
              <div><span>Subtotal</span><span>{KES(subtotal)}</span></div>
              {discount > 0 && <div><span>Discount ({pct}%)</span><span>− {KES(discount)}</span></div>}
              <div className="grand"><span>Total</span><span>{KES(total)}</span></div>
            </div>

            <h3 style={{ margin: '8px 0' }}>Payment</h3>
            {pays.map((p, i) => (
              <div className="pay-row" key={i}>
                <select value={p.method} onChange={(e) => setPays(pays.map((x, k) => k === i ? { ...x, method: e.target.value } : x))} aria-label="Payment method">
                  {['cash', 'mpesa', 'card', 'insurance'].map((m) => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}</select>
                <input type="number" min="0" placeholder="Amount" value={p.amount} onChange={(e) => setPays(pays.map((x, k) => k === i ? { ...x, amount: e.target.value } : x))} aria-label="Amount" />
                <input placeholder={p.method === 'mpesa' ? 'M-Pesa code' : 'Reference (optional)'} value={p.reference} onChange={(e) => setPays(pays.map((x, k) => k === i ? { ...x, reference: e.target.value } : x))} aria-label="Reference" />
                {pays.length > 1 ? <button className="icon-btn" onClick={() => setPays(pays.filter((_, k) => k !== i))} aria-label="Remove payment">✕</button> : <span />}
              </div>))}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn sm" onClick={() => setPays([...pays, { method: 'mpesa', amount: '', reference: '' }])}>+ Split payment</button>
              <button className="btn sm" onClick={() => setPays(pays.map((x, k) => k === 0 ? { ...x, amount: String(total) } : { ...x, amount: '' }))}>Customer pays exact amount</button>
            </div>
            <div className="totals">
              <div><span>Paid</span><span>{KES(paid)}</span></div>
              {change > 0 && <div style={{ color: 'var(--ok)', fontWeight: 800 }}><span>Change to give</span><span>{KES(change)}</span></div>}
              {due > 0 && <div style={{ color: 'var(--bad)', fontWeight: 800 }}><span>Balance owed (credit)</span><span>{KES(due)}</span></div>}
            </div>
            {due > 0 && <div className="warnbox">This will be recorded as credit. Enter the customer's name and phone above.</div>}
          </>}
          <ErrorBox error={err} />
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Sale detail + receipt                                              */
/* ------------------------------------------------------------------ */
export function Receipt({ data }) {
  const { sale: s, items, payments, pharmacy: p } = data;
  const line = (a, b, strong) => <div className="row" style={strong ? { fontWeight: 800 } : null}><span>{a}</span><span>{b}</span></div>;
  return (
    <div className="receipt">
      <h4>{p.name}</h4>
      {p.address && <div className="c">{p.address}</div>}
      {p.phone && <div className="c">Tel: {p.phone}</div>}
      {p.kra_pin && <div className="c">PIN: {p.kra_pin}</div>}
      {p.licence_no && <div className="c">PPB licence: {p.licence_no}</div>}
      <hr />
      {line('Receipt', s.sale_no)}{line('Date', eatTime(s.sale_date))}{line('Served by', s.cashier_name)}
      {s.customer_name && line('Customer', s.customer_name)}
      {s.status !== 'completed' && <div className="c"><strong>*** {s.status.toUpperCase()} ***</strong></div>}
      <hr />
      {items.map((i) => (
        <div className="item" key={i.id}><div>{i.drug_name}</div>{line(`  ${i.qty_units} x ${Number(i.unit_price).toFixed(2)}  (Batch ${i.batch_no})`, Number(i.line_total).toFixed(2))}</div>))}
      <hr />
      {line('Subtotal', Number(s.subtotal).toFixed(2))}
      {s.discount > 0 && line('Discount', '-' + Number(s.discount).toFixed(2))}
      {s.vat > 0 && line(`VAT (incl.)`, Number(s.vat).toFixed(2))}
      {line('TOTAL (KES)', Number(s.total).toFixed(2), true)}
      {payments.map((x) => <div key={x.id}>{line(METHOD_LABEL[x.method] || x.method, Number(x.amount).toFixed(2))}</div>)}
      {s.balance_due > 0 && line('Balance owed', Number(s.balance_due).toFixed(2), true)}
      <hr />
      {s.has_prescription ? <div className="c">Prescription sale. Prescriber: {s.prescriber_name}</div> : null}
      <div className="c">{p.receipt_footer}</div>
    </div>
  );
}

function SaleDetail({ id, user, onClose, onChanged }) {
  const toast = useToast();
  const r = useLoad(() => get('/sales/' + id), [id]);
  const [voiding, setVoiding] = useState(null);
  const [reason, setReason] = useState('');
  const canVoid = user.role === 'owner' || user.role === 'pharmacist';
  const data = r.data;
  const doVoid = async () => {
    try { await post(`/sales/${id}/void`, { reason, kind: voiding }); toast('Sale ' + (voiding === 'voided' ? 'voided' : 'refunded') + '. Stock restored.'); setVoiding(null); onChanged(); r.reload(); }
    catch (e) { toast(e.message, 'err'); }
  };
  const print = () => {
    document.body.classList.add('printing-receipt');
    window.print();
    setTimeout(() => document.body.classList.remove('printing-receipt'), 500);
  };
  const share = () => {
    const s = data.sale;
    const text = `${data.pharmacy.name}\nReceipt ${s.sale_no}\n${data.items.map((i) => `${i.drug_name} x${i.qty_units}: ${KES(i.line_total)}`).join('\n')}\nTotal: ${KES(s.total)}\n${data.pharmacy.receipt_footer || ''}`;
    const phone = (s.customer_phone || '').replace(/\D/g, '');
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, '_blank');
  };
  return (
    <Modal title={data ? `Sale ${data.sale.sale_no}` : 'Sale'} onClose={onClose} footer={data && <>
      {canVoid && data.sale.status === 'completed' && <><button className="btn" onClick={() => { setReason(''); setVoiding('refunded'); }}>Refund</button><button className="btn danger" onClick={() => { setReason(''); setVoiding('voided'); }}>Void sale</button></>}
      <button className="btn" onClick={share}>Share on WhatsApp</button>
      <button className="btn primary" onClick={print}>🖨 Print receipt</button></>}>
      {r.loading && !data && <Spinner />}<ErrorBox error={r.error} />
      {data && <>
        {data.sale.status !== 'completed' && <div className="errbox">This sale was {data.sale.status} by {data.sale.voided_by_name}: {data.sale.void_reason}</div>}
        <div className="print-receipt"><Receipt data={data} /></div>
        {data.sale.approver_name && <p className="sub no-print" style={{ textAlign: 'center' }}>Approved by pharmacist: {data.sale.approver_name}</p>}
      </>}
      {voiding && <Modal title={voiding === 'voided' ? 'Void this sale?' : 'Refund this sale?'} onClose={() => setVoiding(null)} footer={<><button className="btn" onClick={() => setVoiding(null)}>Cancel</button><button className="btn danger" disabled={!reason.trim()} onClick={doVoid}>Confirm</button></>}>
        <p>Stock will be returned to the shelf and the sale will show as {voiding}. This cannot be undone.</p>
        <Field label="Reason *"><input value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></Field></Modal>}
    </Modal>
  );
}
