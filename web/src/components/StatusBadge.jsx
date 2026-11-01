import { Badge } from '../ui';
import { getExpiryStatus, getStockStatus } from '../util';

export function ExpiryStatusBadge({ expiryDate }) {
  if (!expiryDate) return null;
  const status = getExpiryStatus(expiryDate);
  return <Badge className={status.color}>{status.label}</Badge>;
}

export function StockStatusBadge({ stockUnits, reorderLevel }) {
  const status = getStockStatus(stockUnits, reorderLevel);
  return <Badge className={status.color}>{status.label}</Badge>;
}

export function AlertLevelBadge({ level, children }) {
  const colors = {
    expired: 'bg-red-100 text-red-800 border-red-300',
    critical: 'bg-orange-100 text-orange-800 border-orange-300',
    warning: 'bg-yellow-100 text-yellow-800 border-yellow-300',
    low: 'bg-yellow-100 text-yellow-800 border-yellow-300',
    ok: 'bg-green-100 text-green-800 border-green-300',
    out_of_stock: 'bg-red-100 text-red-800 border-red-300',
    out: 'bg-red-100 text-red-800 border-red-300'
  };
  
  return (
    <Badge className={colors[level] || 'bg-gray-100 text-gray-800'} style={{ border: '1px solid', fontWeight: 600 }}>
      {children}
    </Badge>
  );
}
