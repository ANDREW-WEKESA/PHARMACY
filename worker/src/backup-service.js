// Automated backup service for pharmacy data
import { q, eatDate } from './lib.js';

/**
 * Generate comprehensive backup data for a pharmacy
 * @param {Object} db - D1 database
 * @param {number} pharmacyId - Pharmacy ID to backup
 * @returns {Object} - Complete backup data
 */
export async function generateBackupData(db, pharmacyId) {
  const backupDate = new Date().toISOString();
  
  // Pharmacy details
  const pharmacy = await q.first(db, 'SELECT * FROM pharmacy WHERE id = ?', pharmacyId);
  
  // Users (staff)
  const users = await q.all(db, 
    'SELECT id, name, email, phone, role, reg_no, active FROM users WHERE assigned_pharmacy_id = ?', 
    pharmacyId);
  
  // Drugs catalog
  const drugs = await q.all(db, 
    'SELECT * FROM drugs WHERE pharmacy_id = ? AND active = 1', 
    pharmacyId);
  
  // Batches (current stock)
  const batches = await q.all(db, 
    `SELECT b.*, d.brand_name, d.strength 
     FROM batches b 
     JOIN drugs d ON d.id = b.drug_id 
     WHERE d.pharmacy_id = ? AND b.active = 1`, 
    pharmacyId);
  
  // Sales (last 90 days)
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const sales = await q.all(db, 
    `SELECT s.*, u.name as cashier_name 
     FROM sales s 
     LEFT JOIN users u ON u.id = s.cashier_id 
     WHERE s.pharmacy_id = ? AND s.sale_date >= ?
     ORDER BY s.sale_date DESC`, 
    pharmacyId, ninetyDaysAgo);
  
  // Suppliers
  const suppliers = await q.all(db, 
    'SELECT * FROM suppliers WHERE pharmacy_id = ?', 
    pharmacyId);
  
  // Customers with credit
  const customers = await q.all(db, 
    'SELECT * FROM customers WHERE pharmacy_id = ? AND credit_balance > 0', 
    pharmacyId);
  
  // Controlled drugs register (last 90 days)
  const controlledRegister = await q.all(db, 
    `SELECT cr.*, d.brand_name, d.strength 
     FROM controlled_register cr 
     JOIN drugs d ON d.id = cr.drug_id 
     WHERE d.pharmacy_id = ? AND cr.created_at >= ?
     ORDER BY cr.created_at DESC`, 
    pharmacyId, ninetyDaysAgo);
  
  // Financial summary
  const financialSummary = await q.first(db, 
    `SELECT 
      COUNT(*) total_sales,
      SUM(CASE WHEN status = 'completed' THEN total ELSE 0 END) total_revenue,
      SUM(CASE WHEN status = 'completed' THEN subtotal - total ELSE 0 END) total_discounts,
      SUM(CASE WHEN balance_due > 0 THEN balance_due ELSE 0 END) total_credit
     FROM sales 
     WHERE pharmacy_id = ? AND sale_date >= ?`, 
    pharmacyId, ninetyDaysAgo);
  
  // Inventory summary
  const inventorySummary = await q.first(db, 
    `SELECT 
      COUNT(DISTINCT d.id) total_drugs,
      COALESCE(SUM(b.qty_units), 0) total_units,
      COALESCE(SUM(b.qty_units * b.selling_price / d.pack_size), 0) inventory_value
     FROM drugs d 
     LEFT JOIN batches b ON b.drug_id = d.id AND b.active = 1 AND b.qty_units > 0
     WHERE d.pharmacy_id = ? AND d.active = 1`, 
    pharmacyId);
  
  return {
    backup_date: backupDate,
    pharmacy,
    summary: {
      financial: financialSummary,
      inventory: inventorySummary,
      staff_count: users.length,
      supplier_count: suppliers.length,
      customer_count: customers.length
    },
    users,
    drugs,
    batches,
    sales,
    suppliers,
    customers,
    controlled_register: controlledRegister
  };
}

/**
 * Convert backup data to CSV format
 * @param {Object} backupData - Backup data object
 * @returns {Object} - CSV files by category
 */
