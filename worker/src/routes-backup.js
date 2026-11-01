import { Hono } from 'hono';
import { generateBackupData, generateCSVBackup } from './backup-service.js';
import { q, int, HttpError } from './lib.js';
import { need } from './routes-core.js';

const app = new Hono();

// Middleware for system owners only
const SYSTEM_OWNER = async (c, next) => {
  const user = c.get('user');
  if (!user.is_system_owner) {
    throw new HttpError(403, 'This feature is only available to system owners.');
  }
  await next();
};

// Manual backup trigger - generates and downloads backup
app.post('/trigger', need('owner'), SYSTEM_OWNER, async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const pharmacyId = int(c.req.query('pharmacy_id'));
  
  if (!pharmacyId) {
    throw new HttpError(400, 'pharmacy_id query parameter required');
  }
  
  // Verify ownership
  const pharmacy = await q.first(db, 
    'SELECT * FROM pharmacy WHERE id = ? AND owner_user_id = ?', 
    pharmacyId, user.id);
  
  if (!pharmacy) {
    throw new HttpError(404, 'Pharmacy not found or you do not own it');
  }
  
  // Generate backup
  const backupData = await generateBackupData(db, pharmacyId);
  const csvFiles = generateCSVBackup(backupData);
  
  return c.json({
    success: true,
    pharmacy_name: pharmacy.name,
    backup_date: backupData.backup_date,
    files: Object.keys(csvFiles),
    download_links: Object.keys(csvFiles).map(filename => ({
      filename,
      url: `/api/backup/download/${pharmacyId}/${filename}`
    }))
  });
});

// Download individual CSV file
app.get('/download/:pharmacy_id/:filename', need('owner'), SYSTEM_OWNER, async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const pharmacyId = int(c.req.param('pharmacy_id'));
  const filename = c.req.param('filename');
  
  // Verify ownership
  const pharmacy = await q.first(db, 
    'SELECT * FROM pharmacy WHERE id = ? AND owner_user_id = ?', 
    pharmacyId, user.id);
  
  if (!pharmacy) {
    throw new HttpError(404, 'Pharmacy not found or you do not own it');
  }
  
  // Generate backup data
  const backupData = await generateBackupData(db, pharmacyId);
  const csvFiles = generateCSVBackup(backupData);
  
  if (!csvFiles[filename]) {
    throw new HttpError(404, 'File not found');
  }
  
  // Return CSV file
  return new Response(csvFiles[filename], {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${pharmacy.name.replace(/[^a-zA-Z0-9]/g, '-')}-${filename}"`
    }
  });
});

// Get backup history (if stored in R2)
app.get('/history/:pharmacy_id', need('owner'), SYSTEM_OWNER, async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const pharmacyId = int(c.req.param('pharmacy_id'));
  
  // Verify ownership
  const pharmacy = await q.first(db, 
    'SELECT * FROM pharmacy WHERE id = ? AND owner_user_id = ?', 
    pharmacyId, user.id);
  
  if (!pharmacy) {
    throw new HttpError(404, 'Pharmacy not found or you do not own it');
  }
  
  if (!c.env.BACKUP_BUCKET) {
    return c.json({ 
      success: false, 
      message: 'Backup storage not configured',
      backups: []
    });
  }
  
  // List backups from R2
  const sanitizedName = pharmacy.name.replace(/[^a-zA-Z0-9-]/g, '-');
  const prefix = `backups/${sanitizedName}/`;
  
  const listed = await c.env.BACKUP_BUCKET.list({ prefix, delimiter: '/' });
  
  const backups = listed.delimitedPrefixes?.map(prefix => {
    const date = prefix.split('/').slice(-2, -1)[0];
    return {
      date,
      path: prefix,
      url: `/api/backup/restore/${pharmacyId}/${date}`
    };
  }) || [];
  
  return c.json({
    success: true,
    pharmacy_name: pharmacy.name,
    backups
  });
});

export default app;
