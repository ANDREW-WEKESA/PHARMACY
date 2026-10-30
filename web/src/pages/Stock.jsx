import { useEffect, useMemo, useState } from 'react';
import { get, post, put, qs } from '../api.js';
import { KES, num, fmtDate, daysUntil, eatTime, packsText, toCSV, download, todayEAT } from '../util.js';
import { PageHead, Spinner, ErrorBox, useLoad, useDebounced, Empty, Badge, Modal, Field, Tabs, useToast } from '../ui.jsx';
import { usePharmacy } from '../contexts/PharmacyContext.jsx';

const REASONS = { damage: 'Damaged', expired: 'Expired / write-off', loss: 'Lost / missing', count_correction: 'Count correction', return_to_supplier: 'Return to supplier', customer_return: 'Customer return', other: 'Other' };

export default function Stock({ user }) {
  const { selectedPharmacyId } = usePharmacy() || {};
  const canManage = user.role === 'owner' || user.role === 'pharmacist';
  const [tab, setTab] = useState('levels');
  const tabs = [
    { id: 'levels', label: 'Stock levels' }, { id: 'receive', label: 'Receive stock' }, { id: 'reorder', label: 'Reorder list' },
    { id: 'adjust', label: 'Adjustments' }, { id: 'take', label: 'Stock take' }, { id: 'suppliers', label: 'Suppliers' },
  ];
  return (
    <>
      <PageHead icon="📦" title="Stock Management" sub="Batches, expiry dates, deliveries and counts" />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'levels' && <Levels canManage={canManage} selectedPharmacyId={selectedPharmacyId} />}
      {tab === 'receive' && <Receive selectedPharmacyId={selectedPharmacyId} />}
      {tab === 'reorder' && <Reorder selectedPharmacyId={selectedPharmacyId} />}
      {tab === 'adjust' && <Adjustments user={user} selectedPharmacyId={selectedPharmacyId} />}
      {tab === 'take' && <StockTake canManage={canManage} selectedPharmacyId={selectedPharmacyId} />}
      {tab === 'suppliers' && <Suppliers canManage={canManage} selectedPharmacyId={selectedPharmacyId} />}
    </>
  );
}

/* ---------- levels ---------- */
function Levels({ selectedPharmacyId }) {
  const [search, setSearch] = useState(''); const [status, setStatus] = useState('instock');
  const dq = useDebounced(search);
  const r = useLoad(() => get('/stock' + qs({ q: dq, status, pharmacy_id: selectedPharmacyId || '' })), [dq, status, selectedPharmacyId]);
  const rows = r.data?.batches || [];
  const exp = (b) => { const d = daysUntil(b.expiry_date); return d < 0 ? <Badge kind="bad">Expired {fmtDate(b.expiry_date)}</Badge> : d <= 30 ? <Badge kind="warn">{fmtDate(b.expiry_date)} · {d}d</Badge> : d <= 90 ? <Badge kind="info">{fmtDate(b.expiry_date)}</Badge> : <span>{fmtDate(b.expiry_date)}</span>; };
  return (
    <div className="card">
      <div className="toolbar">
        <input className="grow" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search drug, batch number or barcode" aria-label="Search stock" />
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Stock filter"><option value="instock">In stock</option><option value="expiring">Expiring soon</option><option value="expired">Expired (still on shelf)</option><option value="all">All batches</option></select>
        <button className="btn sm" disabled={!rows.length} onClick={() => download('stock.csv', toCSV(rows, [{ label: 'Drug', value: (b) => b.brand_name + ' ' + (b.strength || '') }, { label: 'Batch', key: 'batch_no' }, { label: 'Expiry', key: 'expiry_date' }, { label: 'Units', key: 'qty_units' }, { label: 'Buying price (pack)', key: 'buying_price' }, { label: 'Selling price (pack)', key: 'selling_price' }, { label: 'Supplier', key: 'supplier_name' }]))}>⬇ Export</button>
      </div>
      <ErrorBox error={r.error} retry={r.reload} />
      {r.loading && !r.data ? <Spinner /> : rows.length === 0 ? <Empty icon="📦" title="No stock found" sub="Use “Receive stock” to add a delivery." /> :
        <div className="table-wrap"><table><thead><tr><th>Drug</th><th>Batch</th><th>Expiry</th><th className="r">On hand</th><th className="r">Buy / pack</th><th className="r">Sell / pack</th><th>Supplier</th></tr></thead><tbody>
          {rows.map((b) => <tr key={b.id}><td><strong>{b.brand_name}</strong> {b.strength}<div className="sub">{b.generic_name}</div></td><td>{b.batch_no}</td><td>{exp(b)}</td>
            <td className="r mono"><strong>{num(b.qty_units)}</strong><div className="sub">{packsText(b.qty_units, b)}</div></td><td className="r mono">{KES(b.buying_price)}</td><td className="r mono">{KES(b.selling_price)}</td><td>{b.supplier_name || '—'}</td></tr>)}
        </tbody></table></div>}
    </div>
  );
}

