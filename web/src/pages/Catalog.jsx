import { useRef, useState } from 'react';
import { get, post, put, qs } from '../api.js';
import { KES, num, fmtDate, CLASS_LABEL, packsText, toCSV, download, parseCSV, eatTime } from '../util.js';
import { PageHead, Spinner, ErrorBox, useLoad, useDebounced, Empty, Badge, Modal, Field, useToast } from '../ui.jsx';

const BLANK = { brand_name: '', generic_name: '', strength: '', dosage_form: 'Tablet', pack_size: 1, unit_name: 'pack', allow_split: false, category: '', manufacturer: '', barcode: '', drug_class: 'OTC', storage: '', buying_price: '', selling_price: '', vat_applicable: false, reorder_level: 10, preferred_supplier_id: '', notes: '' };
const classBadge = (c) => <Badge kind={c === 'CONTROLLED' ? 'bad' : c === 'POM' ? 'info' : c === 'PHARMACY_ONLY' ? 'warn' : 'gray'}>{CLASS_LABEL[c]}</Badge>;

export default function Catalog({ user }) {
  const canEdit = user.role === 'owner' || user.role === 'pharmacist';
  const toast = useToast();
  const [search, setSearch] = useState(''); const [cls, setCls] = useState(''); const [showInactive, setShowInactive] = useState(false);
  const dq = useDebounced(search);
  const r = useLoad(() => get('/drugs' + qs({ q: dq, class: cls, active: showInactive ? 'all' : '', limit: 500 })), [dq, cls, showInactive]);
  const [edit, setEdit] = useState(null); const [view, setView] = useState(null); const [importing, setImporting] = useState(false);
  const drugs = r.data?.drugs || [];
  const exportCsv = () => download('drug-catalog.csv', toCSV(drugs, ['brand_name', 'generic_name', 'strength', 'dosage_form', 'pack_size', 'unit_name', 'allow_split', 'category', 'manufacturer', 'barcode', 'drug_class', 'buying_price', 'selling_price', 'vat_applicable', 'reorder_level'].map((k) => ({ label: k, key: k }))));
  return (
    <>
      <PageHead icon="📖" title="Drug Catalog" sub="Every drug the pharmacy sells, with prices and rules">
        {canEdit && <><button className="btn ghost" onClick={() => setImporting(true)}>⬆ Import CSV</button><button className="btn primary" onClick={() => setEdit({ ...BLANK })}>+ Add drug</button></>}
      </PageHead>
      <div className="glass"><div className="toolbar" style={{ marginBottom: 0 }}>
        <div className="searchbox grow"><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="🔍 Search brand, generic, category or scan barcode" aria-label="Search drugs" /></div>
        <select value={cls} onChange={(e) => setCls(e.target.value)} aria-label="Drug class" style={{ background: '#1f2340', color: '#fff', border: 'none' }}><option value="">All classes</option>{Object.entries(CLASS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        {canEdit && <label className="check"><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Show deactivated</label>}
        <button className="btn sm ghost" disabled={!drugs.length} onClick={exportCsv}>⬇ Export</button>
      </div></div>
      <ErrorBox error={r.error} retry={r.reload} />
      {r.loading && !r.data ? <Spinner /> : drugs.length === 0 ? <div className="glass"><Empty icon="📖" title="No drugs found" sub={canEdit ? 'Add your first drug or import a CSV list.' : 'Ask the pharmacist to add drugs.'} /></div> :
        <div className="card"><div className="table-wrap"><table><thead><tr><th>Drug</th><th>Class</th><th className="r">Pack</th><th className="r">Price / pack</th><th className="r">In stock</th><th>Next expiry</th></tr></thead><tbody>
          {drugs.map((d) => <tr key={d.id} className="clickable" tabIndex={0} onClick={() => setView(d.id)} onKeyDown={(e) => e.key === 'Enter' && setView(d.id)} style={!d.active ? { opacity: .55 } : null}>
            <td><strong>{d.brand_name}</strong> {d.strength}{!d.active && <> <Badge>Deactivated</Badge></>}<div className="sub">{d.generic_name} {d.dosage_form && '· ' + d.dosage_form}</div></td>
            <td>{classBadge(d.drug_class)}</td><td className="r">{d.pack_size}</td><td className="r mono">{KES(d.selling_price)}</td>
            <td className="r mono">{d.stock_units <= 0 ? <Badge kind="bad">Out</Badge> : d.stock_units <= d.reorder_level ? <Badge kind="warn">{packsText(d.stock_units, d)}</Badge> : packsText(d.stock_units, d)}</td>
            <td>{d.next_expiry ? fmtDate(d.next_expiry) : '—'}{d.expired_units > 0 && <div className="sub" style={{ color: 'var(--bad)' }}>{d.expired_units} expired on shelf</div>}</td></tr>)}
        </tbody></table></div></div>}
      {view && <DrugView id={view} canEdit={canEdit} onClose={() => setView(null)} onEdit={(d) => { setView(null); setEdit({ ...d, preferred_supplier_id: d.preferred_supplier_id || '' }); }} onPick={setView} />}
      {edit && <DrugForm initial={edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); toast('Drug saved'); r.reload(); }} />}
      {importing && <Importer onClose={() => setImporting(false)} onDone={() => { setImporting(false); r.reload(); }} />}
    </>
  );
}

