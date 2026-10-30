import { get } from '../api.js';
import { KES, num, fmtDate, daysUntil, METHOD_LABEL, ROLE_LABEL } from '../util.js';
import { PageHead, Spinner, ErrorBox, useLoad, Empty, Badge, Tabs } from '../ui.jsx';
import { useState } from 'react';

function Bars({ rows }) {
  const max = Math.max(1, ...rows.map((r) => r.total));
  return (
    <div className="bars" role="img" aria-label="Sales for the last 14 days">
      {rows.map((r) => (
        <div className="bar" key={r.day} title={`${fmtDate(r.day)}: ${KES(r.total)} (${r.n} sales)`}>
          <i style={{ height: Math.max(3, (r.total / max) * 100) + '%' }} /><span>{r.day.slice(8)}</span>
        </div>
      ))}
    </div>
  );
}

export default function Dashboard({ user, go }) {
  const d = useLoad(() => get('/dashboard'));
  const canStock = user.role !== 'cashier';
  const a = useLoad(() => (canStock ? get('/stock/alerts') : Promise.resolve(null)));
  const [topTab, setTopTab] = useState('day');
  const [expTab, setExpTab] = useState('d30');

  if (d.loading && !d.data) return <><PageHead icon="📊" title="Dashboard" sub="How the pharmacy is doing today" /><Spinner /></>;
  const x = d.data;
  const diff = x ? x.today.total - x.yesterday.total : 0;
  const pct = x && x.yesterday.total ? Math.round((diff / x.yesterday.total) * 100) : null;
  const al = a.data;
  const top = x?.top[topTab] || [];
  const topMax = Math.max(1, ...top.map((t) => t.revenue));

  return (
    <>
      <PageHead icon="📊" title="Dashboard" sub="How the pharmacy is doing today">
        <button className="btn primary" onClick={() => go('sales')}>+ New Sale</button>
      </PageHead>
      <ErrorBox error={d.error} retry={d.reload} />
      {x && (
        <>
          <div className="grid g4" style={{ marginBottom: 18 }}>
            <div className="stat good"><span>Today's sales</span><strong>{KES(x.today.total)}</strong>
              <small>{pct == null ? 'No sales yesterday' : <><span className={diff >= 0 ? 'up' : 'down'}>{diff >= 0 ? '▲' : '▼'} {Math.abs(pct)}%</span> vs yesterday ({KES(x.yesterday.total)})</>}</small></div>
            <div className="stat"><span>Transactions</span><strong>{num(x.today.count)}</strong><small>Yesterday: {num(x.yesterday.count)}</small></div>
            <div className="stat"><span>Average sale</span><strong>{KES(x.today.average)}</strong><small>Per transaction today</small></div>
            {x.today.profit != null
              ? <div className="stat"><span>Estimated profit today</span><strong>{KES(x.today.profit)}</strong><small>Sales minus VAT and cost</small></div>
              : <div className="stat"><span>Signed in as</span><strong style={{ fontSize: 20 }}>{ROLE_LABEL[user.role]}</strong><small>{user.name}</small></div>}
          </div>

          {al && (al.out.length + al.low.length + al.expired.length > 0) && (
            <div className="warnbox" style={{ background: '#fff4d6' }}>
              ⚠️ {al.out.length ? `${al.out.length} out of stock. ` : ''}{al.low.length ? `${al.low.length} running low. ` : ''}{al.expired.length ? `${al.expired.length} expired batch${al.expired.length > 1 ? 'es' : ''} still on the shelf. ` : ''}
              <a href="#/stock" onClick={() => go('stock')}>Open Stock Management</a>
            </div>
          )}

          <div className="grid g2">
            <div className="card"><div className="card-head"><h3>Sales, last 14 days</h3></div><Bars rows={x.trend} /></div>
            <div className="card"><div className="card-head"><h3>Top sellers</h3></div>
              <div style={{ color: 'var(--ink)' }}><div className="tabs" style={{ marginBottom: 10 }}>
                {[['day', 'Today'], ['week', '7 days'], ['month', 'This month']].map(([id, l]) => (
                  <button key={id} className={topTab === id ? 'on' : ''} style={topTab === id ? { background: 'var(--p2)', color: '#fff' } : { background: 'var(--bg)', color: 'var(--ink)', border: '1px solid var(--line)' }} onClick={() => setTopTab(id)}>{l}</button>
                ))}</div></div>
              {top.length === 0 ? <Empty icon="🛒" title="No sales in this period" /> : (
                <div className="rank">{top.map((t) => (
                  <div className="rank-row" key={t.drug_id}><span>{t.brand_name} {t.strength || ''}</span><strong>{KES(t.revenue)}</strong>
                    <div className="rank-bar"><i style={{ width: (t.revenue / topMax) * 100 + '%' }} /></div></div>
                ))}</div>)}
            </div>
          </div>

          <div className="grid g2">
            <div className="card"><h3>Payment methods today</h3>
              {x.byMethod.length === 0 ? <Empty icon="💳" title="No payments yet today" /> : (
                <div className="table-wrap"><table><tbody>{x.byMethod.map((m) => <tr key={m.method}><td>{METHOD_LABEL[m.method] || m.method}</td><td className="r mono"><strong>{KES(m.total)}</strong></td></tr>)}</tbody></table></div>)}
            </div>
            {al && (
              <div className="card"><div className="card-head"><h3>Expiry alerts</h3>
                <div style={{ display: 'flex', gap: 6 }}>{[['d30', '30 days'], ['d60', '60 days'], ['d90', '90 days'], ['expired', 'Expired']].map(([id, l]) => (
                  <button key={id} className="btn sm" style={expTab === id ? { background: 'var(--p2)', color: '#fff' } : {}} onClick={() => setExpTab(id)}>{l}</button>))}</div></div>
                {(expTab === 'expired' ? al.expired : al.buckets[expTab]).length === 0 ? <Empty icon="✅" title="Nothing here" sub="No batches in this window" /> : (
                  <div className="table-wrap" style={{ maxHeight: 260 }}><table><thead><tr><th>Drug</th><th>Batch</th><th>Expires</th><th className="r">Units</th></tr></thead><tbody>
                    {(expTab === 'expired' ? al.expired : al.buckets[expTab]).map((b) => (
                      <tr key={b.batch_id}><td>{b.brand_name} {b.strength || ''}</td><td>{b.batch_no}</td>
                        <td><Badge kind={daysUntil(b.expiry_date) < 0 ? 'bad' : daysUntil(b.expiry_date) <= 30 ? 'warn' : 'gray'}>{fmtDate(b.expiry_date)}</Badge></td><td className="r">{num(b.qty_units)}</td></tr>))}
                  </tbody></table></div>)}
              </div>
            )}
          </div>

          {al && (
            <div className="card"><div className="card-head"><h3>Low and out of stock</h3><button className="btn sm" onClick={() => go('stock')}>Open stock</button></div>
              {al.low.length + al.out.length === 0 ? <Empty icon="✅" title="Everything is above its reorder level" /> : (
                <div className="table-wrap" style={{ maxHeight: 300 }}><table><thead><tr><th>Drug</th><th className="r">In stock</th><th className="r">Reorder level</th><th>Status</th></tr></thead><tbody>
                  {[...al.out, ...al.low].slice(0, 30).map((r) => (
                    <tr key={r.id}><td>{r.brand_name} {r.strength || ''}</td><td className="r">{num(r.stock_units)}</td><td className="r">{num(r.reorder_level)}</td>
                      <td>{r.stock_units <= 0 ? <Badge kind="bad">Out of stock</Badge> : <Badge kind="warn">Low</Badge>}</td></tr>))}
                </tbody></table></div>)}
            </div>
          )}
        </>
      )}
    </>
  );
}
