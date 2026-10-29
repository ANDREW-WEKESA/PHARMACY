// Shared helpers: crypto, JWT, dates, DB shortcuts, validation.

const enc = new TextEncoder();

// ---------- base64url ----------
const b64url = (buf) => {
  let s = '';
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64url = (str) => {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

// ---------- password hashing (PBKDF2, Workers max 100k iterations) ----------
const ITER = 100000;
export async function hashPassword(password, saltB64) {
  const salt = saltB64 ? fromB64url(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' }, key, 256);
  return { hash: b64url(bits), salt: b64url(salt) };
}
export async function verifyPassword(password, hash, salt) {
  const r = await hashPassword(password, salt);
  return timingSafeEqual(r.hash, hash);
}
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// ---------- JWT (HS256) ----------
async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
export async function signJwt(payload, secret, ttlSeconds = 12 * 3600) {
  const header = b64url(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body = b64url(enc.encode(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds })));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(`${header}.${body}`));
  return `${header}.${body}.${b64url(sig)}`;
}
export async function verifyJwt(token, secret) {
  try {
    const [h, p, s] = token.split('.');
    if (!h || !p || !s) return null;
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), fromB64url(s), enc.encode(`${h}.${p}`));
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(fromB64url(p)));
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

// ---------- dates (Africa/Nairobi is UTC+3, no DST) ----------
const EAT = 3 * 3600 * 1000;
const pad = (n) => String(n).padStart(2, '0');
export function fmtUtc(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}
export const nowUtc = () => fmtUtc(Date.now());
export function eatDate(ms = Date.now()) {
  const d = new Date(ms + EAT);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
export function addDays(dateStr, n) {
  return eatDate(Date.parse(dateStr + 'T00:00:00Z') + n * 86400000 - EAT + EAT);
}
// UTC [start, end) timestamps that cover the Nairobi calendar days from..to (inclusive)
export function eatRange(fromDate, toDate = fromDate) {
  const start = Date.parse(fromDate + 'T00:00:00Z') - EAT;
  const end = Date.parse(toDate + 'T00:00:00Z') - EAT + 86400000;
  return [fmtUtc(start), fmtUtc(end)];
}
export const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));

// ---------- DB shortcuts ----------
export const q = {
  all: async (db, sql, ...p) => (await db.prepare(sql).bind(...p).all()).results || [],
  first: async (db, sql, ...p) => (await db.prepare(sql).bind(...p).first()) || null,
  run: (db, sql, ...p) => db.prepare(sql).bind(...p).run(),
  stmt: (db, sql, ...p) => db.prepare(sql).bind(...p),
};

export async function audit(db, user, action, entity, entityId, detail) {
  await db
    .prepare('INSERT INTO audit_log (user_id,user_name,action,entity,entity_id,detail) VALUES (?,?,?,?,?,?)')
    .bind(user?.id ?? null, user?.name ?? null, action, entity ?? null, entityId != null ? String(entityId) : null,
      detail == null ? null : typeof detail === 'string' ? detail : JSON.stringify(detail))
    .run();
}
export const auditStmt = (db, user, action, entity, entityId, detail) =>
  db
    .prepare('INSERT INTO audit_log (user_id,user_name,action,entity,entity_id,detail) VALUES (?,?,?,?,?,?)')
    .bind(user?.id ?? null, user?.name ?? null, action, entity ?? null, entityId != null ? String(entityId) : null,
      detail == null ? null : typeof detail === 'string' ? detail : JSON.stringify(detail));

// ---------- validation ----------
export class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}
export const bad = (msg, extra) => new HttpError(400, msg, extra);
export const str = (v, max = 200) => (v == null ? '' : String(v).trim().slice(0, max));
export const num = (v, def = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};
export const int = (v, def = 0) => Math.trunc(num(v, def));
export const money = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
export function normPhone(p) {
  if (!p) return null;
  let s = String(p).replace(/[\s\-()]/g, '');
  if (/^0[17]\d{8}$/.test(s)) s = '+254' + s.slice(1);
  else if (/^254[17]\d{8}$/.test(s)) s = '+' + s;
  else if (/^[17]\d{8}$/.test(s)) s = '+254' + s;
  return s;
}
export const DRUG_CLASSES = ['OTC', 'PHARMACY_ONLY', 'POM', 'CONTROLLED'];
export const ROLES = ['owner', 'pharmacist', 'cashier', 'stock_clerk'];