function DrugView({ id, canEdit, onClose, onEdit, onPick }) {
  const r = useLoad(() => get('/drugs/' + id), [id]);
  const x = r.data; const d = x?.drug;
  return (
    <Modal title={d ? `${d.brand_name} ${d.strength || ''}` : 'Drug'} wide onClose={onClose} footer={d && canEdit && <button className="btn primary" onClick={() => onEdit(d)}>Edit drug</button>}>
      {r.loading && !x && <Spinner />}<ErrorBox error={r.error} />
      {d && <div className="grid g2">
        <div><table><tbody>
          {[['Generic name', d.generic_name], ['Dosage form', d.dosage_form], ['Class', classBadge(d.drug_class)], ['Category', d.category], ['Manufacturer', d.manufacturer], ['Barcode', d.barcode], ['Pack size', `${d.pack_size} ${d.unit_name === 'pack' ? 'units' : d.unit_name + 's'}${d.allow_split ? ' (can sell loose)' : ' (whole packs only)'}`], ['Storage', d.storage], ['Buying price / pack', KES(d.buying_price)], ['Selling price / pack', KES(d.selling_price)], ['Margin', d.selling_price ? Math.round(((d.selling_price - d.buying_price) / d.selling_price) * 100) + '%' : '—'], ['VAT', d.vat_applicable ? 'Taxable' : 'Exempt / zero-rated'], ['Reorder level', d.reorder_level + ' units'], ['Notes', d.notes]].map(([k, v]) => v ? <tr key={k}><td className="sub" style={{ width: 150 }}>{k}</td><td>{v}</td></tr> : null)}
        </tbody></table></div>
        <div>
          <h3>Stock by batch</h3>
          {x.batches.filter((b) => b.qty_units > 0).length === 0 ? <p className="sub">No stock on hand.</p> : <table><thead><tr><th>Batch</th><th>Expiry</th><th className="r">Units</th></tr></thead><tbody>{x.batches.filter((b) => b.qty_units > 0).map((b) => <tr key={b.id}><td>{b.batch_no}</td><td>{fmtDate(b.expiry_date)}</td><td className="r">{b.qty_units}</td></tr>)}</tbody></table>}
          {x.alternatives.length > 0 && <><h3 style={{ marginTop: 16 }}>Other brands of {d.generic_name}</h3>{x.alternatives.map((a) => <div key={a.id} className="pos-item" tabIndex={0} onClick={() => onPick(a.id)} onKeyDown={(e) => e.key === 'Enter' && onPick(a.id)}><span>{a.brand_name} {a.strength}</span><strong>{KES(a.selling_price)}</strong></div>)}</>}
          {x.prices.length > 1 && <><h3 style={{ marginTop: 16 }}>Price history</h3><table><tbody>{x.prices.slice(0, 6).map((p) => <tr key={p.id}><td className="sub">{eatTime(p.changed_at, true)}</td><td className="r">Buy {KES(p.buying_price)}</td><td className="r">Sell {KES(p.selling_price)}</td></tr>)}</tbody></table></>}
        </div></div>}
    </Modal>
  );
}

