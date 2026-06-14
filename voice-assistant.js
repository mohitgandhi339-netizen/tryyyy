/**
 * ================================================================
 *  JUSTDOWOW — AI Voice Assistant  (voice-assistant.js)
 *  Version 4.0  |  Production-Audited  |  Pure Vanilla JS
 * ================================================================
 *
 *  AUDIT FIXES IN THIS VERSION
 *  ─────────────────────────────────────────────────────────────
 *  FIX-01  synth / window.speechSynthesis fully removed.
 *          ElevenLabs is the ONLY TTS path.
 *  FIX-02  speakText() AbortController + 15 s timeout.
 *          UI never hangs in 'thinking' or 'speaking' state.
 *  FIX-03  callAI() pushes to aiHistory ONLY on success.
 *          Failed/retried turns never corrupt the history.
 *  FIX-04  aiHistory trimmed to MAX_HISTORY*2 messages on every
 *          send so token cost stays low and requests stay fast.
 *  FIX-05  processInput() resets state + hides typing on EVERY
 *          error path with no exceptions.
 *  FIX-06  parseAIResponse() strips ONLY known signal tags.
 *          Arbitrary [BRACKETS] in AI text are preserved.
 *  FIX-07  addMsg() guards against empty / whitespace-only text.
 *  FIX-08  scrapeDOMContent() skips SCRIPT/STYLE/NOSCRIPT tags.
 *  FIX-09  SpeechRecognition handlers assigned ONCE in
 *          buildRecognition(), not re-attached on every call.
 *  FIX-10  startListening() returns early while state=thinking
 *          to prevent overlapping recognition sessions.
 *  FIX-11  renderLeadForm() guard: won't render if form already
 *          present in DOM.
 *  FIX-12  handleInput() deduplication: adds user bubble ONCE
 *          regardless of entry path (voice / chip / text input).
 *  FIX-13  endConversation() callable safely from speakText
 *          onDone without double-executing.
 *  FIX-14  Greeting added to aiHistory so OpenAI has context
 *          from message 1.
 *  FIX-15  WHATSAPP_CTA rendered as a tappable anchor, never
 *          as plain text that breaks on mobile.
 *
 *  ARCHITECTURE
 *  ─────────────────────────────────────────────────────────────
 *  STT  → Web SpeechRecognition (browser-native)
 *  AI   → OpenAI GPT-4o-mini via POST /api/ai   (key: server)
 *  TTS  → ElevenLabs eleven_multilingual_v2
 *         via POST /api/tts                      (key: server)
 *  Lead → POST /api/lead → Web3Forms
 *  Lang → Hindi / English / Hinglish auto-detect
 * ================================================================
 */

