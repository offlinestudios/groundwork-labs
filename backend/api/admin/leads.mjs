import { neon } from '@neondatabase/serverless';
import { allowOrigin, authorize, parseBody } from './_auth.mjs';

const STATUSES = new Set(['New', 'Contacted', 'Qualified', 'In progress', 'Converted', 'Closed']);

async function ensureSchema(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS leads (
      id UUID PRIMARY KEY,
      submission_id TEXT UNIQUE NOT NULL,
      business_name TEXT NOT NULL,
      contact_email TEXT NOT NULL,
      industry TEXT,
      monthly_volume TEXT,
      funnel TEXT,
      landing_path TEXT,
      referrer TEXT,
      utm_source TEXT,
      utm_medium TEXT,
      utm_campaign TEXT,
      utm_term TEXT,
      utm_content TEXT,
      fbclid TEXT,
      status TEXT NOT NULL DEFAULT 'New',
      email_status TEXT NOT NULL DEFAULT 'pending',
      support_email_id TEXT,
      customer_email_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}

export default async function handler(request, response) {
  const origin = request.headers.origin;
  if (request.method === 'OPTIONS') {
    if (!allowOrigin(origin, response, 'GET, PATCH, OPTIONS')) return;
    return response.status(204).end();
  }
  if (!['GET', 'PATCH'].includes(request.method)) return response.status(405).json({ ok: false, error: 'Method not allowed.' });
  if (!allowOrigin(origin, response, 'GET, PATCH, OPTIONS')) return;
  if (!authorize(request, response)) return;

  try {
    const sql = neon(process.env.DATABASE_URL);
    await ensureSchema(sql);

    if (request.method === 'GET') {
      const leads = await sql`
        SELECT id, business_name, contact_email, industry, monthly_volume, funnel,
               landing_path, referrer, utm_source, utm_medium, utm_campaign,
               utm_term, utm_content, fbclid, status, email_status, created_at, updated_at
        FROM leads
        ORDER BY created_at DESC
        LIMIT 250
      `;
      return response.status(200).json({ ok: true, leads, statuses: Array.from(STATUSES) });
    }

    const body = parseBody(request.body);
    const leadId = body && typeof body.id === 'string' ? body.id : '';
    const status = body && typeof body.status === 'string' ? body.status : '';
    if (!leadId || !STATUSES.has(status)) return response.status(400).json({ ok: false, error: 'Please select a valid lead status.' });

    const updated = await sql`
      UPDATE leads
      SET status = ${status}, updated_at = NOW()
      WHERE id = ${leadId}
      RETURNING id, business_name, contact_email, industry, monthly_volume, funnel,
                landing_path, referrer, utm_source, utm_medium, utm_campaign,
                utm_term, utm_content, fbclid, status, email_status, created_at, updated_at
    `;
    if (!updated.length) return response.status(404).json({ ok: false, error: 'Lead not found.' });
    return response.status(200).json({ ok: true, lead: updated[0] });
  } catch (error) {
    console.error('Admin lead request failed.', error instanceof Error ? error.message : 'Unknown error');
    return response.status(500).json({ ok: false, error: 'We could not load or update leads. Please try again.' });
  }
}