function DrugForm({ initial, onClose, onDone }) {
  const [f, setF] = useState(initial); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const sup = useLoad(() => get('/suppliers'));
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const save = async () => { setErr(''); setBusy(true); try { f.id ? await put('/drugs/' + f.id, f) : await post('/drugs', f); onDone(); } catch (e) { setErr(e.message); } finally { setBusy(false); } };
  return (
    <Modal title={f.id ? 'Edit drug' : 'Add drug'} wide onClose={onClose} footer={<>{f.id && <button className="btn" onClick={async () => { try { await put('/drugs/' + f.id, { ...f, active: !f.active }); onDone(); } catch (e) { setErr(e.message); } }}>{f.active ? 'Deactivate' : 'Reactivate'}</button>}<button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>Save drug</button></>}>
      <div className="form-grid">
        <Field label="Brand name *"><input autoFocus value={f.brand_name} onChange={set('brand_name')} /></Field>
        <Field label="Generic name"><input value={f.generic_name || ''} onChange={set('generic_name')} /></Field>
        <Field label="Strength"><input value={f.strength || ''} onChange={set('strength')} placeholder="500mg" /></Field>
        <Field label="Dosage form"><input value={f.dosage_form || ''} onChange={set('dosage_form')} placeholder="Tablet, syrup, cream…" list="forms" /></Field>
        <datalist id="forms">{['Tablet', 'Capsule', 'Syrup', 'Suspension', 'Injection', 'Cream', 'Ointment', 'Drops', 'Inhaler', 'Sachet', 'Suppository', 'Other'].map((x) => <option key={x} value={x} />)}</datalist>
        <Field label="Class *" hint="Decides which sale rules apply"><select value={f.drug_class} onChange={set('drug_class')}>{Object.entries(CLASS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Category"><input value={f.category || ''} onChange={set('category')} placeholder="Antibiotic, analgesic…" /></Field>
        <Field label="Units in one pack" hint="e.g. 20 tablets in a strip or box"><input type="number" min="1" value={f.pack_size} onChange={set('pack_size')} /></Field>
        <Field label="Unit name"><input value={f.unit_name || ''} onChange={set('unit_name')} placeholder="tablet, ml, sachet" /></Field>
        <label className="check full"><input type="checkbox" checked={!!f.allow_split} onChange={set('allow_split')} /> Can be sold loose (single tablets, part packs)</label>
        <Field label="Buying price per pack (KES)"><input type="number" min="0" value={f.buying_price} onChange={set('buying_price')} /></Field>
        <Field label="Selling price per pack (KES)" hint={f.pack_size > 1 && f.selling_price ? `≈ ${KES(f.selling_price / f.pack_size)} per unit` : ''}><input type="number" min="0" value={f.selling_price} onChange={set('selling_price')} /></Field>
        <Field label="Reorder level (units)"><input type="number" min="0" value={f.reorder_level} onChange={set('reorder_level')} /></Field>
        <Field label="Preferred supplier"><select value={f.preferred_supplier_id || ''} onChange={set('preferred_supplier_id')}><option value="">—</option>{sup.data?.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <Field label="Barcode"><input value={f.barcode || ''} onChange={set('barcode')} /></Field>
        <Field label="Manufacturer"><input value={f.manufacturer || ''} onChange={set('manufacturer')} /></Field>
        <Field label="Storage"><input value={f.storage || ''} onChange={set('storage')} placeholder="Below 25°C, keep in fridge…" /></Field>
        <label className="check"><input type="checkbox" checked={!!f.vat_applicable} onChange={set('vat_applicable')} /> VAT applies (price includes VAT)</label>
        <Field label="Notes" className="full"><textarea value={f.notes || ''} onChange={set('notes')} /></Field>
      </div>
      <ErrorBox error={err} />
    </Modal>
  );
}

function Importer({ onClose, onDone }) {
  const toast = useToast(); const fileRef = useRef(null);
  const [rows, setRows] = useState(null); const [res, setRes] = useState(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const TEMPLATE = 'brand_name,generic_name,strength,dosage_form,pack_size,unit_name,allow_split,category,barcode,drug_class,buying_price,selling_price,vat_applicable,reorder_level\nPanadol,Paracetamol,500mg,Tablet,20,tablet,yes,Analgesic,,OTC,100,200,no,40\nAmoxil,Amoxicillin,500mg,Capsule,10,capsule,no,Antibiotic,,POM,150,300,no,20';
  const onFile = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const parsed = parseCSV(await f.text()).map((r) => ({ ...r, allow_split: /^(yes|true|1|y)$/i.test(r.allow_split || ''), vat_applicable: /^(yes|true|1|y)$/i.test(r.vat_applicable || ''), drug_class: (r.drug_class || 'OTC').toUpperCase().replace(/\s+/g, '_') }));
    setRows(parsed); setRes(null); setErr('');
  };
  const go = async () => { setBusy(true); setErr(''); try { const r = await post('/drugs/import', { rows }); setRes(r); toast(`Imported: ${r.created} new, ${r.updated} updated`); } catch (e) { setErr(e.message); } finally { setBusy(false); } };
  return (
    <Modal title="Import drugs from CSV" onClose={onClose} footer={res ? <button className="btn primary" onClick={onDone}>Done</button> : <><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!rows?.length || busy} onClick={go}>{busy ? 'Importing…' : `Import ${rows?.length || 0} rows`}</button></>}>
      <p>Save your list as a CSV file from Excel (File → Save as → CSV). Existing drugs (same barcode, or same name and strength) are updated, new ones are added. Stock is not changed.</p>
      <button className="btn sm" onClick={() => download('drug-import-template.csv', TEMPLATE)}>⬇ Download template</button>
      <div style={{ margin: '14px 0' }}><input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onFile} /></div>
      {rows && !res && <div className="infobox">{rows.length} rows ready. First: {rows[0]?.brand_name || '(no brand_name column?)'}</div>}
      {res && <div className="infobox">Added {res.created}, updated {res.updated}, {res.errors.length} problem row(s).</div>}
      {res?.errors.slice(0, 10).map((e) => <div key={e.row} className="errbox">Row {e.row}: {e.error}</div>)}
      <ErrorBox error={err} />
    </Modal>
  );
}
