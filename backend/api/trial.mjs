import { neon } from '@neondatabase/serverless';
import { Resend } from 'resend';
import { randomUUID } from 'node:crypto';

const ALLOWED_ORIGINS = new Set([
  'https://thegroundworklabs.com',
  'https://www.thegroundworklabs.com',
  'https://offlinestudios.github.io',
]);

const SUPPORT_EMAIL = 'support@thegroundworklabs.com';
const FROM_EMAIL = 'Ground Work Labs <trials@updates.thegroundworklabs.com>';

function setCors(response, origin) {
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
  }
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function clean(value, maxLength = 500) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 320;
}

function htmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function firstName(businessName) {
  const parts = businessName.split(/\s+/).filter(Boolean);
  return parts.length ? parts[0] : 'there';
}

function parseBody(body) {
  if (typeof body === 'string') {
    try {
      return JSON.parse(body);
    } catch {
      return null;
    }
  }
  return body && typeof body === 'object' ? body : null;
}

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
  await sql`CREATE INDEX IF NOT EXISTS leads_contact_email_created_at_idx ON leads (contact_email, created_at DESC)`;
}

function supportHtml(lead) {
  const fields = [
    ['Business', lead.businessName],
    ['Email', lead.email],
    ['Business type', lead.industry || 'Not supplied'],
    ['Customers / month', lead.monthlyVolume || 'Not supplied'],
    ['Requested solution', lead.funnel || 'General trial'],
    ['Landing page', lead.landingPath || 'Not supplied'],
    ['Referrer', lead.referrer || 'Direct / not supplied'],
    ['UTM source', lead.utmSource || 'Not supplied'],
    ['UTM medium', lead.utmMedium || 'Not supplied'],
    ['UTM campaign', lead.utmCampaign || 'Not supplied'],
    ['Meta click ID', lead.fbclid || 'Not supplied'],
  ];
  const rows = fields.map(([label, value]) => (
    `<tr><td style="padding:8px 12px;border:1px solid #e2e7e5;font-weight:600;vertical-align:top">${htmlEscape(label)}</td><td style="padding:8px 12px;border:1px solid #e2e7e5">${htmlEscape(value)}</td></tr>`
  )).join('');
  return `<!doctype html><html><body style="margin:0;background:#f6f8f7;font-family:Arial,sans-serif;color:#131a17"><div style="max-width:620px;margin:0 auto;padding:32px 18px"><div style="background:#ffffff;border:1px solid #e2e7e5;border-radius:14px;padding:28px"><p style="margin:0 0 8px;color:#1f8a5b;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase">New trial request</p><h1 style="margin:0 0 20px;font-size:24px">${htmlEscape(lead.businessName)}</h1><table style="width:100%;border-collapse:collapse;font-size:14px">${rows}</table><p style="margin:20px 0 0;color:#5b6663;font-size:13px">Review this lead and update its status from New when you contact the business.</p></div></div></body></html>`;
}

function customerHtml(lead) {
  const name = htmlEscape(firstName(lead.businessName));
  return `<!doctype html><html><body style="margin:0;background:#f6f8f7;font-family:Arial,sans-serif;color:#131a17"><div style="max-width:620px;margin:0 auto;padding:32px 18px"><div style="background:#ffffff;border:1px solid #e2e7e5;border-radius:14px;padding:32px"><p style="margin:0 0 10px;color:#1f8a5b;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase">Ground Work Labs</p><h1 style="margin:0 0 16px;font-size:26px;line-height:1.2">We received your trial request.</h1><p style="margin:0 0 14px;line-height:1.6">Hi ${name},</p><p style="margin:0 0 14px;line-height:1.6">Thanks for requesting a Ground Work Labs trial. We have your details and will contact you within one business day to discuss the right starting point for your business.</p><p style="margin:0 0 14px;line-height:1.6">Nothing has been activated and no payment is required at this stage.</p><p style="margin:22px 0 0;line-height:1.6">Ground Work Labs<br><a href="mailto:${SUPPORT_EMAIL}" style="color:#1f8a5b">${SUPPORT_EMAIL}</a></p></div></div></body></html>`;
}