/* ---------- receive delivery ---------- */
function Receive({ selectedPharmacyId }) {
  const toast = useToast();
  const sup = useLoad(() => get('/suppliers' + qs({ pharmacy_id: selectedPharmacyId || '' })), [selectedPharmacyId]);
  const hist = useLoad(() => get('/deliveries' + qs({ pharmacy_id: selectedPharmacyId || '' })), [selectedPharmacyId]);
  const [form, setForm] = useState({ supplier_id: '', invoice_no: '', delivery_date: todayEAT(), amount_paid: '', notes: '' });
  const [lines, setLines] = useState([]);
  const [search, setSearch] = useState(''); const dq = useDebounced(search, 250);
  const found = useLoad(() => (dq ? get('/drugs' + qs({ q: dq, limit: 8, pharmacy_id: selectedPharmacyId || '' })) : Promise.resolve({ drugs: [] })), [dq, selectedPharmacyId]);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const add = (d) => { setLines((l) => [...l, { key: Math.random(), drug: d, batch_no: '', expiry_date: '', packs: '', loose_units: '', buying_price: d.buying_price, selling_price: d.selling_price }]); setSearch(''); };
  const upd = (i, k, v) => setLines((l) => l.map((x, n) => n === i ? { ...x, [k]: v } : x));
  const total = lines.reduce((s, l) => s + ((Number(l.packs) || 0) + (Number(l.loose_units) || 0) / l.drug.pack_size) * (Number(l.buying_price) || 0), 0);
  const save = async () => {
    setErr(''); setBusy(true);
    try {
      await post('/deliveries', { ...form, supplier_id: form.supplier_id || null, items: lines.map((l) => ({ drug_id: l.drug.id, batch_no: l.batch_no, expiry_date: l.expiry_date, packs: Number(l.packs) || 0, loose_units: Number(l.loose_units) || 0, buying_price: Number(l.buying_price) || 0, selling_price: Number(l.selling_price) || 0 })) });
      toast('Delivery received. Stock updated.'); setLines([]); setForm({ supplier_id: '', invoice_no: '', delivery_date: todayEAT(), amount_paid: '', notes: '' }); hist.reload();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <>
      <div className="card"><h3>Receive a delivery</h3>
        <div className="form-grid">
          <Field label="Supplier"><select value={form.supplier_id} onChange={(e) => setForm({ ...form, supplier_id: e.target.value })}><option value="">— Select —</option>{sup.data?.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
          <Field label="Invoice / delivery note no."><input value={form.invoice_no} onChange={(e) => setForm({ ...form, invoice_no: e.target.value })} /></Field>
          <Field label="Delivery date"><input type="date" value={form.delivery_date} max={todayEAT()} onChange={(e) => setForm({ ...form, delivery_date: e.target.value })} /></Field>
          <Field label="Amount paid now (KES)"><input type="number" min="0" value={form.amount_paid} onChange={(e) => setForm({ ...form, amount_paid: e.target.value })} /></Field>
        </div>
        <Field label="Add a drug to this delivery" className="" ><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search the catalogue by name or barcode" style={{ marginTop: 6 }} /></Field>
        {search && <div className="pos-results" style={{ marginTop: 8, maxHeight: 220 }}>
          {found.data?.drugs.length === 0 && <Empty icon="🔎" title="Not in the catalogue" sub="Add it under Drug Catalog first" />}
          {found.data?.drugs.map((d) => <div className="pos-item" key={d.id} tabIndex={0} onClick={() => add(d)} onKeyDown={(e) => e.key === 'Enter' && add(d)}><span><strong>{d.brand_name}</strong> {d.strength} <span className="sub">pack of {d.pack_size}</span></span><span className="sub">+ Add</span></div>)}</div>}
        {lines.length > 0 && <div className="table-wrap" style={{ marginTop: 12 }}><table><thead><tr><th>Drug</th><th>Batch no.</th><th>Expiry</th><th>Packs</th><th>+ Loose</th><th>Buy / pack</th><th>Sell / pack</th><th /></tr></thead><tbody>
          {lines.map((l, i) => <tr key={l.key}><td style={{ minWidth: 150 }}><strong>{l.drug.brand_name}</strong> {l.drug.strength}<div className="sub">pack of {l.drug.pack_size}</div></td>
            <td><input style={{ width: 110 }} value={l.batch_no} onChange={(e) => upd(i, 'batch_no', e.target.value)} aria-label="Batch number" /></td>
            <td><input type="date" style={{ width: 150 }} value={l.expiry_date} onChange={(e) => upd(i, 'expiry_date', e.target.value)} aria-label="Expiry date" /></td>
            <td><input type="number" min="0" style={{ width: 80 }} value={l.packs} onChange={(e) => upd(i, 'packs', e.target.value)} aria-label="Packs" /></td>
            <td><input type="number" min="0" style={{ width: 80 }} value={l.loose_units} disabled={l.drug.pack_size === 1} onChange={(e) => upd(i, 'loose_units', e.target.value)} aria-label="Loose units" /></td>
            <td><input type="number" min="0" style={{ width: 90 }} value={l.buying_price} onChange={(e) => upd(i, 'buying_price', e.target.value)} aria-label="Buying price" /></td>
            <td><input type="number" min="0" style={{ width: 90 }} value={l.selling_price} onChange={(e) => upd(i, 'selling_price', e.target.value)} aria-label="Selling price" /></td>
            <td><button className="icon-btn" onClick={() => setLines(lines.filter((_, n) => n !== i))} aria-label="Remove line">✕</button></td></tr>)}
        </tbody></table></div>}
        <ErrorBox error={err} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14, flexWrap: 'wrap', gap: 10 }}>
          <strong>Delivery cost: {KES(Math.round(total * 100) / 100)}</strong>
          <button className="btn primary" disabled={!lines.length || busy} onClick={save}>{busy ? 'Saving…' : 'Receive into stock'}</button></div>
      </div>
      <div className="card"><h3>Recent deliveries</h3>
        {hist.data?.deliveries.length === 0 ? <Empty icon="🚚" title="No deliveries yet" /> : <div className="table-wrap"><table><thead><tr><th>Date</th><th>Supplier</th><th>Invoice</th><th className="r">Lines</th><th className="r">Cost</th><th className="r">Paid</th></tr></thead><tbody>
          {hist.data?.deliveries.map((d) => <tr key={d.id}><td>{fmtDate(d.delivery_date)}</td><td>{d.supplier_name || '—'}</td><td>{d.invoice_no || '—'}</td><td className="r">{d.lines}</td><td className="r mono">{KES(d.total_cost)}</td><td className="r mono">{d.total_cost - d.amount_paid > 0.009 ? <Badge kind="warn">Owes {KES(d.total_cost - d.amount_paid)}</Badge> : <Badge kind="ok">Paid</Badge>}</td></tr>)}
        </tbody></table></div>}
      </div>
    </>
  );
}

