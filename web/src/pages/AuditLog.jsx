import { useState, useEffect } from 'react';
import { api } from '../api';
import { Card, Input, Badge, Loader } from '../ui';

const ACTION_COLORS = {
  login: 'bg-green-100 text-green-800',
  login_failed: 'bg-red-100 text-red-800',
  logout: 'bg-gray-100 text-gray-800',
  user_created: 'bg-blue-100 text-blue-800',
  user_updated: 'bg-yellow-100 text-yellow-800',
  sale_created: 'bg-green-100 text-green-800',
  stock_adjustment: 'bg-purple-100 text-purple-800',
  delivery_received: 'bg-cyan-100 text-cyan-800',
  password_changed: 'bg-orange-100 text-orange-800',
  settings_updated: 'bg-indigo-100 text-indigo-800',
  backup_exported: 'bg-pink-100 text-pink-800',
  default: 'bg-gray-100 text-gray-800'
};

export function AuditLog() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    loadLogs();
  }, [page, search]);

  const loadLogs = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({ page: page.toString() });
      if (search) params.append('q', search);
      const data = await api.get(`/audit?${params}`);
      setLogs(data.rows || []);
      setTotal(data.total || 0);
    } catch (err) {
      console.error('Failed to load audit logs:', err);
    } finally {
      setLoading(false);
    }
  };

  const getActionColor = (action) => ACTION_COLORS[action] || ACTION_COLORS.default;

  const formatDate = (dateStr) => {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleString('en-KE', { 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const totalPages = Math.ceil(total / 50);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Audit Log</h1>
        <Badge className="bg-blue-100 text-blue-800">
          {total} total events
        </Badge>
      </div>

      <Card className="p-4">
        <Input
          placeholder="Search by action, user, or detail..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </Card>

      {loading ? (
        <div className="flex justify-center p-8">
          <Loader />
        </div>
      ) : (
        <>
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">ID</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Timestamp</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Action</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">User</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Entity</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Detail</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {logs.length === 0 ? (
                    <tr>
                      <td colSpan="6" className="px-4 py-8 text-center text-gray-500">
                        No audit logs found
                      </td>
                    </tr>
                  ) : (
                    logs.map((log) => (
                      <tr key={log.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm text-gray-900">{log.id}</td>
                        <td className="px-4 py-3 text-sm text-gray-600">
                          {formatDate(log.created_at)}
                        </td>
                        <td className="px-4 py-3">
                          <Badge className={getActionColor(log.action)}>
                            {log.action.replace(/_/g, ' ')}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-900">
                          {log.user_name || '-'}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">
                          {log.entity ? `${log.entity} #${log.entity_id || '-'}` : '-'}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">
                          {log.detail || '-'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          {totalPages > 1 && (
            <Card className="p-4">
              <div className="flex justify-between items-center">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-4 py-2 bg-blue-600 text-white rounded disabled:bg-gray-300 disabled:cursor-not-allowed"
                >
                  Previous
                </button>
                <span className="text-sm text-gray-600">
                  Page {page} of {totalPages}
                </span>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="px-4 py-2 bg-blue-600 text-white rounded disabled:bg-gray-300 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
