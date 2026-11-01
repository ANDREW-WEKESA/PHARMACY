import { useState } from 'react';
import { get, post } from '../api.js';
import { PageHead, useToast, Spinner } from '../ui.jsx';
import { download } from '../util.js';

export default function Backup({ user, pharmacy }) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const doBackup = async () => {
    setBusy(true);
    try {
      const data = await get('/backup');
      const json = JSON.stringify(data, null, 2);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      download(`${pharmacy.name}_backup_${timestamp}.json`, json);
      toast('Backup downloaded successfully!');
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHead icon="💾" title="Backup & Restore" sub="Export and import your pharmacy data" />
      
      <div className="card">
        <h3>📦 Create Backup</h3>
        <p>Download a complete backup of your pharmacy data including:</p>
        <ul style={{ marginLeft: 20, marginBottom: 20 }}>
          <li>Pharmacy information</li>
          <li>Users and staff</li>
          <li>Drugs and inventory</li>
          <li>Suppliers</li>
          <li>Customers</li>
          <li>Sales history</li>
          <li>Audit logs</li>
        </ul>
        <button className="btn primary" onClick={doBackup} disabled={busy}>
          {busy ? <><Spinner /> Creating backup...</> : '⬇️ Download Backup'}
        </button>
      </div>

      <div className="card" style={{ marginTop: 20, background: '#fff4d6', border: '2px solid #eab308' }}>
        <h3>⚠️ Important Notes</h3>
        <ul style={{ marginLeft: 20 }}>
          <li>Backups do NOT include password hashes for security reasons</li>
          <li>Store backups securely - they contain sensitive business data</li>
          <li>Regular backups recommended (daily for active pharmacies)</li>
          <li>Test your backups periodically</li>
        </ul>
      </div>
    </>
  );
}