/* ---------- reorder ---------- */
function Reorder({ selectedPharmacyId }) {
  const r = useLoad(() => get('/stock/alerts' + qs({ pharmacy_id: selectedPharmacyId || '' })), [selectedPharmacyId]);
  const rows = useMemo(() => [...(r.data?.out || []), ...(r.data?.low || [])], [r.data]);
  const groups = useMemo(() => { const g = {}; rows.forEach((x) => { (g[x.supplier_name || 'No preferred supplier'] ||= []).push(x); }); return g; }, [rows]);
  const text = (name, items) => `Order request for ${name}\n` + items.map((i) => `- ${i.brand_name} ${i.strength || ''}: need about ${Math.max(1, Math.ceil((i.reorder_level * 2 - i.stock_units) / i.pack_size))} pack(s)`).join('\n');
  return (
    <div className="card"><h3>Reorder list</h3><p className="sub" style={{ marginTop: -6 }}>Drugs at or below their reorder level, grouped by preferred supplier. The suggested quantity brings stock back to twice the reorder level.</p>
      <ErrorBox error={r.error} retry={r.reload} />
      {r.loading && !r.data ? <Spinner /> : rows.length === 0 ? <Empty icon="✅" title="Nothing to reorder" sub="All drugs are above their reorder level." /> :
        Object.entries(groups).map(([name, items]) => (
          <div key={name} style={{ marginBottom: 18 }}>
            <div className="card-head"><strong>{name}</strong><span style={{ display: 'flex', gap: 8 }}>
              <button className="btn sm" onClick={() => navigator.clipboard?.writeText(text(name, items)).then(() => alert('Copied. Paste it into WhatsApp or an email.'))}>Copy order</button>
              <button className="btn sm" onClick={() => window.open('https://wa.me/?text=' + encodeURIComponent(text(name, items)), '_blank')}>WhatsApp</button></span></div>
            <div className="table-wrap"><table><thead><tr><th>Drug</th><th className="r">In stock</th><th className="r">Reorder level</th><th className="r">Suggested packs</th></tr></thead><tbody>
              {items.map((i) => <tr key={i.id}><td>{i.brand_name} {i.strength}{i.stock_units <= 0 && <> <Badge kind="bad">Out</Badge></>}</td><td className="r">{num(i.stock_units)}</td><td className="r">{num(i.reorder_level)}</td><td className="r"><strong>{Math.max(1, Math.ceil((i.reorder_level * 2 - i.stock_units) / i.pack_size))}</strong></td></tr>)}
            </tbody></table></div></div>))}
    </div>
  );
}

