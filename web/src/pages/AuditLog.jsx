import { useState } from 'react';
import { get, qs } from '../api';
import { Badge, Spinner, useLoad } from '../ui';
import { eatTime } from '../util';

const ACTION_COLORS = {
  login: 'ok',
  login_failed: 'bad',
  logout: 'gray',
  user_created: 'info',
  user_updated: 'warn',
  sale_created: 'ok',
  stock_adjustment: 'info',
  delivery_received: 'info',
  password_changed: 'warn',
  settings_updated: 'info',
  backup_exported: 'info',
};

export function AuditLog() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  
  const r = useLoad(() => get('/audit' + qs({ q: search, page })), [search, page]);
  const logs = r.data?.rows || [];
  const total = r.data?.total || 0;
  const totalPages = Math.ceil(total / 50);

  const getActionColor = (action) => ACTION_COLORS[action] || 'gray';

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, fontWeight: 'bold' }}>📋 Audit Log</h1>
        <Badge kind="info">{total} events</Badge>
      </div>

      <div className="card" style={{ padding: 16, marginBottom: 20 }}>
        <input
          className="grow"
          placeholder="Search by action, user, or detail..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          style={{ width: '100%', padding: 8 }}
        />
      </div>

      {r.loading && !r.data ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 32 }}>
          <Spinner />
        </div>
      ) : (
        <>
          <div className="card">
            <div className="table-wrap">
              <table>
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: '#666', textTransform: 'uppercase' }}>ID</th>
                    <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: '#666', textTransform: 'uppercase' }}>Timestamp</th>
                    <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: '#666', textTransform: 'uppercase' }}>Action</th>
                    <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: '#666', textTransform: 'uppercase' }}>User</th>
                    <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: '#666', textTransform: 'uppercase' }}>Entity</th>
                    <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: '#666', textTransform: 'uppercase' }}>Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.length === 0 ? (
                    <tr>
                      <td colSpan="6" style={{ padding: '32px', textAlign: 'center', color: '#666' }}>
                        No audit logs found
                      </td>
                    </tr>
                  ) : (
                    logs.map((log) => (
                      <tr key={log.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                        <td style={{ padding: '12px 16px', fontSize: 14 }}>{log.id}</td>
                        <td style={{ padding: '12px 16px', fontSize: 14, color: '#666' }}>
                          {eatTime(log.created_at)}
                        </td>
                        <td style={{ padding: '12px 16px' }}>
                          <Badge kind={getActionColor(log.action)}>
                            {log.action.replace(/_/g, ' ')}
                          </Badge>
                        </td>
                        <td style={{ padding: '12px 16px', fontSize: 14 }}>
                          {log.user_name || '-'}
                        </td>
                        <td style={{ padding: '12px 16px', fontSize: 14, color: '#666' }}>
                          {log.entity ? `${log.entity} #${log.entity_id || '-'}` : '-'}
                        </td>
                        <td style={{ padding: '12px 16px', fontSize: 14, color: '#666' }}>
                          {log.detail || '-'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {totalPages > 1 && (
            <div className="card" style={{ padding: 16, marginTop: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="btn"
                >
                  Previous
                </button>
                <span style={{ fontSize: 14, color: '#666' }}>
                  Page {page} of {totalPages}
                </span>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="btn"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