export function generateCSVBackup(backupData) {
  const csvFiles = {};
  
  // Helper to convert array to CSV
  const arrayToCSV = (arr) => {
    if (!arr || arr.length === 0) return '';
    const headers = Object.keys(arr[0]).join(',');
    const rows = arr.map(obj => 
      Object.values(obj).map(v => {
        if (v === null || v === undefined) return '';
        const str = String(v);
        return str.includes(',') || str.includes('"') || str.includes('\n') 
          ? `"${str.replace(/"/g, '""')}"` 
          : str;
      }).join(',')
    );
    return [headers, ...rows].join('\n');
  };
  
  csvFiles['pharmacy_info.csv'] = arrayToCSV([backupData.pharmacy]);
  csvFiles['users.csv'] = arrayToCSV(backupData.users);
  csvFiles['drugs.csv'] = arrayToCSV(backupData.drugs);
  csvFiles['batches.csv'] = arrayToCSV(backupData.batches);
  csvFiles['sales.csv'] = arrayToCSV(backupData.sales);
  csvFiles['suppliers.csv'] = arrayToCSV(backupData.suppliers);
  csvFiles['customers.csv'] = arrayToCSV(backupData.customers);
  csvFiles['controlled_register.csv'] = arrayToCSV(backupData.controlled_register);
  csvFiles['summary.csv'] = `Category,Value\nBackup Date,${backupData.backup_date}\nPharmacy,${backupData.pharmacy.name}\nTotal Sales (90 days),${backupData.summary.financial.total_sales}\nTotal Revenue,${backupData.summary.financial.total_revenue}\nInventory Value,${backupData.summary.inventory.inventory_value}\nTotal Drugs,${backupData.summary.inventory.total_drugs}\nStaff Count,${backupData.summary.staff_count}`;
  
  return csvFiles;
}

/**
 * Store backup to R2 bucket
 * @param {Object} env - Environment with R2 binding
 * @param {string} pharmacyName - Pharmacy name
 * @param {Object} csvFiles - CSV files object
 * @param {string} format - 'csv' or 'zip'
 */
export async function storeBackup(env, pharmacyName, csvFiles, format = 'csv') {
  if (!env.BACKUP_BUCKET) {
    console.warn('BACKUP_BUCKET not configured, skipping R2 storage');
    return null;
  }
  
  const timestamp = new Date().toISOString().slice(0, 10);
  const sanitizedName = pharmacyName.replace(/[^a-zA-Z0-9-]/g, '-');
  
  if (format === 'csv') {
    // Store each CSV file separately
    const keys = [];
    for (const [filename, content] of Object.entries(csvFiles)) {
      const key = `backups/${sanitizedName}/${timestamp}/${filename}`;
      await env.BACKUP_BUCKET.put(key, content, {
        httpMetadata: { contentType: 'text/csv' }
      });
      keys.push(key);
    }
    return keys;
  }
  
  // ZIP format would require additional library
  // For now, return CSV format
  return null;
}

/**
 * Schedule weekly backup (called by Cron Trigger)
 * @param {Object} env - Environment with DB and R2
 */
export async function runWeeklyBackup(env) {
  try {
    // Get all active pharmacies
    const pharmacies = await q.all(env.DB, 
      'SELECT id, name FROM pharmacy WHERE active = 1');
    
    const results = [];
    
    for (const pharmacy of pharmacies) {
      // Generate backup data
      const backupData = await generateBackupData(env.DB, pharmacy.id);
      
      // Convert to CSV
      const csvFiles = generateCSVBackup(backupData);
      
      // Store to R2 (if configured)
      const keys = await storeBackup(env, pharmacy.name, csvFiles);
      
      results.push({
        pharmacy_id: pharmacy.id,
        pharmacy_name: pharmacy.name,
        backup_date: new Date().toISOString(),
        status: 'success',
        files_created: Object.keys(csvFiles).length,
        r2_keys: keys
      });
      
      console.log(`✅ Backup completed for ${pharmacy.name}`);
    }
    
    return {
      success: true,
      timestamp: new Date().toISOString(),
      pharmacies_backed_up: results.length,
      results
    };
  } catch (error) {
    console.error('❌ Backup failed:', error);
    return {
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}