/* ---------- adjustments ---------- */
function Adjustments({ user, selectedPharmacyId }) {
  const toast = useToast();
  const list = useLoad(() => get('/adjustments' + qs({ pharmacy_id: selectedPharmacyId || '' })), [selectedPharmacyId]);
  const [open, setOpen] = useState(false);
  return (
    <div className="card"><div className="card-head"><h3>Stock adjustments</h3><button className="btn primary sm" onClick={() => setOpen(true)}>+ New adjustment</button></div>
      <ErrorBox error={list.error} retry={list.reload} />
      {list.loading && !list.data ? <Spinner /> : list.data?.adjustments.length === 0 ? <Empty icon="📝" title="No adjustments yet" sub="Damages, expiries and write-offs are recorded here." /> :
        <div className="table-wrap"><table><thead><tr><th>Date</th><th>Drug / batch</th><th>Reason</th><th className="r">Change</th><th>By</th><th>Note</th></tr></thead><tbody>
          {list.data?.adjustments.map((a) => <tr key={a.id}><td>{eatTime(a.created_at)}</td><td>{a.brand_name} {a.strength}<div className="sub">Batch {a.batch_no}</div></td><td>{REASONS[a.reason]}</td>
            <td className="r mono" style={{ color: a.qty_change < 0 ? 'var(--bad)' : 'var(--ok)', fontWeight: 700 }}>{a.qty_change > 0 ? '+' : ''}{a.qty_change}</td><td>{a.user_name}</td><td>{a.note}{a.witness && <div className="sub">Witness: {a.witness}</div>}</td></tr>)}
        </tbody></table></div>}
      {open && <AdjustForm user={user} selectedPharmacyId={selectedPharmacyId} onClose={() => setOpen(false)} onDone={() => { setOpen(false); toast('Adjustment saved'); list.reload(); }} />}
    </div>
  );
}
function AdjustForm({ user, selectedPharmacyId, onClose, onDone }) {
  const [search, setSearch] = useState(''); const dq = useDebounced(search, 250);
  const found = useLoad(() => get('/stock' + qs({ q: dq, status: 'all', pharmacy_id: selectedPharmacyId || '' })), [dq, selectedPharmacyId]);
  const [batch, setBatch] = useState(null);
  const [f, setF] = useState({ reason: 'damage', qty: '', note: '', witness: '' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const clerk = user.role === 'stock_clerk';
  const reasons = clerk ? ['damage', 'expired', 'loss'] : Object.keys(REASONS);
  const negative = ['damage', 'expired', 'loss', 'return_to_supplier'].includes(f.reason);
  const submit = async () => {
    setErr(''); setBusy(true);
    const q = Math.abs(Math.floor(Number(f.qty) || 0));
    try { await post('/adjustments', { batch_id: batch.id, reason: f.reason, note: f.note, witness: f.witness, qty_change: f.reason === 'count_correction' || f.reason === 'other' ? Math.floor(Number(f.qty) || 0) : negative ? -q : q }); onDone(); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal title="New stock adjustment" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!batch || !f.qty || busy} onClick={submit}>Save adjustment</button></>}>
      {!batch ? <>
        <Field label="Find the batch"><input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Drug name or batch number" /></Field>
        <div className="pos-results" style={{ marginTop: 10 }}>{found.data?.batches.slice(0, 30).map((b) => <div className="pos-item" key={b.id} tabIndex={0} onClick={() => setBatch(b)} onKeyDown={(e) => e.key === 'Enter' && setBatch(b)}><span><strong>{b.brand_name}</strong> {b.strength}<div className="sub">Batch {b.batch_no} · expires {fmtDate(b.expiry_date)}</div></span><strong>{num(b.qty_units)} units</strong></div>)}</div>
      </> : <div className="stack">
        <div className="infobox"><strong>{batch.brand_name} {batch.strength}</strong> · Batch {batch.batch_no} · {num(batch.qty_units)} units on hand <button className="btn sm" style={{ marginLeft: 8 }} onClick={() => setBatch(null)}>Change</button></div>
        <Field label="Reason"><select value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })}>{reasons.map((r) => <option key={r} value={r}>{REASONS[r]}</option>)}</select></Field>
        <Field label={f.reason === 'count_correction' || f.reason === 'other' ? 'Quantity change (use − to remove)' : negative ? 'Units to remove' : 'Units to add'}><input type="number" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} /></Field>
        <Field label={'Witness name' + (batch.drug_class === 'CONTROLLED' ? ' *' : '')} hint={batch.drug_class === 'CONTROLLED' ? 'Required for controlled drugs' : ''}><input value={f.witness} onChange={(e) => setF({ ...f, witness: e.target.value })} /></Field>
        <Field label={'Note' + (f.reason === 'other' ? ' *' : '')}><input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
        <ErrorBox error={err} />
      </div>}
    </Modal>
  );
}

