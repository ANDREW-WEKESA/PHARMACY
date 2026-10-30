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

// JWT Authentication middleware
app.use('/api/*', async (c, next) => {
  const path = new URL(c.req.url).pathname;
  // Skip auth middleware for public endpoints
  if (/^\/api\/(setup|auth\/login|seed-demo|migrate-multi-tenant|health-check)/.test(path)) return next();
  
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Authentication required' }, 401);
  }
  
  const token = authHeader.slice(7);
  try {
    const payload = await verifyJwt(token, c.env.JWT_SECRET || 'dev-secret-key-change-in-production');
    const user = await c.env.DB.prepare(
      'SELECT id,name,email,phone,role,reg_no,active,pharmacy_id,is_system_owner,assigned_pharmacy_id FROM users WHERE id=? AND active=1'
    ).bind(payload.sub).first();
    
    if (!user) {
      return c.json({ error: 'User not found or inactive' }, 401);
    }
    
    c.set('user', user);
    
    // Set pharmacy context based on owner status
    if (user.is_system_owner) {
      c.set('is_system_owner', true);
      // System owners can query specific pharmacy via query param
      const qpid = parseInt(c.req.query('pharmacy_id'));
      if (qpid && !isNaN(qpid)) {
        c.set('pharmacy_id', qpid);
      } else {
        c.set('pharmacy_id', null); // No default pharmacy for system owners
      }
    } else {
      c.set('is_system_owner', false);
      c.set('pharmacy_id', user.assigned_pharmacy_id || user.pharmacy_id || 1);
    }
    
    return next();
  } catch (err) {
    console.error('Auth error:', err);
    return c.json({ error: 'Invalid or expired token' }, 401);
  }
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
