/**
 * api/ai.js  —  Vercel Edge Function
 * ================================================================
 * Google AI Studio Gemini proxy for the JUSTDOWOW Voice Assistant.
 *
 * BACKEND SWAP: OpenAI → Google Gemini
 * ─────────────────────────────────────────────────────────────
 * This file is a drop-in replacement. The frontend (voice-assistant.js)
 * is NOT modified and continues to send/receive the exact same shape:
 *
 * SETUP (Vercel Dashboard → Project → Settings → Environment Variables):
 *   GEMINI_API_KEY   =  your_google_ai_studio_key
 *
 * REQUEST  POST /api/ai
 *   { messages: [{role: "system"|"user"|"assistant", content: "..."}, ...] }
 *
 * RESPONSE  (OpenAI-shaped — unchanged contract for the frontend)
 *   {
 *     choices: [
 *       { message: { content: "AI response text" } }
 *     ]
 *   }
 *
 * INTERNAL CONVERSION
 *   - OpenAI "system" role        → prepended as a Gemini systemInstruction
 *   - OpenAI "user" role          → Gemini role "user"
 *   - OpenAI "assistant" role     → Gemini role "model"
 *   - Gemini candidates[0].content.parts[0].text
 *         → repackaged into        choices[0].message.content
 *
 * PRESERVED FEATURES (identical behaviour to the OpenAI version)
 *   FIX-A1  CORS headers on OPTIONS + all error responses.
 *   FIX-A2  Input validation: reject if messages missing/empty.
 *   FIX-A3  Per-message content truncated to 4000 chars.
 *   FIX-A4  History capped at 20 messages before sending.
 *   FIX-A5  Upstream error body forwarded to client for debugging.
 *   FIX-A6  Edge runtime declared for fast cold starts.
 *   FIX-A7  maxOutputTokens set to 350 for concise voice-friendly replies.
 *
 * NEW ERROR HANDLING FOR GEMINI
 *   FIX-G1  Missing/invalid GEMINI_API_KEY        → 503 with clear message
 *   FIX-G2  Gemini 400 INVALID_ARGUMENT (bad key)  → 401 forwarded
 *   FIX-G3  Gemini 403 PERMISSION_DENIED            → 403 forwarded
 *   FIX-G4  Gemini 429 RESOURCE_EXHAUSTED (quota)  → 429 forwarded
 *   FIX-G5  Gemini 500/503 (server-side outage)    → 502 forwarded
 *   FIX-G6  Network failure reaching Gemini         → 502 with detail
 *   FIX-G7  Empty / missing candidates in response → 502 graceful message
 *   FIX-G8  Safety-blocked response (finishReason)  → 200 with polite fallback text
 * ================================================================
 */

export const config = { runtime: 'edge' }; // FIX-A6

const GEMINI_MODEL    = 'gemini-2.5-flash';
const GEMINI_ENDPOINT =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

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