/* ---------- stock take ---------- */
function StockTake({ canManage, selectedPharmacyId }) {
  const toast = useToast();
  const list = useLoad(() => get('/stocktakes' + qs({ pharmacy_id: selectedPharmacyId || '' })), [selectedPharmacyId]);
  const [openId, setOpenId] = useState(null);
  const start = async () => { try { const r = await post('/stocktakes'); setOpenId(r.id); list.reload(); } catch (e) { if (e.data?.id) setOpenId(e.data.id); else toast(e.message, 'err'); } };
  return (
    <div className="card"><div className="card-head"><h3>Stock take</h3><button className="btn primary sm" onClick={start}>Start / continue a count</button></div>
      <p className="sub" style={{ marginTop: -6 }}>Count the shelves, enter what you counted, then a pharmacist posts the differences as adjustments.</p>
      <ErrorBox error={list.error} retry={list.reload} />
      {list.data?.stocktakes.length === 0 ? <Empty icon="🧮" title="No stock takes yet" /> : <div className="table-wrap"><table><thead><tr><th>Started</th><th>By</th><th>Progress</th><th>Status</th><th /></tr></thead><tbody>
        {list.data?.stocktakes.map((t) => <tr key={t.id}><td>{eatTime(t.created_at)}</td><td>{t.started_by_name}</td><td>{t.counted} of {t.lines} counted</td><td>{t.status === 'open' ? <Badge kind="warn">Open</Badge> : <Badge kind="ok">Posted</Badge>}</td><td><button className="btn sm" onClick={() => setOpenId(t.id)}>{t.status === 'open' ? 'Continue' : 'View'}</button></td></tr>)}
      </tbody></table></div>}
      {openId && <CountSheet id={openId} canPost={canManage} onClose={() => { setOpenId(null); list.reload(); }} />}
    </div>
  );
}
function CountSheet({ id, canPost, onClose }) {
  const toast = useToast();
  const r = useLoad(() => get('/stocktakes/' + id), [id]);
  const [counts, setCounts] = useState({});
  const [search, setSearch] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { if (r.data) setCounts(Object.fromEntries(r.data.lines.map((l) => [l.id, l.counted_qty ?? '']))); }, [r.data]);
  const open = r.data?.stocktake.status === 'open';
  const lines = (r.data?.lines || []).filter((l) => !search || (l.brand_name + l.batch_no).toLowerCase().includes(search.toLowerCase()));
  const save = async () => { const changed = r.data.lines.filter((l) => String(counts[l.id] ?? '') !== String(l.counted_qty ?? '')).map((l) => ({ id: l.id, counted_qty: counts[l.id] === '' ? null : Number(counts[l.id]) })); if (changed.length) await put(`/stocktakes/${id}/lines`, { lines: changed }); return changed.length; };
  const doSave = async () => { setBusy(true); try { const n = await save(); toast(n ? 'Counts saved' : 'Nothing new to save'); r.reload(); } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); } };
  const doPost = async () => {
    if (!confirm('Post this stock take? Differences will change your stock levels and cannot be undone.')) return;
    setBusy(true); try { await save(); const x = await post(`/stocktakes/${id}/post`); toast(`Posted. ${x.adjusted} difference(s) adjusted.`); onClose(); } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  const diffs = r.data?.lines.filter((l) => counts[l.id] !== '' && counts[l.id] != null && Number(counts[l.id]) !== l.system_qty).length || 0;
  return (
    <Modal title={`Stock take #${id}`} wide onClose={onClose} footer={open && <><button className="btn" disabled={busy} onClick={doSave}>Save counts</button>{canPost && <button className="btn primary" disabled={busy} onClick={doPost}>Post {diffs} difference{diffs === 1 ? '' : 's'}</button>}</>}>
      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter by drug or batch" style={{ marginBottom: 10 }} />
      {r.loading && !r.data ? <Spinner /> : <div className="table-wrap"><table><thead><tr><th>Drug</th><th>Batch</th><th>Expiry</th><th className="r">System</th><th className="r">Counted</th><th className="r">Difference</th></tr></thead><tbody>
        {lines.map((l) => { const c = counts[l.id]; const diff = c === '' || c == null ? null : Number(c) - l.system_qty; return <tr key={l.id}><td>{l.brand_name} {l.strength}</td><td>{l.batch_no}</td><td>{fmtDate(l.expiry_date)}</td><td className="r">{l.system_qty}</td>
          <td className="r">{open ? <input type="number" min="0" style={{ width: 90, textAlign: 'right' }} value={c ?? ''} onChange={(e) => setCounts({ ...counts, [l.id]: e.target.value })} aria-label="Counted quantity" /> : l.counted_qty ?? '—'}</td>
          <td className="r" style={{ fontWeight: 700, color: diff ? (diff < 0 ? 'var(--bad)' : 'var(--ok)') : undefined }}>{diff == null ? '' : diff > 0 ? '+' + diff : diff}</td></tr>; })}
      </tbody></table></div>}
    </Modal>
  );
}

