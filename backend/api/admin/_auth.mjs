import { createHmac, timingSafeEqual } from 'node:crypto';

export const ALLOWED_ORIGINS = new Set([
  'https://thegroundworklabs.com',
  'https://www.thegroundworklabs.com',
  'https://offlinestudios.github.io',
]);

const SESSION_SECONDS = 8 * 60 * 60;

export function setCors(response, origin, methods) {
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
  }
  response.setHeader('Access-Control-Allow-Methods', methods);
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

export function parseBody(body) {
  if (typeof body === 'string') {
    try { return JSON.parse(body); } catch { return null; }
  }
  return body && typeof body === 'object' ? body : null;
}

function encode(value) {
  return Buffer.from(value).toString('base64url');
}

function sign(payload) {
  return createHmac('sha256', process.env.ADMIN_SESSION_SECRET).update(payload).digest('base64url');
}

function constantTimeMatch(received, expected) {
  const a = Buffer.from(String(received || ''));
  const b = Buffer.from(String(expected || ''));
  return a.length === b.length && timingSafeEqual(a, b);
}

export function configurationReady() {
  return Boolean(process.env.ADMIN_PASSWORD && process.env.ADMIN_SESSION_SECRET && process.env.DATABASE_URL);
}

export function issueSession() {
  const now = Math.floor(Date.now() / 1000);
  const payload = encode(JSON.stringify({ aud: 'groundwork-admin', iat: now, exp: now + SESSION_SECONDS }));
  return { token: `${payload}.${sign(payload)}`, expiresAt: (now + SESSION_SECONDS) * 1000 };
}

export function passwordIsValid(password) {
  return constantTimeMatch(password, process.env.ADMIN_PASSWORD);
}

export function authorize(request, response) {
  if (!configurationReady()) {
    response.status(503).json({ ok: false, error: 'The admin service is not configured yet.' });
    return false;
  }

  const header = request.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const parts = token.split('.');
  if (parts.length !== 2 || !constantTimeMatch(parts[1], sign(parts[0]))) {
    response.status(401).json({ ok: false, error: 'Your admin session is not valid. Please sign in again.' });
    return false;
  }

  try {
    const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    const now = Math.floor(Date.now() / 1000);
    if (payload.aud !== 'groundwork-admin' || !Number.isFinite(payload.exp) || payload.exp < now) {
      response.status(401).json({ ok: false, error: 'Your admin session has expired. Please sign in again.' });
      return false;
    }
  } catch {
    response.status(401).json({ ok: false, error: 'Your admin session is not valid. Please sign in again.' });
    return false;
  }

  return true;
}

export function allowOrigin(origin, response, methods) {
  setCors(response, origin, methods);
  if (!origin || !ALLOWED_ORIGINS.has(origin)) {
    response.status(403).json({ ok: false, error: 'Request origin is not allowed.' });
    return false;
  }
  return true;
}
