/*!
 * Arabic OCR — AI Document & Workflow Agent widget
 * Standalone, dependency-free. Drop-in:
 *   <script src="/web-widget/agent-widget.js" defer></script>
 *
 * Optional overrides (set before the script loads):
 *   window.OCR_AGENT_ENDPOINT = 'https://.../agent/chat'
 *   window.__ocrAgentContext  = 'text of the current document'   (string or () => string)
 * or via attribute: <script ... data-endpoint="https://.../agent/chat">
 */
(function () {
  'use strict';
  if (window.__ocrAgentLoaded) return;
  window.__ocrAgentLoaded = true;

  var scriptEl = document.currentScript;
  var ENDPOINT =
    window.OCR_AGENT_ENDPOINT ||
    (scriptEl && scriptEl.getAttribute('data-endpoint')) ||
    'https://ocrchat.zczvwz6pw7.workers.dev/agent/chat';
  var SID_KEY = 'ocr_agent_sid';
  var REQUEST_TIMEOUT_MS = 25000;
  var PROMO = 'GS7ROCLMYB';

  var LINKS = {
    pricing: 'https://arabic-ocr.com/pricing.html?discount=' + PROMO,
    ios: 'https://apps.apple.com/app/id6745792738',
    mac: 'https://apps.apple.com/us/search?term=Arabic%20OCR',
    android: 'https://play.google.com/store/apps/details?id=com.kanzati.arabicocr',
    windows: 'https://apps.microsoft.com/detail/9P2NRS4S8ND6',
    web: 'https://arabic-ocr.com/portal.html',
    blog: 'https://arabic-ocr.com/blog.html',
    contact: 'https://arabic-ocr.com/contact.html',
    email: 'mailto:support@arabic-ocr.com'
  };

  // ── Helpers ───────────────────────────────────────────────────────
  var memSid = null;
  function getSessionId() {
    try {
      var s = localStorage.getItem(SID_KEY);
      if (s && /^[A-Za-z0-9_-]{8,64}$/.test(s)) return s;
      s = newId();
      localStorage.setItem(SID_KEY, s);
      return s;
    } catch (e) {
      return memSid || (memSid = newId());
    }
  }
  function newId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    var a = new Uint8Array(16);
    (window.crypto || window.msCrypto).getRandomValues(a);
    return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }
  function detectPlatform() {
    var ua = navigator.userAgent || '';
    if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
    if (/Android/i.test(ua)) return 'android';
    // Web users on desktop: point to the matching store app, but report "web" as the platform.
    return 'web';
  }
  function desktopStoreKey() {
    var ua = navigator.userAgent || '';
    if (/Windows/i.test(ua)) return 'windows';
    if (/Macintosh|Mac OS X/i.test(ua)) return 'mac';
    return null;
  }
  function downloadLink() {
    var p = detectPlatform();
    if (p === 'ios' || p === 'android') return LINKS[p];
    return LINKS[desktopStoreKey()] || LINKS.web;
  }
  function lang() {
    // Arabic by default. Override with window.OCR_AGENT_LANG = 'en' or data-lang="en".
    var o = window.OCR_AGENT_LANG || (scriptEl && scriptEl.getAttribute('data-lang'));
    return o === 'en' ? 'en' : 'ar';
  }
  function isArabic(t) { return /[\u0600-\u06FF]/.test(t); }

  var lastOcrText = '';
  function getContext() {
    try {
      var c = window.__ocrAgentContext;
      if (typeof c === 'function') c = c();
      if (typeof c === 'string' && c.trim()) return c.trim().slice(0, 6000);
      // Web portal (Quill editor holding the extracted text)
      var q = document.querySelector('#editor-container .ql-editor');
      if (q) {
        var t = (q.innerText || '').trim();
        if (t.length > 1) return t.slice(0, 6000);
      }
      if (lastOcrText) return lastOcrText.slice(0, 6000);
    } catch (e) { /* ignore */ }
    return '';
  }

  // ── In-chat OCR (same worker + daily limit as the homepage demo) ──
  var OCR_PROXY = 'https://arabicocr.zczvwz6pw7.workers.dev';
  var OCR_DAY_KEY = 'ocr_last_used_date';
  function today() { return new Date().toISOString().split('T')[0]; }
  function usedOcrToday() { try { return localStorage.getItem(OCR_DAY_KEY) === today(); } catch (e) { return false; } }
  function markOcrUsed() { try { localStorage.setItem(OCR_DAY_KEY, today()); } catch (e) { /* ignore */ } }
  function stripThink(t) { return String(t || '').replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<think>[\s\S]*/gi, '').trim(); }
  async function callOcr(messages) {
    var r = await fetch(OCR_PROXY, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: messages }) });
    var j = await r.json();
    if (j.choices && j.choices[0] && j.choices[0].message) return stripThink(j.choices[0].message.content);
    throw new Error((j.error && (j.error.message || JSON.stringify(j.error))) || 'OCR failed');
  }
  // Downscale to keep uploads small and fast
  function imageToDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var max = 1800, w = img.naturalWidth, h = img.naturalHeight, s = Math.min(1, max / Math.max(w, h));
        var c = document.createElement('canvas');
        c.width = Math.round(w * s); c.height = Math.round(h * s);
        var ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', 0.88));
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('bad image')); };
      img.src = url;
    });
  }

  var L = lang();
  var T = {
    title: L === 'ar' ? 'مساعد المستندات' : 'Document Assistant',
    status: L === 'ar' ? 'Arabic OCR · متصل' : 'Arabic OCR · Online',
    placeholder: L === 'ar' ? 'اسأل عن نصك أو مستندك...' : 'Ask about your text or document...',
    tryTitle: 'Try Arabic OCR Online / تجربة استخراج النصوص',
    tryBody: L === 'ar'
      ? 'جرّب Arabic OCR مجاناً هنا في المحادثة! ارفع صورة، جرّب خط يدك، أو اسحب ملفاً إلى هنا لاستخراج النص العربي فوراً.\n(لنتائج كاملة ودعم PDF، حمّل التطبيق.)'
      : 'Test Arabic OCR free right here in the chat! Upload an image, try your handwriting, or drop a file here to extract Arabic text instantly.\n(For full results & PDF support, download the app.)',
    upload: L === 'ar' ? '📷 ارفع صورة' : '📷 Upload image',
    attach: L === 'ar' ? 'إرفاق صورة' : 'Attach image',
    ocrBusy: L === 'ar' ? 'جاري استخراج النص...' : 'Extracting text...',
    ocrResult: L === 'ar' ? '📄 النص المستخرج:' : '📄 Extracted text:',
    ocrEmpty: L === 'ar' ? 'لم يتم العثور على نص في الصورة.' : 'No text was found in the image.',
    ocrFail: L === 'ar' ? 'تعذّر استخراج النص. حاول بصورة أوضح.' : 'Could not extract text. Try a clearer image.',
    ocrPdf: L === 'ar' ? 'ملفات PDF مدعومة في التطبيق والبوابة. هنا يمكنك تجربة الصور (JPG, PNG).' : 'PDFs are supported in the app and web portal. Here you can try images (JPG, PNG).',
    ocrLimit: L === 'ar' ? 'استخدمت التجربة المجانية اليومية (صفحة واحدة/يوم). سجّل في البوابة للحصول على 10 مسحات شهرياً، أو حمّل التطبيق.' : 'You\'ve used today\'s free try (1 page/day). Sign in to the portal for 10 scans/month, or download the app.',
    copy: L === 'ar' ? 'نسخ' : 'Copy',
    copied: L === 'ar' ? 'تم النسخ ✓' : 'Copied ✓',
    whatNext: L === 'ar' ? 'ماذا تريد أن أفعل بالنص؟' : 'What should I do with this text?',
    hello: L === 'ar'
      ? 'مرحباً! يمكنني شرح النص العربي المستخرج، تلخيص المستندات، ترجمتها، ومساعدتك في الخطوات التالية. كيف أساعدك؟'
      : 'Hi! I can explain extracted Arabic text, summarize or translate documents, and help you with next steps. How can I help?',
    hasDoc: L === 'ar' ? 'يمكنني رؤية النص المستخرج في صفحتك. اسألني لتلخيصه أو شرحه.' : 'I can see the text extracted on this page. Ask me to summarize or explain it.',
    network: L === 'ar' ? 'تعذّر الاتصال. تحقق من الإنترنت، أو جرّب التطبيق الأصلي الذي يعمل أيضاً بدون إنترنت.' : 'Connection failed. Check your internet, or try the native app which also works offline.',
    generic: L === 'ar' ? 'حدث خطأ مؤقت. حاول مرة أخرى.' : 'Something went wrong. Please try again.',
    download: L === 'ar' ? 'حمّل التطبيق' : 'Download app',
    upgrade: L === 'ar' ? 'الترقية إلى Pro' : 'Upgrade to Pro',
    portal: L === 'ar' ? 'افتح البوابة' : 'Open web portal',
    more: L === 'ar' ? 'اعرف المزيد' : 'Learn more',
    open: L === 'ar' ? 'فتح المساعد' : 'Open assistant',
    close: L === 'ar' ? 'إغلاق' : 'Close',
    send: L === 'ar' ? 'إرسال' : 'Send',
    pricingHi: L === 'ar'
      ? '🎁 لديك خصم خاص! استخدم الكود ' + PROMO + ' عند الاشتراك في Pro واحصل على مسحات غير محدودة. الكود مُطبّق تلقائياً عبر الزر أدناه.'
      : '🎁 You have a special discount! Use code ' + PROMO + ' when upgrading to Pro for unlimited scans. It\'s applied automatically with the button below.',
    claim: L === 'ar' ? 'استخدم الخصم' : 'Claim discount',
    // Rotating welcomes — picked smartly (time of day, returning visitor, never the same twice in a row)
    welcomes: L === 'ar' ? [
      '🏆 Arabic OCR — التطبيق العربي رقم 1 لدعم الخط اليدوي.\nاستخدم تقنية OCR المتقدمة لمسح الصور وملفات PDF والخط اليدوي بدقة عالية.',
      '✍️ هل لديك ملاحظات مكتوبة بخط اليد؟ Arabic OCR هو التطبيق العربي رقم 1 للخط اليدوي — حوّلها إلى نص قابل للتعديل في ثوانٍ.',
      '👋 أهلاً بك! حوّل الصور وملفات PDF إلى نص عربي دقيق، مع التلخيص والترجمة والتصدير إلى Word/PDF. لديك 10 مسحات مجانية شهرياً.',
      '📚 طالب، باحث، أو صحفي؟ استخرج النصوص العربية من الكتب والمخطوطات والمستندات الممسوحة بدقة عالية وبضغطة واحدة.',
      '⚡ من الصورة إلى النص في ثوانٍ! Arabic OCR يتعرّف على النص المطبوع والمكتوب بخط اليد، ثم يلخّصه أو يترجمه لك.',
      '🧠 اكتشف قوة الذكاء الاصطناعي في التعرف على الخط العربي اليدوي واستخراجه بدقة مذهلة — من ملاحظات الطلاب إلى المخطوطات التاريخية، وتحويلها إلى نصوص رقمية فوراً.',
      '✨ الحل المتكامل لتحويل الصور والملفات إلى نصوص بدقة فائقة. وداعاً للكتابة اليدوية! استخرج النصوص العربية من أي مصدر بضغطة زر واحدة.',
      '🎯 دقة فائقة وسرعة البرق: دعم كامل للخطوط العربية المطبوعة واليدوية، واستخراج النصوص وتنسيقها خلال ثوانٍ معدودة.',
      '📑 جرّب PDF Studio: عدّل وادمج ونظّم ملفات PDF مباشرة من متصفحك — تدوير الصفحات، الحذف، واستخراج النصوص دون أي تثبيت.',
      '🔒 خصوصيتك مضمونة: تتم معالجة الملفات محلياً أو بشكل آمن في السحابة — لا يتم حفظ أو مشاركة أي بيانات.',
      '🤖 مدعوم بتقنية Google Vision AI المدرّبة على ملايين المستندات — دقة عالية حتى مع الخط اليدوي المعقد والصور منخفضة الجودة، وتتحسن النتائج باستمرار.'
    ] : [
      '🏆 Arabic OCR — the #1 Arabic app for handwriting support.\nUse advanced Arabic OCR to scan images, PDFs, and handwriting with high precision.',
      '✍️ Got handwritten notes? Arabic OCR is the #1 Arabic app for handwriting — turn them into editable text in seconds.',
      '👋 Welcome! Turn images and PDFs into accurate Arabic text, with summarizing, translation and Word/PDF export. You get 10 free scans every month.',
      '📚 Student, researcher or journalist? Extract Arabic text from books, manuscripts and scanned documents with high precision.',
      '⚡ Image to text in seconds! Arabic OCR reads printed and handwritten Arabic, then summarizes or translates it for you.',
      '🧠 Discover the power of AI in Arabic handwriting recognition — from student notes to historical manuscripts, converted to digital text instantly.',
      '✨ The complete solution for turning images and files into text with superior accuracy. Goodbye manual typing!',
      '🎯 Superior accuracy, lightning speed: full support for printed and handwritten Arabic, extracted and formatted in seconds.',
      '📑 Try PDF Studio: edit, merge and organize PDFs right in your browser — rotate, delete pages and extract text with no installation.',
      '🔒 Your privacy is guaranteed: files are processed locally or securely in the cloud — nothing is stored or shared.',
      '🤖 Powered by Google Vision AI, trained on millions of real documents — precise even with complex handwriting or low-quality images, and always improving.'
    ],
    faqIntro: L === 'ar' ? '❓ لديك سؤال؟ اختر من الأسئلة الشائعة:' : '❓ Have a question? Pick one of our FAQs:',
    faq: L === 'ar'
      ? [['ما هو Arabic OCR؟', 'ما هو Arabic OCR؟'], ['هل يمكنني استخدامه أونلاين؟', 'هل يمكنني استخدامه أونلاين دون تحميل تطبيق؟'], ['هل يدعم الخط اليدوي؟', 'هل يدعم التعرف على الكتابة اليدوية العربية؟'], ['المنصات المدعومة', 'ما هي المنصات المدعومة؟'], ['هل التطبيق مجاني؟', 'هل التطبيق مجاني؟'], ['صيغ الملفات', 'ما صيغ الملفات المدعومة؟'], ['الخصوصية والأمان', 'هل بياناتي آمنة وخاصة؟'], ['اللغات المدعومة', 'ما اللغات المدعومة؟']]
      : [['What is Arabic OCR?', 'What is Arabic OCR?'], ['Use it online?', 'Can I use it online without downloading an app?'], ['Handwriting support?', 'Does it support Arabic handwriting recognition?'], ['Platforms', 'Which platforms are supported?'], ['Is it free?', 'Is Arabic OCR free?'], ['File formats', 'What file formats are supported?'], ['Privacy & security', 'Is my data private and secure?'], ['Languages', 'What languages are supported?']],
    blogMsg: L === 'ar' ? '📰 آخر ما في مدوّنتنا: نصائح ودروس وأحدث الأخبار حول Arabic OCR وتقنيات الذكاء الاصطناعي.' : '📰 Latest from our blog: tips, tutorials, and the latest news about Arabic OCR and AI technology.',
    blogBtn: L === 'ar' ? 'عرض جميع المقالات' : 'View all articles',
    contactMsg: L === 'ar'
      ? '💬 لأي دعم أو استفسار، تواصل معنا على support@arabic-ocr.com أو عبر نموذج صفحة اتصل بنا.'
      : '💬 For any support or questions, email us at support@arabic-ocr.com or use our Contact Us form.',
    emailBtn: L === 'ar' ? '✉️ راسلنا' : '✉️ Email us',
    contactBtn: L === 'ar' ? 'صفحة اتصل بنا' : 'Contact Us page',
    greetMorning: L === 'ar' ? '☀️ صباح الخير!' : '☀️ Good morning!',
    greetEvening: L === 'ar' ? '🌙 مساء الخير!' : '🌙 Good evening!',
    welcomeBack: L === 'ar' ? '👋 أهلاً بعودتك!' : '👋 Welcome back!',
    appleLLM: L === 'ar'
      ? '🍎 على Mac و iPhone/iPad: تطبيقنا مصمم خصيصاً لأنظمة Apple مع تكامل Apple Local LLM — خصوصية وسرعة لا مثيل لهما. عالج مستنداتك الحساسة بالكامل دون إنترنت، ولا تغادر بياناتك جهازك أبداً.'
      : '🍎 On Mac and iPhone/iPad: designed for the Apple ecosystem with Apple Local LLM integration — ultimate privacy and speed. Process sensitive documents entirely offline; your data never leaves your device.',
    winApp: L === 'ar'
      ? '🪟 تستخدم Windows؟ جرّب تطبيق Arabic OCR لنظام Windows من Microsoft Store — يعمل بنموذج محلي على جهازك بدون إنترنت، ولا تغادر ملفاتك جهازك أبداً.'
      : '🪟 On Windows? Get the Arabic OCR app for Windows from the Microsoft Store — it runs a local on-device model offline, so your files never leave your PC.',
    androidApp: L === 'ar'
      ? '🤖 تستخدم Android؟ تطبيقنا يعتمد على Google Cloud Vision API لدقة عالية في التعرّف على النص العربي، حتى الخط اليدوي. حمّله من Google Play.'
      : '🤖 On Android? Our app is powered by Google Cloud Vision API for highly accurate Arabic text recognition, even handwriting. Get it on Google Play.',
    winStore: L === 'ar' ? 'تحميل من Microsoft Store' : 'Get it from Microsoft Store',
    playStore: L === 'ar' ? 'تحميل من Google Play' : 'Get it on Google Play',
    getApp: L === 'ar' ? 'حمّل التطبيق' : 'Get the app',
    tryWeb: L === 'ar' ? 'جرّب البوابة' : 'Try the web portal',
    scanDone: L === 'ar'
      ? '✅ اكتمل المسح! ماذا تريد أن أفعل بالنص؟'
      : '✅ Scan complete! What would you like me to do with the text?',
    scanTip: L === 'ar'
      ? '💡 نصيحة: جرّب "القوالب" لتنسيق النص كفاتورة أو مستند قانوني أو ورقة بحثية. إذا كان المستند يحتوي على جداول، جرّب "استخراج الجداول" من شريط الأدوات.'
      : '💡 Tip: Try "Templates" to format text as an invoice, legal doc, or research paper. If your document has tables, try "Extract Tables" from the toolbar.',
    chips: L === 'ar'
      ? [['📝 لخّص', 'لخّص هذا النص'], ['🌐 ترجم للإنجليزية', 'ترجم هذا النص إلى الإنجليزية'], ['✨ حسّن النص', 'صحّح وحسّن هذا النص المستخرج'], ['📊 استخرج الجداول', 'استخرج الجداول من هذا النص'], ['❓ اشرحه', 'اشرح لي هذا النص']]
      : [['📝 Summarize', 'Summarize this text'], ['🌐 Translate', 'Translate this text to English'], ['✨ Refine', 'Fix and refine this extracted text'], ['📊 Extract Tables', 'Extract tables from this text'], ['❓ Explain', 'Explain this text to me']]
  };

  // ── UI (Shadow DOM so site CSS can't interfere) ───────────────────
  var host = document.createElement('div');
  host.id = 'ocr-agent-host';
  document.body.appendChild(host);
  var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;

  var css = [
    ':host{all:initial}',
    '*{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Noto Sans Arabic",Tahoma,sans-serif}',
    '.fab{position:fixed;right:24px;bottom:24px;width:60px;height:60px;border:0;border-radius:50%;cursor:pointer;color:#1c1917;z-index:2147483000;',
    'background:linear-gradient(135deg,#fcd34d 0%,#fbbf24 55%,#f59e0b 100%);box-shadow:0 8px 24px rgba(245,158,11,.45);display:flex;align-items:center;justify-content:center;transition:transform .2s,box-shadow .2s}',
    '.fab:hover{transform:scale(1.08);box-shadow:0 10px 28px rgba(245,158,11,.55)}',
    '.fab:focus-visible,.send:focus-visible,.close:focus-visible,.act:focus-visible{outline:3px solid #fde68a;outline-offset:2px}',
    '.fab svg{width:28px;height:28px}',
    '.fab .dot{position:absolute;top:6px;right:6px;width:12px;height:12px;background:#ef4444;border:2px solid #fff;border-radius:50%;display:none}',
    '.fab.nudge .dot{display:block}',
    '.panel{position:fixed;right:24px;bottom:96px;width:380px;height:520px;max-width:calc(100vw - 24px);max-height:calc(100vh - 116px);z-index:2147483001;',
    'background:#fff;border-radius:18px;box-shadow:0 18px 60px rgba(15,23,42,.28);display:flex;flex-direction:column;overflow:hidden;',
    'opacity:0;transform:translateY(12px) scale(.96);transform-origin:bottom right;pointer-events:none;transition:opacity .2s,transform .2s}',
    '.panel.open{opacity:1;transform:none;pointer-events:auto}',
    '.head{background:linear-gradient(135deg,#fcd34d,#fbbf24);color:#1c1917;padding:14px 16px;display:flex;align-items:center;gap:12px;flex-shrink:0}',
    '.avatar{width:38px;height:38px;border-radius:50%;background:rgba(255,255,255,.2);display:flex;align-items:center;justify-content:center;flex-shrink:0}',
    '.avatar svg{width:20px;height:20px}',
    '.info{flex:1;min-width:0}.info b{display:block;font-size:15px}.info span{font-size:11px;opacity:.85}',
    '.close{background:none;border:0;color:#1c1917;font-size:22px;line-height:1;cursor:pointer;padding:4px 8px;border-radius:8px;opacity:.85}.close:hover{opacity:1;background:rgba(255,255,255,.15)}',
    '.msgs{flex:1;overflow-y:auto;padding:16px 14px;background:#f1f5f9;display:flex;flex-direction:column;gap:10px}',
    '.msg{max-width:86%;padding:10px 14px;border-radius:16px;font-size:14px;line-height:1.55;white-space:pre-wrap;word-break:break-word}',
    '.msg.bot{background:#fff;color:#0f172a;border:1px solid #e2e8f0;border-bottom-left-radius:5px;align-self:flex-start}',
    '.msg.user{background:linear-gradient(135deg,#fcd34d,#fbbf24);color:#1c1917;border-bottom-right-radius:5px;align-self:flex-end}',
    '.msg[dir=rtl].bot{border-bottom-left-radius:16px;border-bottom-right-radius:5px}',
    '.msg[dir=rtl].user{border-bottom-right-radius:16px;border-bottom-left-radius:5px}',
    '.actions{display:flex;flex-wrap:wrap;gap:8px;align-self:flex-start;max-width:92%}',
    '.act{display:inline-block;text-decoration:none;font-size:13px;font-weight:600;padding:8px 14px;border-radius:999px;cursor:pointer;border:1px solid #f59e0b;color:#b45309;background:#fff;transition:background .15s}',
    '.act:hover{background:#fffbeb}.act.primary{background:#fbbf24;color:#1c1917}.act.primary:hover{background:#f59e0b}',
    '.chip{font-size:13px;font-weight:600;padding:7px 12px;border-radius:999px;cursor:pointer;border:1px solid #fcd34d;color:#92400e;background:linear-gradient(135deg,#fffbeb,#fef3c7);transition:transform .15s,box-shadow .15s}',
    '.chip:hover{transform:translateY(-1px);box-shadow:0 4px 12px rgba(245,158,11,.25)}',
    '.msg.bot{animation:pop .25s ease-out}@keyframes pop{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}',
    '.typing{display:flex;gap:4px;padding:12px 14px;background:#fff;border:1px solid #e2e8f0;border-radius:16px;align-self:flex-start}',
    '.typing i{width:7px;height:7px;border-radius:50%;background:#94a3b8;animation:b .9s infinite}.typing i:nth-child(2){animation-delay:.15s}.typing i:nth-child(3){animation-delay:.3s}',
    '@keyframes b{0%,80%,100%{transform:translateY(0);opacity:.5}40%{transform:translateY(-5px);opacity:1}}',
    '.row{display:flex;gap:8px;align-items:flex-end;padding:10px 12px;background:#fff;border-top:1px solid #e2e8f0;flex-shrink:0}',
    'textarea{text-align:right;flex:1;resize:none;border:1px solid #cbd5e1;border-radius:12px;padding:10px 12px;font-size:14px;line-height:1.4;max-height:96px;outline:none;color:#0f172a}',
    'textarea:focus{border-color:#fbbf24;box-shadow:0 0 0 3px rgba(245,158,11,.2)}',
    '.send{width:40px;height:40px;border:0;border-radius:12px;background:linear-gradient(135deg,#fcd34d,#fbbf24);color:#1c1917;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0}',
    '.send:disabled{opacity:.5;cursor:default}.send svg{width:18px;height:18px}',
    '.foot{text-align:center;font-size:10px;color:#94a3b8;padding:0 0 8px;background:#fff}',
    '.attach{width:40px;height:40px;border:1px solid #fcd34d;border-radius:12px;background:#fffbeb;color:#b45309;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:background .15s}',
    '.attach:hover{background:#fef3c7}.attach svg{width:20px;height:20px}.attach:disabled{opacity:.5;cursor:default}',
    '.card{align-self:stretch;background:linear-gradient(135deg,#fffbeb,#fff);border:1px solid #fde68a;border-radius:16px;padding:14px;animation:pop .25s ease-out}',
    '.card h4{margin:0 0 6px;font-size:14px;color:#92400e}.card p{margin:0 0 10px;font-size:13px;line-height:1.55;color:#334155;white-space:pre-wrap}',
    '.drop{border:2px dashed #fbbf24;border-radius:12px;padding:14px;text-align:center;cursor:pointer;color:#b45309;font-weight:600;font-size:13px;background:#fff;transition:background .15s}',
    '.drop:hover{background:#fef3c7}',
    '.thumb{align-self:flex-end;max-width:60%;max-height:160px;border-radius:12px;border:2px solid #fbbf24;object-fit:cover}',
    '.result{align-self:stretch;background:#fff;border:1px solid #fde68a;border-radius:16px;overflow:hidden;animation:pop .25s ease-out}',
    '.result .rh{display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:#fffbeb;border-bottom:1px solid #fde68a;font-size:12px;font-weight:700;color:#92400e}',
    '.result .rt{padding:12px;font-size:14px;line-height:1.7;color:#0f172a;white-space:pre-wrap;word-break:break-word;max-height:240px;overflow-y:auto}',
    '.copy{border:0;border-radius:999px;padding:5px 12px;font-size:12px;font-weight:700;cursor:pointer;background:#fbbf24;color:#1c1917;transition:background .15s}.copy:hover{background:#f59e0b}.copy.ok{background:#22c55e;color:#fff}',
    '.panel.dragging::after{content:"";position:absolute;inset:8px;border:3px dashed #f59e0b;border-radius:14px;background:rgba(254,243,199,.6);pointer-events:none}',
    '@media (max-width:480px){.panel{right:8px;left:8px;width:auto;bottom:88px;height:calc(100vh - 110px);max-height:none}.fab{right:16px;bottom:16px}}',
    '@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}'
  ].join('');

  root.innerHTML =
    '<style>' + css + '</style>' +
    '<button class="fab" id="fab" aria-label="' + T.open + '" aria-expanded="false">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>' +
      '<span class="dot"></span></button>' +
    '<section class="panel" id="panel" dir="rtl" role="dialog" aria-label="' + T.title + '">' +
      '<div class="head"><div class="avatar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg></div>' +
      '<div class="info"><b>' + T.title + '</b><span>' + T.status + '</span></div>' +
      '<button class="close" id="close" aria-label="' + T.close + '">&times;</button></div>' +
      '<div class="msgs" id="msgs" aria-live="polite"></div>' +
      '<div class="row"><button class="attach" id="attach" type="button" aria-label="' + T.attach + '" title="' + T.attach + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg></button>' +
      '<input type="file" id="file" accept="image/*" hidden>' +
      '<textarea id="input" rows="1" dir="auto" placeholder="' + T.placeholder + '" aria-label="' + T.placeholder + '"></textarea>' +
      '<button class="send" id="send" aria-label="' + T.send + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></button></div>' +
      '<div class="foot">Powered by arabic-ocr.com</div>' +
    '</section>';

  var $ = function (id) { return root.getElementById ? root.getElementById(id) : root.querySelector('#' + id); };
  var fab = $('fab'), panel = $('panel'), msgs = $('msgs'), input = $('input'), sendBtn = $('send'), attachBtn = $('attach'), fileEl = $('file');
  var isOpen = false, greeted = false, busy = false;

  // Keep clear of the portal's mobile bottom nav
  function adjustForPortalNav() {
    var nav = document.getElementById('mobile-bottom-nav');
    var small = window.matchMedia && window.matchMedia('(max-width:768px)').matches;
    var offset = nav && small && nav.offsetParent !== null ? nav.offsetHeight + 12 : 0;
    fab.style.bottom = (offset ? offset + 4 : 24) + 'px';
    panel.style.bottom = (offset ? offset + 76 : 96) + 'px';
  }
  adjustForPortalNav();
  window.addEventListener('resize', adjustForPortalNav);

  function addMsg(text, role) {
    var el = document.createElement('div');
    el.className = 'msg ' + role;
    el.setAttribute('dir', 'rtl');
    el.textContent = text; // textContent: model output is never interpreted as HTML
    msgs.appendChild(el);
    scroll();
    return el;
  }
  function addActions(list) {
    if (!list.length) return;
    var wrap = document.createElement('div');
    wrap.className = 'actions';
    list.forEach(function (a, i) {
      var link = document.createElement('a');
      link.className = 'act' + (i === 0 ? ' primary' : '');
      link.href = a.href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = a.label;
      wrap.appendChild(link);
    });
    msgs.appendChild(wrap);
    scroll();
  }
  function addChips(list) {
    var wrap = document.createElement('div');
    wrap.className = 'actions';
    list.forEach(function (c) {
      var b = document.createElement('button');
      b.className = 'chip';
      b.type = 'button';
      b.textContent = c[0];
      b.addEventListener('click', function () { wrap.remove(); send(c[1]); });
      wrap.appendChild(b);
    });
    msgs.appendChild(wrap);
    scroll();
  }
  function scroll() { msgs.scrollTop = msgs.scrollHeight; }
  function typing() {
    var el = document.createElement('div');
    el.className = 'typing';
    el.innerHTML = '<i></i><i></i><i></i>';
    msgs.appendChild(el);
    scroll();
    return el;
  }

  function safeHref(u) {
    try { var x = new URL(u); return x.protocol === 'https:' ? x.href : null; } catch (e) { return null; }
  }
  function labelFor(type) {
    if (type === 'download') return T.download;
    if (type === 'pricing' || type === 'limit') return T.upgrade;
    if (type === 'portal') return T.portal;
    return T.more;
  }
  function limitActions() {
    return [{ label: T.download, href: downloadLink() }, { label: T.upgrade, href: LINKS.pricing }];
  }

  // ── Smart rotating welcome ───────────────────────────────────────────────
  function pickWelcome() {
    var visits = 0, last = -1;
    try {
      visits = parseInt(localStorage.getItem('ocr_agent_visits') || '0', 10) + 1;
      last = parseInt(localStorage.getItem('ocr_agent_last_welcome') || '-1', 10);
      localStorage.setItem('ocr_agent_visits', String(visits));
    } catch (e) { /* ignore */ }
    var list = T.welcomes;
    // First visit always leads with the #1 handwriting message; afterwards rotate randomly, never repeating
    var i = visits <= 1 ? 0 : Math.floor(Math.random() * list.length);
    if (visits > 1 && i === last) i = (i + 1) % list.length;
    try { localStorage.setItem('ocr_agent_last_welcome', String(i)); } catch (e) { /* ignore */ }
    var h = new Date().getHours();
    var prefix = visits > 1 ? T.welcomeBack : (h >= 5 && h < 12 ? T.greetMorning : (h >= 18 || h < 5 ? T.greetEvening : ''));
    return (prefix ? prefix + ' ' : '') + list[i];
  }

  // ── In-chat OCR UI ────────────────────────────────────────────────────
  function addOcrOffer() {
    var card = document.createElement('div');
    card.className = 'card';
    card.setAttribute('dir', 'rtl');
    var h = document.createElement('h4'); h.textContent = T.tryTitle;
    var p = document.createElement('p'); p.textContent = T.tryBody;
    var d = document.createElement('div'); d.className = 'drop'; d.textContent = T.upload;
    d.addEventListener('click', function () { fileEl.click(); });
    card.appendChild(h); card.appendChild(p); card.appendChild(d);
    msgs.appendChild(card);
    scroll();
  }
  function addOcrResult(text) {
    var box = document.createElement('div');
    box.className = 'result';
    var head = document.createElement('div'); head.className = 'rh';
    var lbl = document.createElement('span'); lbl.textContent = T.ocrResult;
    var btn = document.createElement('button'); btn.className = 'copy'; btn.type = 'button'; btn.textContent = T.copy;
    var body = document.createElement('div'); body.className = 'rt';
    body.setAttribute('dir', 'rtl');
    body.textContent = text;
    btn.addEventListener('click', function () {
      var ok = function () {
        btn.textContent = T.copied; btn.classList.add('ok');
        setTimeout(function () { btn.textContent = T.copy; btn.classList.remove('ok'); }, 2000);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(body.textContent).then(ok, function () { fallbackCopy(body.textContent); ok(); });
      } else { fallbackCopy(body.textContent); ok(); }
    });
    head.appendChild(lbl); head.appendChild(btn);
    box.appendChild(head); box.appendChild(body);
    msgs.appendChild(box);
    scroll();
    return body;
  }
  function fallbackCopy(t) {
    var ta = document.createElement('textarea');
    ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (e) { /* ignore */ }
    ta.remove();
  }
  async function runOcr(file) {
    if (!file || busy) return;
    if (!isOpen) open(true);
    if (!/^image\//.test(file.type)) {
      addMsg(T.ocrPdf, 'bot');
      addActions([{ label: T.download, href: downloadLink() }, { label: T.portal, href: LINKS.web }]);
      return;
    }
    if (usedOcrToday()) {
      addMsg(T.ocrLimit, 'bot');
      addActions([{ label: T.portal, href: LINKS.web }, { label: T.download, href: downloadLink() }, { label: T.upgrade, href: LINKS.pricing }]);
      return;
    }
    busy = true; sendBtn.disabled = true; attachBtn.disabled = true;
    var t = null;
    try {
      var dataUrl = await imageToDataUrl(file);
      var img = document.createElement('img');
      img.className = 'thumb'; img.alt = file.name || 'image'; img.src = dataUrl;
      msgs.appendChild(img);
      var status = addMsg(T.ocrBusy, 'bot');
      t = typing();
      var raw = await callOcr([{ role: 'user', content: [
        { type: 'image_url', image_url: { url: dataUrl } },
        { type: 'text', text: 'Extract ALL text from this image exactly as it appears. The document may be in Arabic, English, or both. Output only the raw extracted text, preserving line breaks and layout. Do not add any labels, commentary, or explanation.' }
      ] }]);
      t.remove(); t = null; status.remove();
      if (!raw) { addMsg(T.ocrEmpty, 'bot'); return; }
      markOcrUsed();
      lastOcrText = raw;
      var body = addOcrResult(raw);
      // Auto-refine in place (keeps raw text if it fails)
      try {
        var refined = await callOcr([
          { role: 'system', content: 'You are an expert document formatter. Fix OCR errors (broken/merged words, misrecognized characters), organize into clear paragraphs, preserve the original language. Do NOT translate, summarize, or add content. Output ONLY the formatted plain text.' },
          { role: 'user', content: 'Text to format:\n' + raw }
        ]);
        if (refined) { body.textContent = refined; lastOcrText = refined; }
      } catch (e) { /* keep raw */ }
      addMsg(T.whatNext, 'bot');
      addChips(T.chips);
      addActions([{ label: T.download, href: downloadLink() }, { label: T.portal, href: LINKS.web }]);
    } catch (e) {
      if (t) t.remove();
      addMsg(T.ocrFail, 'bot');
    } finally {
      busy = false; sendBtn.disabled = false; attachBtn.disabled = false;
      fileEl.value = '';
    }
  }

  function open(silent) {
    isOpen = true;
    panel.classList.add('open');
    fab.classList.remove('nudge');
    fab.setAttribute('aria-expanded', 'true');
    if (!greeted) {
      greeted = true;
      if (!silent) {
        addMsg(T.hello, 'bot');
        if (getContext()) addMsg(T.hasDoc, 'bot');
        else addOcrOffer();
      }
    }
    // Don't steal focus (or pop the mobile keyboard) on auto-open
    if (!silent) setTimeout(function () { input.focus(); }, 150);
  }

  // ── Proactive engagement ─────────────────────────────────────────
  function once(key) {
    try {
      if (sessionStorage.getItem('ocr_agent_' + key)) return false;
      sessionStorage.setItem('ocr_agent_' + key, '1');
    } catch (e) { /* ignore */ }
    return true;
  }
  function proactive(key, render) {
    if (!once(key)) return;
    open(true);
    var t = typing();
    setTimeout(function () { t.remove(); render(); }, 900);
  }
  function isAppleUser() {
    var ua = navigator.userAgent || '';
    return /iPhone|iPad|iPod|Macintosh|Mac OS X/i.test(ua);
  }
  var engage = {
    pricing: function () {
      proactive('pricing', function () {
        addMsg(T.pricingHi, 'bot');
        addActions([{ label: T.claim, href: LINKS.pricing }]);
      });
    },
    welcome: function () {
      proactive('welcome', function () {
        addMsg(pickWelcome(), 'bot');
        var ua = navigator.userAgent || '';
        if (/Android/i.test(ua)) {
          addMsg(T.androidApp, 'bot');
          addActions([{ label: T.playStore, href: LINKS.android }, { label: T.tryWeb, href: LINKS.web }]);
        } else if (isAppleUser()) {
          addMsg(T.appleLLM, 'bot');
          addActions([{ label: T.getApp, href: downloadLink() }, { label: T.tryWeb, href: LINKS.web }]);
        } else if (/Windows/i.test(ua)) {
          addMsg(T.winApp, 'bot');
          addActions([{ label: T.winStore, href: LINKS.windows }, { label: T.tryWeb, href: LINKS.web }]);
        } else {
          addActions([{ label: T.tryWeb, href: LINKS.web }, { label: T.getApp, href: downloadLink() }]);
        }
        addOcrOffer();
        // A few FAQs (random 4 of 8, so it varies) + blog
        setTimeout(function () {
          addMsg(T.faqIntro, 'bot');
          addChips(T.faq.slice().sort(function () { return Math.random() - 0.5; }).slice(0, 4));
          addMsg(T.blogMsg, 'bot');
          addActions([{ label: T.blogBtn, href: LINKS.blog }]);
        }, 1500);
      });
    },
    scanComplete: function () {
      // Fires each time a new scan result appears (not once per session)
      if (busy) return;
      greeted = true;
      // Clear previous chat messages so we don't duplicate the scan-complete prompt
      msgs.innerHTML = '';
      open(true);
      addMsg(T.scanDone, 'bot');
      addChips(T.chips);
      setTimeout(function () { addMsg(T.scanTip, 'bot'); }, 800);
    }
  };
  window.OCRAgent = { open: function () { open(); }, close: close, engage: engage };
  function close() {
    isOpen = false;
    panel.classList.remove('open');
    fab.setAttribute('aria-expanded', 'false');
  }

  // ── Networking ────────────────────────────────────────────────────
  function post(payload) {
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, REQUEST_TIMEOUT_MS);
    return fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl.signal
    }).finally(function () { clearTimeout(timer); });
  }

  async function send(preset) {
    var text = (typeof preset === 'string' ? preset : input.value).trim();
    if (!text || busy) return;
    busy = true;
    sendBtn.disabled = true;
    if (typeof preset !== 'string') {
      input.value = '';
      input.style.height = 'auto';
    }
    addMsg(text, 'user');
    var t = typing();

    var payload = { message: text, sessionId: getSessionId(), platform: detectPlatform() };
    var ctx = getContext();
    if (ctx) payload.context = ctx;

    if (navigator.onLine === false) {
      t.remove();
      addMsg(T.network, 'bot');
      addActions([{ label: T.download, href: downloadLink() }]);
      return done();
    }

    var res = null, netFail = false;
    for (var attempt = 0; attempt < 2 && !res; attempt++) {
      try { res = await post(payload); }
      catch (e) { netFail = true; if (attempt === 0) await new Promise(function (r) { setTimeout(r, 800); }); }
    }
    t.remove();

    if (!res) {
      addMsg(T.network, 'bot');
      addActions([{ label: T.download, href: downloadLink() }]);
      return done();
    }

    var data = null;
    try { data = await res.json(); } catch (e) { /* non-JSON */ }

    if (res.status === 429) {
      addMsg((data && data.reply) || T.generic, 'bot');
      addActions(limitActions());
    } else if (!res.ok || !data || !data.reply) {
      addMsg((data && data.error) || T.generic, 'bot');
    } else {
      addMsg(data.reply, 'bot');
      var href = data.suggestedAction && safeHref(data.suggestedAction);
      if (href) addActions([{ label: labelFor(data.actionType), href: href }]);
    }
    done();
  }
  function done() {
    busy = false;
    sendBtn.disabled = false;
    input.focus();
  }

  // ── Events ────────────────────────────────────────────────────────
  fab.addEventListener('click', function () { isOpen ? close() : open(); });
  $('close').addEventListener('click', close);
  sendBtn.addEventListener('click', function () { send(); });
  attachBtn.addEventListener('click', function () { fileEl.click(); });
  fileEl.addEventListener('change', function () { if (fileEl.files && fileEl.files[0]) runOcr(fileEl.files[0]); });
  // Drag & drop an image anywhere on the chat panel
  ['dragenter', 'dragover'].forEach(function (ev) {
    panel.addEventListener(ev, function (e) { e.preventDefault(); panel.classList.add('dragging'); });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    panel.addEventListener(ev, function (e) { e.preventDefault(); if (ev === 'drop' || e.target === panel) panel.classList.remove('dragging'); });
  });
  panel.addEventListener('drop', function (e) {
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) runOcr(f);
  });
  // Paste an image (Cmd/Ctrl+V) into the input
  input.addEventListener('paste', function (e) {
    var items = (e.clipboardData && e.clipboardData.items) || [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].type && items[i].type.indexOf('image/') === 0) { e.preventDefault(); runOcr(items[i].getAsFile()); return; }
    }
  });
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
    if (e.key === 'Escape') close();
  });
  input.addEventListener('input', function () {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 96) + 'px';
  });

  // ── Page-aware auto-engagement ────────────────────────────────────
  var path = (location.pathname || '/').toLowerCase();
  if (path.indexOf('pricing') !== -1) {
    setTimeout(engage.pricing, 2500);
  } else if (path.indexOf('portal') !== -1) {
    // Detect a finished scan: the Quill editor fills with new extracted text
    var lastLen = 0, debounce = null;
    var watch = function () {
      var q = document.querySelector('#editor-container .ql-editor');
      if (!q) return setTimeout(watch, 1000);
      lastLen = (q.innerText || '').trim().length;
      new MutationObserver(function () {
        clearTimeout(debounce);
        debounce = setTimeout(function () {
          var len = (q.innerText || '').trim().length;
          // A big jump in content = OCR result inserted (not normal typing)
          if (len - lastLen > 40 && document.activeElement !== q) engage.scanComplete();
          lastLen = len;
        }, 1200);
      }).observe(q, { childList: true, subtree: true, characterData: true });
    };
    watch();
  } else if (path === '/' || path.indexOf('index') !== -1) {
    setTimeout(engage.welcome, 4000);
  } else {
    // Other pages: gentle nudge only
    setTimeout(function () { if (!isOpen) fab.classList.add('nudge'); }, 8000);
  }
})();
