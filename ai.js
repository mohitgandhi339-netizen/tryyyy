/**
 * api/ai.js  —  Vercel Edge Function
 * ================================================================
 * OpenAI GPT proxy for the JUSTDOWOW Voice Assistant.
 *
 * SETUP (Vercel Dashboard → Project → Settings → Environment Variables):
 *   OPENAI_API_KEY   =  sk-...
 *
 * REQUEST  POST /api/ai
 *   { messages: [{role, content}, ...] }
 *
 * RESPONSE
 *   Standard OpenAI /v1/chat/completions JSON
 *   { choices: [{ message: { content: "..." } }] }
 *
 * AUDIT FIXES
 *   FIX-A1  CORS headers on OPTIONS + all error responses.
 *   FIX-A2  Input validation: reject if messages missing/empty.
 *   FIX-A3  Per-message content truncated to 4000 chars.
 *   FIX-A4  History capped at 20 messages before sending.
 *   FIX-A5  OpenAI error body forwarded to client for debugging.
 *   FIX-A6  Edge runtime declared for fast cold starts.
 *   FIX-A7  max_tokens set to 350 for concise voice-friendly replies.
 * ================================================================
 */

export const config = { runtime: 'edge' }; // FIX-A6

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function jsonResp(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: Object.assign({ 'Content-Type': 'application/json' }, CORS), // FIX-A1
  });
}

export default async function handler(req) {

  // FIX-A1: CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (req.method !== 'POST') {
    return jsonResp({ error: 'Method not allowed' }, 405);
  }

  // Parse body
  let body;
  try {
    body = await req.json();
  } catch {
    return jsonResp({ error: 'Invalid JSON body' }, 400);
  }

  const { messages } = body || {};

  // FIX-A2: validate messages
  if (!Array.isArray(messages) || messages.length === 0) {
    return jsonResp({ error: 'messages array is required and must not be empty' }, 400);
  }

  // API key check
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return jsonResp({ error: 'OPENAI_API_KEY not configured in Vercel environment variables' }, 503);
  }

  // FIX-A3 + FIX-A4: sanitise and cap messages
  const validRoles = new Set(['system', 'user', 'assistant']);
  const clean = messages
    .filter(m => m && validRoles.has(m.role) && typeof m.content === 'string' && m.content.trim())
    .map(m => ({ role: m.role, content: m.content.trim().slice(0, 4000) })) // FIX-A3
    .slice(-20); // FIX-A4: max 20 messages to keep latency low

  if (clean.length === 0) {
    return jsonResp({ error: 'No valid messages after sanitisation' }, 400);
  }

  // Call OpenAI
  let oaRes;
  try {
    oaRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        model:             'gpt-4o-mini',  // fast + cost-effective; change to gpt-4o for higher quality
        messages:          clean,
        max_tokens:        350,            // FIX-A7: concise voice-friendly responses
        temperature:       0.65,           // slightly lower for more focused answers
        top_p:             1,
        frequency_penalty: 0.15,
        presence_penalty:  0.1,
      }),
    });
  } catch (err) {
    return jsonResp({ error: 'OpenAI network error', detail: String(err) }, 502);
  }

  // FIX-A5: forward OpenAI error body for debugging
  if (!oaRes.ok) {
    const errBody = await oaRes.text().catch(() => '');
    return jsonResp(
      { error: 'OpenAI error ' + oaRes.status, detail: errBody },
      oaRes.status >= 500 ? 502 : oaRes.status
    );
  }

  // Return full OpenAI response — frontend reads data.choices[0].message.content
  const data = await oaRes.json();

  return new Response(JSON.stringify(data), {
    status: 200,
    headers: Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, CORS),
  });
}
