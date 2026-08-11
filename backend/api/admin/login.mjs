import { allowOrigin, configurationReady, issueSession, parseBody, passwordIsValid } from './_auth.mjs';

export default async function handler(request, response) {
  const origin = request.headers.origin;
  if (request.method === 'OPTIONS') {
    if (!allowOrigin(origin, response, 'POST, OPTIONS')) return;
    return response.status(204).end();
  }
  if (request.method !== 'POST') return response.status(405).json({ ok: false, error: 'Method not allowed.' });
  if (!allowOrigin(origin, response, 'POST, OPTIONS')) return;
  if (!configurationReady()) return response.status(503).json({ ok: false, error: 'The admin service is not configured yet.' });

  const body = parseBody(request.body);
  const password = body && typeof body.password === 'string' ? body.password : '';
  if (!passwordIsValid(password)) return response.status(401).json({ ok: false, error: 'Incorrect password.' });

  return response.status(200).json({ ok: true, ...issueSession() });
}
