import { get } from '../api.js';
import { KES, num } from '../util.js';
import { PageHead, Spinner, ErrorBox, useLoad, Empty, Badge } from '../ui.jsx';

export default function OwnerDashboard({ user, go }) {
  const d = useLoad(() => get('/owner/dashboard'));

  if (d.loading && !d.data) {
    return (
      <>
        <PageHead icon="🏢" title="Owner Dashboard" sub="Consolidated view of all your pharmacies" />
        <Spinner />
      </>
    );
  }

  const x = d.data;

  return (
    <>
      <PageHead icon="🏢" title="Owner Dashboard" sub="Consolidated view of all your pharmacies">
        <button className="btn primary" onClick={() => go('owner-pharmacies')}>+ Add Pharmacy</button>
      </PageHead>
      <ErrorBox error={d.error} retry={d.reload} />
      
      {x && (
        <>
          <div className="grid g4" style={{ marginBottom: 18 }}>
            <div className="stat">
              <span>Total Pharmacies</span>
              <strong>{num(x.total_pharmacies)}</strong>
              <small>{x.total_pharmacies === 1 ? '1 location' : `${x.total_pharmacies} locations`}</small>
            </div>
            <div className="stat good">
              <span>Combined Sales Today</span>
              <strong>{KES(x.total_sales_today)}</strong>
              <small>Across all pharmacies</small>
            </div>
            <div className="stat">
              <span>Total Inventory Value</span>
              <strong>{KES(x.total_inventory_value)}</strong>
              <small>Current stock value</small>
            </div>
            <div className="stat">
              <span>Total Staff</span>
              <strong>{num(x.total_staff)}</strong>
              <small>Active employees</small>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h3>Pharmacy Comparison</h3>
            </div>
            {x.pharmacies?.length === 0 ? (
              <Empty icon="🏪" title="No pharmacies yet" sub="Add your first pharmacy to get started" />
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Status</th>
                      <th className="r">Today's Sales</th>
                      <th className="r">Inventory Value</th>
                      <th className="r">Low Stock</th>
                      <th className="r">Expiry Alerts</th>
                      <th className="r">Staff</th>
                    </tr>
                  </thead>
                  <tbody>
                    {x.pharmacies?.map(p => (
                      <tr key={p.id}>
                        <td><strong>{p.name}</strong></td>
                        <td>
                          <Badge kind={p.active ? 'ok' : 'gray'}>
                            {p.active ? 'Active' : 'Inactive'}
                          </Badge>
                        </td>
                        <td className="r mono">{KES(p.sales_today || 0)}</td>
                        <td className="r mono">{KES(p.inventory_value || 0)}</td>
                        <td className="r">
                          {p.low_stock_count > 0 ? (
                            <Badge kind="warn">{num(p.low_stock_count)}</Badge>
                          ) : (
                            <span className="sub">—</span>
                          )}
                        </td>
                        <td className="r">
                          {p.expiry_alerts > 0 ? (
                            <Badge kind="warn">{num(p.expiry_alerts)}</Badge>
                          ) : (
                            <span className="sub">—</span>
                          )}
                        </td>
                        <td className="r">{num(p.staff_count || 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
