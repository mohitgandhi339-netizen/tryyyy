/**
 * api/lead.js  –  Vercel Serverless Function
 * ============================================================
 * Lead capture endpoint for the JUSTDOWOW Voice Assistant.
 * Compatible with the existing Web3Forms integration already
 * used by the website contact form.
 *
 * Request (POST):
 *   {
 *     name:     string  (required)
 *     phone:    string  (required)
 *     email?:   string
 *     service?: string
 *     budget?:  string
 *     lang?:    "en" | "hi"
 *     page?:    string  (URL of page where lead was captured)
 *   }
 *
 * Response:
 *   { success: true }   or   { success: false, error: string }
 * ============================================================
 */


const WEB3FORMS_KEY = 'f2a9eff7-9aec-47ae-92f0-27fd7f497bed';
// This key is the same one already used by the website's HTML form.
// It is safe to include here because Web3Forms keys are public-facing
// by design (they do not grant access to sensitive resources).

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ success: false, error: 'Method not allowed' }),
      { status: 405, headers: CORS_HEADERS }
    );
  }

  let data;
  try {
    data = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ success: false, error: 'Invalid JSON' }),
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const { name, phone, email = '', service = 'General Enquiry', budget = 'Not specified', lang = 'en', page = '' } = data;

  // Basic validation
  if (!name || !phone) {
    return new Response(
      JSON.stringify({ success: false, error: 'name and phone are required' }),
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const phoneClean = String(phone).replace(/\D/g, '');
  if (phoneClean.length < 7 || phoneClean.length > 15) {
    return new Response(
      JSON.stringify({ success: false, error: 'Invalid phone number' }),
      { status: 400, headers: CORS_HEADERS }
    );
  }

  // ── Build message body for email ───────────────────────────
  const message = [
    '=== JUSTDOWOW Voice Assistant Lead ===',
    '',
    `Name:         ${name}`,
    `Phone:        ${phone}`,
    `Email:        ${email || 'Not provided'}`,
    `Service:      ${service}`,
    `Budget:       ${budget}`,
    `Language:     ${lang === 'hi' ? 'Hindi' : 'English'}`,
    `Page:         ${page || 'Not recorded'}`,
    `Timestamp:    ${new Date().toISOString()}`,
    '',
    'Source: AI Voice Assistant (Wowy)',
  ].join('\n');

  // ── Submit to Web3Forms ────────────────────────────────────
  const formData = new FormData();
  formData.append('access_key', WEB3FORMS_KEY);
  formData.append('name', name);
  formData.append('phone', phone);
  formData.append('email', email || 'voice-lead@justdowow.com');
  formData.append('message', message);
  formData.append('subject', `[Voice Lead] ${name} — ${service}`);
  formData.append('from_name', 'JUSTDOWOW Wowy Assistant');
  formData.append('redirect', 'false');

  let w3Res;
  try {
    w3Res = await fetch('https://api.web3forms.com/submit', {
      method: 'POST',
      body: formData,
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: 'Submission service unavailable' }),
      { status: 502, headers: CORS_HEADERS }
    );
  }

  const w3Json = await w3Res.json().catch(() => ({}));

  if (!w3Res.ok || w3Json.success === false) {
    return new Response(
      JSON.stringify({ success: false, error: 'Lead submission failed', detail: w3Json }),
      { status: 502, headers: CORS_HEADERS }
    );
  }

  return new Response(
    JSON.stringify({ success: true }),
    { status: 200, headers: CORS_HEADERS }
  );
}
