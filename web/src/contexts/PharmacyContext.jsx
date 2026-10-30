import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { get } from '../api.js';

const PharmacyContext = createContext(null);

export function PharmacyProvider({ children, user }) {
  const isSystemOwner = user?.is_system_owner === 1;
  const [selectedPharmacyId, setSelectedPharmacyId] = useState(() => {
    try {
      const stored = localStorage.getItem('selected_pharmacy_id');
      return stored ? parseInt(stored) : null;
    } catch {
      return null;
    }
  });
  const [pharmacyList, setPharmacyList] = useState([]);
  const [loading, setLoading] = useState(isSystemOwner);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user) {
      console.warn('PharmacyContext: user is undefined');
      setError('User not initialized');
      setLoading(false);
      return;
    }
    if (isSystemOwner) {
      setLoading(true);
      get('/owner/pharmacies')
        .then(data => {
          setPharmacyList(data.pharmacies || []);
          setError('');
        })
        .catch(err => {
          console.error('Failed to load pharmacies:', err);
          setError(err.message || 'Failed to load pharmacies');
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [isSystemOwner, user]);

  const switchPharmacy = useCallback((id) => {
    setSelectedPharmacyId(id);
    try {
      if (id === null) {
        localStorage.removeItem('selected_pharmacy_id');
      } else {
        localStorage.setItem('selected_pharmacy_id', String(id));
      }
    } catch {}
  }, []);

  const refreshPharmacies = useCallback(async () => {
    if (isSystemOwner) {
      const data = await get('/owner/pharmacies');
      setPharmacyList(data.pharmacies || []);
    }
  }, [isSystemOwner]);

  return (
    <PharmacyContext.Provider value={{ 
      isSystemOwner, 
      selectedPharmacyId, 
      pharmacyList, 
      switchPharmacy,
      refreshPharmacies,
      loading,
      error
    }}>
      {children}
    </PharmacyContext.Provider>
  );
}

export const usePharmacy = () => useContext(PharmacyContext);
