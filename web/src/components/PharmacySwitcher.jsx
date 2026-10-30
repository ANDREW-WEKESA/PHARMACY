import { usePharmacy } from '../contexts/PharmacyContext.jsx';

export function PharmacySwitcher() {
  const { isSystemOwner, selectedPharmacyId, pharmacyList, switchPharmacy } = usePharmacy();

  if (!isSystemOwner) return null;

  return (
    <div style={{ marginRight: 12 }}>
      <select 
        value={selectedPharmacyId ?? 'all'} 
        onChange={(e) => switchPharmacy(e.target.value === 'all' ? null : parseInt(e.target.value))}
        style={{ 
          minHeight: 44, 
          padding: '8px 12px', 
          borderRadius: 6,
          border: '1px solid var(--line)',
          background: 'var(--bg)',
          color: 'var(--ink)',
          fontSize: 14,
          cursor: 'pointer'
        }}
        aria-label="Select pharmacy"
      >
        <option value="all">🏢 All Pharmacies</option>
        {pharmacyList.map(p => (
          <option key={p.id} value={p.id}>
            {p.name} {p.active === 0 ? '(Inactive)' : ''}
          </option>
        ))}
      </select>
    </div>
  );
}