// Builds the exact OpenAI-shaped success body the frontend expects.
function openAIShapedResponse(text) {
  return {
    choices: [
      {
        message: {
          role:    'assistant',
          content: text,
        },
        finish_reason: 'stop',
      },
    ],
  };
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

  // FIX-G1: API key check
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return jsonResp({ error: 'GEMINI_API_KEY not configured in Vercel environment variables' }, 503);
  }

  // FIX-A3 + FIX-A4: sanitise and cap messages (identical to OpenAI version)
  const validRoles = new Set(['system', 'user', 'assistant']);
  const clean = messages
    .filter(m => m && validRoles.has(m.role) && typeof m.content === 'string' && m.content.trim())
    .map(m => ({ role: m.role, content: m.content.trim().slice(0, 4000) })) // FIX-A3
    .slice(-20); // FIX-A4: max 20 messages to keep latency low

  if (clean.length === 0) {
    return jsonResp({ error: 'No valid messages after sanitisation' }, 400);
  }

  // ── Convert OpenAI message format → Gemini format ──────────────
  // System messages become a single systemInstruction (Gemini's
  // dedicated field for this — NOT mixed into the contents array).
  // user   → role "user"
  // assistant → role "model"
  const systemParts = clean
    .filter(m => m.role === 'system')
    .map(m => m.content);

  const systemInstruction = systemParts.length
    ? { parts: [{ text: systemParts.join('\n\n') }] }
    : undefined;

  const contents = clean
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => ({
      role:  m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

  if (contents.length === 0) {
    return jsonResp({ error: 'No user/assistant messages to send to Gemini' }, 400);
  }

  // Gemini requires the contents array to not be empty and the
  // conversation should generally start with a user turn. If the
  // first turn is a model turn (can happen with seeded greetings),
  // Gemini still accepts it, so no reordering is required here.

  const geminiPayload = {
    contents,
    generationConfig: {
      maxOutputTokens: 350,   // FIX-A7: concise voice-friendly replies
      temperature:     0.65,
      topP:            1,
    },
  };
  if (systemInstruction) {
    geminiPayload.systemInstruction = systemInstruction;
  }

  // ── Call Gemini ──────────────────────────────────────────────
  let gRes;
  try {
    gRes = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(geminiPayload),
    });
  } catch (err) {
    // FIX-G6: network failure reaching Gemini
    return jsonResp({ error: 'Gemini network error', detail: String(err) }, 502);
  }

  // ── Handle Gemini error responses ───────────────────────────────
  if (!gRes.ok) {
    let errDetail = '';
    let errCode   = null;
    try {
      const errJson = await gRes.json();
      errDetail = errJson?.error?.message || JSON.stringify(errJson);
      errCode   = errJson?.error?.status  || null;
    } catch {
      errDetail = await gRes.text().catch(() => '');
    }

    // FIX-G2: invalid API key
    if (gRes.status === 400 && /API key not valid|API_KEY_INVALID/i.test(errDetail)) {
      return jsonResp({ error: 'Invalid GEMINI_API_KEY — check Vercel environment variables', detail: errDetail }, 401);
    }

    // FIX-G3: permission denied (key lacks access to this model / API not enabled)
    if (gRes.status === 403 || errCode === 'PERMISSION_DENIED') {
      return jsonResp({ error: 'Gemini API permission denied — verify API key has Generative Language API enabled', detail: errDetail }, 403);
    }

    // FIX-G4: quota exceeded
    if (gRes.status === 429 || errCode === 'RESOURCE_EXHAUSTED') {
      return jsonResp({ error: 'Gemini API quota exceeded — please try again shortly', detail: errDetail }, 429);
    }

    // FIX-G5: Gemini server-side outage
    if (gRes.status >= 500) {
      return jsonResp({ error: 'Gemini server error ' + gRes.status, detail: errDetail }, 502);
    }

    // FIX-A5: generic forward of any other error
    return jsonResp({ error: 'Gemini error ' + gRes.status, detail: errDetail }, gRes.status);
  }

  // ── Parse Gemini success response ───────────────────────────────
  let data;
  try {
    data = await gRes.json();
  } catch (err) {
    return jsonResp({ error: 'Failed to parse Gemini response', detail: String(err) }, 502);
  }

  const candidate = data?.candidates?.[0];

  // FIX-G8: response blocked by safety filters — degrade gracefully
  // instead of erroring, so the voice assistant can still speak
  // something sensible to the visitor.
  if (candidate && candidate.finishReason === 'SAFETY') {
    return jsonResp(
      openAIShapedResponse(
        "I'm not able to answer that one. Could you rephrase, or contact our team on WhatsApp at +91 99900 66953?"
      ),
      200
    );
  }

  // FIX-G7: missing/empty candidates — graceful fallback, not a hard error
  const text = candidate?.content?.parts?.map(p => p.text || '').join('').trim();
  if (!text) {
    return jsonResp(
      openAIShapedResponse(
        "I didn't quite get a response there. Could you try asking again, or WhatsApp us at +91 99900 66953?"
      ),
      200
    );
  }

  // ── Return in the EXACT OpenAI-compatible shape the frontend expects ──
  return new Response(JSON.stringify(openAIShapedResponse(text)), {
    status: 200,
    headers: Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, CORS),
  });
}