export default async function handler(request, response) {
  const origin = request.headers.origin;
  setCors(response, origin);

  if (request.method === 'OPTIONS') {
    return response.status(204).end();
  }
  if (request.method !== 'POST') {
    return response.status(405).json({ ok: false, error: 'Method not allowed.' });
  }
  if (!origin || !ALLOWED_ORIGINS.has(origin)) {
    return response.status(403).json({ ok: false, error: 'Request origin is not allowed.' });
  }
  if (!process.env.DATABASE_URL || !process.env.RESEND_API_KEY) {
    console.error('Lead intake is missing a required server-side configuration value.');
    return response.status(503).json({ ok: false, error: 'The trial request service is not ready yet.' });
  }

  const body = parseBody(request.body);
  if (!body) {
    return response.status(400).json({ ok: false, error: 'Please try submitting the form again.' });
  }

  // A hidden field catches basic automated submissions without adding friction for visitors.
  if (clean(body.website, 200)) {
    return response.status(200).json({ ok: true });
  }

  const lead = {
    businessName: clean(body.businessName, 200),
    email: clean(body.email, 320).toLowerCase(),
    industry: clean(body.industry, 120),
    monthlyVolume: clean(body.monthlyVolume, 120),
    funnel: clean(body.funnel, 120),
    landingPath: clean(body.landingPath, 500),
    referrer: clean(body.referrer, 500),
    utmSource: clean(body.utmSource, 200),
    utmMedium: clean(body.utmMedium, 200),
    utmCampaign: clean(body.utmCampaign, 200),
    utmTerm: clean(body.utmTerm, 200),
    utmContent: clean(body.utmContent, 200),
    fbclid: clean(body.fbclid, 500),
  };
  const submissionId = clean(body.submissionId, 120) || randomUUID();

  if (!lead.businessName || !isValidEmail(lead.email)) {
    return response.status(400).json({ ok: false, error: 'Please provide a business name and a valid email address.' });
  }

  try {
    const sql = neon(process.env.DATABASE_URL);
    await ensureSchema(sql);

    let existing = await sql`SELECT id, email_status FROM leads WHERE submission_id = ${submissionId} LIMIT 1`;
    let leadId;
    let emailStatus = 'pending';

    if (existing.length) {
      leadId = existing[0].id;
      emailStatus = existing[0].email_status;
      if (emailStatus === 'sent') {
        return response.status(200).json({ ok: true, leadId });
      }
    } else {
      const recent = await sql`
        SELECT id FROM leads
        WHERE contact_email = ${lead.email}
          AND created_at > NOW() - INTERVAL '15 minutes'
        LIMIT 1
      `;
      if (recent.length) {
        return response.status(429).json({ ok: false, error: 'We already received a recent request from this email. Please check your inbox or try again shortly.' });
      }

      leadId = randomUUID();
      await sql`
        INSERT INTO leads (
          id, submission_id, business_name, contact_email, industry, monthly_volume,
          funnel, landing_path, referrer, utm_source, utm_medium, utm_campaign,
          utm_term, utm_content, fbclid, status, email_status
        ) VALUES (
          ${leadId}, ${submissionId}, ${lead.businessName}, ${lead.email}, ${lead.industry || null}, ${lead.monthlyVolume || null},
          ${lead.funnel || null}, ${lead.landingPath || null}, ${lead.referrer || null}, ${lead.utmSource || null}, ${lead.utmMedium || null}, ${lead.utmCampaign || null},
          ${lead.utmTerm || null}, ${lead.utmContent || null}, ${lead.fbclid || null}, 'New', 'pending'
        )
      `;
    }

    const resend = new Resend(process.env.RESEND_API_KEY);
    const [support, customer] = await Promise.all([
      resend.emails.send({
        from: FROM_EMAIL,
        to: [SUPPORT_EMAIL],
        replyTo: lead.email,
        subject: `New trial request: ${lead.businessName}`,
        html: supportHtml(lead),
        tags: [{ name: 'type', value: 'trial-lead' }, { name: 'lead_id', value: leadId }],
        idempotencyKey: `groundwork-support-lead/${leadId}`,
      }),
      resend.emails.send({
        from: FROM_EMAIL,
        to: [lead.email],
        replyTo: SUPPORT_EMAIL,
        subject: 'We received your Ground Work Labs trial request',
        html: customerHtml(lead),
        tags: [{ name: 'type', value: 'trial-confirmation' }, { name: 'lead_id', value: leadId }],
        idempotencyKey: `groundwork-customer-confirmation/${leadId}`,
      }),
    ]);

    if (support.error || customer.error) {
      await sql`UPDATE leads SET email_status = 'needs_attention', updated_at = NOW() WHERE id = ${leadId}`;
      console.error('Lead notification delivery requires attention.', support.error?.message || customer.error?.message || 'Unknown Resend error');
      return response.status(502).json({ ok: false, error: 'Your request was saved, but we could not send the confirmation yet. Please try again shortly or contact support.' });
    }

    await sql`
      UPDATE leads
      SET email_status = 'sent', support_email_id = ${support.data?.id || null}, customer_email_id = ${customer.data?.id || null}, updated_at = NOW()
      WHERE id = ${leadId}
    `;

    return response.status(200).json({ ok: true, leadId });
  } catch (error) {
    console.error('Lead intake request failed.', error instanceof Error ? error.message : 'Unknown error');
    return response.status(500).json({ ok: false, error: 'We could not submit your request. Please try again shortly.' });
  }
}