/* ---------- suppliers ---------- */
function Suppliers({ canManage, selectedPharmacyId }) {
  const toast = useToast();
  const r = useLoad(() => get('/suppliers' + qs({ pharmacy_id: selectedPharmacyId || '' })), [selectedPharmacyId]);
  const [edit, setEdit] = useState(null);
  const [pay, setPay] = useState(null);
  return (
    <div className="card"><div className="card-head"><h3>Suppliers</h3><button className="btn primary sm" onClick={() => setEdit({ name: '', contact_person: '', phone: '', email: '', address: '' })}>+ Add supplier</button></div>
      <ErrorBox error={r.error} retry={r.reload} />
      {r.loading && !r.data ? <Spinner /> : r.data?.suppliers.length === 0 ? <Empty icon="🚚" title="No suppliers yet" sub="Add the wholesalers and distributors you buy from." /> :
        <div className="table-wrap"><table><thead><tr><th>Supplier</th><th>Contact</th><th className="r">We owe</th><th /></tr></thead><tbody>
          {r.data?.suppliers.map((s) => <tr key={s.id}><td><strong>{s.name}</strong><div className="sub">{s.address}</div></td><td>{s.contact_person}<div className="sub">{s.phone} {s.email}</div></td><td className="r mono">{s.balance > 0.009 ? <Badge kind="warn">{KES(s.balance)}</Badge> : '—'}</td>
            <td style={{ whiteSpace: 'nowrap' }}>{canManage && s.balance > 0.009 && <button className="btn sm" onClick={() => setPay(s)}>Record payment</button>} {canManage && <button className="btn sm" onClick={() => setEdit(s)}>Edit</button>}</td></tr>)}
        </tbody></table></div>}
      {edit && <SupplierForm s={edit} canManage={canManage} onClose={() => setEdit(null)} onDone={() => { setEdit(null); toast('Supplier saved'); r.reload(); }} />}
      {pay && <PayDelivery s={pay} onClose={() => setPay(null)} onDone={() => { setPay(null); toast('Payment recorded'); r.reload(); }} />}
    </div>
  );
}
function SupplierForm({ s, onClose, onDone, canManage }) {
  const [f, setF] = useState(s); const [err, setErr] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => { try { f.id ? await put('/suppliers/' + f.id, f) : await post('/suppliers', f); onDone(); } catch (e) { setErr(e.message); } };
  return <Modal title={f.id ? 'Edit supplier' : 'Add supplier'} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Save</button></>}>
    <div className="form-grid"><Field label="Name *" className="full"><input autoFocus value={f.name} onChange={set('name')} /></Field><Field label="Contact person"><input value={f.contact_person || ''} onChange={set('contact_person')} /></Field><Field label="Phone"><input value={f.phone || ''} onChange={set('phone')} /></Field><Field label="Email"><input value={f.email || ''} onChange={set('email')} /></Field><Field label="Address"><input value={f.address || ''} onChange={set('address')} /></Field></div><ErrorBox error={err} /></Modal>;
}
function PayDelivery({ s, onClose, onDone }) {
  const d = useLoad(() => get('/deliveries'));
  const open = (d.data?.deliveries || []).filter((x) => x.supplier_id === s.id && x.total_cost - x.amount_paid > 0.009);
  const [amounts, setAmounts] = useState({}); const [err, setErr] = useState('');
  const save = async () => { try { for (const x of open) if (Number(amounts[x.id]) > 0) await post(`/deliveries/${x.id}/payment`, { amount: Number(amounts[x.id]) }); onDone(); } catch (e) { setErr(e.message); } };
  return <Modal title={`Pay ${s.name}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Record payment</button></>}>
    {open.map((x) => <div key={x.id} className="form-grid" style={{ marginBottom: 10 }}><div><strong>{x.invoice_no || 'Delivery ' + x.id}</strong><div className="sub">{fmtDate(x.delivery_date)} · owes {KES(x.total_cost - x.amount_paid)}</div></div><Field label="Pay (KES)"><input type="number" min="0" max={x.total_cost - x.amount_paid} value={amounts[x.id] || ''} onChange={(e) => setAmounts({ ...amounts, [x.id]: e.target.value })} /></Field></div>)}
    <ErrorBox error={err} /></Modal>;
}
