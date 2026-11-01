export const KES = (n) => 'KES ' + Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
export const num = (n) => Number(n || 0).toLocaleString('en-KE');

// Server timestamps are UTC "YYYY-MM-DD HH:MM:SS"; show them in Nairobi time.
export function eatTime(s, withDate = true) {
  if (!s) return '';
  const d = new Date(s.replace(' ', 'T') + 'Z');
  if (isNaN(d)) return s;
  const opt = { timeZone: 'Africa/Nairobi' };
  const date = d.toLocaleDateString('en-GB', { ...opt, day: '2-digit', month: 'short', year: 'numeric' });
  const time = d.toLocaleTimeString('en-GB', { ...opt, hour: '2-digit', minute: '2-digit' });
  return withDate ? `${date}, ${time}` : time;
}
export const todayEAT = () => new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
export const addDaysStr = (s, n) => new Date(Date.parse(s + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
export const fmtDate = (s) => (s ? new Date(s + 'T00:00:00Z').toLocaleDateString('en-GB', { timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric' }) : '');
export const daysUntil = (s) => Math.round((Date.parse(s + 'T00:00:00Z') - Date.parse(todayEAT() + 'T00:00:00Z')) / 86400000);

export const ROLE_LABEL = { owner: 'Owner', pharmacist: 'Pharmacist', cashier: 'Cashier', stock_clerk: 'Stock clerk' };
export const CLASS_LABEL = { OTC: 'Over the counter', PHARMACY_ONLY: 'Pharmacy only', POM: 'Prescription only', CONTROLLED: 'Controlled' };
export const METHOD_LABEL = { cash: 'Cash', mpesa: 'M-Pesa', card: 'Card', insurance: 'Insurance', credit_payment: 'Debt payment' };

// Show loose units as "2 packs + 5 units" so stock is easy to read at the counter
export function packsText(units, drug) {
  const size = drug?.pack_size || 1;
  const unit = drug?.unit_name && drug.unit_name !== 'pack' ? drug.unit_name : 'unit';
  if (size <= 1) return `${num(units)}`;
  const packs = Math.floor(units / size), loose = units % size;
  if (!packs) return `${loose} ${unit}${loose === 1 ? '' : 's'}`;
  return loose ? `${packs} pk + ${loose}` : `${packs} pk`;
}

export function toCSV(rows, columns) {
  const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return [columns.map((c) => esc(c.label)).join(','), ...rows.map((r) => columns.map((c) => esc(typeof c.value === 'function' ? c.value(r) : r[c.key])).join(','))].join('\n');
}
export function download(name, text, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob(['﻿' + text], { type: type + ';charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
// Minimal CSV parser (handles quotes) for the drug import
export function parseCSV(text) {
  const rows = []; let row = [], cur = '', q = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.some((x) => x.trim() !== '')) rows.push(row); row = []; }
    else cur += ch;
  }
  row.push(cur); if (row.some((x) => x.trim() !== '')) rows.push(row);
  if (!rows.length) return [];
  const head = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
  return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}

// Enhanced Excel export with styled headers
export function toExcel(rows, columns, sheetName = 'Sheet1') {
  const escapeXml = (str) => String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  
  let xml = '<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?>';
  xml += '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">';
  xml += '<Styles><Style ss:ID="header"><Font ss:Bold="1"/><Interior ss:Color="#4F81BD" ss:Pattern="Solid"/></Style></Styles>';
  xml += `<Worksheet ss:Name="${escapeXml(sheetName)}"><Table>`;
  
  // Header row
  xml += '<Row>';
  columns.forEach(col => {
    xml += `<Cell ss:StyleID="header"><Data ss:Type="String">${escapeXml(col.label)}</Data></Cell>`;
  });
  xml += '</Row>';
  
  // Data rows
  rows.forEach(row => {
    xml += '<Row>';
    columns.forEach(col => {
      const value = typeof col.value === 'function' ? col.value(row) : row[col.key];
      const isNumber = typeof value === 'number' || (!isNaN(value) && value !== '');
      xml += `<Cell><Data ss:Type="${isNumber ? 'Number' : 'String'}">${escapeXml(value)}</Data></Cell>`;
    });
    xml += '</Row>';
  });
  
  xml += '</Table></Worksheet></Workbook>';
  return xml;
}

export function downloadExcel(name, xmlContent) {
  download(name, xmlContent, 'application/vnd.ms-excel');
}
