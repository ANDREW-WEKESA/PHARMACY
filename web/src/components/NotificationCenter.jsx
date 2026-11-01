import { useState, useEffect } from 'react';
import { get } from '../api.js';
import { fmtDate } from '../util.js';
import { useLoad, Badge } from '../ui.jsx';

export function NotificationCenter({ onClose }) {
  const expiry = useLoad(() => get('/expiry-alerts'), []);
  const stock = useLoad(() => get('/stock-alerts'), []);
  const [activeTab, setActiveTab] = useState('expiry');

  const getAlertColor = (level) => {
    switch(level) {
      case 'expired':
      case 'out_of_stock':
        return '#ef4444'; // red
      case 'critical':
        return '#f97316'; // orange
      case 'warning':
      case 'low':
        return '#eab308'; // yellow
      default:
        return '#10b981'; // green
    }
  };

  const getAlertLabel = (level) => {
    switch(level) {
      case 'expired': return 'EXPIRED';
      case 'critical': return 'CRITICAL';
      case 'warning': return 'WARNING';
      case 'low': return 'LOW STOCK';
      case 'out_of_stock': return 'OUT OF STOCK';
      default: return 'OK';
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 800, maxHeight: '80vh', overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2>📬 Notifications</h2>
          <button className="btn ghost" onClick={onClose}>✕</button>
        </div>

        <div style={{ display: 'flex', gap: 10, marginBottom: 20, borderBottom: '2px solid #e5e7eb' }}>
          <button 
            className={`btn ${activeTab === 'expiry' ? 'primary' : 'ghost'}`}
            onClick={() => setActiveTab('expiry')}
          >
            ⏰ Expiry Alerts {expiry.data && `(${expiry.data.summary.total})`}
          </button>
          <button 
            className={`btn ${activeTab === 'stock' ? 'primary' : 'ghost'}`}
            onClick={() => setActiveTab('stock')}
          >
            📦 Stock Alerts {stock.data && `(${stock.data.summary.total})`}
          </button>
        </div>

        {activeTab === 'expiry' && expiry.data && (
          <div>
            <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
              <div style={{ padding: 10, background: '#fee', borderLeft: '4px solid #ef4444', flex: 1, minWidth: 150 }}>
                <strong style={{ color: '#ef4444' }}>{expiry.data.summary.expired}</strong>
                <div className="sub">Expired</div>
              </div>
              <div style={{ padding: 10, background: '#fff4e6', borderLeft: '4px solid #f97316', flex: 1, minWidth: 150 }}>
                <strong style={{ color: '#f97316' }}>{expiry.data.summary.critical}</strong>
                <div className="sub">Critical (≤30 days)</div>
              </div>
              <div style={{ padding: 10, background: '#fefce8', borderLeft: '4px solid #eab308', flex: 1, minWidth: 150 }}>
                <strong style={{ color: '#eab308' }}>{expiry.data.summary.warning}</strong>
                <div className="sub">Warning (≤90 days)</div>
              </div>
            </div>

            {expiry.data.alerts.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 40, color: '#10b981' }}>
                ✅ All stock is within safe expiry dates!
              </div>
            ) : (
              <div style={{ maxHeight: 400, overflow: 'auto' }}>
                {expiry.data.alerts.map((alert) => (
                  <div key={`${alert.id}-${alert.batch_no}`} style={{ 
                    padding: 12, 
                    marginBottom: 8, 
                    background: '#f9fafb',
                    borderLeft: `4px solid ${getAlertColor(alert.alert_level)}`,
                    borderRadius: 4
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                      <div>
                        <strong>{alert.brand_name}</strong>
                        <div className="sub">{alert.generic_name} • Batch: {alert.batch_no}</div>
                      </div>
                      <Badge kind={alert.alert_level === 'expired' ? 'bad' : alert.alert_level === 'critical' ? 'warn' : 'info'}>
                        {getAlertLabel(alert.alert_level)}
                      </Badge>
                    </div>
                    <div style={{ marginTop: 8, display: 'flex', gap: 20 }}>
                      <div>
                        <span className="sub">Expires:</span> <strong style={{ color: getAlertColor(alert.alert_level) }}>{fmtDate(alert.expiry_date)}</strong>
                      </div>
                      <div>
                        <span className="sub">Days left:</span> <strong>{alert.days_until_expiry}</strong>
                      </div>
                      <div>
                        <span className="sub">Stock:</span> <strong>{alert.qty_units} units</strong>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'stock' && stock.data && (
          <div>
            <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
              <div style={{ padding: 10, background: '#fee', borderLeft: '4px solid #ef4444', flex: 1, minWidth: 150 }}>
                <strong style={{ color: '#ef4444' }}>{stock.data.summary.out_of_stock}</strong>
                <div className="sub">Out of Stock</div>
              </div>
              <div style={{ padding: 10, background: '#fff4e6', borderLeft: '4px solid #f97316', flex: 1, minWidth: 150 }}>
                <strong style={{ color: '#f97316' }}>{stock.data.summary.critical}</strong>
                <div className="sub">Critical Low</div>
              </div>
              <div style={{ padding: 10, background: '#fefce8', borderLeft: '4px solid #eab308', flex: 1, minWidth: 150 }}>
                <strong style={{ color: '#eab308' }}>{stock.data.summary.low}</strong>
                <div className="sub">Low Stock</div>
              </div>
            </div>

            {stock.data.alerts.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 40, color: '#10b981' }}>
                ✅ All items are adequately stocked!
              </div>
            ) : (
              <div style={{ maxHeight: 400, overflow: 'auto' }}>
                {stock.data.alerts.map((alert) => (
                  <div key={alert.id} style={{ 
                    padding: 12, 
                    marginBottom: 8, 
                    background: '#f9fafb',
                    borderLeft: `4px solid ${getAlertColor(alert.alert_level)}`,
                    borderRadius: 4
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                      <div>
                        <strong>{alert.brand_name}</strong>
                        <div className="sub">{alert.generic_name}</div>
                      </div>
                      <Badge kind={alert.alert_level === 'out_of_stock' ? 'bad' : alert.alert_level === 'critical' ? 'warn' : 'info'}>
                        {getAlertLabel(alert.alert_level)}
                      </Badge>
                    </div>
                    <div style={{ marginTop: 8, display: 'flex', gap: 20 }}>
                      <div>
                        <span className="sub">Current Stock:</span> <strong style={{ color: getAlertColor(alert.alert_level) }}>{alert.stock_units} units</strong>
                      </div>
                      <div>
                        <span className="sub">Reorder Level:</span> <strong>{alert.reorder_level} units</strong>
                      </div>
                      <div>
                        <span className="sub">Pack Size:</span> <strong>{alert.pack_size}</strong>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
