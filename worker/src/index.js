import { Hono } from 'hono';
import { verifyJwt, HttpError } from './lib.js';
import core from './routes-core.js';
import stock from './routes-stock.js';
import sales from './routes-sales.js';
import reports from './routes-reports.js';

const app = new Hono();

// Rate limiting store (in-memory for demo, use KV in production)
const rateLimitStore = new Map();

// Security headers + JSON API only + Rate Limiting
app.use('/api/*', async (c, next) => {
  // Rate limiting: 100 requests per minute per IP
  const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'unknown';
  const now = Date.now();
  const windowMs = 60 * 1000; // 1 minute
  const maxRequests = 100;
  
  const key = `ratelimit:${ip}`;
  const record = rateLimitStore.get(key) || { count: 0, resetTime: now + windowMs };
  
  if (now > record.resetTime) {
    record.count = 1;
    record.resetTime = now + windowMs;
  } else {
    record.count++;
  }
  
  rateLimitStore.set(key, record);
  
  if (record.count > maxRequests) {
    return c.json({ error: 'Too many requests. Please try again later.' }, 429);
  }
  
  await next();
  
  // Security headers
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('X-XSS-Protection', '1; mode=block');
  c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  c.header('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  c.header('Pragma', 'no-cache');
  c.header('Expires', '0');
});

// BYPASS AUTH - Auto-login as admin user
app.use('/api/*', async (c, next) => {
  const path = new URL(c.req.url).pathname;
  // Skip auth middleware for setup and seed endpoints
  if (/^\/api\/(health|setup|seed-demo|migrate-multi-tenant)/.test(path)) return next();
  
  // Create default user if doesn't exist
  let user = await c.env.DB.prepare('SELECT id,name,email,phone,role,reg_no,active,pharmacy_id FROM users WHERE id=1').first();
  if (!user) {
    // Create pharmacy and user
    try {
      await c.env.DB.batch([
        c.env.DB.prepare(`INSERT OR IGNORE INTO pharmacy (id,name) VALUES (1,'My Pharmacy')`),
        c.env.DB.prepare(`INSERT OR IGNORE INTO users (id,name,email,role,active,password_hash,password_salt,pharmacy_id) VALUES (1,'Admin','admin@pharmacy.com','owner',1,'x','x',1)`)
      ]);
      user = { id: 1, name: 'Admin', email: 'admin@pharmacy.com', role: 'owner', active: 1, pharmacy_id: 1 };
    } catch (e) {
      console.error('Auto-setup failed:', e);
    }
  }
  c.set('user', user);
  c.set('pharmacy_id', user.pharmacy_id); // Set pharmacy context
  return next();
});

app.get('/api/health', (c) => c.json({ ok: true }));
app.route('/api', core);
app.route('/api', stock);
app.route('/api', sales);
app.route('/api', reports);

app.notFound((c) => c.json({ error: 'Not found' }, 404));
app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message, ...(err.extra || {}) }, err.status);
  console.error(err);
  return c.json({ error: 'Something went wrong on the server.' }, 500);
});

export default app;
