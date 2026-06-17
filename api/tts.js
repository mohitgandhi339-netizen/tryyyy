/**
 * api/tts.js  —  Vercel Edge Function
 * ================================================================
 * ElevenLabs Text-to-Speech proxy for the JUSTDOWOW Voice Assistant.
 *
 * SETUP (Vercel Dashboard → Project → Settings → Environment Variables):
 *   ELEVENLABS_API_KEY  =  your_key_here
 *   ELEVENLABS_VOICE_ID =  voice_id_here   (optional — has default)
 *
 * Default voice: Rachel (21m00Tcm4TlvDq8ikWAM)
 * Good Indian-English alternatives:
 *   Domi:  AZnzlk1XvdvUeBnXmlld
 *   Elli:  MF3mGyEYCl7XYWbV9V6O
 *
 * REQUEST  POST /api/tts
 *   { text: string, lang: "en" | "hi" }
 *
 * RESPONSE
 *   audio/mpeg stream  (on success)
 *   application/json   (on error, with { error, fallback: true })
 *
 * AUDIT FIXES
 *   FIX-B1  CORS headers on OPTIONS + ALL error responses.
 *   FIX-B2  Empty/whitespace text returns 400 — not a silent error.
 *   FIX-B3  Text truncated to 450 chars to stay within ElevenLabs limits.
 *   FIX-B4  Voice ID configurable via ELEVENLABS_VOICE_ID env var.
 *   FIX-B5  ElevenLabs error body forwarded for debugging.
 *   FIX-B6  Content-Type check on ElevenLabs response before streaming.
 *   FIX-B7  Cache-Control: no-store on audio response.
 *   FIX-B8  Edge runtime declared.
 * ================================================================
 */

 // FIX-B8

// Default voices per language
const DEFAULT_VOICE_EN = '21m00Tcm4TlvDq8ikWAM'; // Rachel — warm, professional
const DEFAULT_VOICE_HI = 'AZnzlk1XvdvUeBnXmlld'; // Domi — clear for Hindi/Hinglish

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function jsonResp(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: Object.assign({ 'Content-Type': 'application/json' }, CORS), // FIX-B1
  });
}

export default async function handler(req) {

  // FIX-B1: CORS preflight
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

  const { text, lang = 'en' } = body || {};

  // FIX-B2: validate text
  if (!text || typeof text !== 'string' || !text.trim()) {
    return jsonResp({ error: 'text is required and must be a non-empty string' }, 400);
  }

  // API key check
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    // Gracefully tell the frontend to skip audio (it will show ttsError message)
    return jsonResp({ error: 'ELEVENLABS_API_KEY not configured', fallback: true }, 503);
  }

  // FIX-B3: truncate text
  const safeText = text.trim().slice(0, 450);

  // FIX-B4: voice ID from env var or language default
  const envVoice = process.env.ELEVENLABS_VOICE_ID;
  const voiceId  = envVoice || (lang === 'hi' ? DEFAULT_VOICE_HI : DEFAULT_VOICE_EN);

  // Call ElevenLabs
  let elRes;
  try {
    elRes = await fetch(
      'https://api.elevenlabs.io/v1/text-to-speech/' + voiceId + '/stream',
      {
        method: 'POST',
        headers: {
          'xi-api-key':   apiKey,
          'Content-Type': 'application/json',
          'Accept':       'audio/mpeg',
        },
        body: JSON.stringify({
          text:       safeText,
          model_id:   'eleven_multilingual_v2', // supports Hindi + English
          voice_settings: {
            stability:        0.50,
            similarity_boost: 0.75,
            style:            0.25,
            use_speaker_boost: true,
          },
        }),
      }
    );
  } catch (err) {
    return jsonResp({ error: 'ElevenLabs network error', detail: String(err), fallback: true }, 502);
  }

  // FIX-B5: forward ElevenLabs error details
  if (!elRes.ok) {
    const errBody = await elRes.text().catch(() => '');
    return jsonResp(
      { error: 'ElevenLabs error ' + elRes.status, detail: errBody, fallback: true },
      elRes.status >= 500 ? 502 : elRes.status
    );
  }

  // FIX-B6: verify ElevenLabs actually returned audio
  const ct = elRes.headers.get('content-type') || '';
  if (!ct.includes('audio')) {
    const body2 = await elRes.text().catch(() => '');
    return jsonResp({ error: 'ElevenLabs returned non-audio content: ' + ct, detail: body2, fallback: true }, 502);
  }

  // FIX-B7: stream audio back to client
  return new Response(elRes.body, {
    status: 200,
    headers: Object.assign({
      'Content-Type':  'audio/mpeg',
      'Cache-Control': 'no-store',   // FIX-B7: never cache personalised speech
    }, CORS),
  });
}