(function () {
  'use strict';

  /* ══════════════════════════════════════════════════════════════
     CONSTANTS
  ══════════════════════════════════════════════════════════════ */
  var MAX_HISTORY   = 10;    // max conversation PAIRS kept in memory
  var TTS_TIMEOUT   = 15000; // ms — abort ElevenLabs if no response
  var RESTART_DELAY = 400;   // ms — pause before restarting mic
  var WA_URL        = 'https://wa.me/919990066953';
  var WA_NUM        = '+91 99900 66953';
  var EMAIL         = 'justdowowinfo@gmail.com';

  /* ══════════════════════════════════════════════════════════════
     1.  COMPANY KNOWLEDGE BASE
         Injected verbatim into the OpenAI system prompt.
  ══════════════════════════════════════════════════════════════ */
  var COMPANY = {
    name:     'JUSTDOWOW',
    tagline:  "India's Most Creative Growth Agency",
    office:   'Tronica City, Ghaziabad, NCR India',
    serving:  'Tronica City, Ghaziabad, Noida, Greater Noida, Delhi, and all of NCR',
    whatsapp: WA_NUM,
    waUrl:    WA_URL,
    email:    EMAIL,
    instagram:'https://www.instagram.com/justdowow/',
    services: [
      'SEO & Organic Growth',
      'Local SEO',
      'Google Business Profile Optimisation',
      'Performance Marketing',
      'Google Ads',
      'Meta Ads (Facebook & Instagram Ads)',
      'Social Media Marketing',
      'Instagram Marketing',
      'Facebook Ads',
      'Brand Identity Design',
      'Website Design',
      'Website Development',
      'Landing Pages',
      'Lead Generation',
      'Funnel Strategy',
      'Conversion Rate Optimisation (CRO)',
      'WhatsApp Marketing',
      'Content Marketing',
      'Marketing Automation',
      'Real Estate & Property Marketing',
      'Tronica City Property Promotion',
      'Video Marketing & Reels',
    ],
    pricing: {
      sme:  'SME packages start from Rs.8,000 to Rs.10,000 per month',
      ppc:  'Minimum recommended ad spend is Rs.15,000 per month for PPC',
      free: 'Free 45-minute strategy session with digital audit — no commitment required',
    },
    locations: {
      tronica: 'Headquartered in Tronica City, Ghaziabad. Specialised in local property and SME marketing.',
      noida:   'Serving Sector 18, 62, 63, 125, 137, Greater Noida West, and surrounding NCR areas.',
      delhi:   'Serving South Delhi, Dwarka, Rohini, East Delhi, Karol Bagh, and all commercial zones.',
    },
  };

  /* ══════════════════════════════════════════════════════════════
     2.  SYSTEM PROMPT
  ══════════════════════════════════════════════════════════════ */
  function buildSystemPrompt(domText, currentLang) {
    var langRule = currentLang === 'hi'
      ? 'Reply in natural Hindi or Hinglish. Mix Hindi and English as Indians speak in real conversation. Keep it warm and conversational.'
      : 'Reply in English. If the user writes Hindi or Hinglish, automatically switch and match their language.';

    var serviceList = COMPANY.services.map(function (s, i) {
      return (i + 1) + '. ' + s;
    }).join('\n');

    return 'You are Wowy — the official AI assistant of JUSTDOWOW, a premium digital marketing agency.\n\n' +

'IDENTITY RULES\n' +
'- You are Wowy, the JUSTDOWOW AI Assistant.\n' +
'- NEVER say "I am ChatGPT", "I am an AI language model", or mention OpenAI.\n' +
'- You are a friendly, experienced senior digital marketing consultant.\n' +
'- Always represent JUSTDOWOW professionally.\n\n' +

'COMPANY\n' +
'- Name: ' + COMPANY.name + '\n' +
'- Tagline: ' + COMPANY.tagline + '\n' +
'- Office: ' + COMPANY.office + '\n' +
'- Areas served: ' + COMPANY.serving + '\n' +
'- WhatsApp: ' + COMPANY.whatsapp + '\n' +
'- Email: ' + COMPANY.email + '\n\n' +

'SERVICES OFFERED BY JUSTDOWOW:\n' + serviceList + '\n\n' +

'PRICING\n' +
'- ' + COMPANY.pricing.sme + '\n' +
'- ' + COMPANY.pricing.ppc + '\n' +
'- ' + COMPANY.pricing.free + '\n\n' +

'LOCATIONS\n' +
'- Tronica City / Ghaziabad: ' + COMPANY.locations.tronica + '\n' +
'- Noida: ' + COMPANY.locations.noida + '\n' +
'- Delhi: ' + COMPANY.locations.delhi + '\n\n' +

'CURRENT PAGE CONTENT (primary source of truth for this conversation):\n' +
'---\n' +
(domText || 'Not available.') + '\n' +
'---\n\n' +

'LANGUAGE RULE: ' + langRule + '\n\n' +

'CORE BEHAVIOUR\n' +
'1. Keep voice responses under 100 words. Be concise and direct.\n' +
'2. Give real, actionable marketing advice. Never be vague or generic.\n' +
'3. When asked about real estate or property marketing, recommend: Local SEO, Google Business Profile, Meta Ads, Property Reels on Instagram/YouTube, WhatsApp Lead Funnels, Google Search Ads targeting local property buyers.\n' +
'4. Tailor advice to the user\'s city when mentioned (Tronica City, Noida, Delhi, Ghaziabad, etc.).\n' +
'5. Tailor strategy recommendations to the user\'s budget when mentioned.\n' +
'6. For SEO vs Google Ads: SEO = long-term organic growth (3-6 months); Google Ads = immediate traffic and leads. Recommend based on their timeline and budget.\n' +
'7. NEVER promise specific rankings, fixed lead counts, or guaranteed revenue results.\n' +
'8. NEVER invent services, prices, team names, or company details not listed above.\n' +
'9. If information is unavailable: say "I don\'t have that detail — please contact our team on WhatsApp: ' + COMPANY.whatsapp + ' or email ' + COMPANY.email + '"\n\n' +

'LEAD QUALIFICATION\n' +
'When a user shows buying intent, qualify them naturally — ask ONE question at a time:\n' +
'1. What type of business do you have?\n' +
'2. Which city or area are you targeting?\n' +
'3. What is your monthly marketing budget?\n' +
'4. What is your biggest current marketing challenge?\n' +
'After qualifying, recommend a suitable strategy and invite them to consult on WhatsApp.\n\n' +

'SIGNAL TAGS — output on their own line when appropriate:\n' +
'- [COLLECT_LEAD]     — output ONCE when user clearly wants to be contacted or has strong buying intent AND you have enough context about their need.\n' +
'- [END_CONVERSATION] — output when user says: bye, goodbye, band karo, exit, stop, ok thanks, shukriya, theek hai, bas karo.\n' +
'- [WHATSAPP_CTA]     — output when it is natural to offer a WhatsApp consultation link.\n\n' +

'FORMATTING\n' +
'- No markdown: no **bold**, no # headers, no bullet lists starting with *.\n' +
'- Short paragraphs only, as you would speak.\n' +
'- Warm, professional, conversational tone.';
  }

  /* ══════════════════════════════════════════════════════════════
     3.  DOM SCRAPER  (FIX-08: excludes script/style nodes)
  ══════════════════════════════════════════════════════════════ */
  function scrapeDOMContent() {
    var SKIP = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, META: 1, HEAD: 1, LINK: 1, SVG: 1, PATH: 1 };
    var seen = [];
    var parts = [];

    var selectors = [
      'h1', 'h2', 'h3',
      'main p', 'article p',
      '#about', '#about p', '#services p', '#contact p', '#faq p', '#faq li',
      '.hero p', '.section-pad p',
      '[class*="service"] p', '[class*="about"] p', '[class*="hero"] p',
    ];

    for (var i = 0; i < selectors.length; i++) {
      try {
        var els = document.querySelectorAll(selectors[i]);
        for (var j = 0; j < els.length; j++) {
          var el = els[j];
          if (seen.indexOf(el) !== -1) continue;
          if (SKIP[el.tagName]) continue;
          seen.push(el);
          var text = (el.innerText || el.textContent || '').trim();
          if (text.length > 15 && text.length < 600) {
            parts.push(text);
          }
        }
      } catch (e) { /* unsupported selector — skip */ }
    }

    // Deduplicate
    var unique = [];
    var seenText = {};
    for (var k = 0; k < parts.length; k++) {
      if (!seenText[parts[k]]) {
        seenText[parts[k]] = 1;
        unique.push(parts[k]);
      }
    }
    return unique.join('\n').slice(0, 2500);
  }

  /* ══════════════════════════════════════════════════════════════
     4.  UI STRINGS
  ══════════════════════════════════════════════════════════════ */
  var STR = {
    en: {
      greeting:    "Hi! I'm Wowy, JUSTDOWOW's AI assistant. I can help with SEO, Google Ads, Meta Ads, branding, websites, and more. What can I help you with today?",
      chips:       ['Our Services', 'About JUSTDOWOW', 'Pricing', 'Free Consultation', 'Real Estate Marketing', 'SEO vs Google Ads'],
      listening:   'Listening\u2026',
      thinking:    'Thinking\u2026',
      speaking:    'Speaking\u2026',
      idle:        'Tap mic to start',
      ended:       'Conversation ended',
      noSupport:   "Voice input isn't supported in this browser. Please type your question below.",
      ttsError:    "I couldn't speak that — please read the message above.",
      aiError:     "I'm having trouble connecting right now. Please try again, or WhatsApp us at " + WA_NUM + ".",
      leadPrompt:  "I'd love to get you a free consultation! Please share a few details and our team will be in touch within 24 hours.",
      leadSuccess: "Thank you! Your details have been shared with our team. We'll be in touch within 24 hours. You can also WhatsApp us now at " + WA_NUM + ".",
      leadError:   "Couldn't save your details right now. Please WhatsApp us at " + WA_NUM + " or email " + EMAIL + ".",
      endConv:     "It was great talking with you! JUSTDOWOW is always here when you need marketing help. Take care!",
      waPrompt:    "Feel free to WhatsApp us at " + WA_NUM + " for a free strategy session.",
      langBtn:     '\u0939\u093f\u0902\u0926\u0940',
    },
    hi: {
      greeting:    "Namaste! Main Wowy hoon, JUSTDOWOW ka AI assistant. SEO, Google Ads, Meta Ads, branding, website — kisi bhi topic mein help kar sakta hoon. Aaj kaise help karoon?",
      chips:       ['Hamari Services', 'JUSTDOWOW ke baare mein', 'Pricing', 'Free Consultation', 'Real Estate Marketing', 'SEO vs Google Ads'],
      listening:   'Sun raha hoon\u2026',
      thinking:    'Soch raha hoon\u2026',
      speaking:    'Bol raha hoon\u2026',
      idle:        'Mic dabayein',
      ended:       'Conversation khatam',
      noSupport:   'Is browser mein voice support nahi hai. Neeche type karein.',
      ttsError:    "Boli nahi aa payi — upar ka message padh lijiye.",
      aiError:     "Abhi connection mein thodi problem hai. Dobara try karein ya " + WA_NUM + " par WhatsApp karein.",
      leadPrompt:  "Aapki details chahiye free consultation ke liye. Humari team 24 ghante mein contact karegi.",
      leadSuccess: "Shukriya! Aapki details mil gayi. Hum 24 ghante mein contact karenge. Abhi WhatsApp bhi kar sakte hain: " + WA_NUM,
      leadError:   "Details save nahi ho payi. Kripya " + WA_NUM + " par WhatsApp karein.",
      endConv:     "Aapase baat karke acha laga! JUSTDOWOW hamesha yahan hai. Take care!",
      waPrompt:    "Free strategy session ke liye humein WhatsApp karein: " + WA_NUM,
      langBtn:     'English',
    },
  };

  /* ══════════════════════════════════════════════════════════════
     5.  STATE
  ══════════════════════════════════════════════════════════════ */
  var isOpen         = false;
  var lang           = 'en';
  var convActive     = false;
  var state          = 'idle';
  var recognition    = null;
  var currentAudio   = null;   // HTMLAudioElement from ElevenLabs
  var currentAbort   = null;   // AbortController for TTS fetch
  var restartTimer   = null;
  var leadPending    = false;
  var initialized    = false;
  var domContent     = '';
  var aiHistory      = [];     // [{role:'user'|'assistant', content:string}]
  var endingConv     = false;  // FIX-13: guard against double-end

  /* ══════════════════════════════════════════════════════════════
     6.  DOM BUILDER
  ══════════════════════════════════════════════════════════════ */
  function buildDOM() {
    var wrap = document.createElement('div');
    wrap.id = 'jdw-va';
    wrap.innerHTML =
      '<button id="jdw-va-btn" aria-label="Open JUSTDOWOW AI Assistant">' +
        '<svg id="jdw-btn-mic" viewBox="0 0 24 24">' +
          '<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3zm-1 3a1 1 0 0 1 2 0v8a1 1 0 0 1-2 0V4zm6.3 7.7A6 6 0 0 1 12 18a6 6 0 0 1-5.3-6.3l-2-.4A8 8 0 0 0 11 19.9V22H9v2h6v-2h-2v-2.1A8 8 0 0 0 19.3 12l-2-.3z"/>' +
        '</svg>' +
        '<svg id="jdw-btn-close" viewBox="0 0 24 24">' +
          '<path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>' +
        '</svg>' +
      '</button>' +
      '<div id="jdw-va-badge">Talk to Wowy</div>' +

      '<div id="jdw-va-panel" role="dialog" aria-label="JUSTDOWOW AI Assistant" aria-modal="true">' +

        '<div id="jdw-panel-header">' +
          '<div id="jdw-avatar">WW<span id="jdw-avatar-dot"></span></div>' +
          '<div id="jdw-header-info">' +
            '<div id="jdw-header-name">Wowy &middot; <span>JUSTDOWOW</span></div>' +
            '<div id="jdw-header-status">Digital Marketing Expert &bull; Online</div>' +
          '</div>' +
          '<button id="jdw-lang-btn" title="Switch language">' + STR.en.langBtn + '</button>' +
          '<button id="jdw-close-btn" aria-label="Close assistant">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">' +
              '<path d="M18 6L6 18M6 6l12 12"/>' +
            '</svg>' +
          '</button>' +
        '</div>' +

        '<div id="jdw-chat" role="log" aria-live="polite" aria-label="Conversation"></div>' +

        '<div id="jdw-visualiser" class="jdw-vis-idle">' +
          '<span class="jdw-bar"></span><span class="jdw-bar"></span>' +
          '<span class="jdw-bar"></span><span class="jdw-bar"></span>' +
          '<span class="jdw-bar"></span><span class="jdw-bar"></span>' +
          '<span class="jdw-bar"></span><span class="jdw-bar"></span>' +
          '<span class="jdw-bar"></span><span class="jdw-bar"></span>' +
          '<span class="jdw-bar"></span><span class="jdw-bar"></span>' +
        '</div>' +
        '<div id="jdw-state-label" aria-live="polite"></div>' +

        '<div id="jdw-voice-controls">' +
          '<button id="jdw-end-btn" class="jdw-hidden" title="End conversation" aria-label="End conversation">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
              '<rect x="3" y="3" width="18" height="18" rx="3"/>' +
            '</svg>' +
          '</button>' +
          '<button id="jdw-mic-main" aria-label="Start voice conversation">' +
            '<svg viewBox="0 0 24 24">' +
              '<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3zm-1 3a1 1 0 0 1 2 0v8a1 1 0 0 1-2 0V4zm6.3 7.7A6 6 0 0 1 12 18a6 6 0 0 1-5.3-6.3l-2-.4A8 8 0 0 0 11 19.9V22H9v2h6v-2h-2v-2.1A8 8 0 0 0 19.3 12l-2-.3z"/>' +
            '</svg>' +
          '</button>' +
        '</div>' +

        '<div id="jdw-text-row">' +
          '<input id="jdw-text-input" type="text" placeholder="Type a message\u2026" ' +
                 'autocomplete="off" maxlength="300" aria-label="Type a message">' +
          '<button id="jdw-send-btn" aria-label="Send message">' +
            '<svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>' +
          '</button>' +
        '</div>' +

      '</div>';

    document.body.appendChild(wrap);
  }

  /* ══════════════════════════════════════════════════════════════
     7.  STATE MACHINE
  ══════════════════════════════════════════════════════════════ */
  function setState(s) {
    state = s;
    var label  = document.getElementById('jdw-state-label');
    var viz    = document.getElementById('jdw-visualiser');
    var status = document.getElementById('jdw-header-status');
    if (!label || !viz || !status) return;

    var S      = STR[lang];
    var ALL_ST = ['jdw-st-listening', 'jdw-st-thinking', 'jdw-st-speaking', 'jdw-st-ended'];
    ALL_ST.forEach(function (c) { label.classList.remove(c); status.classList.remove(c); });
    viz.className = 'jdw-vis-idle';

    var MAP = {
      listening: { text: S.listening, cls: 'jdw-st-listening', viz: 'jdw-vis-listening' },
      thinking:  { text: S.thinking,  cls: 'jdw-st-thinking',  viz: 'jdw-vis-thinking'  },
      speaking:  { text: S.speaking,  cls: 'jdw-st-speaking',  viz: 'jdw-vis-speaking'  },
      ended:     { text: S.ended,     cls: 'jdw-st-ended',     viz: 'jdw-vis-idle'      },
    };

    if (MAP[s]) {
      label.textContent  = MAP[s].text;
      status.textContent = MAP[s].text;
      label.classList.add(MAP[s].cls);
      status.classList.add(MAP[s].cls);
      viz.className = MAP[s].viz;
    } else {
      label.textContent  = S.idle;
      status.textContent = 'Digital Marketing Expert \u2022 Online';
    }
  }

  /* ══════════════════════════════════════════════════════════════
     8.  CHAT HELPERS
  ══════════════════════════════════════════════════════════════ */
  function addMsg(role, text) {
    if (!text || !text.trim()) return; // FIX-07
    var chat = document.getElementById('jdw-chat');
    if (!chat) return;
    var el = document.createElement('div');
    el.className = 'jdw-msg jdw-' + role;
    el.innerHTML =
      '<div class="jdw-msg-av">' + (role === 'bot' ? 'WW' : 'You') + '</div>' +
      '<div class="jdw-bubble">' + esc(text) + '</div>';
    chat.appendChild(el);
    scrollChat();
  }

  function addMsgHTML(role, html) {
    if (!html || !html.trim()) return;
    var chat = document.getElementById('jdw-chat');
    if (!chat) return;
    var el = document.createElement('div');
    el.className = 'jdw-msg jdw-' + role;
    el.innerHTML =
      '<div class="jdw-msg-av">' + (role === 'bot' ? 'WW' : 'You') + '</div>' +
      '<div class="jdw-bubble">' + html + '</div>';
    chat.appendChild(el);
    scrollChat();
  }

  function showTyping() {
    if (document.getElementById('jdw-typing')) return;
    var chat = document.getElementById('jdw-chat');
    if (!chat) return;
    var el = document.createElement('div');
    el.id = 'jdw-typing';
    el.className = 'jdw-msg jdw-bot';
    el.innerHTML =
      '<div class="jdw-msg-av">WW</div>' +
      '<div class="jdw-bubble"><div class="jdw-dots">' +
      '<span></span><span></span><span></span></div></div>';
    chat.appendChild(el);
    scrollChat();
  }

  function hideTyping() {
    var el = document.getElementById('jdw-typing');
    if (el) el.remove();
  }

  function addChips(chips) {
    removeChips();
    var chat = document.getElementById('jdw-chat');
    if (!chat || !chips || !chips.length) return;
    var row = document.createElement('div');
    row.className = 'jdw-chips';
    row.id = 'jdw-chips';
    chips.forEach(function (label) {
      var btn = document.createElement('button');
      btn.className = 'jdw-chip';
      btn.textContent = label;
      btn.addEventListener('click', function () { removeChips(); handleInput(label); });
      row.appendChild(btn);
    });
    chat.appendChild(row);
    scrollChat();
  }

  function removeChips() {
    var el = document.getElementById('jdw-chips');
    if (el) el.remove();
  }

  function scrollChat() {
    var chat = document.getElementById('jdw-chat');
    if (chat) setTimeout(function () { chat.scrollTop = chat.scrollHeight; }, 40);
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ══════════════════════════════════════════════════════════════
     9.  OPENAI API CALL  (FIX-03, FIX-04)
  ══════════════════════════════════════════════════════════════ */
  async function callAI(userMessage) {
    // Trim history to MAX_HISTORY pairs (FIX-04)
    if (aiHistory.length > MAX_HISTORY * 2) {
      aiHistory = aiHistory.slice(-(MAX_HISTORY * 2));
    }

    var messages = [
      { role: 'system', content: buildSystemPrompt(domContent, lang) },
    ].concat(aiHistory).concat([
      { role: 'user', content: userMessage },
    ]);

    var res = await fetch('/api/ai', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ messages: messages }),
    });

    if (!res.ok) {
      var errTxt = await res.text().catch(function () { return ''; });
      throw new Error('/api/ai returned ' + res.status + ': ' + errTxt);
    }

    var data  = await res.json();
    var reply = (
      data && data.choices && data.choices[0] &&
      data.choices[0].message && data.choices[0].message.content
    ) || (data && data.reply) || (data && data.content) || '';

    if (!reply || !reply.trim()) throw new Error('Empty response from /api/ai');

    // Push to history ONLY after success (FIX-03)
    aiHistory.push({ role: 'user',      content: userMessage });
    aiHistory.push({ role: 'assistant', content: reply });

    return reply;
  }

  /* ══════════════════════════════════════════════════════════════
     10.  RESPONSE PARSER  (FIX-06: only strips known signal tags)
  ══════════════════════════════════════════════════════════════ */
  var KNOWN_SIGNALS = /\[(COLLECT_LEAD|END_CONVERSATION|WHATSAPP_CTA)\]/g;

  function parseAIResponse(raw) {
    var text        = raw || '';
    var collectLead = text.indexOf('[COLLECT_LEAD]')     !== -1;
    var endConv     = text.indexOf('[END_CONVERSATION]') !== -1;
    var showWACTA   = text.indexOf('[WHATSAPP_CTA]')     !== -1;

    // Strip ONLY known signal tags (FIX-06)
    text = text.replace(KNOWN_SIGNALS, '').trim();

    // Strip markdown formatting for clean chat/voice output
    text = text
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g,     '$1')
      .replace(/^#{1,6}\s+/gm,     '')
      .replace(/`([^`]+)`/g,       '$1')
      .trim();

    return { text: text, collectLead: collectLead, endConv: endConv, showWACTA: showWACTA };
  }

  /* ══════════════════════════════════════════════════════════════
     11.  INPUT PIPELINE  (FIX-05, FIX-07, FIX-12)
  ══════════════════════════════════════════════════════════════ */
  // FIX-12: handleInput is the ONLY place a user bubble is added
  function handleInput(text) {
    if (!text || !text.trim()) return;
    removeChips();
    var t = text.trim();
    addMsg('user', t);
    processInput(t);
  }

  async function processInput(rawText) {
    // Auto-detect Hindi from user input
    var hasHindi =
      /[\u0900-\u097F]/.test(rawText) ||
      /\b(kya|hai|hain|aap|main|mujhe|karo|kaise|bata|chahiye|nahi|mera|dijiye|bataiye|chahte|chahti|hoon|hu|batao|samjhao|chahta|karein|karoon)\b/i.test(rawText);
    if (hasHindi && lang !== 'hi') { lang = 'hi'; updateLangBtn(); }

    setState('thinking');
    showTyping();

    var rawReply;
    try {
      rawReply = await callAI(rawText);
    } catch (err) {
      // FIX-05: guaranteed cleanup on every error path
      hideTyping();
      setState('idle');
      console.warn('[JDWVA] AI error:', err.message);
      var errMsg = STR[lang].aiError;
      addMsg('bot', errMsg);
      speakText(errMsg, function () {
        if (convActive) safeRestartListening();
        else addChips(STR[lang].chips);
      });
      return;
    }

    hideTyping();

    var parsed = parseAIResponse(rawReply);
    var text        = parsed.text;
    var collectLead = parsed.collectLead;
    var endConv     = parsed.endConv;
    var showWACTA   = parsed.showWACTA;

    // ── End conversation signal ──────────────────────────────
    if (endConv) {
      if (text) addMsg('bot', text);
      speakText(text || STR[lang].endConv, function () {
        endConversation();
      });
      return;
    }

    // ── Display AI reply ─────────────────────────────────────
    if (text) addMsg('bot', text);

    // ── WhatsApp CTA (FIX-15: tappable anchor) ───────────────
    if (showWACTA) {
      var waMsg = encodeURIComponent('Hi! I was chatting with Wowy on the JUSTDOWOW website and would like a free consultation.');
      addMsgHTML('bot',
        '<a class="jdw-wa-link" href="' + WA_URL + '?text=' + waMsg + '" target="_blank" rel="noopener noreferrer">' +
        '&#128172; Chat on WhatsApp &rarr;</a>'
      );
    }

    // ── Lead collection form ─────────────────────────────────
    if (collectLead && !leadPending) {
      leadPending = true;
      speakText(text || STR[lang].leadPrompt, function () {
        if (!text) addMsg('bot', STR[lang].leadPrompt);
        renderLeadForm();
      });
      return;
    }

    // ── Speak then re-listen or show chips ───────────────────
    speakText(text, function () {
      if (convActive && state !== 'ended') {
        setTimeout(function () { if (convActive) startListening(); }, RESTART_DELAY);
      } else {
        addChips(STR[lang].chips);
      }
    });
  }

  /* ══════════════════════════════════════════════════════════════
     12.  TTS — ElevenLabs ONLY  (FIX-01, FIX-02)
          No browser speechSynthesis. AbortController timeout.
  ══════════════════════════════════════════════════════════════ */
  async function speakText(text, onDone) {
    if (!text || !text.trim()) { if (onDone) onDone(); return; }

    stopCurrentAudio();
    setState('speaking');

    var plain = text
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 500);

    // AbortController + timeout (FIX-02)
    var ac = new AbortController();
    currentAbort = ac;
    var timeoutId = setTimeout(function () { ac.abort(); }, TTS_TIMEOUT);

    try {
      var res = await fetch('/api/tts', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ text: plain, lang: lang }),
        signal:  ac.signal,
      });

      clearTimeout(timeoutId);
      currentAbort = null;

      var contentType = (res.headers.get('content-type') || '');
      if (!res.ok || !contentType.includes('audio')) {
        // ElevenLabs returned error or non-audio — do NOT fall back to browser TTS (FIX-01)
        setState('idle');
        addMsg('bot', STR[lang].ttsError);
        if (onDone) onDone();
        return;
      }

      var blob  = await res.blob();
      var url   = URL.createObjectURL(blob);
      var audio = new Audio(url);
      currentAudio = audio;

      audio.onplay = function () { setState('speaking'); };

      audio.onended = function () {
        URL.revokeObjectURL(url);
        currentAudio = null;
        setState('idle');
        if (onDone) onDone();
      };

      audio.onerror = function () {
        URL.revokeObjectURL(url);
        currentAudio = null;
        setState('idle');
        addMsg('bot', STR[lang].ttsError);
        if (onDone) onDone();
      };

      audio.play().catch(function (e) {
        // Autoplay blocked (common on mobile before user gesture)
        currentAudio = null;
        setState('idle');
        console.warn('[JDWVA] Audio autoplay blocked:', e.message);
        if (onDone) onDone();
      });

    } catch (err) {
      clearTimeout(timeoutId);
      currentAbort = null;
      currentAudio = null;
      setState('idle');
      if (err.name !== 'AbortError') {
        console.warn('[JDWVA] TTS fetch error:', err.message);
      }
      addMsg('bot', STR[lang].ttsError);
      if (onDone) onDone();
    }
  }

  function stopCurrentAudio() {
    if (currentAbort) { currentAbort.abort(); currentAbort = null; }
    if (currentAudio) {
      try { currentAudio.pause(); } catch (e) {}
      currentAudio.src = '';
      currentAudio = null;
    }
  }

  /* ══════════════════════════════════════════════════════════════
     13.  SPEECH RECOGNITION  (FIX-09, FIX-10)
           Handlers assigned ONCE. Does not re-listen while thinking.
  ══════════════════════════════════════════════════════════════ */
  function buildRecognition() {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return null;

    var r = new SR();
    r.continuous      = false; // manual restart for cross-browser reliability
    r.interimResults  = false;
    r.maxAlternatives = 1;

    // FIX-09: assign handlers ONCE here
    r.onresult = function (e) {
      var transcript = ((e.results[0][0] || {}).transcript || '').trim();
      try { r.stop(); } catch (ex) {}
      if (!transcript) { safeRestartListening(); return; }
      setState('thinking');
      handleInput(transcript); // FIX-12: handleInput is the one and only entry
    };

    r.onspeechend = function () { try { r.stop(); } catch (ex) {} };

    r.onerror = function (e) {
      if (e.error === 'no-speech')  { if (convActive) safeRestartListening(); return; }
      if (e.error === 'aborted')    { return; }
      console.warn('[JDWVA] SpeechRecognition error:', e.error);
      setState('idle');
      if (convActive) safeRestartListening();
    };

    r.onend = function () {
      if (convActive && state === 'listening') safeRestartListening();
    };

    return r;
  }

  function startListening() {
    if (!recognition) { addMsg('bot', STR[lang].noSupport); return; }
    if (state === 'thinking') return; // FIX-10: don't overlap with AI thinking
    if (state === 'speaking') stopCurrentAudio(); // interruption support

    clearTimeout(restartTimer);
    recognition.lang = lang === 'hi' ? 'hi-IN' : 'en-IN';
    setState('listening');

    try {
      recognition.start();
    } catch (e) {
      if (e.name === 'InvalidStateError') safeRestartListening();
    }
  }

  function safeRestartListening() {
    if (!convActive) return;
    clearTimeout(restartTimer);
    restartTimer = setTimeout(function () {
      if (convActive && state !== 'speaking' && state !== 'thinking') startListening();
    }, RESTART_DELAY);
  }

  function stopListening() {
    clearTimeout(restartTimer);
    if (recognition) { try { recognition.abort(); } catch (e) {} }
  }

  /* ══════════════════════════════════════════════════════════════
     14.  LEAD FORM  (FIX-11)
  ══════════════════════════════════════════════════════════════ */
  function renderLeadForm() {
    if (document.getElementById('jdw-lead-form')) return; // FIX-11: guard duplicate
    var hi = lang === 'hi';

    addMsgHTML('bot', [
      '<div class="jdw-lead-form" id="jdw-lead-form">',
        '<input id="jdw-l-name"    type="text"  maxlength="80"  placeholder="' + (hi ? 'Aapka Naam *' : 'Your Name *') + '">',
        '<input id="jdw-l-phone"   type="tel"   maxlength="15"  placeholder="' + (hi ? 'Mobile Number *' : 'Mobile Number *') + '">',
        '<input id="jdw-l-biz"     type="text"  maxlength="100" placeholder="' + (hi ? 'Business Name' : 'Business Name') + '">',
        '<input id="jdw-l-city"    type="text"  maxlength="80"  placeholder="' + (hi ? 'City / Location' : 'City / Location') + '">',
        '<select id="jdw-l-service">',
          '<option value="">' + (hi ? 'Service chunein' : 'Select Service') + '</option>',
          '<option>SEO &amp; Local SEO</option>',
          '<option>Google Ads</option>',
          '<option>Meta Ads (Facebook &amp; Instagram)</option>',
          '<option>Social Media Marketing</option>',
          '<option>Website Design &amp; Development</option>',
          '<option>Brand Identity Design</option>',
          '<option>Real Estate / Property Marketing</option>',
          '<option>Lead Generation</option>',
          '<option>WhatsApp Marketing</option>',
          '<option>Full-Service Package</option>',
          '<option>General Enquiry</option>',
        '</select>',
        '<input id="jdw-l-budget" type="text" maxlength="60" placeholder="' + (hi ? 'Monthly Budget (e.g. Rs.15,000)' : 'Monthly Budget (e.g. \u20b915,000)') + '">',
        '<button class="jdw-lead-submit" id="jdw-l-submit">' + (hi ? 'Submit Karein' : 'Get Free Consultation') + '</button>',
      '</div>',
    ].join(''));

    var submitBtn = document.getElementById('jdw-l-submit');
    var budgetEl  = document.getElementById('jdw-l-budget');
    if (submitBtn) submitBtn.addEventListener('click', submitLead);
    if (budgetEl)  budgetEl.addEventListener('keypress', function (e) { if (e.key === 'Enter') submitLead(); });
  }

  async function submitLead() {
    var name    = ((document.getElementById('jdw-l-name')    || {}).value || '').trim();
    var phone   = ((document.getElementById('jdw-l-phone')   || {}).value || '').trim();
    var biz     = ((document.getElementById('jdw-l-biz')     || {}).value || '').trim();
    var city    = ((document.getElementById('jdw-l-city')    || {}).value || '').trim();
    var service = ((document.getElementById('jdw-l-service') || {}).value || '');
    var budget  = ((document.getElementById('jdw-l-budget')  || {}).value || '').trim();

    if (!name) {
      var w1 = lang === 'hi' ? 'Naam required hai.' : 'Please enter your name.';
      addMsg('bot', w1); speakText(w1); return;
    }
    if (!phone || !/^[\d+\s\-]{7,15}$/.test(phone)) {
      var w2 = lang === 'hi' ? 'Valid mobile number dalein.' : 'Please enter a valid mobile number.';
      addMsg('bot', w2); speakText(w2); return;
    }

    var btn = document.getElementById('jdw-l-submit');
    if (btn) { btn.disabled = true; btn.textContent = lang === 'hi' ? 'Bhej rahe hain\u2026' : 'Sending\u2026'; }

    var formEl = document.getElementById('jdw-lead-form');
    if (formEl) { var parentMsg = formEl.closest('.jdw-msg'); if (parentMsg) parentMsg.remove(); }
    leadPending = false;

    // Add lead context to aiHistory for future responses (FIX-03 compliant: already success)
    aiHistory.push({
      role: 'assistant',
      content: '[Lead captured — Name: ' + name + ', Phone: ' + phone +
               ', Business: ' + (biz || 'N/A') + ', City: ' + (city || 'N/A') +
               ', Service: ' + (service || 'General') + ', Budget: ' + (budget || 'N/A') + ']',
    });

    try {
      var res = await fetch('/api/lead', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          name:     name,
          phone:    phone,
          email:    '',
          business: biz,
          city:     city,
          service:  service,
          budget:   budget,
          lang:     lang,
          page:     window.location.href,
        }),
      });

      var json = await res.json().catch(function () { return {}; });

      if (res.ok && json.success) {
        var successMsg = STR[lang].leadSuccess;
        addMsg('bot', successMsg);
        speakText(successMsg, function () {
          var waText = encodeURIComponent(
            "Hi! I'm " + name + ". I spoke with Wowy on the JUSTDOWOW website about " + (service || 'your services') + "."
          );
          addMsgHTML('bot',
            '<a class="jdw-wa-link" href="' + WA_URL + '?text=' + waText + '" target="_blank" rel="noopener noreferrer">' +
            '&#128172; Chat on WhatsApp now &rarr;</a>'
          );
          if (convActive) setTimeout(startListening, 1500);
        });
      } else {
        throw new Error('Lead API error ' + res.status);
      }
    } catch (err) {
      console.warn('[JDWVA] Lead submit error:', err.message);
      var errMsg = STR[lang].leadError;
      addMsg('bot', errMsg);
      speakText(errMsg);
    }
  }

  /* ══════════════════════════════════════════════════════════════
     15.  CONVERSATION CONTROL  (FIX-13)
  ══════════════════════════════════════════════════════════════ */
  function startConversation() {
    if (!recognition) {
      addMsg('bot', STR[lang].noSupport);
      addChips(STR[lang].chips);
      return;
    }
    endingConv = false;
    convActive = true;
    var micBtn = document.getElementById('jdw-mic-main');
    var endBtn = document.getElementById('jdw-end-btn');
    if (micBtn) micBtn.classList.add('jdw-conv-active');
    if (endBtn) endBtn.classList.remove('jdw-hidden');
    startListening();
  }

  function endConversation() {
    if (endingConv) return; // FIX-13: prevent double-execution
    endingConv = true;
    convActive = false;
    stopListening();
    stopCurrentAudio();
    setState('ended');
    var micBtn = document.getElementById('jdw-mic-main');
    var endBtn = document.getElementById('jdw-end-btn');
    if (micBtn) micBtn.classList.remove('jdw-conv-active');
    if (endBtn) endBtn.classList.add('jdw-hidden');
  }

  /* ══════════════════════════════════════════════════════════════
     16.  PANEL OPEN / CLOSE
  ══════════════════════════════════════════════════════════════ */
  function openPanel() {
    isOpen = true;
    var panel = document.getElementById('jdw-va-panel');
    var btn   = document.getElementById('jdw-va-btn');
    if (panel) panel.classList.add('jdw-open');
    if (btn)   btn.classList.add('jdw-active');
    if (!initialized) {
      initialized = true;
      setTimeout(doGreeting, 350);
    }
  }

  function closePanel() {
    isOpen = false;
    stopCurrentAudio();
    if (convActive) endConversation();
    var panel = document.getElementById('jdw-va-panel');
    var btn   = document.getElementById('jdw-va-btn');
    if (panel) panel.classList.remove('jdw-open');
    if (btn)   btn.classList.remove('jdw-active');
    setState('idle');
  }

  function doGreeting() {
    showTyping();
    setTimeout(function () {
      hideTyping();
      var msg = STR[lang].greeting;
      addMsg('bot', msg);
      // FIX-14: seed aiHistory with greeting for full context from turn 1
      aiHistory.push({ role: 'assistant', content: msg });
      speakText(msg, function () { addChips(STR[lang].chips); });
    }, 700);
  }

  /* ══════════════════════════════════════════════════════════════
     17.  LANGUAGE TOGGLE
  ══════════════════════════════════════════════════════════════ */
  function updateLangBtn() {
    var btn   = document.getElementById('jdw-lang-btn');
    var input = document.getElementById('jdw-text-input');
    if (btn)   btn.textContent   = STR[lang].langBtn;
    if (input) input.placeholder = lang === 'hi' ? 'Yahan type karein\u2026' : 'Type a message\u2026';
    setState(state);
  }

  /* ══════════════════════════════════════════════════════════════
     18.  EVENT WIRING
  ══════════════════════════════════════════════════════════════ */
  function wireEvents() {
    function $(id) { return document.getElementById(id); }

    $('jdw-va-btn') && $('jdw-va-btn').addEventListener('click', function () {
      if (isOpen) closePanel(); else openPanel();
    });

    $('jdw-close-btn') && $('jdw-close-btn').addEventListener('click', closePanel);

    $('jdw-mic-main') && $('jdw-mic-main').addEventListener('click', function () {
      if (convActive) {
        endConversation();
        setState('idle');
      } else {
        if (!isOpen) openPanel();
        startConversation();
      }
    });

    $('jdw-end-btn') && $('jdw-end-btn').addEventListener('click', function () {
      endConversation();
      setState('idle');
    });

    $('jdw-send-btn') && $('jdw-send-btn').addEventListener('click', sendText);

    $('jdw-text-input') && $('jdw-text-input').addEventListener('keypress', function (e) {
      if (e.key === 'Enter') sendText();
    });

    $('jdw-lang-btn') && $('jdw-lang-btn').addEventListener('click', function () {
      lang = lang === 'en' ? 'hi' : 'en';
      updateLangBtn();
      var msg = lang === 'hi'
        ? 'Ab main Hindi mein jawab doonga.'
        : 'Switched to English. I will respond in English now.';
      addMsg('bot', msg);
      aiHistory.push({ role: 'assistant', content: msg });
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && isOpen) closePanel();
    });

    // Tooltip badge auto-show after 4 s if panel not yet opened
    setTimeout(function () {
      var badge = $('jdw-va-badge');
      if (badge && !isOpen) {
        badge.classList.add('jdw-show');
        setTimeout(function () { badge.classList.remove('jdw-show'); }, 5000);
      }
    }, 4000);
  }

  function sendText() {
    var input = document.getElementById('jdw-text-input');
    var text  = ((input && input.value) || '').trim();
    if (!text) return;
    input.value = '';
    removeChips();
    handleInput(text);
  }

  /* ══════════════════════════════════════════════════════════════
     19.  INIT
  ══════════════════════════════════════════════════════════════ */
  function init() {
    domContent  = scrapeDOMContent();
    buildDOM();
    recognition = buildRecognition();
    wireEvents();
    setState('idle');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
