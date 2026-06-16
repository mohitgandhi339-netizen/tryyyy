/**
 * api/lead.js  —  Vercel Edge Function
 * ================================================================
 * Lead capture endpoint for the JUSTDOWOW Voice Assistant.
 * Submits to Web3Forms (same key already used in HTML contact forms).
 *
 * FIXES APPLIED
 * ─────────────────────────────────────────────────────────────
 * FIX-L1  FormData replaced with JSON body.
 *         FormData is NOT available in Vercel Edge Functions.
 *         Web3Forms accepts application/json — no behaviour change.
 *
 * FIX-L2  business / city fields added (sent by voice-assistant.js
 *         but previously dropped because destructure didn't include them).
 *
 * FIX-L3  CORS headers separated from Content-Type so OPTIONS
 *         preflight returns 204 with CORS only (no CT header).
 *
 * REQUEST  POST /api/lead
 *   { name, phone, email?, business?, city?, service?, budget?, lang?, page? }
 *
 * RESPONSE
 *   { success: true }  or  { success: false, error: string }
 * ================================================================
 */

export const config = { runtime: 'edge' };

const WEB3FORMS_KEY = 'f2a9eff7-9aec-47ae-92f0-27fd7f497bed';

// FIX-L3: CORS separate from Content-Type
const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const JSON_HDR = Object.assign({ 'Content-Type': 'application/json' }, CORS);

function resp(body, status) {
  return new Response(JSON.stringify(body), { status: status || 200, headers: JSON_HDR });
}

export default async function handler(req) {

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (req.method !== 'POST') {
    return resp({ success: false, error: 'Method not allowed' }, 405);
  }

  let data;
  try {
    data = await req.json();
  } catch {
    return resp({ success: false, error: 'Invalid JSON body' }, 400);
  }

  // FIX-L2: include business and city
  const {
    name,
    phone,
    email    = '',
    business = '',
    city     = '',
    service  = 'General Enquiry',
    budget   = 'Not specified',
    lang     = 'en',
    page     = '',
  } = data || {};

  if (!name || !phone) {
    return resp({ success: false, error: 'name and phone are required' }, 400);
  }

  const phoneClean = String(phone).replace(/\D/g, '');
  if (phoneClean.length < 7 || phoneClean.length > 15) {
    return resp({ success: false, error: 'Invalid phone number' }, 400);
  }

  const message = [
    '=== JUSTDOWOW Voice Assistant Lead ===',
    '',
    `Name:         ${name}`,
    `Phone:        ${phone}`,
    `Email:        ${email || 'Not provided'}`,
    `Business:     ${business || 'Not provided'}`,
    `City:         ${city || 'Not provided'}`,
    `Service:      ${service}`,
    `Budget:       ${budget}`,
    `Language:     ${lang === 'hi' ? 'Hindi' : 'English'}`,
    `Page:         ${page || 'Not recorded'}`,
    `Timestamp:    ${new Date().toISOString()}`,
    '',
    'Source: AI Voice Assistant (Wowy)',
  ].join('\n');

  // FIX-L1: JSON body — FormData unavailable in Edge runtime
  let w3Res;
  try {
    w3Res = await fetch('https://api.web3forms.com/submit', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        access_key: WEB3FORMS_KEY,
        name:       name,
        phone:      phone,
        email:      email || 'voice-lead@justdowow.com',
        message:    message,
        subject:    `[Voice Lead] ${name} — ${service}`,
        from_name:  'JUSTDOWOW Wowy Assistant',
        redirect:   'false',
      }),
    });
  } catch (err) {
    return resp({ success: false, error: 'Submission service unavailable', detail: String(err) }, 502);
  }

  const w3Json = await w3Res.json().catch(() => ({}));

  if (!w3Res.ok || w3Json.success === false) {
    return resp({ success: false, error: 'Lead submission failed', detail: w3Json }, 502);
  }

  return resp({ success: true }, 200);
}
