// js/chatbot.js — Arabic OCR floating chat widget
// Bilingual (Arabic / English), RTL/LTR auto-detect per message, proactive bubbles

(function () {
  'use strict';

  const WORKER_URL = 'https://arabicocr.zczvwz6pw7.workers.dev/web/chat';
  const PROMO_CODE = 'GS7ROCLMYB';
  const OPEN_DELAY_MS = 3500; // auto-open delay on pricing page

  // ── Helpers ──────────────────────────────────────────────────────

  function isArabic(text) {
    return /[\u0600-\u06FF]/.test(text);
  }

  function md(text) {
    // Very lightweight: **bold**, *italic*, newlines → <br>
    return text
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/\n/g, '<br>');
  }

  function browserLang() {
    // Default to Arabic; only switch to English if the browser is explicitly English
    const lang = (navigator.language || navigator.userLanguage || 'ar').toLowerCase();
    return lang.startsWith('en') ? 'en' : 'ar';
  }

  function detectPlatform() {
    const ua = navigator.userAgent;
    if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
    if (/Android/i.test(ua)) return 'android';
    if (/Win/i.test(ua)) return 'windows';
    if (/Macintosh|Mac OS X/i.test(ua)) return 'mac';
    return 'web';
  }

  function currentPage() {
    return window.location.pathname.split('/').pop() || 'index.html';
  }

  // ── Proactive messages ────────────────────────────────────────────
  // Each entry has both `en` and `ar` variants — shown based on browser language.

  // Returns a single proactive message object {en, ar} based on page + platform
  function getProactiveMessage() {
    const platform = detectPlatform();
    const page = currentPage();

    // Pricing page → promo code (highest priority)
    if (page === 'pricing.html') {
      return {
        en: `🎉 Special offer! Use code **${PROMO_CODE}** for **10% off** any plan today!`,
        ar: `🎉 عرض خاص! استخدم الكود **${PROMO_CODE}** للحصول على **خصم 10%** على أي خطة اليوم!`,
      };
    }

    // All other pages → platform-specific welcome
    const byPlatform = {
      ios: {
        en: `👋 Hi! On iPhone or iPad? Try the **Vision** feature — point your camera at Arabic text for a live translation. Use code **${PROMO_CODE}** for 10% off any plan!`,
        ar: `👋 مرحباً! على iPhone أو iPad؟ جرّب ميزة **Vision** — وجّه الكاميرا على أي نص عربي وترجمه فوراً. استخدم الكود **${PROMO_CODE}** للحصول على خصم 10%!`,
      },
      android: {
        en: `👋 Hi! On Android? Scan Arabic **handwriting** directly with your camera. Your page balance syncs across all your devices. Use code **${PROMO_CODE}** for 10% off!`,
        ar: `👋 مرحباً! على Android؟ امسح **الخط اليدوي** العربي مباشرة. رصيد صفحاتك يُزامن على جميع أجهزتك. استخدم الكود **${PROMO_CODE}** للحصول على خصم 10%!`,
      },
      windows: {
        en: `👋 Hi! On Windows? Our **PDF Studio** processes entire Arabic PDFs in one click. Use code **${PROMO_CODE}** for 10% off any plan today!`,
        ar: `👋 مرحباً! على Windows؟ **PDF Studio** يعالج ملفات PDF العربية بالكامل بنقرة واحدة. استخدم الكود **${PROMO_CODE}** للحصول على خصم 10%!`,
      },
      mac: {
        en: `👋 Hi! On Mac? **Arabic OCR** runs locally on your device using on-device AI — no internet needed for OCR, ultra-fast and private. Use code **${PROMO_CODE}** for 10% off!`,
        ar: `👋 مرحباً! على Mac؟ **Arabic OCR** يعمل محلياً على جهازك بالذكاء الاصطناعي — بدون إنترنت وبسرعة فائقة. استخدم الكود **${PROMO_CODE}** للحصول على خصم 10%!`,
      },
      web: {
        en: `👋 Hi! Need help with Arabic OCR? I can answer questions about plans, features, and platforms. Use code **${PROMO_CODE}** for 10% off any plan!`,
        ar: `👋 مرحباً! هل تحتاج مساعدة؟ يمكنني الإجابة على أسئلتك حول الخطط والميزات والمنصات. استخدم الكود **${PROMO_CODE}** للحصول على خصم 10%!`,
      },
    };

    return byPlatform[platform] || byPlatform.web;
  }

  // ── CSS ───────────────────────────────────────────────────────────

  const CSS = `
  #ocr-chat-btn {
    position: fixed;
    bottom: 24px;
    right: 24px;
    z-index: 9998;
    width: 56px;
    height: 56px;
    border-radius: 50%;
    background: linear-gradient(135deg, #fde047, #facc15);
    color: #1a1a1a;
    border: none;
    cursor: pointer;
    box-shadow: 0 4px 16px rgba(250,204,21,.6);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: transform .2s, box-shadow .2s;
    animation: ocr-breathe 3s ease-in-out infinite;
  }
  #ocr-chat-btn::before {
    content: '';
    position: absolute;
    inset: -4px;
    border-radius: 50%;
    background: rgba(250,204,21,.35);
    animation: ocr-ripple 2.4s ease-out infinite;
    pointer-events: none;
  }
  #ocr-chat-btn::after {
    content: '';
    position: absolute;
    inset: -4px;
    border-radius: 50%;
    background: rgba(250,204,21,.2);
    animation: ocr-ripple 2.4s ease-out infinite .8s;
    pointer-events: none;
  }
  #ocr-chat-btn.open,
  #ocr-chat-btn.open::before,
  #ocr-chat-btn.open::after {
    animation: none;
  }
  #ocr-chat-btn.wiggle { animation: ocr-wiggle .6s ease-in-out, ocr-breathe 3s ease-in-out infinite .65s; }
  #ocr-chat-btn:hover { transform: scale(1.1); box-shadow: 0 6px 20px rgba(250,204,21,.7); animation: none; }
  #ocr-chat-btn svg { width: 26px; height: 26px; position: relative; z-index: 1; }

  @keyframes ocr-breathe {
    0%,100% { transform: scale(1);   box-shadow: 0 4px 16px rgba(250,204,21,.6); }
    50%      { transform: scale(1.06); box-shadow: 0 6px 24px rgba(250,204,21,.8); }
  }
  @keyframes ocr-ripple {
    0%   { transform: scale(1);   opacity: .7; }
    100% { transform: scale(1.9); opacity: 0;  }
  }
  @keyframes ocr-wiggle {
    0%,100% { transform: rotate(0deg)   scale(1); }
    15%     { transform: rotate(-14deg) scale(1.08); }
    30%     { transform: rotate(12deg)  scale(1.08); }
    45%     { transform: rotate(-10deg) scale(1.05); }
    60%     { transform: rotate(8deg)   scale(1.05); }
    75%     { transform: rotate(-5deg)  scale(1.02); }
    90%     { transform: rotate(3deg)   scale(1.01); }
  }

  #ocr-chat-badge {
    position: absolute;
    top: -3px; right: -3px;
    background: #ef4444;
    color: #fff;
    font-size: 11px;
    font-weight: 700;
    width: 18px; height: 18px;
    border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    display: none;
  }

  #ocr-chat-panel {
    position: fixed;
    bottom: 92px;
    right: 24px;
    z-index: 9999;
    width: 360px;
    max-width: calc(100vw - 32px);
    height: 500px;
    max-height: calc(100vh - 120px);
    background: #fff;
    border-radius: 16px;
    box-shadow: 0 8px 40px rgba(0,0,0,.22);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    transform-origin: bottom right;
    transition: opacity .2s, transform .2s;
    opacity: 0;
    transform: scale(.92) translateY(8px);
    pointer-events: none;
  }
  #ocr-chat-panel.open {
    opacity: 1;
    transform: scale(1) translateY(0);
    pointer-events: all;
  }

  #ocr-chat-header {
    background: linear-gradient(135deg, #fde047, #facc15);
    color: #1a1a1a;
    padding: 14px 16px;
    display: flex;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;
  }
  #ocr-chat-header .avatar {
    width: 36px; height: 36px;
    border-radius: 50%;
    background: rgba(255,255,255,.25);
    display: flex; align-items: center; justify-content: center;
    font-size: 18px;
    flex-shrink: 0;
  }
  #ocr-chat-header .info { flex: 1; }
  #ocr-chat-header .info strong { display: block; font-size: 14px; }
  #ocr-chat-header .info span { font-size: 11px; opacity: .85; }
  #ocr-chat-close {
    background: none; border: none; color: #1a1a1a;
    cursor: pointer; font-size: 20px; line-height: 1;
    padding: 4px; border-radius: 4px; opacity: .8;
    transition: opacity .15s;
  }
  #ocr-chat-close:hover { opacity: 1; }

  #ocr-chat-messages {
    flex: 1;
    overflow-y: auto;
    padding: 14px 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    background: #fffbeb;
  }
  #ocr-chat-messages::-webkit-scrollbar { width: 5px; }
  #ocr-chat-messages::-webkit-scrollbar-thumb { background: #fde047; border-radius: 4px; }

  .ocr-msg {
    max-width: 86%;
    padding: 9px 13px;
    border-radius: 14px;
    font-size: 13.5px;
    line-height: 1.55;
    word-break: break-word;
  }
  .ocr-msg.bot {
    background: #fff;
    border: 1px solid #e2e8f0;
    border-bottom-left-radius: 4px;
    align-self: flex-start;
    color: #1e293b;
  }
  .ocr-msg.user {
    background: linear-gradient(135deg, #fde047, #facc15);
    color: #1a1a1a;
    border-bottom-right-radius: 4px;
    align-self: flex-end;
    text-align: right;
  }
  .ocr-msg[dir="rtl"] { text-align: right; }
  .ocr-msg[dir="ltr"] { text-align: left; }
  .ocr-msg.user[dir="rtl"] { text-align: right; }

  .ocr-typing {
    display: flex; align-items: center; gap: 4px;
    padding: 10px 14px;
    background: #fff;
    border: 1px solid #e2e8f0;
    border-radius: 14px;
    border-bottom-left-radius: 4px;
    align-self: flex-start;
  }
  .ocr-typing span {
    width: 7px; height: 7px;
    border-radius: 50%;
    background: #94a3b8;
    animation: ocr-bounce .8s infinite;
  }
  .ocr-typing span:nth-child(2) { animation-delay: .15s; }
  .ocr-typing span:nth-child(3) { animation-delay: .3s; }
  @keyframes ocr-bounce {
    0%,80%,100% { transform: translateY(0); opacity:.6; }
    40% { transform: translateY(-6px); opacity:1; }
  }

  #ocr-chat-input-row {
    padding: 10px 12px;
    border-top: 1px solid #e2e8f0;
    display: flex;
    gap: 8px;
    align-items: flex-end;
    background: #fff;
    flex-shrink: 0;
  }
  #ocr-chat-input {
    flex: 1;
    border: 1px solid #cbd5e1;
    border-radius: 10px;
    padding: 9px 12px;
    font-size: 13.5px;
    outline: none;
    resize: none;
    max-height: 90px;
    overflow-y: auto;
    line-height: 1.4;
    font-family: inherit;
    color: #1e293b;
    transition: border-color .15s;
  }
  #ocr-chat-input:focus { border-color: #facc15; box-shadow: 0 0 0 3px rgba(250,204,21,.25); }
  #ocr-chat-input::placeholder { color: #94a3b8; }
  #ocr-chat-send {
    width: 38px; height: 38px;
    border-radius: 10px;
    background: linear-gradient(135deg, #fde047, #facc15);
    color: #1a1a1a;
    border: none; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
    transition: opacity .15s;
  }
  #ocr-chat-send:disabled { opacity: .5; cursor: default; }
  #ocr-chat-send svg { width: 18px; height: 18px; }

  #ocr-chat-footer {
    text-align: center;
    font-size: 10px;
    color: #94a3b8;
    padding: 4px 0 8px;
    background: #fff;
    flex-shrink: 0;
  }
  #ocr-chat-footer a { color: #94a3b8; text-decoration: none; }
  `;

  // ── Inject CSS ────────────────────────────────────────────────────

  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  // ── Build HTML ────────────────────────────────────────────────────

  const lang = browserLang();

  const wrapper = document.createElement('div');
  wrapper.id = 'ocr-chat-wrapper';
  wrapper.innerHTML = `
    <button id="ocr-chat-btn" aria-label="Open chat">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>
      <span id="ocr-chat-badge">1</span>
    </button>
    <div id="ocr-chat-panel" role="dialog" aria-label="Chat with support">
      <div id="ocr-chat-header">
        <div class="avatar">🤖</div>
        <div class="info">
          <strong>${lang === 'ar' ? 'مساعد Arabic OCR' : 'Arabic OCR Assistant'}</strong>
          <span>${lang === 'ar' ? 'متصل الآن · عادةً يرد فوراً' : 'Online · Replies instantly'}</span>
        </div>
        <button id="ocr-chat-close" aria-label="Close">✕</button>
      </div>
      <div id="ocr-chat-messages"></div>
      <div id="ocr-chat-input-row">
        <textarea id="ocr-chat-input" rows="1"
          placeholder="${lang === 'ar' ? 'اكتب سؤالك هنا...' : 'Ask a question...'}"
          dir="auto"></textarea>
        <button id="ocr-chat-send" aria-label="Send">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"/>
            <polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
        </button>
      </div>
      <div id="ocr-chat-footer">Powered by <a href="https://arabic-ocr.com" target="_blank">arabic-ocr.com</a></div>
    </div>
  `;
  document.body.appendChild(wrapper);

  // ── References ────────────────────────────────────────────────────

  const btn      = document.getElementById('ocr-chat-btn');
  const panel    = document.getElementById('ocr-chat-panel');
  const closeBtn = document.getElementById('ocr-chat-close');
  const messagesEl = document.getElementById('ocr-chat-messages');
  const inputEl  = document.getElementById('ocr-chat-input');
  const sendBtn  = document.getElementById('ocr-chat-send');
  const badge    = document.getElementById('ocr-chat-badge');

  let history = [];       // [{role, content}]
  let proactiveShown = false;
  let isOpen = false;

  // ── Helpers ───────────────────────────────────────────────────────

  function addMessage(text, role) {
    const el = document.createElement('div');
    el.className = `ocr-msg ${role}`;
    el.setAttribute('dir', isArabic(text) ? 'rtl' : 'ltr');
    el.innerHTML = md(text);
    messagesEl.appendChild(el);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return el;
  }

  function showTyping() {
    const el = document.createElement('div');
    el.className = 'ocr-typing';
    el.innerHTML = '<span></span><span></span><span></span>';
    messagesEl.appendChild(el);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return el;
  }

  function openPanel() {
    panel.classList.add('open');
    btn.classList.add('open');
    isOpen = true;
    badge.style.display = 'none';
    inputEl.focus();
  }

  function closePanel() {
    panel.classList.remove('open');
    btn.classList.remove('open');
    isOpen = false;
  }

  // Idle wiggle — fires every 8s while panel is closed
  function scheduleWiggle() {
    setTimeout(function tick() {
      if (!isOpen) {
        btn.classList.remove('wiggle');
        void btn.offsetWidth; // force reflow to restart animation
        btn.classList.add('wiggle');
        btn.addEventListener('animationend', () => btn.classList.remove('wiggle'), { once: true });
      }
      setTimeout(tick, 8000);
    }, 8000);
  }
  scheduleWiggle();

  // ── Proactive messages ────────────────────────────────────────────

  function showProactive() {
    if (proactiveShown) return;
    proactiveShown = true;

    const msg = getProactiveMessage();
    const text = msg[lang] || msg.en;
    addMessage(text, 'bot');
    history.push({ role: 'assistant', content: text });
  }

  // ── Send message ──────────────────────────────────────────────────

  async function sendMessage() {
    const text = inputEl.value.trim();
    if (!text) return;

    inputEl.value = '';
    inputEl.style.height = 'auto';
    sendBtn.disabled = true;

    addMessage(text, 'user');
    history.push({ role: 'user', content: text });

    const typing = showTyping();

    try {
      const res = await fetch(WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history: history.slice(0, -1) }),
      });

      const data = await res.json();
      typing.remove();

      const reply = data.reply || data.error || (lang === 'ar'
        ? 'عذراً، حدث خطأ. حاول مرة أخرى.'
        : 'Sorry, something went wrong. Please try again.');

      addMessage(reply, 'bot');
      history.push({ role: 'assistant', content: reply });

      // Keep history to last 20 entries (10 turns)
      if (history.length > 20) history = history.slice(-20);

    } catch {
      typing.remove();
      const errMsg = lang === 'ar'
        ? 'تعذّر الاتصال. تحقق من اتصالك بالإنترنت.'
        : 'Connection failed. Check your internet connection.';
      addMessage(errMsg, 'bot');
    }

    sendBtn.disabled = false;
    inputEl.focus();
  }

  // ── Event listeners ───────────────────────────────────────────────

  btn.addEventListener('click', () => {
    if (isOpen) {
      closePanel();
    } else {
      openPanel();
      if (!proactiveShown) showProactive();
    }
  });

  closeBtn.addEventListener('click', closePanel);

  sendBtn.addEventListener('click', sendMessage);

  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // Auto-resize textarea
  inputEl.addEventListener('input', () => {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 90) + 'px';
  });

  // ── Auto-open on all pages ────────────────────────────────────────

  setTimeout(() => {
    openPanel();
    showProactive();
  }, OPEN_DELAY_MS);

})();
